import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    items: {
        type: Array,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    address: {
        type: Object,
        required: true
    },
    paymentMethod: {
        type: String,
        required: true
    },
    payment: {
        type: Boolean,
        default: false
    },
    paymentStatus: {
        type: String,
        default: "pending"
    },
    refundStatus: {
        type: String,
        default: ""
    },
    refundId: {
        type: String,
        default: ""
    },
    refundAmount: {
        type: Number,
        default: 0
    },
    refundReason: {
        type: String,
        default: ""
    },
    refundDate: {
        type: Number,
        default: 0
    },
    cancelledBy: {
        type: String,
        default: ""
    },
    cancelReason: {
        type: String,
        default: ""
    },
    stripeSessionId: {
        type: String,
        default: ""
    },
    razorpayOrderId: {
        type: String,
        default: ""
    },
    razorpayPaymentId: {
        type: String,
        default: ""
    },
    status: {
        type: String,
        default: "Order Placed"
    },
    courier: {
        type: String,
        default: ""
    },
    trackingNumber: {
        type: String,
        default: ""
    },
    estimatedDelivery: {
        type: String,
        default: ""
    },
    adminNote: {
        type: String,
        default: ""
    },
    statusHistory: {
        type: Array,
        default: []
    },
    date: {
        type: Number,
        required: true
    }
}, {
    minimize: false
});

const orderModel = mongoose.models.order || mongoose.model("Order", orderSchema);

export default orderModel;
