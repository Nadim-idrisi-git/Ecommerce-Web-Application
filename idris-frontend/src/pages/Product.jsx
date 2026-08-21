import React, { useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import { assets } from "../assets/assets";
import RelatedProducts from "../components/RelatedProducts";

const Product = () => {
  const { productId } = useParams();
  const { products, currency, addToCart, buyNow } = useContext(ShopContext);

  const [productData, setProductData] = useState(false);
  const [image, setImage] = useState("");
  const [size, setSize] = useState("");
  const [activeTab, setActiveTab] = useState("description");
  const [showImage, setShowImage] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const reviews = [
    {
      name: "Muhammad Waseem Idrisi",
      rating: "⭐⭐⭐⭐⭐",
      comment: "Great quality product.",
    },
    {
      name: "Shah Alam",
      rating: "⭐⭐⭐⭐",
      comment: "Very comfortable.",
    },
    {
      name: "Mohammed Uvaish",
      rating: "⭐⭐⭐⭐⭐",
      comment: "Worth buying.",
    },
    {
      name: "Utkarsh",
      rating: "⭐⭐⭐⭐",
      comment: "Fabric is nice.",
    },
    {
      name: "Uwaish",
      rating: "⭐⭐⭐⭐⭐",
      comment: "Loved this product.",
    },
  ];

  const fetchProductData = async () => {
    const item = products.find((product) => product._id === productId);

    if (item) {
      setProductData(item);
      setImage(item.image?.[0] || "");
      setCurrentImageIndex(0);
    }
  };

  useEffect(() => {
    fetchProductData();
    window.scrollTo(0, 0);
  }, [productId, products]);

  return productData ? (
    <div className="border-t-2 pt-10 transition-opacity ease-in duration-500 opacity-100">
      {/* Product Data */}
      <div className="flex gap-12 sm:gap-12 flex-col sm:flex-row">
        {/* Product Images */}
        <div className="flex-1 flex flex-col-reverse gap-3 sm:flex-row">
          <div className="flex sm:flex-col overflow-x-auto sm:overflow-y-scroll justify-between sm:justify-normal sm:w-[18.7%] w-full">
            {productData.image?.map((item, index) => (
              <img
                key={index}
                onClick={() => setImage(item)}
                src={item}
                className="w-[24%] sm:w-full sm:mb-3 flex-shrink-0 cursor-pointer"
                alt=""
              />
            ))}

            {showImage && (
              <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
                <button
                  onClick={() => {
                    setShowImage(false);
                    setZoom(false);
                  }}
                  className="absolute top-6 left-6 text-white text-5xl"
                >
                  ×
                </button>

                <button
                  onClick={() =>
                    setCurrentImageIndex(
                      currentImageIndex === 0
                        ? productData.image.length - 1
                        : currentImageIndex - 1,
                    )
                  }
                  className="absolute left-8 text-white text-6xl"
                >
                  ‹
                </button>

                <img
                  src={productData.image[currentImageIndex]}
                  alt=""
                  onClick={() => setZoom(!zoom)}
                  className={`cursor-zoom-in transition duration-500 ${zoom ? "scale-150" : "scale-100"} max-h-[90vh] object-contain`}
                />

                <button
                  onClick={() =>
                    setCurrentImageIndex(
                      currentImageIndex === productData.image.length - 1
                        ? 0
                        : currentImageIndex + 1,
                    )
                  }
                  className="absolute right-8 text-white text-6xl"
                >
                  ›
                </button>
              </div>
            )}
          </div>

          <div className="w-full sm:w-[80%] overflow-hidden">
            <img
              src={image}
              alt=""
              onClick={() => setShowImage(true)}
              className="w-full h-auto cursor-zoom-in"
            />
          </div>
        </div>

        {/* Product Info */}
        <div className="flex-1">
          <h1 className="font-medium text-2xl mt-2">{productData.name}</h1>

          <div
            className="flex items-center gap-1 mt-2 cursor-pointer"
            onClick={() => {
              setActiveTab("reviews");
              document
                .getElementById("reviews-section")
                .scrollIntoView({ behavior: "smooth" });
            }}
          >
            <img src={assets.star_icon} className="w-3.5" alt="" />
            <img src={assets.star_icon} className="w-3.5" alt="" />
            <img src={assets.star_icon} className="w-3.5" alt="" />
            <img src={assets.star_icon} className="w-3.5" alt="" />
            <img src={assets.star_dull_icon} className="w-3.5" alt="" />

            <p className="pl-2">(122 Reviews)</p>
          </div>

          <p className="mt-5 text-3xl font-medium">
            {currency}
            {productData.price}
          </p>

          <p className="mt-5 text-gray-500 md:w-4/5">
            {productData.description}
          </p>

          <div className="flex flex-col gap-4 my-8">
            <p>Select Size</p>

            <div className="flex gap-2">
              {productData.sizes?.map((item, index) => (
                <button
                  key={index}
                  onClick={() => setSize(item)}
                  className={`border py-2 px-4 bg-gray-100 ${
                    item === size ? "border-orange-500" : ""
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => addToCart(productData._id, size)}
              className="bg-black text-white px-8 py-3 text-sm active:bg-gray-700"
              type="button"
            >
              ADD TO CART
            </button>

            <button
              onClick={() => buyNow(productData._id, size)}
              className="border border-black px-8 py-3 text-sm hover:bg-black hover:text-white transition"
              type="button"
            >
              BUY NOW
            </button>
          </div>

          <hr className="mt-8 sm:w-4/5" />

          <div className="text-sm text-gray-500 mt-5 flex flex-col gap-1">
            <p>100% Original product.</p>
            <p>Cash on delivery available.</p>
            <p>Easy return and exchange policy within 7 days.</p>
          </div>
        </div>
      </div>

      {/* Description Reviews */}
      <div id="reviews-section" className="mt-20">
        <div className="flex">
          <button
            onClick={() => setActiveTab("description")}
            className={`border px-5 py-3 text-sm ${
              activeTab === "description" ? "bg-gray-100 font-bold" : ""
            }`}
          >
            Description
          </button>

          <button
            onClick={() => setActiveTab("reviews")}
            className={`border px-5 py-3 text-sm ${
              activeTab === "reviews" ? "bg-gray-100 font-bold" : ""
            }`}
          >
            Reviews (122)
          </button>
        </div>

        <div className="border px-6 py-6 text-sm text-gray-500">
          {activeTab === "description" && (
            <div className="flex flex-col gap-4">
              <p>
                An e-commerce website is an online platform that facilitates
                buying and selling products online.
              </p>

              <p>Products include images, prices, descriptions and details.</p>
            </div>
          )}

          {activeTab === "reviews" && (
            <div className="space-y-4">
              {reviews
                .sort(() => 0.5 - Math.random())
                .slice(0, 3)
                .map((review, index) => (
                  <div key={index} className="border-b pb-4">
                    <h4 className="font-medium">{review.name}</h4>

                    <p>
                      {review.rating} {review.comment}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <RelatedProducts
        category={productData.category}
        subCategory={productData.subCategory}
      />
    </div>
  ) : (
    <div className="opacity-0"></div>
  );
};

export default Product;
