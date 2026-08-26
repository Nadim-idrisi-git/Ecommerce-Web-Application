import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";
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
import { parseFeaturesInput } from "../utils/parseFeatures";

const emptyEditData = {
  name: "",
  description: "",
  price: "",
  gender: "Men",
  category: "Topwear",
  productType: "",
  color: "",
  bestseller: false,
  sizes: [],
  material: "",
  fit: "",
  pattern: "",
  occasions: [],
  seasons: [],
  style: [],
  features: "",
};

const List = ({ token }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState(emptyEditData);

  const getImageUrl = (image) => {
    if (!image) return "";
    return image.startsWith("/assets") ? backendUrl + image : image;
  };

  const openProduct = (product) => {
    setSelectedProduct(product);
    setEditMode(false);
    setEditData({
      name: product.name || "",
      description: product.description || "",
      price: product.price || "",
      gender: product.gender || "Men",
      category: product.category || "Topwear",
      productType: product.productType || "",
      color: product.color || "",
      bestseller: Boolean(product.bestseller),
      sizes: product.sizes || [],
      material: product.material || "",
      fit: product.fit || "",
      pattern: product.pattern || "",
      occasions: product.occasions || [],
      seasons: product.seasons || [],
      style: product.style || [],
      features: (product.features || []).join(", "),
    });
  };

  const closeProduct = () => {
    setSelectedProduct(null);
    setEditMode(false);
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const response = await axios.get(backendUrl + "/api/product/list");

      if (response.data.success) {
        setProducts(response.data.products);
      } else {
        toast.error(response.data.message || "Failed to load products");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  };

  const removeProduct = async (id) => {
    try {
      const response = await axios.post(
        backendUrl + "/api/product/remove",
        { id },
        { headers: { token } },
      );

      if (response.data.success) {
        toast.success(response.data.message);
        setProducts((prev) => prev.filter((product) => product._id !== id));
        if (selectedProduct?._id === id) {
          closeProduct();
        }
      } else {
        toast.error(response.data.message || "Failed to remove product");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const updateProduct = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);
      const response = await axios.post(
        backendUrl + "/api/product/update",
        {
          id: selectedProduct._id,
          ...editData,
          features: parseFeaturesInput(editData.features),
        },
        { headers: { token } },
      );

      if (response.data.success) {
        toast.success(response.data.message);
        setProducts((prev) =>
          prev.map((product) =>
            product._id === response.data.product._id
              ? response.data.product
              : product,
          ),
        );
        setSelectedProduct(response.data.product);
        setEditMode(false);
      } else {
        toast.error(response.data.message || "Failed to update product");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleListValue = (field, value) => {
    setEditData((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  return (
    <div className="w-full max-w-5xl">
      <div className="flex items-center justify-between gap-3 mb-5">
        <p className="text-xl font-medium">All Products List</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={fetchProducts}
            className="border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="hidden md:grid grid-cols-[80px_2fr_1fr_1fr_90px] items-center py-3 px-4 border bg-gray-100 text-sm font-medium">
        <p>Image</p>
        <p>Name</p>
        <p>Category</p>
        <p>Price</p>
        <p className="text-center">Action</p>
      </div>

      {loading ? (
        <div className="border border-t-0 md:border-t px-4 py-8 text-center text-gray-500">
          Loading products...
        </div>
      ) : products.length === 0 ? (
        <div className="border border-t-0 md:border-t px-4 py-8 text-center text-gray-500">
          No products found.
        </div>
      ) : (
        <div className="flex flex-col">
          {products.map((product) => (
            <div
              key={product._id}
              onClick={() => openProduct(product)}
              className="grid grid-cols-[70px_1fr_auto] md:grid-cols-[80px_2fr_1fr_1fr_90px] items-center gap-3 py-3 px-3 sm:px-4 border border-t-0 first:border-t md:first:border-t-0 text-sm bg-white cursor-pointer hover:bg-gray-50"
            >
              <img
                className="w-14 h-14 object-cover border"
                src={getImageUrl(product.images?.[0])}
                alt={product.name}
              />

              <div className="min-w-0">
                <p className="font-medium text-gray-800 truncate">
                  {product.name}
                </p>
                <p className="md:hidden text-xs text-gray-500 mt-1">
                  {product.gender} / {product.category}
                </p>
                <p className="md:hidden text-xs text-gray-500 mt-1">
                  ${product.price}
                </p>
              </div>

              <p className="hidden md:block text-gray-700">
                {product.gender} / {product.category}
              </p>
              <p className="hidden md:block text-gray-700">${product.price}</p>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeProduct(product._id);
                }}
                className="justify-self-end md:justify-self-center w-8 h-8 border border-gray-300 text-lg leading-none hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                type="button"
                aria-label={`Remove ${product.name}`}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto border shadow-lg">
            <div className="flex items-center justify-between gap-4 border-b px-4 sm:px-6 py-4">
              <div className="min-w-0">
                <p className="text-lg font-medium text-gray-800 truncate">
                  {editMode ? "Edit Product" : selectedProduct.name}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {selectedProduct.gender} / {selectedProduct.category}
                </p>
              </div>
              <button
                onClick={closeProduct}
                className="w-8 h-8 border border-gray-300 text-lg hover:bg-gray-100"
                type="button"
                aria-label="Close product details"
              >
                x
              </button>
            </div>

            {!editMode ? (
              <div className="p-4 sm:p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  {selectedProduct.images?.map((image, index) => (
                    <img
                      key={image}
                      className="w-full aspect-square object-cover border"
                      src={getImageUrl(image)}
                      alt={`${selectedProduct.name} ${index + 1}`}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Product name</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Price</p>
                    <p className="font-medium text-gray-800 mt-1">
                      ${selectedProduct.price}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Gender</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.gender}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Category</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.category}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Product type</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.productType || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Color</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.color || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Sizes</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.sizes?.join(", ") || "No sizes"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Material</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.material || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Fit</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.fit || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Pattern</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.pattern || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Occasions</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.occasions?.join(", ") || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Seasons</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.seasons?.join(", ") || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Style</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.style?.join(", ") || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Features</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.features?.join(", ") || "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Bestseller</p>
                    <p className="font-medium text-gray-800 mt-1">
                      {selectedProduct.bestseller ? "Yes" : "No"}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-gray-500">Description</p>
                    <p className="text-gray-800 mt-1 leading-6">
                      {selectedProduct.description}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 mt-6">
                  <button
                    onClick={() => setEditMode(true)}
                    className="bg-black text-white px-6 py-3 text-sm"
                    type="button"
                  >
                    Edit Details
                  </button>
                  <button
                    onClick={() => removeProduct(selectedProduct._id)}
                    className="border border-red-200 text-red-600 px-6 py-3 text-sm hover:bg-red-50"
                    type="button"
                  >
                    Remove Product
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={updateProduct}
                className="p-4 sm:p-6 flex flex-col gap-4"
              >
                <div>
                  <p className="mb-2">Product name</p>
                  <input
                    value={editData.name}
                    onChange={(e) =>
                      setEditData((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full border border-gray-300 px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <p className="mb-2">Product Description</p>
                  <textarea
                    value={editData.description}
                    onChange={(e) =>
                      setEditData((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 px-3 py-2 min-h-28"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <p className="mb-2">Gender</p>
                    <select
                      value={editData.gender}
                      onChange={(e) =>
                        setEditData((prev) => ({
                          ...prev,
                          gender: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 px-3 py-2"
                    >
                      {GENDERS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="mb-2">Category</p>
                    <select
                      value={editData.category}
                      onChange={(e) =>
                        setEditData((prev) => ({
                          ...prev,
                          category: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 px-3 py-2"
                    >
                      {CATEGORIES.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="mb-2">Color</p>
                    <ColorCombobox
                      value={editData.color}
                      onChange={(nextColor) =>
                        setEditData((prev) => ({
                          ...prev,
                          color: nextColor,
                        }))
                      }
                      options={COLORS}
                      placeholder="Select or type a color"
                    />
                  </div>

                  <div>
                    <p className="mb-2">Product Price</p>
                    <input
                      value={editData.price}
                      onChange={(e) =>
                        setEditData((prev) => ({
                          ...prev,
                          price: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 px-3 py-2"
                      type="number"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <p className="mb-2">Product Type</p>
                    <ColorCombobox
                      value={editData.productType}
                      onChange={(value) =>
                        setEditData((prev) => ({ ...prev, productType: value }))
                      }
                      options={PRODUCT_TYPES}
                      placeholder="e.g. T-Shirt"
                    />
                  </div>
                  <div>
                    <p className="mb-2">Material</p>
                    <ColorCombobox
                      value={editData.material}
                      onChange={(value) =>
                        setEditData((prev) => ({ ...prev, material: value }))
                      }
                      options={MATERIALS}
                      placeholder="e.g. Cotton"
                    />
                  </div>
                  <div>
                    <p className="mb-2">Fit</p>
                    <ColorCombobox
                      value={editData.fit}
                      onChange={(value) =>
                        setEditData((prev) => ({ ...prev, fit: value }))
                      }
                      options={FITS}
                      placeholder="e.g. Regular"
                    />
                  </div>
                  <div>
                    <p className="mb-2">Pattern</p>
                    <ColorCombobox
                      value={editData.pattern}
                      onChange={(value) =>
                        setEditData((prev) => ({ ...prev, pattern: value }))
                      }
                      options={PATTERNS}
                      placeholder="e.g. Solid"
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2">Product Sizes</p>
                  <div className="flex flex-wrap gap-3">
                    {SIZES.map((productSize) => (
                      <button
                        key={productSize}
                        onClick={() => toggleListValue("sizes", productSize)}
                        className={`px-3 py-1 ${editData.sizes.includes(productSize) ? "bg-black text-white" : "bg-slate-200"}`}
                        type="button"
                      >
                        {productSize}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2">Occasions</p>
                  <div className="flex flex-wrap gap-3">
                    {OCCASIONS.map((option) => (
                      <button
                        key={option}
                        onClick={() => toggleListValue("occasions", option)}
                        className={`px-3 py-1 text-sm ${editData.occasions.includes(option) ? "bg-black text-white" : "bg-slate-200"}`}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2">Seasons</p>
                  <div className="flex flex-wrap gap-3">
                    {SEASONS.map((option) => (
                      <button
                        key={option}
                        onClick={() => toggleListValue("seasons", option)}
                        className={`px-3 py-1 text-sm ${editData.seasons.includes(option) ? "bg-black text-white" : "bg-slate-200"}`}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2">Style</p>
                  <div className="flex flex-wrap gap-3">
                    {STYLES.map((option) => (
                      <button
                        key={option}
                        onClick={() => toggleListValue("style", option)}
                        className={`px-3 py-1 text-sm ${editData.style.includes(option) ? "bg-black text-white" : "bg-slate-200"}`}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2">Features</p>
                  <input
                    value={editData.features}
                    onChange={(e) =>
                      setEditData((prev) => ({ ...prev, features: e.target.value }))
                    }
                    className="w-full border border-gray-300 px-3 py-2"
                    placeholder="Comma-separated, e.g. Lightweight, Breathable, Soft Fabric"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    checked={editData.bestseller}
                    onChange={() =>
                      setEditData((prev) => ({
                        ...prev,
                        bestseller: !prev.bestseller,
                      }))
                    }
                    id="edit-bestseller"
                    type="checkbox"
                  />
                  <label className="cursor-pointer" htmlFor="edit-bestseller">
                    Add to bestseller
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    className="bg-black text-white px-6 py-3 text-sm disabled:opacity-60"
                    type="submit"
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    className="border border-gray-300 px-6 py-3 text-sm hover:bg-gray-100"
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default List;
