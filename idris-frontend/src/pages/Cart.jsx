import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";
import { Link } from "react-router-dom";

const Cart = () => {
  const {
    products,
    currency,
    delivery_fee,
    cartItems,
    addToCart,
    removeFromCart,
  } = useContext(ShopContext);

  const [cartData, setCartData] = useState([]);

  // Convert cartItems → array
  useEffect(() => {
    const tempData = [];

    for (const items in cartItems) {
      for (const item in cartItems[items]) {
        if (cartItems[items][item] > 0) {
          tempData.push({
            _id: items,
            size: item,
            quantity: cartItems[items][item],
          });
        }
      }
    }

    setCartData(tempData);
  }, [cartItems]);

  // Subtotal
  const getSubtotal = () => {
    let total = 0;

    cartData.forEach((item) => {
      const productData = products.find(
        (product) => product._id === item._id
      );

      if (productData) {
        total += productData.price * item.quantity;
      }
    });

    return total;
  };

  return (
    <div className="border-t pt-14">

      <div className="text-2xl mb-5">
        <Title text1={"Shopping"} text2={"Cart"} />
      </div>

      {/* CART ITEMS */}
      <div>
        {cartData.length === 0 ? (
          <div className="text-center mt-10 space-y-4">

            <p className="text-gray-500">
              Your cart is empty 🛒
            </p>

            {/* SHOP NOW */}
            <Link
              to="/collection"
              className="inline-block px-6 py-2 border border-black hover:bg-black hover:text-white transition"
            >
              SHOP NOW
            </Link>

          </div>
        ) : (
          cartData.map((item, index) => {
            const productData = products.find(
              (product) => product._id === item._id
            );

            return (
              <div
                key={index}
                className="flex justify-between items-center border-b py-4"
              >
                {/* LEFT */}
                <div className="flex items-center gap-4">

                  <img
                    src={productData?.image[0]}
                    alt=""
                    className="w-16 h-16 object-cover rounded"
                  />

                  <div>
                    <p className="font-semibold">{productData?.name}</p>

                    <p className="text-sm text-gray-500">
                      Size: {item.size}
                    </p>

                    {/* QUANTITY */}
                    <div className="flex items-center gap-2 mt-2">

                      <button
                        onClick={() =>
                          removeFromCart(item._id, item.size)
                        }
                        className="px-2 border"
                      >
                        -
                      </button>

                      <span>{item.quantity}</span>

                      <button
                        onClick={() =>
                          addToCart(item._id, item.size)
                        }
                        className="px-2 border"
                      >
                        +
                      </button>

                    </div>
                  </div>
                </div>

                {/* RIGHT */}
                <div className="text-right">

                  <p>
                    {currency}
                    {productData?.price * item.quantity}
                  </p>

                  <button
                    onClick={() =>
                      removeFromCart(item._id, item.size, true)
                    }
                    className="text-red-500 text-sm mt-2"
                  >
                    Remove
                  </button>

                </div>
              </div>
            );
          })
        )}
      </div>

      {/* TOTAL + CHECKOUT */}
      {cartData.length > 0 && (
        <div className="mt-10 text-right space-y-2">

          <p>
            Subtotal: {currency}
            {getSubtotal()}
          </p>

          <p>
            Delivery Fee: {currency}
            {delivery_fee}
          </p>

          <p className="text-lg font-bold">
            Total: {currency}
            {getSubtotal() + delivery_fee}
          </p>

          {/* CHECKOUT BUTTON */}
          <Link
            to="/place-order"
            className="inline-block mt-4 px-6 py-3 bg-black text-white hover:bg-gray-800 transition"
          >
            PROCEED TO CHECKOUT
          </Link>

        </div>
      )}

    </div>
  );
};

export default Cart;