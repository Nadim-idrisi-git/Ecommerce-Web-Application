import React from 'react'
import Title from '../components/Title'
import { assets } from '../assets/assets'
import NewsletterBox from '../components/NewsletterBox'

const About = () => {
  return (
    <div>

      {/* ABOUT US */}
      <div className='text-2xl text-center pt-8 border-t'>
        <Title text1={'ABOUT'} text2={'US'} />
      </div>

      <div className='my-10 flex flex-col md:flex-row gap-16'>

        <img
          className='w-full md:max-w-[450px]'
          src={assets.about_img}
          alt=""
        />

        <div className='flex flex-col justify-center gap-6 md:w-2/4 text-gray-600'>

          <p>
            Welcome to IDRIS, your one-stop destination for modern fashion and timeless styles. We are committed to providing premium quality products that blend comfort, style, and affordability.
          </p>

          <p>
            Our mission is to make fashion accessible for everyone while ensuring an exceptional shopping experience. From trendy collections to everyday essentials, we carefully curate products that match your lifestyle.
          </p>

          <b className='text-gray-800'>
            Our Mission
          </b>

          <p>
            At IDRIS, we strive to redefine online shopping by offering high-quality products, seamless user experience, and excellent customer support that customers can trust.
          </p>

        </div>

      </div>

      {/* WHY CHOOSE US */}
      <div className='text-xl py-4'>
        <Title text1={'WHY'} text2={'CHOOSE US'} />
      </div>

      <div className='flex flex-col md:flex-row text-sm mb-20'>

        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>

          <b>Quality Assurance:</b>

          <p className='text-gray-600'>
            We carefully select and verify each product to ensure top-notch quality and customer satisfaction.
          </p>

        </div>

        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>

          <b>Convenience:</b>

          <p className='text-gray-600'>
            With our easy-to-use platform and smooth checkout process, shopping becomes faster and more convenient.
          </p>

        </div>

        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>

          <b>Exceptional Customer Service:</b>

          <p className='text-gray-600'>
            Our support team is always ready to help and ensure the best possible experience for every customer.
          </p>

        </div>

      </div>

      <NewsletterBox />

    </div>
  )
}

export default About