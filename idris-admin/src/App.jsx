import React, { useEffect } from "react";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { Routes, Route } from "react-router-dom";
import List from "./pages/List";
import Add from "./pages/Add";
import Order from "./pages/Order";
import Login from "./components/Login";
import { useState } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { getApiConfig } from "./config/api";

export const { backendUrl, apiConfigError } = getApiConfig();

const App = () => {
  const [token, setToken] = useState(
    localStorage.getItem("token") ? localStorage.getItem("token") : "");

  useEffect(() => {
    localStorage.setItem("token", token);
  }, [token]);

  return (
    <div className="bg-gray-50 min-h-screen">
      <ToastContainer />
      {apiConfigError ? (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="bg-white border border-red-200 shadow-sm p-6 w-full max-w-md">
            <h1 className="text-xl font-semibold text-red-600 mb-2">Deployment config error</h1>
            <p className="text-sm text-gray-700">{apiConfigError}</p>
          </div>
        </div>
      ) : token === "" ? (
        <Login setToken={setToken} />
      ) : (
        <>
          <Navbar setToken={setToken} />
          <hr />
          <div className="flex w-full">
            <Sidebar />
            <main className="flex-1 w-full min-w-0 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 text-gray-600 text-sm sm:text-base overflow-x-hidden">
              <Routes>
                <Route path="/add" element={<Add token={token} />} />
                <Route path="/list" element={<List token={token} />} />
                <Route path="/orders" element={<Order token={token} />} />
              </Routes>
            </main>
          </div>
        </>
      )}
    </div>
  );
};

export default App;
