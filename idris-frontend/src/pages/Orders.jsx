import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { ShopContext } from "../context/ShopContext";

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

  return order.paymentMethod;
};

const Orders = () => {
  const { orders, currency, paymentMethod, token, refreshOrders, cancelOrder } = useContext(ShopContext);
  const [cancellingOrderId, setCancellingOrderId] = useState("");

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  const handleCancelOrder = async (orderId) => {
    const confirmed = window.confirm("Cancel this order? If payment was captured, refund processing will start.");
    if (!confirmed) return;

    try {
      setCancellingOrderId(orderId);
      const response = await cancelOrder(orderId);
      if (response.success) {
        toast.success(response.message);
      } else {
        toast.error(response.message || "Could not cancel order");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setCancellingOrderId("");
    }
  };

  if (!token) {
    return (
      <div className="border-t pt-16 px-4 sm:px-10 min-h-[60vh] text-center">
        <p className="text-gray-600 mb-4">Please sign in to view your orders.</p>
        <Link to="/login" className="inline-block bg-black text-white px-8 py-3 text-sm">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="border-t pt-16 px-4 sm:px-10 min-h-[60vh]">
      <div className="text-2xl mb-8">
        <h1 className="font-medium">
          MY <span className="text-gray-500">ORDERS</span>
        </h1>
      </div>

      {orders.length === 0 ? (
        <div className="text-center text-gray-500 mt-10">
          No orders yet.
        </div>
      ) : (
        <div>
          {orders.map((order) =>
            order.items.map((item) => {
              const isCancelled = order.status === "Cancelled";
              const canCancel = cancellableStatuses.includes(order.status);

              return (
              <div
                key={order._id + item.productId + item.size}
                className="py-4 border-t border-b text-gray-700 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
              >
                <div className="flex items-start gap-6 text-sm">
                  <img className="w-16 sm:w-20" src={item.image} alt="" />

                  <div>
                    <p className="sm:text-base font-medium">{item.name}</p>

                    <div className="flex flex-wrap items-center gap-3 mt-2 text-base text-gray-700">
                      <p className="text-lg">{currency}{item.price}</p>
                      <p className="text-lg">Quantity: {item.quantity}</p>
                      <p className="text-lg">Size: {item.size}</p>
                    </div>

                    <p className="mt-2">
                      Date: <span className="text-gray-400">{new Date(order.date).toDateString()}</span>
                    </p>

                    <p className="mt-2">
                      Payment: <span className="text-gray-400">{getPaymentLabel(order) || paymentMethod}</span>
                    </p>
                  </div>
                </div>

                <div className="md:w-1/2 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className={`min-w-2 h-2 rounded-full ${isCancelled ? "bg-red-500" : "bg-green-500"}`}></p>
                      <p className="text-sm md:text-base">{order.status}</p>
                    </div>
                    <div className="text-sm text-gray-500 mt-2 space-y-1">
                      {isCancelled && <p className="text-red-500">Delivery cancelled</p>}
                      {isCancelled && order.payment && <p>{getPaymentLabel(order)}</p>}
                      {!isCancelled && order.estimatedDelivery && <p>Expected by: {order.estimatedDelivery}</p>}
                      {order.courier && <p>Courier: {order.courier}</p>}
                      {order.trackingNumber && <p>Tracking ID: {order.trackingNumber}</p>}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    {canCancel && (
                      <button
                        onClick={() => handleCancelOrder(order._id)}
                        disabled={cancellingOrderId === order._id}
                        className="border border-red-300 text-red-600 px-4 py-2 text-sm font-medium rounded text-center hover:bg-red-50 disabled:opacity-60 transition"
                        type="button"
                      >
                        {cancellingOrderId === order._id ? "Cancelling..." : "Cancel Order"}
                      </button>
                    )}
                    <Link to={`/track/${order._id}`} className="border px-4 py-2 text-sm font-medium rounded text-center hover:bg-black hover:text-white transition">
                      Track Order
                    </Link>
                  </div>
                </div>
              </div>
            )})
          )}
        </div>
      )}
    </div>
  );
};

export default Orders;
