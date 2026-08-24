import React, { useState } from "react";
import { assets } from "../assets/assets";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";
import ColorCombobox from "../components/ColorCombobox";

const Add = ({ token }) => {
  const [image1, setImage1] = useState(false);
  const [image2, setImage2] = useState(false);
  const [image3, setImage3] = useState(false);
  const [image4, setImage4] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Men");
  const [subCategory, setSubCategory] = useState("Topwear");
  const [color, setColor] = useState("");
  const [bestseller, setBestseller] = useState(true);
  const [size, setSize] = useState([]);

  // Fixed palette (matches the storefront's color filter and the AI
  // assistant's color-search enum) so every product's color stays a
  // controlled, filterable value instead of free text that could drift
  // out of sync with those.
  const productColors = [
    "Black",
    "White",
    "Blue",
    "Red",
    "Green",
    "Yellow",
    "Pink",
    "Brown",
    "Grey",
    "Beige",
    "Navy",
    "Maroon",
    "Olive",
    "Orange",
    "Purple",
    "Lavender",
    "Violet",
    "Magenta",
    "Cyan",
    "Turquoise",
    "Teal",
    "Mint",
    "Lime",
    "Sky Blue",
    "Royal Blue",
    "Light Blue",
    "Dark Blue",
    "Light Green",
    "Dark Green",
    "Bottle Green",
    "Forest Green",
    "Mustard",
    "Cream",
    "Ivory",
    "Off White",
    "Khaki",
    "Tan",
    "Camel",
    "Rust",
    "Coral",
    "Peach",
    "Wine",
    "Burgundy",
    "Plum",
    "Mauve",
    "Rose",
    "Gold",
    "Silver",
    "Bronze",
    "Charcoal",
    "Ash",
    "Nude",
  ];

  const onSubmitHandler = async (e) => {
    e.preventDefault();

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      formData.append("price", price);
      formData.append("category", category);
      formData.append("subCategory", subCategory);
      formData.append("color", color);
      formData.append("bestseller", bestseller);
      formData.append("size", JSON.stringify(size));

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
        setSize([]);
        setColor("");
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
            <p className="mb-2">Product category</p>
            <select
              onChange={(e) => setCategory(e.target.value)}
              value={category}
              className="w-full px-3 py-2 border border-gray-300"
            >
              <option value="Men">Men</option>
              <option value="Women">Women</option>
              <option value="Kids">Kids</option>
            </select>
          </div>
        </div>

        <div className="w-full">
          <div>
            <p className="mb-2">Sub category</p>
            <select
              onChange={(e) => setSubCategory(e.target.value)}
              value={subCategory}
              className="w-full px-3 py-2 border border-gray-300"
            >
              <option value="Topwear">Topwear</option>
              <option value="Bottomwear">Bottomwear</option>
              <option value="Winterwear">Winterwear</option>
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

      <div className="w-full">
        <p className="mb-2">Product Color</p>
        <ColorCombobox
          value={color}
          onChange={setColor}
          options={productColors}
          className="max-w-[220px]"
          placeholder="Select or type a color"
        />
      </div>

      <div className="w-full">
        <p className="mb-2">Product Sizes</p>
        <div className="flex flex-wrap gap-3">
          <div
            onClick={() =>
              setSize((prev) =>
                prev.includes("S")
                  ? prev.filter((item) => item !== "S")
                  : [...prev, "S"],
              )
            }
          >
            <p
              className={`px-3 py-1 cursor-pointer ${size.includes("S") ? "bg-black text-white" : "bg-slate-200"}`}
            >
              S
            </p>
          </div>

          <div
            onClick={() =>
              setSize((prev) =>
                prev.includes("M")
                  ? prev.filter((item) => item !== "M")
                  : [...prev, "M"],
              )
            }
          >
            <p
              className={`px-3 py-1 cursor-pointer ${size.includes("M") ? "bg-black text-white" : "bg-slate-200"}`}
            >
              M
            </p>
          </div>

          <div
            onClick={() =>
              setSize((prev) =>
                prev.includes("L")
                  ? prev.filter((item) => item !== "L")
                  : [...prev, "L"],
              )
            }
          >
            <p
              className={`px-3 py-1 cursor-pointer ${size.includes("L") ? "bg-black text-white" : "bg-slate-200"}`}
            >
              L
            </p>
          </div>

          <div
            onClick={() =>
              setSize((prev) =>
                prev.includes("XL")
                  ? prev.filter((item) => item !== "XL")
                  : [...prev, "XL"],
              )
            }
          >
            <p
              className={`px-3 py-1 cursor-pointer ${size.includes("XL") ? "bg-black text-white" : "bg-slate-200"}`}
            >
              XL
            </p>
          </div>

          <div
            onClick={() =>
              setSize((prev) =>
                prev.includes("XXL")
                  ? prev.filter((item) => item !== "XXL")
                  : [...prev, "XXL"],
              )
            }
          >
            <p
              className={`px-3 py-1 cursor-pointer ${size.includes("XXL") ? "bg-black text-white" : "bg-slate-200"}`}
            >
              XXL
            </p>
          </div>
        </div>
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
