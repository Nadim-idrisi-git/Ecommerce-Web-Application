import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import Title from "../components/Title";
import { ShopContext } from "../context/ShopContext";

const deliverySteps = [
  "Order Placed",
  "Packing",
  "Shipped",
  "Out for Delivery",
  "Delivered",
];

const formatDate = (value) => {
  if (!value) return "Not available";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const itemImage = (image) => Array.isArray(image) ? image[0] : image;
const cancellableStatuses = ["Order Placed", "Packing"];
const onlinePaymentMethods = ["Stripe", "Razorpay"];

const getPaymentLabel = (order) => {
  if (order.status === "Cancelled") {
    if (!order.payment) return "No payment captured";
    if (order.refundStatus === "not_required") return "No online refund needed";
    if (order.refundStatus === "refunded") return "Refunded";
    if (order.refundStatus === "manual_refund_required") return "Manual refund required";
    if (order.refundStatus === "refund_failed") return "Refund failed";
    if (order.refundStatus === "refund_processing" || onlinePaymentMethods.includes(order.paymentMethod)) {
      return "Refund pending";
    }
  }

  return order.payment ? "Paid" : order.paymentStatus || "Pending";
};

const TrackOrder = () => {
  const { orderId } = useParams();
  const { orders, token, refreshOrders, currency, cancelOrder } = useContext(ShopContext);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const loadOrder = async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        await refreshOrders();
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [refreshOrders, token]);

  const order = useMemo(
    () => orders.find((item) => item._id === orderId),
    [orders, orderId]
  );

  const timeline = useMemo(() => {
    if (!order) return [];

    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const historyByStatus = new Map(history.map((entry) => [entry.status, entry]));
    const currentStatus = order.status || "Order Placed";
    const currentIndex = deliverySteps.indexOf(currentStatus);

    if (currentStatus === "Cancelled") {
      return [
        ...deliverySteps.slice(0, Math.max(1, currentIndex + 1)).map((status, index) => ({
          status,
          complete: index <= Math.max(0, currentIndex),
          entry: historyByStatus.get(status),
        })),
        {
          status: "Cancelled",
          complete: true,
          entry: historyByStatus.get("Cancelled") || { date: order.date, note: order.adminNote },
        },
      ];
    }

    return deliverySteps.map((status, index) => ({
      status,
      complete: currentIndex === -1 ? status === "Order Placed" : index <= currentIndex,
      entry: historyByStatus.get(status),
    }));
  }, [order]);

  if (!token) {
    return (
      <div className="border-t min-h-[55vh] flex items-center justify-center text-center px-4">
        <div>
          <p className="text-gray-600 mb-5">Please sign in to track your order.</p>
          <Link to="/login" className="bg-black text-white px-8 py-3 text-sm">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="border-t pt-16 min-h-[55vh] text-center text-gray-500">
        Loading tracking details...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="border-t pt-16 min-h-[55vh] text-center">
        <p className="text-gray-600 mb-5">Order not found.</p>
        <Link to="/orders" className="inline-block border border-black px-8 py-3 text-sm hover:bg-black hover:text-white">
          Back to Orders
        </Link>
      </div>
    );
  }

  const address = order.address || {};
  const customerName = `${address.firstName || ""} ${address.lastName || ""}`.trim();
  const isCancelled = order.status === "Cancelled";
  const canCancel = cancellableStatuses.includes(order.status);

  const handleCancelOrder = async () => {
    const confirmed = window.confirm("Cancel this order? If payment was captured, refund processing will start.");
    if (!confirmed) return;

    try {
      setCancelling(true);
      const response = await cancelOrder(order._id);
      if (response.success) {
        toast.success(response.message);
      } else {
        toast.error(response.message || "Could not cancel order");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="border-t pt-12 min-h-[60vh]">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
        <div>
          <div className="text-2xl">
            <Title text1="TRACK" text2="ORDER" />
          </div>
          <p className="text-sm text-gray-500 break-all">Order #{order._id}</p>
          <p className="text-sm text-gray-500 mt-1">Placed on {formatDateTime(order.date)}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {canCancel && (
            <button
              onClick={handleCancelOrder}
              disabled={cancelling}
              className="border border-red-300 text-red-600 px-5 py-2 text-sm text-center hover:bg-red-50 disabled:opacity-60"
              type="button"
            >
              {cancelling ? "Cancelling..." : "Cancel Order"}
            </button>
          )}
          <Link to="/orders" className="border border-gray-300 px-5 py-2 text-sm text-center hover:bg-gray-100 w-fit">
            Back to Orders
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        <div className="space-y-6">
          <div className="border p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <div>
                <p className="text-xl font-medium text-gray-800">{order.status}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {isCancelled
                    ? "This order has been cancelled."
                    : order.estimatedDelivery
                    ? `Expected by ${formatDate(order.estimatedDelivery)}`
                    : "Estimated delivery will appear once assigned."}
                </p>
              </div>
              <div className={`px-4 py-2 text-sm w-fit ${
                order.status === "Delivered" ? "bg-green-50 text-green-700 border border-green-200" :
                order.status === "Cancelled" ? "bg-red-50 text-red-700 border border-red-200" :
                "bg-gray-50 text-gray-700 border border-gray-200"
              }`}>
                {getPaymentLabel(order)}
              </div>
            </div>

            <div className="space-y-0">
              {timeline.map((step, index) => (
                <div key={`${step.status}-${index}`} className="grid grid-cols-[28px_1fr] gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-4 h-4 rounded-full border ${
                      step.complete ? "bg-black border-black" : "bg-white border-gray-300"
                    }`} />
                    {index < timeline.length - 1 && (
                      <div className={`w-px flex-1 min-h-12 ${
                        step.complete && timeline[index + 1]?.complete ? "bg-black" : "bg-gray-200"
                      }`} />
                    )}
                  </div>
                  <div className="pb-6">
                    <p className={`font-medium ${step.complete ? "text-gray-900" : "text-gray-400"}`}>
                      {step.status}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {step.entry?.date ? formatDateTime(step.entry.date) : step.complete ? "Updated" : "Pending"}
                    </p>
                    {step.entry?.note && (
                      <p className="text-sm text-gray-500 mt-1">{step.entry.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border p-4 sm:p-6">
            <p className="font-medium text-gray-800 mb-4">Items in this order</p>
            <div className="space-y-3">
              {order.items.map((item, index) => (
                <div key={`${item.productId}-${item.size}-${index}`} className="flex gap-4 border p-3">
                  <img className="w-16 h-16 object-cover border" src={itemImage(item.image)} alt="" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800">{item.name}</p>
                    <p className="text-sm text-gray-500 mt-1">Size: {item.size} | Quantity: {item.quantity}</p>
                    <p className="text-sm text-gray-800 mt-1">{currency}{item.price} each</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="border p-4 sm:p-6">
            <p className="font-medium text-gray-800 mb-4">Delivery Details</p>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-500">Courier</p>
                <p className="font-medium text-gray-800">{order.courier || "Not assigned"}</p>
              </div>
              <div>
                <p className="text-gray-500">Tracking ID</p>
                <p className="font-medium text-gray-800 break-all">{order.trackingNumber || "Not available"}</p>
              </div>
              <div>
                <p className="text-gray-500">Estimated Delivery</p>
                <p className="font-medium text-gray-800">
                  {isCancelled ? "Cancelled" : formatDate(order.estimatedDelivery)}
                </p>
              </div>
            </div>
          </div>

          <div className="border p-4 sm:p-6">
            <p className="font-medium text-gray-800 mb-4">Shipping Address</p>
            <div className="text-sm text-gray-600 space-y-1">
              <p className="font-medium text-gray-800">{customerName || "Customer"}</p>
              <p>{address.street}</p>
              <p>{address.city}, {address.state} {address.zipcode}</p>
              <p>{address.country}</p>
              <p>{address.phone}</p>
              <p>{address.email}</p>
            </div>
          </div>

          <div className="border p-4 sm:p-6">
            <p className="font-medium text-gray-800 mb-4">Payment Summary</p>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Method</span>
                <span className="font-medium text-gray-800">{order.paymentMethod}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Status</span>
                <span className={`font-medium ${
                  isCancelled
                    ? order.refundStatus === "refunded" ? "text-green-600" : "text-orange-600"
                    : order.payment ? "text-green-600" : "text-orange-600"
                }`}>
                  {getPaymentLabel(order)}
                </span>
              </div>
              <div className="flex justify-between gap-4 border-t pt-3">
                <span className="text-gray-500">Total</span>
                <span className="font-medium text-gray-800">{currency}{order.amount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackOrder;
