import React, { useEffect, useState, useCallback } from "react";
import { ShopContext } from "./ShopContext";

//import { products } from "../assets/assets";
import { toast } from "react-toastify";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { getApiConfig } from "../config/api";

const ShopContextProvider = (props) => {
  const currency = "$";
  const delivery_fee = 10;
  const { backendUrl, apiConfigError } = getApiConfig();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [cartItems, setCartItems] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [products, setProducts] = useState([]);
  const [voiceSort, setVoiceSort] = useState("");
  const [voiceCategory, setVoiceCategory] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");
    const [voiceSearchFilters, setVoiceSearchFilters] = useState({
  query: "",
  category: "",
  color: "",
  maxPrice: null,
});
  // The exact set of product ids the assistant most recently surfaced
  // (via search or recommendation), so the Collection page can display
  // precisely what was announced instead of re-deriving an approximation,
  // and so the assistant can accurately answer "the second one" next turn.
  const [voiceProductIds, setVoiceProductIds] = useState([]);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [addresses, setAddresses] = useState([]);

  const normalizeImageUrl = (image) => {
    if (!image) return "";
    return image.startsWith("/assets") && backendUrl ? backendUrl + image : image;
  };

  const normalizeProduct = useCallback((product) => {
    const image = product.image || product.images || [];
    const sizes = product.sizes || product.size || [];

    return {
      ...product,
      image: image.map(normalizeImageUrl),
      images: image.map(normalizeImageUrl),
      sizes,
      size: sizes,
    };
  }, [backendUrl]);

  const authHeaders = useCallback(() => ({ headers: { token } }), [token]);

  const saveCart = useCallback(async (cartData) => {
    if (!token) return;
    if (!backendUrl) {
      toast.error(apiConfigError || "Backend URL is not configured");
      return;
    }

    try {
      await axios.post(backendUrl + "/api/user/cart", { cartData }, authHeaders());
    } catch (error) {
      console.error("Error saving cart:", error);
      toast.error(error.response?.data?.message || "Could not save cart");
    }
  }, [backendUrl, apiConfigError, token, authHeaders]);

  const addToCart = (itemId, size) => {
    if (!size) {
      toast.error("Please Select Product Size");
      return;
    }

    let cartData = structuredClone(cartItems);

    if (cartData[itemId]) {
      if (cartData[itemId][size]) {
        cartData[itemId][size] += 1;
      } else {
        cartData[itemId][size] = 1;
      }
    } else {
      cartData[itemId] = {};
      cartData[itemId][size] = 1;
    }

    setCartItems(cartData);
    saveCart(cartData);
    //toast.success("Added to cart");
  };

  const buyNow = async (itemId, size) => {
    if (!size) {
      toast.error("Please Select Product Size");
      return;
    }

    const cartData = structuredClone(cartItems);

    if (cartData[itemId]) {
      cartData[itemId][size] = (cartData[itemId][size] || 0) + 1;
    } else {
      cartData[itemId] = { [size]: 1 };
    }

    setCartItems(cartData);
    await saveCart(cartData);
    navigate("/place-order");
  };

  const getCartCount = () => {
    let totalCount = 0;
    for (const items in cartItems) {
      for (const item in cartItems[items]) {
        try {
          if(cartItems[items][item] > 0) {
            totalCount += cartItems[items][item];
          }
        } catch (error) {
          console.log(error);
        }
      }
    }
    return totalCount;
  };

  const removeFromCart = (itemId, size, removeAll = false) => {

  setCartItems((prev) => {

    const copy = { ...prev };

    if (!copy[itemId] || !copy[itemId][size]) return prev;

    if (removeAll) {

      delete copy[itemId][size];

    } else {

      copy[itemId][size] -= 1;

      if (copy[itemId][size] <= 0) {

        delete copy[itemId][size];

      }

    }
    
     if (Object.keys(copy[itemId]).length === 0) {

      delete copy[itemId];

    }

    saveCart(copy);
    return copy;

  });

};

  // Sets a cart line to an exact quantity in a single save (unlike
  // addToCart/removeFromCart, which move by one and are meant for the +/-
  // buttons). Used by the assistant for "add N", "make it 3", and removal
  // (quantity 0), so a single voice instruction is one network call, not N.
  const setCartItemQuantity = useCallback((itemId, size, quantity) => {
    const targetQuantity = Math.max(0, Math.min(10, Math.round(Number(quantity) || 0)));

    setCartItems((prev) => {
      const copy = structuredClone(prev);

      if (targetQuantity <= 0) {
        if (copy[itemId]) {
          delete copy[itemId][size];
          if (Object.keys(copy[itemId]).length === 0) delete copy[itemId];
        }
      } else {
        copy[itemId] = { ...(copy[itemId] || {}), [size]: targetQuantity };
      }

      saveCart(copy);
      return copy;
    });
  }, [saveCart]);

const getSubtotal = () => {
  let total = 0;

  for (const item in cartItems) {
    for (const size in cartItems[item]) {
      if (cartItems[item][size] > 0) {
        const product = products.find(p => p._id.toString() === item);
        if (product) {
          total += product.price * cartItems[item][size];
        }
      }
    }
  }

  return total;
};

  const getProductsData = useCallback(async () => {
    if (!backendUrl) {
      toast.error(apiConfigError || "Backend URL is not configured");
      return;
    }

    try {
      const response = await axios.get(backendUrl + '/api/product/list');
      if(response.data.success) {
        setProducts(response.data.products.map(normalizeProduct));
      } else {
        toast.error("Failed to fetch products");
      }
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error("An error occurred while fetching products");
    }
  }, [backendUrl, apiConfigError]);

  const loadUserData = useCallback(async () => {
    if (!token) {
      setUser(null);
      setCartItems({});
      setOrders([]);
      setAddresses([]);
      return;
    }
    if (!backendUrl) {
      toast.error(apiConfigError || "Backend URL is not configured");
      return;
    }

    try {
      const [profileResponse, cartResponse, ordersResponse, addressesResponse] = await Promise.all([
        axios.get(backendUrl + "/api/user/profile", authHeaders()),
        axios.get(backendUrl + "/api/user/cart", authHeaders()),
        axios.get(backendUrl + "/api/order/userorders", authHeaders()),
        axios.get(backendUrl + "/api/user/address", authHeaders()),
      ]);

      if (profileResponse.data.success) setUser(profileResponse.data.user);
      if (cartResponse.data.success) setCartItems(cartResponse.data.cartData || {});
      if (ordersResponse.data.success) setOrders(ordersResponse.data.orders || []);
      if (addressesResponse.data.success) setAddresses(addressesResponse.data.addresses || []);
    } catch (error) {
      console.error("Error loading user data:", error);
      localStorage.removeItem("token");
      setToken("");
      setUser(null);
      setCartItems({});
      setAddresses([]);
    }
  }, [backendUrl, apiConfigError, token, authHeaders]);

  const loginCustomer = (authToken, authUser) => {
    localStorage.setItem("token", authToken);
    setToken(authToken);
    setUser(authUser);
  };

  const logoutCustomer = () => {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
    setCartItems({});
    setOrders([]);
    setAddresses([]);
    navigate("/login");
  };

  const placeOrder = useCallback(async ({ items, amount, address, paymentMethod, source }) => {
    if (!backendUrl) {
      throw new Error(apiConfigError || "Backend URL is not configured");
    }

    const response = await axios.post(
      backendUrl + "/api/order/place",
      { items, amount, address, paymentMethod, source },
      authHeaders()
    );

    if (response.data.success && response.data.clearCart) {
      setCartItems({});
      await loadUserData();
    }

    return response.data;
  }, [backendUrl, apiConfigError, authHeaders, loadUserData]);

  const refreshOrders = useCallback(async () => {
    if (!token) return;
    if (!backendUrl) throw new Error(apiConfigError || "Backend URL is not configured");
    const response = await axios.get(backendUrl + "/api/order/userorders", authHeaders());
    if (response.data.success) setOrders(response.data.orders || []);
  }, [backendUrl, apiConfigError, token, authHeaders]);

  const refreshAddresses = useCallback(async () => {
    if (!token) return [];
    if (!backendUrl) throw new Error(apiConfigError || "Backend URL is not configured");
    const response = await axios.get(backendUrl + "/api/user/address", authHeaders());
    if (response.data.success) {
      setAddresses(response.data.addresses || []);
      return response.data.addresses || [];
    }
    return [];
  }, [backendUrl, apiConfigError, token, authHeaders]);

  const saveAddress = useCallback(async (address, addressId = "") => {
    if (!backendUrl) throw new Error(apiConfigError || "Backend URL is not configured");
    const method = addressId ? "put" : "post";
    const response = await axios[method](
      backendUrl + "/api/user/address",
      addressId ? { addressId, address } : { address },
      authHeaders()
    );

    if (response.data.success) {
      setAddresses(response.data.addresses || []);
      const savedAddress = addressId
        ? response.data.addresses?.find((item) => item._id === addressId)
        : response.data.addresses?.[response.data.addresses.length - 1];
      return { ...response.data, address: savedAddress };
    }

    return response.data;
  }, [backendUrl, apiConfigError, authHeaders]);

  const deleteAddress = useCallback(async (addressId) => {
    if (!backendUrl) throw new Error(apiConfigError || "Backend URL is not configured");
    const response = await axios.delete(backendUrl + "/api/user/address", {
      ...authHeaders(),
      data: { addressId }
    });

    if (response.data.success) setAddresses(response.data.addresses || []);
    return response.data;
  }, [backendUrl, apiConfigError, authHeaders]);

  const setDefaultAddress = useCallback(async (addressId) => {
    if (!backendUrl) throw new Error(apiConfigError || "Backend URL is not configured");
    const response = await axios.post(
      backendUrl + "/api/user/address/default",
      { addressId },
      authHeaders()
    );

    if (response.data.success) setAddresses(response.data.addresses || []);
    return response.data;
  }, [backendUrl, apiConfigError, authHeaders]);

  const cancelOrder = useCallback(async (orderId, reason = "Cancelled by customer", source) => {
    if (!backendUrl) throw new Error(apiConfigError || "Backend URL is not configured");
    const response = await axios.post(
      backendUrl + "/api/order/cancel",
      { orderId, reason, source },
      authHeaders()
    );

    if (response.data.success) {
      await refreshOrders();
    }

    return response.data;
  }, [backendUrl, apiConfigError, authHeaders, refreshOrders]);

  useEffect(() => {
    getProductsData();
  }, [getProductsData]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  const value = {
    products,
    getProductsData,
    currency,
    delivery_fee,
    search,
    setSearch,
    showSearch,
    setShowSearch,
    cartItems,
    setCartItems,
    addToCart,
    buyNow,
    getCartCount,
    removeFromCart,
    setCartItemQuantity,
    getSubtotal,
    paymentMethod,
setPaymentMethod,
    voiceSort,
    setVoiceSort,
    voiceCategory,
    setVoiceCategory,
    backendUrl,
    apiConfigError,
    navigate,
    token,
    setToken,
    user,
    orders,
    addresses,
    loginCustomer,
    logoutCustomer,
    placeOrder,
    refreshOrders,
    cancelOrder,
    refreshAddresses,
    saveAddress,
    deleteAddress,
    setDefaultAddress,
    voiceSearchFilters,
setVoiceSearchFilters,
    voiceProductIds,
    setVoiceProductIds,
  };

  return (
    <ShopContext.Provider value={value}>{props.children}</ShopContext.Provider>
  );
};

export default ShopContextProvider;
