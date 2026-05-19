import React from 'react'
import {assets} from '../assets/assets'

const Navbar = ({ setToken }) => {
  return (
    <div className='flex items-center py-3 px-4 sm:px-[4%] justify-between gap-4 bg-white'>
      <img className='w-24 sm:w-32 md:w-40' src={assets.logo} alt="" />
      <button className='bg-gray-600 text-white px-4 sm:px-5 py-2 rounded-full text-xs sm:text-sm hover:bg-red-600 whitespace-nowrap' onClick={() => setToken('')}>Logout</button>
    </div>
  )
}

export default Navbar
