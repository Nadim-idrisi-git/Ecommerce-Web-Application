import React from 'react'
import { assets } from '../assets/assets'

const Footer = () => {
  return (
    <div>

      <div className='flex flex-col sm:grid grid-cols-[3fr_1fr_1fr] gap-14 my-10 mt-40 text-sm'>

        <div>
          <img src={assets.logo} className='mb-0 w-32 sm:w-40' alt="" />
          <p className='w-full sm:w-2/3 text-gray-600'>
            We are a fashion e-commerce store dedicated to providing the latest trends and styles to our customers. Our mission is to offer high-quality products at affordable prices, while delivering exceptional customer service. We believe that fashion should be accessible to everyone, and we strive to create a seamless shopping experience for our customers.
          </p>
        </div>


        <div>
          <p className='text-xl font-medium mb-5'>COMPANY</p>

          <ul className='flex flex-col gap-1 text-gray-600'>
            <li>Home</li>
            <li>About us</li>
            <li>Delivery</li>
            <li>Privacy policy</li>
          </ul>
        </div>
        <div>
          <p className='text-xl font-medium mb-5 '>KEEP IN TOUCH</p>
          <p className='text-gray-600'>Get the latest news and updates!</p>
          <ul className='flex flex-col gap-1 mt-1 text-gray-600'>
            <li>+91 1234567890</li>
            <li>contact@idris.com</li>
            
          </ul>
          <ul className='flex gap-4 mt-4'>
            <li className='w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center hover:bg-black transition-all duration-300 cursor-pointer'>
              <img src={assets.x_icon} alt="" />
            </li>
            <li className='w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center hover:bg-black transition-all duration-300 cursor-pointer'>
              <img src={assets.facebook_icon} alt="" />
            </li>
            <li className='w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center hover:bg-black transition-all duration-300 cursor-pointer'>
              <img src={assets.instagram_icon} alt="" />
            </li></ul>
        </div>

      </div>

      <div>
        <hr />
        <p className='text-center text-gray-400 text-xm py-5'>Copyright© 2026 @idris.com - All rights reserved.</p>
      </div>

    </div>
  )
}

export default Footer