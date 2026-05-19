import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Title from "../components/Title";
import { ShopContext } from "../context/ShopContext";

const emptyAddress = {
  label: "Home",
  firstName: "",
  lastName: "",
  email: "",
  street: "",
  city: "",
  state: "",
  zipcode: "",
  country: "",
  phone: "",
  isDefault: false,
};

const inputClass = "border border-gray-300 px-3 py-2 outline-none w-full";

const Addresses = () => {
  const {
    token,
    addresses,
    refreshAddresses,
    saveAddress,
    deleteAddress,
    setDefaultAddress,
  } = useContext(ShopContext);

  const [formData, setFormData] = useState(emptyAddress);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refreshAddresses();
  }, [refreshAddresses]);

  if (!token) {
    return (
      <div className="border-t pt-16 text-center min-h-[55vh]">
        <p className="text-gray-600 mb-4">Please sign in to manage addresses.</p>
        <Link to="/login" className="inline-block bg-black text-white px-8 py-3 text-sm">
          Sign In
        </Link>
      </div>
    );
  }

  const updateField = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const resetForm = () => {
    setFormData(emptyAddress);
    setEditingId("");
  };

  const editAddress = (address) => {
    setEditingId(address._id);
    setFormData({
      label: address.label || "Home",
      firstName: address.firstName || "",
      lastName: address.lastName || "",
      email: address.email || "",
      street: address.street || "",
      city: address.city || "",
      state: address.state || "",
      zipcode: address.zipcode || "",
      country: address.country || "",
      phone: address.phone || "",
      isDefault: Boolean(address.isDefault),
    });
  };

  const onSubmit = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);
      const response = await saveAddress(formData, editingId);
      if (response.success) {
        toast.success(response.message);
        resetForm();
      } else {
        toast.error(response.message || "Could not save address");
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    } finally {
      setSaving(false);
    }
  };

  const removeAddress = async (addressId) => {
    const confirmed = window.confirm("Delete this address?");
    if (!confirmed) return;

    try {
      const response = await deleteAddress(addressId);
      if (response.success) toast.success(response.message);
      else toast.error(response.message || "Could not delete address");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const markDefault = async (addressId) => {
    try {
      const response = await setDefaultAddress(addressId);
      if (response.success) toast.success(response.message);
      else toast.error(response.message || "Could not update default address");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
    }
  };

  return (
    <div className="border-t pt-12 min-h-[60vh]">
      <div className="text-2xl mb-8">
        <Title text1="MY" text2="ADDRESSES" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8">
        <div>
          {addresses.length === 0 ? (
            <div className="border px-4 py-8 text-center text-gray-500">
              No saved addresses yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {addresses.map((address) => (
                <div key={address._id} className="border p-4 text-sm text-gray-600">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="font-medium text-gray-800">{address.label || "Address"}</p>
                      {address.isDefault && <p className="text-xs text-green-600 mt-1">Default address</p>}
                    </div>
                    {!address.isDefault && (
                      <button
                        onClick={() => markDefault(address._id)}
                        className="text-xs border px-3 py-1 hover:bg-gray-100"
                        type="button"
                      >
                        Set Default
                      </button>
                    )}
                  </div>

                  <p className="font-medium text-gray-800">{address.firstName} {address.lastName}</p>
                  <p className="mt-1">{address.street}</p>
                  <p>{address.city}, {address.state} {address.zipcode}</p>
                  <p>{address.country}</p>
                  <p className="mt-1">{address.phone}</p>
                  <p>{address.email}</p>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => editAddress(address)}
                      className="border border-gray-300 px-4 py-2 hover:bg-gray-100"
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeAddress(address._id)}
                      className="border border-red-300 text-red-600 px-4 py-2 hover:bg-red-50"
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border p-4 sm:p-6 h-fit">
          <p className="font-medium text-gray-800 mb-4">{editingId ? "Edit Address" : "Add New Address"}</p>

          <div className="space-y-3">
            <input name="label" value={formData.label} onChange={updateField} placeholder="Label" className={inputClass} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input required name="firstName" value={formData.firstName} onChange={updateField} placeholder="First Name" className={inputClass} />
              <input required name="lastName" value={formData.lastName} onChange={updateField} placeholder="Last Name" className={inputClass} />
            </div>
            <input required name="email" value={formData.email} onChange={updateField} placeholder="Email Address" className={inputClass} />
            <input required name="street" value={formData.street} onChange={updateField} placeholder="Street" className={inputClass} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input required name="city" value={formData.city} onChange={updateField} placeholder="City" className={inputClass} />
              <input required name="state" value={formData.state} onChange={updateField} placeholder="State" className={inputClass} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input required name="zipcode" value={formData.zipcode} onChange={updateField} placeholder="Zipcode" className={inputClass} />
              <input required name="country" value={formData.country} onChange={updateField} placeholder="Country" className={inputClass} />
            </div>
            <input required name="phone" value={formData.phone} onChange={updateField} placeholder="Phone" className={inputClass} />

            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input name="isDefault" checked={formData.isDefault} onChange={updateField} type="checkbox" />
              Use as default address
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-5">
            <button disabled={saving} className="bg-black text-white px-6 py-3 text-sm disabled:opacity-60" type="submit">
              {saving ? "Saving..." : editingId ? "Update Address" : "Save Address"}
            </button>
            {editingId && (
              <button onClick={resetForm} className="border px-6 py-3 text-sm hover:bg-gray-100" type="button">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default Addresses;
