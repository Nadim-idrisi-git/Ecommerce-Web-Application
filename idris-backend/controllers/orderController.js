import orderModel from "../models/orderModel.js";
import userModel from "../models/userModel.js";
import Stripe from "stripe";
import Razorpay from "razorpay";
import crypto from "crypto";

// Minimal audit trail for security-sensitive actions the AI assistant
// takes on the customer's behalf - never logs address/payment/contact
// details, only identifiers needed to trace what happened.
const auditAssistantAction = (action, req, details = {}) => {
    if (req.body?.source !== "assistant") return;

    console.log(JSON.stringify({
        audit: true,
        action,
        userId: req.userId,
        timestamp: Date.now(),
        ...details,
    }));
};

const getStripe = () => {
    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error("STRIPE_SECRET_KEY is missing");
    }

    return new Stripe(process.env.STRIPE_SECRET_KEY);
};

const getRazorpay = () => {
    if (!process.env.RAZORPAY_API_KEY || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error("Razorpay keys are missing");
    }

    return new Razorpay({
        key_id: process.env.RAZORPAY_API_KEY,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
};

const getFrontendUrl = (req) => {
    if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, "");

    if (process.env.NODE_ENV === "production") {
        throw new Error("FRONTEND_URL is missing");
    }

    return req.headers.origin || "http://localhost:5173";
};
const userCancellableStatuses = ["Order Placed", "Packing"];

const getRefundLabel = (status) => {
    if (status === "succeeded" || status === "processed") return "refunded";
    if (status === "failed") return "refund_failed";
    return "refund_processing";
};

const processRefund = async (order, reason) => {
    if (!order.payment || order.paymentMethod === "COD") {
        order.refundStatus = "not_required";
        order.paymentStatus = "cancelled";
        return;
    }

    if (order.refundStatus === "refunded") return;

    order.refundStatus = "refund_processing";
    order.refundReason = reason;

    if (order.paymentMethod === "Stripe") {
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        const paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;

        if (!paymentIntentId) {
            throw new Error("Stripe payment intent not found for refund");
        }

        const refund = await stripe.refunds.create({
            payment_intent: paymentIntentId,
            reason: "requested_by_customer",
            metadata: {
                orderId: order._id.toString(),
                reason
            }
        });

        order.refundId = refund.id;
        order.refundAmount = Number(refund.amount || 0) / 100;
        order.refundStatus = getRefundLabel(refund.status);
        order.refundDate = Date.now();
        order.paymentStatus = order.refundStatus === "refunded" ? "refunded" : "refund_processing";
        return;
    }

    if (order.paymentMethod === "Razorpay") {
        if (!order.razorpayPaymentId) {
            throw new Error("Razorpay payment id not found for refund");
        }

        const refund = await getRazorpay().payments.refund(order.razorpayPaymentId, {
            amount: Math.round(Number(order.amount || 0) * 100),
            notes: {
                orderId: order._id.toString(),
                reason
            }
        });

        order.refundId = refund.id;
        order.refundAmount = Number(refund.amount || 0) / 100;
        order.refundStatus = getRefundLabel(refund.status);
        order.refundDate = Date.now();
        order.paymentStatus = order.refundStatus === "refunded" ? "refunded" : "refund_processing";
        return;
    }

    order.refundStatus = "manual_refund_required";
    order.paymentStatus = "refund_pending";
};

const cancelOrderWithRefund = async (order, { cancelledBy, reason }) => {
    const cancelReason = reason || "Order cancelled";

    await processRefund(order, cancelReason);

    order.status = "Cancelled";
    order.estimatedDelivery = "";
    order.cancelledBy = cancelledBy;
    order.cancelReason = cancelReason;
    order.statusHistory.push({
        status: "Cancelled",
        date: Date.now(),
        note: cancelReason
    });

    await order.save();
};

const placeOrder = async (req, res) => {
    try {
        const { items, amount, address, paymentMethod } = req.body;

        if (!items || items.length === 0) {
            return res.json({ success: false, message: "Cart is empty" });
        }

        const orderData = {
            userId: req.userId,
            items,
            amount,
            address,
            paymentMethod,
            payment: false,
            paymentStatus: "pending",
            statusHistory: [{ status: "Order Placed", date: Date.now(), note: "Order received" }],
            date: Date.now()
        };

        const order = new orderModel(orderData);

        await order.save();

        if (paymentMethod === "COD") {
            await userModel.findByIdAndUpdate(req.userId, { cartData: {} });
            auditAssistantAction("place_order", req, { orderId: order._id.toString(), amount, paymentMethod });
            return res.json({ success: true, message: "Order placed successfully", order, clearCart: true });
        }

        if (paymentMethod === "Stripe") {
            const stripe = getStripe();
            const frontendUrl = getFrontendUrl(req);
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ["card"],
                mode: "payment",
                line_items: items.map((item) => ({
                    price_data: {
                        currency: "usd",
                        product_data: { name: `${item.name} (${item.size})` },
                        unit_amount: Math.round(Number(item.price) * 100),
                    },
                    quantity: Number(item.quantity),
                })).concat([{
                    price_data: {
                        currency: "usd",
                        product_data: { name: "Shipping Fee" },
                        unit_amount: Math.round((Number(amount) - items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0)) * 100),
                    },
                    quantity: 1,
                }]),
                success_url: `${frontendUrl}/verify?gateway=stripe&success=true&orderId=${order._id}&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${frontendUrl}/verify?gateway=stripe&success=false&orderId=${order._id}`,
                metadata: {
                    orderId: order._id.toString(),
                    userId: req.userId,
                },
            });

            order.stripeSessionId = session.id;
            await order.save();

            return res.json({ success: true, message: "Stripe checkout created", order, sessionUrl: session.url });
        }

        if (paymentMethod === "Razorpay") {
            const razorpay = getRazorpay();
            const razorpayOrder = await razorpay.orders.create({
                amount: Math.round(Number(amount) * 100),
                currency: "INR",
                receipt: order._id.toString(),
                notes: {
                    orderId: order._id.toString(),
                    userId: req.userId,
                },
            });

            order.razorpayOrderId = razorpayOrder.id;
            await order.save();

            return res.json({
                success: true,
                message: "Razorpay order created",
                order,
                razorpayOrder,
                key: process.env.RAZORPAY_API_KEY,
            });
        }

        res.json({ success: false, message: "Invalid payment method" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const verifyStripe = async (req, res) => {
    try {
        const { orderId, sessionId } = req.body;
        const order = await orderModel.findOne({ _id: orderId, userId: req.userId });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const session = await getStripe().checkout.sessions.retrieve(sessionId);

        if (session.payment_status === "paid" && session.metadata.orderId === orderId) {
            order.payment = true;
            order.paymentStatus = "paid";
            order.stripeSessionId = sessionId;
            order.statusHistory.push({ status: "Payment Verified", date: Date.now(), note: "Stripe payment completed" });
            await order.save();
            await userModel.findByIdAndUpdate(req.userId, { cartData: {} });

            return res.json({ success: true, message: "Payment verified", order, clearCart: true });
        }

        res.json({ success: false, message: "Payment not completed" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const verifyRazorpay = async (req, res) => {
    try {
        const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const order = await orderModel.findOne({ _id: orderId, userId: req.userId });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature === razorpay_signature && order.razorpayOrderId === razorpay_order_id) {
            order.payment = true;
            order.paymentStatus = "paid";
            order.razorpayPaymentId = razorpay_payment_id;
            order.statusHistory.push({ status: "Payment Verified", date: Date.now(), note: "Razorpay payment completed" });
            await order.save();
            await userModel.findByIdAndUpdate(req.userId, { cartData: {} });

            return res.json({ success: true, message: "Payment verified", order, clearCart: true });
        }

        res.json({ success: false, message: "Payment verification failed" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const cancelPayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        const order = await orderModel.findOne({ _id: orderId, userId: req.userId });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        if (!order.payment) {
            await orderModel.findByIdAndDelete(orderId);
            return res.json({ success: true, message: "Payment cancelled. Cart is still available." });
        }

        res.json({ success: true, message: "Order already paid" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const verifyPaymentStatus = async (req, res) => {
    try {
        const { orderId } = req.body;
        const order = await orderModel.findOne({ _id: orderId, userId: req.userId });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        if (order.payment) {
            return res.json({ success: true, message: "Payment already verified", order });
        }

        if (order.paymentMethod === "Stripe" && order.stripeSessionId) {
            const session = await getStripe().checkout.sessions.retrieve(order.stripeSessionId);

            if (session.payment_status === "paid") {
                order.payment = true;
                order.paymentStatus = "paid";
                order.statusHistory.push({ status: "Payment Verified", date: Date.now(), note: "Stripe payment completed" });
                await order.save();
                await userModel.findByIdAndUpdate(req.userId, { cartData: {} });

                return res.json({ success: true, message: "Stripe payment verified", order, clearCart: true });
            }

            return res.json({ success: false, message: "Stripe payment is still pending", order });
        }

        if (order.paymentMethod === "Razorpay") {
            return res.json({
                success: false,
                message: order.razorpayPaymentId
                    ? "Razorpay payment exists but is not verified"
                    : "Razorpay payments are verified immediately after checkout. Please complete payment again if needed.",
                order
            });
        }

        res.json({ success: false, message: "No online payment to verify for this order", order });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const userOrders = async (req, res) => {
    try {
        const orders = await orderModel.find({ userId: req.userId }).sort({ date: -1 });
        res.json({ success: true, orders });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const allOrders = async (req, res) => {
    try {
        const orders = await orderModel.find({}).sort({ date: -1 });
        const userIds = [...new Set(orders.map((order) => order.userId))];
        const users = await userModel.find({ _id: { $in: userIds } }).select("name email");
        const userMap = Object.fromEntries(users.map((user) => [user._id.toString(), user]));

        const ordersWithUsers = orders.map((order) => ({
            ...order.toObject(),
            user: userMap[order.userId] || null
        }));

        res.json({ success: true, orders: ordersWithUsers });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateOrder = async (req, res) => {
    try {
        const { orderId, status, courier, trackingNumber, estimatedDelivery, adminNote, payment } = req.body;
        const order = await orderModel.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const statusChanged = status && status !== order.status;

        if (courier !== undefined) order.courier = courier;
        if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;
        if (estimatedDelivery !== undefined) order.estimatedDelivery = estimatedDelivery;
        if (adminNote !== undefined) order.adminNote = adminNote;
        if (payment !== undefined){ order.payment = payment;
            order.paymentStatus = payment ? "paid" : "pending";
        }

        if (status === "Cancelled" && order.status !== "Cancelled") {
            await cancelOrderWithRefund(order, {
                cancelledBy: "admin",
                reason: adminNote || "Cancelled by admin"
            });

            return res.json({ success: true, message: "Order cancelled successfully", order });
        }

        if (status) order.status = status;

        if (statusChanged && status !== "Cancelled") {
            order.statusHistory.push({
                status,
                date: Date.now(),
                note: adminNote || ""
            });
        }

        await order.save();

        res.json({ success: true, message: "Order updated successfully", order });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const cancelUserOrder = async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        const order = await orderModel.findOne({ _id: orderId, userId: req.userId });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        if (order.status === "Cancelled") {
            return res.json({ success: true, message: "Order is already cancelled", order });
        }

        if (!userCancellableStatuses.includes(order.status)) {
            return res.status(400).json({
                success: false,
                message: "This order can no longer be cancelled online. Please contact support."
            });
        }

        await cancelOrderWithRefund(order, {
            cancelledBy: "user",
            reason: reason || "Cancelled by customer"
        });

        auditAssistantAction("cancel_order", req, { orderId: order._id.toString() });

        res.json({ success: true, message: "Order cancelled successfully", order });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export { placeOrder, verifyStripe, verifyRazorpay, verifyPaymentStatus, cancelPayment, cancelUserOrder, userOrders, allOrders, updateOrder };
