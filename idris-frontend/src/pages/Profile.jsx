import React, { useContext } from "react";
import { Link } from "react-router-dom";
import { ShopContext } from "../context/ShopContext";
import Title from "../components/Title";

const Profile = () => {
  const { user, token, logoutCustomer } = useContext(ShopContext);

  if (!token) {
    return (
      <div className="border-t pt-16 text-center">
        <p className="text-gray-600 mb-4">Please sign in to view your profile.</p>
        <Link to="/login" className="inline-block bg-black text-white px-8 py-3 text-sm">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="border-t pt-16 min-h-[50vh]">
      <div className="text-2xl mb-8">
        <Title text1="MY" text2="PROFILE" />
      </div>

      <div className="max-w-xl border px-6 py-6 text-gray-700">
        <p className="text-sm text-gray-500">Name</p>
        <p className="text-lg font-medium mb-5">{user?.name}</p>

        <p className="text-sm text-gray-500">Email</p>
        <p className="text-lg font-medium mb-8">{user?.email}</p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link to="/orders" className="border border-black px-6 py-3 text-sm text-center hover:bg-black hover:text-white">
            View Orders
          </Link>
          <Link to="/addresses" className="border border-gray-300 px-6 py-3 text-sm text-center hover:bg-gray-100">
            Addresses
          </Link>
          <button onClick={logoutCustomer} className="border border-gray-300 px-6 py-3 text-sm hover:bg-gray-100" type="button">
            Logout
          </button>
        </div>
      </div>
    </div>
  );
};

export default Profile;
