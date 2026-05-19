import ProductItem from './ProductItem';
import React, { useContext } from 'react'
import { ShopContext } from '../context/ShopContext';
import Title from './Title';


const LatestCollection = () => {

    const { products } = useContext(ShopContext);

const latestProducts = products
  ? products.slice().sort((a, b) => b.date - a.date).slice(0, 10)
  : [];

  return (
    <div className='my-10'>
        <div className='text-center py-8 text-3xl'>
            <Title text1={'LATEST'} text2={'COLLECTION'}/>
            <p className='w-3.4 m-auto text-xs sm:text-sm md:text-base text-gray-600'>
                Explore our latest collection of fashion and accessories, featuring trendy styles and timeless classics. Shop now to elevate your wardrobe with the newest arrivals.
            </p>
        </div>

        {/* Products Grid */}
        <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6'>
            {latestProducts.map((item) => (
  <ProductItem
    key={item._id}
    id={item._id}
    image={item.image}
    name={item.name}
    price={item.price}
  />
))}
        </div>


      
    </div>
  )
}

export default LatestCollection
