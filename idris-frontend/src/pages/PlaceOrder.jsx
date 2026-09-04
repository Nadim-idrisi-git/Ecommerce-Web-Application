import React, { useContext, useEffect, useState } from "react";
import Title from "../components/Title";
import { ShopContext } from "../context/ShopContext";
import { useNavigate } from "react-router-dom";
import { assets } from "../assets/assets";
import axios from "axios";
import { toast } from "react-toastify";

const emptyAddress = {
  label: "Home",
  firstName: "",
  lastName: "",
  email: "",
  street: "",
  city: "",
  state: "",
  zipcode: "",
  country: "",
  phone: "",
  isDefault: false,
};

const addressFields = ["firstName", "lastName", "email", "street", "city", "state", "zipcode", "country", "phone"];
const inputClass = "border border-gray-300 rounded px-3 py-2 w-full outline-none";

const toAddressForm = (address = emptyAddress) => ({
  label: address.label || "Home",
  firstName: address.firstName || "",
  lastName: address.lastName || "",
  email: address.email || "",
  street: address.street || "",
  city: address.city || "",
  state: address.state || "",
  zipcode: address.zipcode || "",
  country: address.country || "",
  phone: address.phone || "",
  isDefault: Boolean(address.isDefault),
});

const PlaceOrder = () => {

  const {
    currency,
    delivery_fee,
    cartItems,
    products,
    setPaymentMethod,
    token,
    placeOrder,
    setCartItems,
    backendUrl,
    user,
    addresses,
    refreshAddresses,
    saveAddress,
  } = useContext(ShopContext);

  const navigate = useNavigate();

  const [method, setMethod] = useState("COD");
  const [placing, setPlacing] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState("new");
  const [saveAddressChoice, setSaveAddressChoice] = useState(true);

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const [formData, setFormData] = useState(emptyAddress);

  useEffect(() => {
    if (token) refreshAddresses();
  }, [token, refreshAddresses]);

  useEffect(() => {
    if (!addresses.length || selectedAddressId !== "new") return;

    const defaultAddress = addresses.find((address) => address.isDefault) || addresses[0];
    setSelectedAddressId(defaultAddress._id);
    setFormData(toAddressForm(defaultAddress));
    setSaveAddressChoice(false);
  }, [addresses, selectedAddressId]);

  // Handle Input
  const onChangeHandler = (e) => {
    const name = e.target.name;
    const value = e.target.value;

    setFormData((data) => ({
      ...data,
      [name]: value,
    }));
  };

  const selectAddress = (addressId) => {
    setSelectedAddressId(addressId);

    if (addressId === "new") {
      setFormData({
        ...emptyAddress,
        email: user?.email || "",
      });
      setSaveAddressChoice(true);
      return;
    }

    const address = addresses.find((item) => item._id === addressId);
    if (address) {
      setFormData(toAddressForm(address));
      setSaveAddressChoice(false);
    }
  };

  // Cart Subtotal
  const getSubtotal = () => {

    let total = 0;

    for (const item in cartItems) {

      for (const size in cartItems[item]) {

        if (cartItems[item][size] > 0) {

          const productData = products.find(
            (product) => product._id === item
          );

          if (productData) {
            total +=
              productData.price * cartItems[item][size];
          }
        }
      }
    }

    return total;
  };

  // Submit
  const onSubmitHandler = async (e) => {

    e.preventDefault();

    if (!token) {
      navigate("/login");
      return;
    }

    for (const key of addressFields) {
      if (!formData[key]) {
        toast.error("Please fill all delivery address fields");
        return;
      }
    }

    const hasItems = Object.values(cartItems).some((sizes) =>
      Object.values(sizes).some((quantity) => quantity > 0)
    );

    if (!hasItems) {
      alert("Your cart is empty");
      return;
    }

    setPaymentMethod(method);

    try {
      setPlacing(true);
      let checkoutAddress = { ...formData };

      if (saveAddressChoice) {
        const saveResponse = await saveAddress(formData, selectedAddressId === "new" ? "" : selectedAddressId);

        if (!saveResponse.success) {
          toast.error(saveResponse.message || "Could not save address");
          return;
        }

        checkoutAddress = {
          ...checkoutAddress,
          addressId: saveResponse.address?._id || selectedAddressId,
          label: saveResponse.address?.label || checkoutAddress.label,
        };
      } else if (selectedAddressId !== "new") {
        checkoutAddress.addressId = selectedAddressId;
      }

      const response = await placeOrder({
        address: checkoutAddress,
        paymentMethod: method,
      });

      if (response.success) {
        if (method === "COD") {
          setCartItems({});
          navigate("/orders");
        } else if (method === "Stripe") {
          window.location.href = response.sessionUrl;
        } else if (method === "Razorpay") {
          const scriptLoaded = await loadRazorpayScript();

          if (!scriptLoaded) {
            alert("Razorpay SDK failed to load");
            return;
          }

          const options = {
            key: response.key,
            amount: response.razorpayOrder.amount,
            currency: response.razorpayOrder.currency,
            name: "IDRIS",
            description: "Order Payment",
            order_id: response.razorpayOrder.id,
            prefill: {
              name: user?.name || `${checkoutAddress.firstName} ${checkoutAddress.lastName}`,
              email: user?.email || checkoutAddress.email,
              contact: checkoutAddress.phone,
            },
            handler: async (paymentResponse) => {
              try {
                const verifyResponse = await axios.post(
                  backendUrl + "/api/order/verify-razorpay",
                  {
                    orderId: response.order._id,
                    razorpay_order_id: paymentResponse.razorpay_order_id,
                    razorpay_payment_id: paymentResponse.razorpay_payment_id,
                    razorpay_signature: paymentResponse.razorpay_signature,
                  },
                  { headers: { token } }
                );

                if (verifyResponse.data.success) {
                  setCartItems({});
                  navigate("/orders");
                } else {
                  alert(verifyResponse.data.message || "Payment verification failed");
                }
              } catch (error) {
                alert(error.response?.data?.message || error.message);
              }
            },
            retry: {
              enabled: true,
              max_count: 3,
            },
            modal: {
              ondismiss: async () => {
                try {
                  await axios.post(
                    backendUrl + "/api/order/cancel-payment",
                    { orderId: response.order._id },
                    { headers: { token } }
                  );
                  toast.info("Payment was not completed. Your cart is still available.");
                } catch (error) {
                  toast.error(error.response?.data?.message || error.message);
                }
              },
            },
            theme: { color: "#000000" },
          };

          const razorpay = new window.Razorpay(options);
          razorpay.on("payment.failed", (paymentResponse) => {
            const message = paymentResponse.error?.description || "Razorpay payment failed.";
            toast.error(`${message} Use card 4111 1111 1111 1111, any CVV, any future expiry, then OTP 123456.`);
          });
          razorpay.open();
        }
      } else {
        alert(response.message || "Could not place order");
      }
    } catch (error) {
      alert(error.response?.data?.message || error.message);
    } finally {
      setPlacing(false);
    }
  };

  return (
    <form
      onSubmit={onSubmitHandler}
      className="flex flex-col lg:flex-row justify-between gap-10 pt-10 border-t"
    >

      {/* LEFT SIDE */}
      <div className="flex flex-col gap-4 w-full lg:w-[55%]">

        <div className="text-xl mb-3">
          <Title text1={"DELIVERY"} text2={"INFORMATION"} />
        </div>

        {addresses.length > 0 && (
          <div className="border border-gray-200 p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="font-medium text-gray-800">Choose Address</p>
              <button
                onClick={() => selectAddress("new")}
                className="border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
                type="button"
              >
                Add New
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {addresses.map((address) => (
                <button
                  key={address._id}
                  onClick={() => selectAddress(address._id)}
                  className={`border p-3 text-left text-sm ${
                    selectedAddressId === address._id ? "border-black bg-gray-50" : "border-gray-200"
                  }`}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-800">{address.label || "Address"}</p>
                    {address.isDefault && <span className="text-xs text-green-600">Default</span>}
                  </div>
                  <p className="mt-2 text-gray-600">{address.firstName} {address.lastName}</p>
                  <p className="text-gray-500">{address.street}</p>
                  <p className="text-gray-500">{address.city}, {address.state} {address.zipcode}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border border-gray-200 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-gray-800">
              {selectedAddressId === "new" ? "New Delivery Address" : "Selected Delivery Address"}
            </p>
            {selectedAddressId !== "new" && (
              <button
                onClick={() => selectAddress("new")}
                className="text-sm underline text-gray-600"
                type="button"
              >
                Use different address
              </button>
            )}
          </div>

          <input
            name="label"
            value={formData.label}
            onChange={onChangeHandler}
            placeholder="Address Label"
            className={inputClass}
          />

        <div className="flex flex-col sm:flex-row gap-3">

          <input
            required
            name="firstName"
            value={formData.firstName}
            onChange={onChangeHandler}
            placeholder="First Name"
            className={inputClass}
          />

          <input
            required
            name="lastName"
            value={formData.lastName}
            onChange={onChangeHandler}
            placeholder="Last Name"
            className={inputClass}
          />

        </div>

        <input
          required
          name="email"
          value={formData.email}
          onChange={onChangeHandler}
          placeholder="Email Address"
          className={inputClass}
        />

        <input
          required
          name="street"
          value={formData.street}
          onChange={onChangeHandler}
          placeholder="Street"
          className={inputClass}
        />

        <div className="flex flex-col sm:flex-row gap-3">

          <input
            required
            name="city"
            value={formData.city}
            onChange={onChangeHandler}
            placeholder="City"
            className={inputClass}
          />

          <input
            required
            name="state"
            value={formData.state}
            onChange={onChangeHandler}
            placeholder="State"
            className={inputClass}
          />

        </div>

        <div className="flex flex-col sm:flex-row gap-3">

          <input
            required
            name="zipcode"
            value={formData.zipcode}
            onChange={onChangeHandler}
            placeholder="Zipcode"
            className={inputClass}
          />

          <input
            required
            name="country"
            value={formData.country}
            onChange={onChangeHandler}
            placeholder="Country"
            className={inputClass}
          />

        </div>

        <input
          required
          name="phone"
          value={formData.phone}
          onChange={onChangeHandler}
          placeholder="Phone"
          className={inputClass}
        />

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              checked={saveAddressChoice}
              onChange={(e) => setSaveAddressChoice(e.target.checked)}
              type="checkbox"
            />
            {selectedAddressId === "new" ? "Save this address for next time" : "Save changes to this address"}
          </label>
        </div>

      </div>

      {/* RIGHT SIDE */}
      <div className="w-full lg:max-w-[450px] lg:w-[40%]">

        {/* CART TOTAL */}
        <div className="mb-8">

          <div className="text-xl mb-3">
            <Title text1={"CART"} text2={"TOTALS"} />
          </div>

          <div className="flex justify-between border-b pb-2">
            <p>Subtotal</p>
            <p>
              {currency}
              {getSubtotal()}
            </p>
          </div>

          <div className="flex justify-between border-b py-2">
            <p>Shipping Fee</p>
            <p>
              {currency}
              {delivery_fee}
            </p>
          </div>

          <div className="flex justify-between pt-2 font-bold text-lg">
            <p>Total</p>
            <p>
              {currency}
              {getSubtotal() + delivery_fee}
            </p>
          </div>

        </div>

        {/* PAYMENT METHOD */}
        <div>

          <div className="text-lg mb-3">
            <Title text1={"PAYMENT"} text2={"METHOD"} />
          </div>

          <div className="flex flex-col gap-3">

            {/* Stripe */}
            <div
              onClick={() => setMethod("Stripe")}
              className={`flex items-center gap-3 border px-4 py-3 cursor-pointer rounded 
              ${method === "Stripe"
                  ? "bg-gray-200 border-black"
                  : ""
                }`}
            >

              <img
                src={assets?.stripe_logo}
                className="h-5"
                alt=""
              />

              <p>Stripe</p>

            </div>

            {/* Razorpay */}
            <div
              onClick={() => setMethod("Razorpay")}
              className={`flex items-center gap-3 border px-4 py-3 cursor-pointer rounded 
              ${method === "Razorpay"
                  ? "bg-gray-200 border-black"
                  : ""
                }`}
            >

              <img
                src={assets?.razorpay_logo}
                className="h-5"
                alt=""
              />

              <p>Razorpay</p>

            </div>

            {method === "Razorpay" && (
              <div className="border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 space-y-2">
                <p className="font-medium">Razorpay test card details</p>
                <div className="grid grid-cols-1 gap-1">
                  <p>Visa: <span className="font-medium">4111 1111 1111 1111</span></p>
                  <p>Mastercard: <span className="font-medium">5267 3181 8797 5449</span></p>
                  <p>CVV: any 3 digits | Expiry: any future date | OTP: <span className="font-medium">123456</span></p>
                </div>
              </div>
            )}

            {/* COD */}
            <div
              onClick={() => setMethod("COD")}
              className={`flex items-center gap-3 border px-4 py-3 cursor-pointer rounded 
              ${method === "COD"
                  ? "bg-gray-200 border-black"
                  : ""
                }`}
            >

              <p>Cash On Delivery</p>

            </div>

          </div>

        </div>

        {/* BUTTON */}
        <div className="mt-8">

          <button
            type="submit"
            disabled={placing}
            className="w-full bg-black text-white py-3 rounded hover:bg-gray-800 transition disabled:opacity-60"
          >
            {placing ? "PROCESSING..." : "PLACE ORDER"}
          </button>

        </div>

      </div>

    </form>
  );
};

export default PlaceOrder;
