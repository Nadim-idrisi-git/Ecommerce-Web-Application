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
  gender: "",
  category: "",
  color: "",
  maxPrice: null,
});
  // The exact set of product ids the assistant most recently surfaced
  // (via search or recommendation), so the Collection page can display
  // precisely what was announced instead of re-deriving an approximation,
  // and so the assistant can accurately answer "the second one" next turn.
  // null = the assistant hasn't set anything (fall through to manual
  // filters/search); [] is a deliberate, distinct value meaning "the
  // assistant searched and found nothing" - collapsing the two would make
  // a genuine zero-result search silently fall back to showing everything.
  const [voiceProductIds, setVoiceProductIds] = useState(null);
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

  // Backend-verified cart mutations for the AI assistant. Unlike
  // addToCart/removeFromCart above (which optimistically compute the next
  // cartData client-side and blind-overwrite it), these call dedicated
  // endpoints that re-check the user's actual stored cart and the real
  // product/size before mutating, then hand back the server's own
  // resulting cartData - so the assistant only ever reports a change it
  // knows the backend actually made, never one it merely computed locally.
  const assistantRequest = useCallback(async (path, body) => {
    if (!token) return { success: false, message: "Please log in first" };
    if (!backendUrl) return { success: false, message: apiConfigError || "Backend URL is not configured" };

    try {
      const response = await axios.post(backendUrl + path, body, authHeaders());
      if (response.data.success && response.data.cartData) setCartItems(response.data.cartData);
      return response.data;
    } catch (error) {
      return { success: false, message: error.response?.data?.message || error.message };
    }
  }, [token, backendUrl, apiConfigError, authHeaders]);

  const assistantAddToCart = useCallback(
    (productId, size, quantity = 1) => assistantRequest("/api/user/cart/add", { productId, size, quantity }),
    [assistantRequest]
  );

  const assistantUpdateCartQuantity = useCallback(
    (productId, size, { delta, quantity } = {}) =>
      assistantRequest("/api/user/cart/update", { productId, size, delta, quantity }),
    [assistantRequest]
  );

  const assistantRemoveFromCart = useCallback(
    (productId, size) => assistantRequest("/api/user/cart/remove", { productId, size }),
    [assistantRequest]
  );

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

  const placeOrder = useCallback(async ({ address, paymentMethod, source }) => {
    if (!backendUrl) {
      throw new Error(apiConfigError || "Backend URL is not configured");
    }

    // Only the delivery address and payment method travel to the backend -
    // items, prices and the total are derived server-side from the user's
    // saved cart and current product prices, never trusted from the client.
    const response = await axios.post(
      backendUrl + "/api/order/place",
      { address, paymentMethod, source },
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
    assistantAddToCart,
    assistantUpdateCartQuantity,
    assistantRemoveFromCart,
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
