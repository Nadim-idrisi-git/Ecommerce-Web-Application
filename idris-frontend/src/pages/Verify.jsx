import React, { useContext, useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";

const Verify = () => {
  const [searchParams] = useSearchParams();
  const {
    backendUrl,
    token,
    orders,
    setCartItems,
    refreshOrders,
    navigate,
  } = useContext(ShopContext);

  const [status, setStatus] = useState("");
  const [success, setSuccess] = useState(null);
  const [checkingOrderId, setCheckingOrderId] = useState("");

  const hasReturnParams = searchParams.has("gateway");

  const verifyOrderPayment = async (orderId) => {
    try {
      setCheckingOrderId(orderId);
      const response = await axios.post(
        backendUrl + "/api/order/verify-payment",
        { orderId },
        { headers: { token } }
      );

      if (response.data.clearCart) {
        setCartItems({});
      }

      await refreshOrders();
      setSuccess(response.data.success);
      setStatus(response.data.message);
    } catch (error) {
      setSuccess(false);
      setStatus(error.response?.data?.message || error.message);
    } finally {
      setCheckingOrderId("");
    }
  };

  useEffect(() => {
    const verifyPaymentReturn = async () => {
      const gateway = searchParams.get("gateway");
      const paymentSuccess = searchParams.get("success");
      const orderId = searchParams.get("orderId");
      const sessionId = searchParams.get("session_id");

      if (!token) {
        navigate("/login");
        return;
      }

      if (!hasReturnParams) {
        refreshOrders();
        return;
      }

      setStatus("Verifying payment...");

      try {
        if (gateway === "stripe" && paymentSuccess === "true") {
          const response = await axios.post(
            backendUrl + "/api/order/verify-stripe",
            { orderId, sessionId },
            { headers: { token } }
          );

          if (response.data.success) {
            setCartItems({});
            await refreshOrders();
            setSuccess(true);
            setStatus("Payment successful. Your order has been placed.");
          } else {
            setSuccess(false);
            setStatus(response.data.message || "Payment verification failed.");
          }
          return;
        }

        if (gateway === "stripe" && paymentSuccess === "false") {
          await axios.post(
            backendUrl + "/api/order/cancel-payment",
            { orderId },
            { headers: { token } }
          );
          await refreshOrders();
          setSuccess(false);
          setStatus("Payment cancelled. Your cart is still available.");
          return;
        }

        setSuccess(false);
        setStatus("Invalid payment verification request.");
      } catch (error) {
        setSuccess(false);
        setStatus(error.response?.data?.message || error.message);
      }
    };

    verifyPaymentReturn();
  }, [backendUrl, hasReturnParams, navigate, refreshOrders, searchParams, setCartItems, token]);

  if (!token) {
    return (
      <div className="border-t min-h-[55vh] flex items-center justify-center text-center px-4">
        <div>
          <p className="text-gray-600 mb-5">Please sign in to view payment history.</p>
          <Link to="/login" className="bg-black text-white px-8 py-3 text-sm">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  const paymentOrders = orders.filter((order) => order.paymentMethod !== "COD");
  const codOrders = orders.filter((order) => order.paymentMethod === "COD");

  return (
    <div className="border-t pt-12 min-h-[60vh]">
      <div className="text-2xl mb-6">
        <Title text1="PAYMENT" text2="HISTORY" />
      </div>

      {status && (
        <div className={`mb-6 border px-4 py-3 text-sm ${
          success === true ? "bg-green-50 border-green-200 text-green-700" :
          success === false ? "bg-red-50 border-red-200 text-red-700" :
          "bg-gray-50 border-gray-200 text-gray-700"
        }`}>
          {status}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {[...paymentOrders, ...codOrders].length === 0 ? (
          <div className="border px-4 py-8 text-center text-gray-500">
            No payments found.
          </div>
        ) : (
          [...paymentOrders, ...codOrders].map((order) => (
            <div key={order._id} className="border px-4 py-4 bg-white">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <p className="font-medium text-gray-800">Order #{order._id}</p>
                  <p className="text-sm text-gray-500 mt-1">{new Date(order.date).toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {order.items.length} item{order.items.length > 1 ? "s" : ""}:{" "}
                    {order.items.map((item) => `${item.name} (${item.size} x${item.quantity})`).join(", ")}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm lg:min-w-[560px]">
                  <div>
                    <p className="text-gray-500">Gateway</p>
                    <p className="font-medium text-gray-800">{order.paymentMethod}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Amount</p>
                    <p className="font-medium text-gray-800">${order.amount}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Payment</p>
                    <p className={`font-medium ${order.payment ? "text-green-600" : "text-orange-600"}`}>
                      {order.payment ? "Verified" : order.paymentStatus || "Pending"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Order</p>
                    <p className="font-medium text-gray-800">{order.status}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-600">
                {order.stripeSessionId && (
                  <p><span className="text-gray-500">Stripe Session:</span> {order.stripeSessionId}</p>
                )}
                {order.razorpayOrderId && (
                  <p><span className="text-gray-500">Razorpay Order:</span> {order.razorpayOrderId}</p>
                )}
                {order.razorpayPaymentId && (
                  <p><span className="text-gray-500">Razorpay Payment:</span> {order.razorpayPaymentId}</p>
                )}
              </div>

              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                {!order.payment && order.paymentMethod !== "COD" && (
                  <button
                    onClick={() => verifyOrderPayment(order._id)}
                    disabled={checkingOrderId === order._id}
                    className="bg-black text-white px-5 py-2 text-sm disabled:opacity-60"
                    type="button"
                  >
                    {checkingOrderId === order._id ? "Checking..." : "Verify Payment"}
                  </button>
                )}

                <Link to={`/track/${order._id}`} className="border border-gray-300 px-5 py-2 text-sm text-center hover:bg-gray-100">
                  Track Order
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Verify;
