const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_BACKEND_URL = ["http://", "local", "host", ":4000"].join("");

const isBrowserLocal = () => {
  if (typeof window === "undefined") return false;
  return LOCAL_HOSTNAMES.has(window.location.hostname);
};

const isLocalUrl = (value) => {
  try {
    return LOCAL_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return false;
  }
};

const cleanUrl = (value) => value.trim().replace(/\/+$/, "");

export const getApiConfig = () => {
  const configuredUrl = import.meta.env.VITE_BACKEND_URL?.trim();

  if (!configuredUrl) {
    if (import.meta.env.DEV || isBrowserLocal()) {
      return { backendUrl: LOCAL_BACKEND_URL, apiConfigError: "" };
    }

    return {
      backendUrl: "",
      apiConfigError: "Missing VITE_BACKEND_URL. Set it to your deployed backend URL in Vercel.",
    };
  }

  if (!isBrowserLocal() && isLocalUrl(configuredUrl)) {
    return {
      backendUrl: "",
      apiConfigError: "Invalid VITE_BACKEND_URL. Production cannot use localhost.",
    };
  }

  return { backendUrl: cleanUrl(configuredUrl), apiConfigError: "" };
};
