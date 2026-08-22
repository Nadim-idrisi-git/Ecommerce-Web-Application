import React, { useContext, useState } from 'react'
import { assets } from "../assets/assets";
import {Link, NavLink } from "react-router-dom";
import { ShopContext } from "../context/ShopContext"
import { getPublicUrl } from "../config/api";


const Navbar = () => {
  const [visible, setVisible] = useState(false);

  const {setShowSearch, getCartCount, token, logoutCustomer, navigate} = useContext(ShopContext);
  const localAdminUrl = ["http://", "local", "host", ":5174"].join("");
  const productionAdminUrl = "https://idris-admin-nu.vercel.app";
  const configuredAdminUrl = getPublicUrl(
    "VITE_ADMIN_URL",
    import.meta.env.DEV ? localAdminUrl : productionAdminUrl
  );
  const adminUrl = configuredAdminUrl === window.location.origin ? productionAdminUrl : configuredAdminUrl;

  const openAdmin = () => {
    if (!adminUrl) return;
    window.open(adminUrl, "_blank", "noopener,noreferrer");
  };

  const openSearch = () => {
    setShowSearch(true);
    navigate("/collection");
  };

  return (
    <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-5">
      <Link to="/" className="flex-shrink-0"><img src={assets.logo} className="w-28 sm:w-36 lg:w-40" alt="logo" /></Link>
      <ul className="hidden lg:flex gap-5 xl:gap-7 text-sm text-gray-700">
        <NavLink to="/" className="flex flex-col items-center gap-1">
          <p>HOME</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/collection" className="flex flex-col items-center gap-1">
          <p>COLLECTION</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/about" className="flex flex-col items-center gap-1">
          <p>ABOUT</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
        <NavLink to="/contact" className="flex flex-col items-center gap-1">
          <p>CONTACT</p>
          <hr className="w-2/4 border-none h-[1.5px] bg-gray-700 hidden" />
        </NavLink>
      </ul>

      <div className="flex items-center gap-4 sm:gap-5 flex-shrink-0">
          <button
            onClick={openAdmin}
            disabled={!adminUrl}
            className="hidden md:inline-flex h-9 items-center justify-center rounded-full border border-gray-300 px-4 text-xs font-medium tracking-wide text-gray-700 hover:border-black hover:bg-black hover:text-white transition"
            type="button"
          >
            ADMIN
          </button>

          <img onClick={openSearch} src={assets.search_icon} className="w-5 cursor-pointer" alt="" />

          <div className="group relative">
              <img onClick={() => token ? null : navigate('/login')} src={assets.profile_icon} className= "w-5 cursor-pointer" alt=""/>
              {/* z-50: Hero's image slider animates via CSS `transform`,
                  which creates its own stacking context - since it comes
                  after Navbar in DOM order and neither had a z-index, it
                  painted over this dropdown on any page that renders Hero
                  (Home), while pages without a transformed element (e.g.
                  Collection) were unaffected. An explicit z-index here
                  keeps the dropdown on top regardless of what any page
                  renders below it. */}
              <div className="absolute dropdown-menu right-0 pt-4 hidden group-hover:block z-50">
                 <div className="flex flex-col gap-2 w-36 py-3 px-5 bg-slate-100 text-gray-500 rounded">
                    <p onClick={() => navigate(token ? '/profile' : '/login')} className="cursor-pointer hover:text-black">My Profile</p>
                    <p onClick={() => navigate(token ? '/addresses' : '/login')} className="cursor-pointer hover:text-black">Addresses</p>
                    <p onClick={() => navigate(token ? '/orders' : '/login')} className="cursor-pointer hover:text-black">Orders</p>
                    <p onClick={() => navigate(token ? '/verify' : '/login')} className="cursor-pointer hover:text-black">Payments</p>
                    {token && <p onClick={logoutCustomer} className="cursor-pointer hover:text-black">Logout</p>}
                 </div>
               </div>
           </div>
           <Link to ='/cart' className='relative'>
              <img src={assets.cart_icon} className="w-5 min-w-5" alt=""/>
              <p className='absolute right-[-5px] bottom-[-5px] w-4 text-center leading-4 bg-black text-white aspect-square rounded-full text-[8px]'>{getCartCount()}</p>
           </Link>
           <img onClick={() => setVisible(true)} src={assets.menu_icon}  className='w-5 cursor-pointer lg:hidden' alt=""/>
      </div>

      {/* Sidebar menu for mobile */}
      
       <div className={`absolute top-0 right-0 bottom-0 z-50 overflow-hidden bg-white transition-all ${visible ? 'w-full' : 'w-0'}`}>
          <div className="flex flex-col text-gray-600">
            <div onClick={() => setVisible(false)} className="flex items-center gap-4 p-3 cursor-pointer">
              <img className="h-4 rotate-180" src={assets.dropdown_icon} alt="" />
              <p>Back</p>
            </div>
              <NavLink onClick={()=>setVisible(false)} className='py-2 pl-6 border' to="/">HOME</NavLink>
              <NavLink onClick={()=>setVisible(false)} className='py-2 pl-6 border' to="/collection">COLLECTION</NavLink>
              <NavLink onClick={()=>setVisible(false)} className='py-2 pl-6 border' to="/about">ABOUT</NavLink>
              <NavLink onClick={()=>setVisible(false)} className='py-2 pl-6 border' to="/contact">CONTACT</NavLink>
              <button onClick={openAdmin} className='py-2 pl-6 border text-left' type="button">ADMIN</button>
          </div>
        </div>
      

      </div>
  );
};
export default Navbar; 
