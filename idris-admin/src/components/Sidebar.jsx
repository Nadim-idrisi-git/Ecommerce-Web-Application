import React from 'react'
import { NavLink } from 'react-router-dom'
import { assets } from '../assets/assets'

const Sidebar = () => {
  return (
    <aside className='w-16 sm:w-20 md:w-56 lg:w-64 min-h-screen shrink-0 border-r-2 bg-white'>
      <div className='flex flex-col gap-3 pt-5 px-2 sm:px-3 md:pl-5 md:pr-0 text-sm md:text-[15px]'>

        <NavLink className='flex items-center justify-center md:justify-start gap-3 border border-gray-300 md:border-r-0 px-3 py-2 hover:bg-gray-200' to='/add'>
            <img className='w-5 h-5 shrink-0' src={assets.add_icon} alt="" />
            <p className='hidden md:block'>Add Item</p>
        </NavLink>

        <NavLink className='flex items-center justify-center md:justify-start gap-3 border border-gray-300 md:border-r-0 px-3 py-2 hover:bg-gray-200' to='/list'>
            <img className='w-5 h-5 shrink-0' src={assets.order_icon} alt="" />
            <p className='hidden md:block'>List Items</p>
        </NavLink>

        <NavLink className='flex items-center justify-center md:justify-start gap-3 border border-gray-300 md:border-r-0 px-3 py-2 hover:bg-gray-200' to='/orders'>
            <img className='w-5 h-5 shrink-0' src={assets.order_icon} alt="" />
            <p className='hidden md:block'>Orders</p>
        </NavLink>

      </div>
    </aside>
  )
}

export default Sidebar
