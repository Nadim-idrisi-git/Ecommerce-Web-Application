import React from 'react'

const NewsletterBox = () => {

    const onSubmitHandler = (event) => {
        event.preventDefault();
        // Handle form submission logic here (e.g., send email to server)
        alert('Thank you for subscribing!');
    }  

  return (
    <div className='text-center'>
      <p className='text-2xl font-medium text-gray-800'>Subscribe now for exclusive offers!</p>
      <p className='text-gray-400 mt-3'>Sign up for our newsletter and be the first to know about our latest products and special offers.</p>

      <form onSubmit={onSubmitHandler} className='w-full sm:w-1/2 flex items-center gap-3 mx-auto my-6 border pl-3'>
        <input className='w-full sm:flex-1 outline-none' type="email" placeholder='Enter your email' required />
        <button type='submit' className='bg-black text-white text-xs px-10 py-4'>SUBSCRIBE</button>
      </form>
    </div>
  )
}

export default NewsletterBox
