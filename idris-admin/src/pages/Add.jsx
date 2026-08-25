import React, { useState } from "react";
import { assets } from "../assets/assets";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import ColorCombobox from "../components/ColorCombobox";
import {
  GENDERS,
  CATEGORIES,
  PRODUCT_TYPES,
  MATERIALS,
  FITS,
  PATTERNS,
  OCCASIONS,
  SEASONS,
  STYLES,
  SIZES,
  COLORS,
} from "../constants/productOptions";

const Add = ({ token }) => {
  const [image1, setImage1] = useState(false);
  const [image2, setImage2] = useState(false);
  const [image3, setImage3] = useState(false);
  const [image4, setImage4] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [gender, setGender] = useState("Men");
  const [category, setCategory] = useState("Topwear");
  const [productType, setProductType] = useState("");
  const [color, setColor] = useState("");
  const [bestseller, setBestseller] = useState(true);
  const [sizes, setSizes] = useState([]);
  const [material, setMaterial] = useState("");
  const [fit, setFit] = useState("");
  const [pattern, setPattern] = useState("");
  const [occasions, setOccasions] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [style, setStyle] = useState([]);
  const [features, setFeatures] = useState("");

  const toggle = (setter) => (value) =>
    setter((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  const toggleSize = toggle(setSizes);
  const toggleOccasion = toggle(setOccasions);
  const toggleSeason = toggle(setSeasons);
  const toggleStyle = toggle(setStyle);

  const onSubmitHandler = async (e) => {
    e.preventDefault();

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      formData.append("price", price);
      formData.append("gender", gender);
      formData.append("category", category);
      formData.append("productType", productType);
      formData.append("color", color);
      formData.append("bestseller", bestseller);
      formData.append("sizes", JSON.stringify(sizes));
      formData.append("material", material);
      formData.append("fit", fit);
      formData.append("pattern", pattern);
      formData.append(
        "features",
        JSON.stringify(features.split(",").map((item) => item.trim()).filter(Boolean)),
      );
      formData.append("occasions", JSON.stringify(occasions));
      formData.append("seasons", JSON.stringify(seasons));
      formData.append("style", JSON.stringify(style));

      image1 && formData.append("image1", image1);
      image2 && formData.append("image2", image2);
      image3 && formData.append("image3", image3);
      image4 && formData.append("image4", image4);
      const response = await axios.post(
        backendUrl + "/api/product/add",
        formData,
        { headers: { token } },
      );

      if (response.data.success) {
        toast.success("Product added successfully");
        setName("");
        setDescription("");
        setPrice("");
        setImage1(false);
        setImage2(false);
        setImage3(false);
        setImage4(false);
        setSizes([]);
        setColor("");
        setProductType("");
        setMaterial("");
        setFit("");
        setPattern("");
        setOccasions([]);
        setSeasons([]);
        setStyle([]);
        setFeatures("");
      } else {
        toast.error("Failed to add product");
      }
    } catch (error) {
      console.error(
        "Add product failed:",
        error.response?.data?.message || error.message,
      );
      toast.error("Failed to add product");
    }
  };

  return (
    <form
      onSubmit={onSubmitHandler}
      className="flex flex-col w-full max-w-3xl items-start gap-4"
    >
      <div className="w-full">
        <p className="mb-2">Upload Image</p>

        <div className="grid grid-cols-2 sm:flex gap-2 max-w-md">
          <label htmlFor="image1">
            <img
              className="w-full max-w-20 aspect-square object-cover cursor-pointer"
              src={!image1 ? assets.upload_area : URL.createObjectURL(image1)}
              alt=""
            />
            <input
              onChange={(e) => setImage1(e.target.files[0])}
              type="file"
              id="image1"
              hidden
            />
          </label>
          <label htmlFor="image2">
            <img
              className="w-full max-w-20 aspect-square object-cover cursor-pointer"
              src={!image2 ? assets.upload_area : URL.createObjectURL(image2)}
              alt=""
            />
            <input
              onChange={(e) => setImage2(e.target.files[0])}
              type="file"
              id="image2"
              hidden
            />
          </label>
          <label htmlFor="image3">
            <img
              className="w-full max-w-20 aspect-square object-cover cursor-pointer"
              src={!image3 ? assets.upload_area : URL.createObjectURL(image3)}
              alt=""
            />
            <input
              onChange={(e) => setImage3(e.target.files[0])}
              type="file"
              id="image3"
              hidden
            />
          </label>
          <label htmlFor="image4">
            <img
              className="w-full max-w-20 aspect-square object-cover cursor-pointer"
              src={!image4 ? assets.upload_area : URL.createObjectURL(image4)}
              alt=""
            />
            <input
              onChange={(e) => setImage4(e.target.files[0])}
              type="file"
              id="image4"
              hidden
            />
          </label>
        </div>
      </div>

      <div className="w-full">
        <p className="mb-2">Product name</p>
        <input
          onChange={(e) => setName(e.target.value)}
          value={name}
          className="max-w-[500px] px-3 py-2 w-full border border-gray-300"
          type="text"
          placeholder="Type product name..."
          required
        />
      </div>

      <div className="w-full">
        <p className="mb-2">Product Description</p>
        <textarea
          onChange={(e) => setDescription(e.target.value)}
          value={description}
          className="max-w-[500px] px-3 py-2 w-full min-h-24 border border-gray-300"
          type="text"
          placeholder="Type product description..."
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[160px_180px_160px] gap-3 sm:gap-5 w-full max-w-[560px]">
        <div className="w-full">
          <div>
            <p className="mb-2">Gender</p>
            <select
              onChange={(e) => setGender(e.target.value)}
              value={gender}
              className="w-full px-3 py-2 border border-gray-300"
            >
              {GENDERS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="w-full">
          <div>
            <p className="mb-2">Category</p>
            <select
              onChange={(e) => setCategory(e.target.value)}
              value={category}
              className="w-full px-3 py-2 border border-gray-300"
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="w-full sm:col-span-2 lg:col-span-1">
          <p className="mb-2">Product Price</p>
          <input
            onChange={(e) => setPrice(e.target.value)}
            value={price}
            className="w-full px-3 py-2 border border-gray-300"
            type="Number"
            placeholder="25"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 w-full">
        <div className="w-full">
          <p className="mb-2">Product Type</p>
          <ColorCombobox
            value={productType}
            onChange={setProductType}
            options={PRODUCT_TYPES}
            placeholder="e.g. T-Shirt"
          />
        </div>

        <div className="w-full">
          <p className="mb-2">Material</p>
          <ColorCombobox
            value={material}
            onChange={setMaterial}
            options={MATERIALS}
            placeholder="e.g. Cotton"
          />
        </div>

        <div className="w-full">
          <p className="mb-2">Fit</p>
          <ColorCombobox
            value={fit}
            onChange={setFit}
            options={FITS}
            placeholder="e.g. Regular"
          />
        </div>

        <div className="w-full">
          <p className="mb-2">Pattern</p>
          <ColorCombobox
            value={pattern}
            onChange={setPattern}
            options={PATTERNS}
            placeholder="e.g. Solid"
          />
        </div>
      </div>

      <div className="w-full">
        <p className="mb-2">Product Color</p>
        <ColorCombobox
          value={color}
          onChange={setColor}
          options={COLORS}
          className="max-w-[220px]"
          placeholder="Select or type a color"
        />
      </div>

      <div className="w-full">
        <p className="mb-2">Product Sizes</p>
        <div className="flex flex-wrap gap-3">
          {SIZES.map((productSize) => (
            <div key={productSize} onClick={() => toggleSize(productSize)}>
              <p
                className={`px-3 py-1 cursor-pointer ${sizes.includes(productSize) ? "bg-black text-white" : "bg-slate-200"}`}
              >
                {productSize}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full">
        <p className="mb-2">Occasions</p>
        <div className="flex flex-wrap gap-3">
          {OCCASIONS.map((option) => (
            <div key={option} onClick={() => toggleOccasion(option)}>
              <p
                className={`px-3 py-1 cursor-pointer text-sm ${occasions.includes(option) ? "bg-black text-white" : "bg-slate-200"}`}
              >
                {option}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full">
        <p className="mb-2">Seasons</p>
        <div className="flex flex-wrap gap-3">
          {SEASONS.map((option) => (
            <div key={option} onClick={() => toggleSeason(option)}>
              <p
                className={`px-3 py-1 cursor-pointer text-sm ${seasons.includes(option) ? "bg-black text-white" : "bg-slate-200"}`}
              >
                {option}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full">
        <p className="mb-2">Style</p>
        <div className="flex flex-wrap gap-3">
          {STYLES.map((option) => (
            <div key={option} onClick={() => toggleStyle(option)}>
              <p
                className={`px-3 py-1 cursor-pointer text-sm ${style.includes(option) ? "bg-black text-white" : "bg-slate-200"}`}
              >
                {option}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full">
        <p className="mb-2">Features</p>
        <input
          onChange={(e) => setFeatures(e.target.value)}
          value={features}
          className="max-w-[500px] px-3 py-2 w-full border border-gray-300"
          type="text"
          placeholder="Comma-separated, e.g. Lightweight, Breathable, Soft Fabric"
        />
      </div>

      <div className="flex gap-2 mt-2">
        <input
          onChange={() => setBestseller((prev) => !prev)}
          checked={bestseller}
          type="checkbox"
          id="bestseller"
        />
        <label className="cursor-pointer" htmlFor="bestseller">
          Add to bestseller
        </label>
      </div>

      <button type="submit" className="w-28 py-3 mt-4 bg-black text-white">
        ADD
      </button>
    </form>
  );
};

export default Add;
