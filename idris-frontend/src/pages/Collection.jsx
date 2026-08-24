import React, { useContext, useEffect, useState } from 'react'
import { ShopContext } from '../context/ShopContext'
import { assets } from '../assets/assets'
import Title from '../components/Title'
import ProductItem from '../components/ProductItem'
import { searchProducts } from '../utils/productSearch'

const Collection = () => {

  const { products, search, showSearch, voiceSort, setVoiceSort, voiceCategory, setVoiceCategory,  voiceSearchFilters, setVoiceSearchFilters, voiceProductIds } = useContext(ShopContext)

  const [showFilter,setShowFilter] = useState(false)
  const [filterProducts,setFilterProducts] = useState([])
  const [category,setCategory] = useState([])
  const [subCategory,setSubCategory] = useState([])
  const [sortType,setSortType] = useState('relevant')


  const toggleCategory = (e) => {

    if(category.includes(e.target.value)){
      setCategory(prev => prev.filter(item => item !== e.target.value))
    }
    else{
      setCategory(prev => [...prev,e.target.value])
    }
  }


  const toggleSubCategory = (e) => {

    if(subCategory.includes(e.target.value)){
      setSubCategory(prev => prev.filter(item => item !== e.target.value))
    }
    else{
      setSubCategory(prev => [...prev,e.target.value])
    }

  }


 const applyFilter = () => {
  let productsCopy = products.slice();

  const aiFilters = voiceSearchFilters || {};
  const hasAiFilter = Boolean(
    (aiFilters.query || "").trim() ||
    aiFilters.category ||
    aiFilters.color ||
    (aiFilters.maxPrice !== null && aiFilters.maxPrice !== undefined && aiFilters.maxPrice !== "")
  );

  if (voiceProductIds !== null) {
    // The assistant already announced an exact set of products (search or
    // recommendation) - show precisely that, in that order, rather than
    // re-deriving an approximation. An empty array here is deliberate (the
    // assistant searched and found nothing) and must still win over the
    // fallback branches below, not be treated as "no filter set".
    const byId = new Map(products.map((item) => [item._id, item]));
    productsCopy = voiceProductIds.map((id) => byId.get(id)).filter(Boolean);
  } else if (hasAiFilter) {
    // Best-effort keyword match (utils/productSearch): scores products by
    // how many requested keywords they match instead of requiring every
    // one to match, so a facet the catalog has no data for (e.g. color)
    // doesn't zero out results that otherwise clearly match.
    productsCopy = searchProducts(productsCopy, aiFilters);
  } else if (showSearch && search.trim()) {
    const searchWords = search
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    productsCopy = productsCopy.filter((item) => {
      const searchableText = [
        item.name,
        item.description,
        item.category,
        item.subCategory,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchWords.every((word) =>
        searchableText.includes(word)
      );
    });
  }

  // --------------------------------
  // NORMAL CATEGORY FILTER
  // --------------------------------
  if (category.length > 0) {
    productsCopy = productsCopy.filter((item) =>
      category.includes(item.category)
    );
  }

  // --------------------------------
  // NORMAL SUBCATEGORY FILTER
  // --------------------------------
  if (subCategory.length > 0) {
    productsCopy = productsCopy.filter((item) =>
      subCategory.includes(item.subCategory)
    );
  }

  setFilterProducts(productsCopy);
};


  const sortProduct = () => {

    let fpCopy = filterProducts.slice()

    switch(sortType){

      case 'low-high':
        setFilterProducts(
          fpCopy.sort((a,b)=> a.price - b.price)
        )
        break

      case 'high-low':
        setFilterProducts(
          fpCopy.sort((a,b)=> b.price - a.price)
        )
        break

      case 'newest':
        setFilterProducts(
          fpCopy.sort((a,b)=> b.date - a.date)
        )
        break

      default:
        applyFilter()
        break
    }

  }

  useEffect(()=>{
    sortProduct()
  },[sortType])

  useEffect(() => {
    if (voiceSort) {
      setSortType(voiceSort)
      setVoiceSort("")
    }
  }, [voiceSort, setVoiceSort])

  useEffect(() => {
    if (voiceCategory) {
      setCategory([voiceCategory])
      setVoiceCategory("")
      setShowFilter(true)
    }
  }, [voiceCategory, setVoiceCategory])



  useEffect(() => {
  applyFilter();
}, [
  category,
  subCategory,
  search,
  showSearch,
  products,
  voiceSearchFilters,
  voiceProductIds,
]);


  useEffect(()=>{
    sortProduct()
  },[sortType])



  useEffect(()=>{
    setFilterProducts(products)
  },[products])



  return (
    <div className='flex flex-col sm:flex-row gap-1 sm:gap-10 pt-10 border-t'>

      {/* Filter Options */}
      <div className='min-w-60'>

        <p
         onClick={()=>setShowFilter(!showFilter)}
         className='my-2 text-xl flex items-center cursor-pointer gap-2'
        >
          FILTERS

          <img
           className={`h-3 sm:hidden ${showFilter ? 'rotate-90' : ''}`}
           src={assets.dropdown_icon}
           alt=""
          />

        </p>


        {/* Category Filter */}

        <div className={`border border-gray-300 pl-5 py-3 mt-6 ${showFilter ? '' : 'hidden'} sm:block`}>

          <p className='mb-3 text-sm font-medium'>
            CATEGORIES
          </p>

          <div className='flex flex-col gap-2 text-sm font-light text-gray-700'>

            <p className='flex gap-2'>
              <input
               id='category-men'
               name='category'
               className='w-3'
               type="checkbox"
               value={'Men'}
               onChange={toggleCategory}
              />
              <label htmlFor='category-men'>Men</label>
            </p>

            <p className='flex gap-2'>
              <input
               id='category-women'
               name='category'
               className='w-3'
               type="checkbox"
               value={'Women'}
               onChange={toggleCategory}
              />
              <label htmlFor='category-women'>Women</label>
            </p>

            <p className='flex gap-2'>
              <input
               id='category-kids'
               name='category'
               className='w-3'
               type="checkbox"
               value={'Kids'}
               onChange={toggleCategory}
              />
              <label htmlFor='category-kids'>Kids</label>
            </p>

          </div>
        </div>



        {/* SubCategory Filter */}

        <div className={`border border-gray-300 pl-5 py-3 my-5 ${showFilter ? '' : 'hidden'} sm:block`}>

          <p className='mb-3 text-sm font-medium'>
            TYPE
          </p>

          <div className='flex flex-col gap-2 text-sm font-light text-gray-700'>

            <p className='flex gap-2'>
              <input
               id='subcategory-topwear'
               name='subCategory'
               className='w-3'
               type="checkbox"
               value={'Topwear'}
               onChange={toggleSubCategory}
              />
              <label htmlFor='subcategory-topwear'>Topwear</label>
            </p>

            <p className='flex gap-2'>
              <input
               id='subcategory-bottomwear'
               name='subCategory'
               className='w-3'
               type="checkbox"
               value={'Bottomwear'}
               onChange={toggleSubCategory}
              />
              <label htmlFor='subcategory-bottomwear'>Bottomwear</label>
            </p>

            <p className='flex gap-2'>
              <input
               id='subcategory-winterwear'
               name='subCategory'
               className='w-3'
               type="checkbox"
               value={'Winterwear'}
               onChange={toggleSubCategory}
              />
              <label htmlFor='subcategory-winterwear'>Winterwear</label>
            </p>

          </div>

        </div>

      </div>



      {/* Right Side */}
      <div className='flex-1'>

        <div className='flex justify-between text-base sm:text-2xl mb-4'>

          <Title text1={'ALL'} text2={'COLLECTIONS'} />


          {/* Product Sort */}
          <select
           onChange={(e)=>setSortType(e.target.value)}
           className='border-2 border-gray-300 text-sm px-2'
          >
            <option value="relevant">
              Sort by: Relevant
            </option>

            <option value="low-high">
              Sort by price: Low to High
            </option>

            <option value="high-low">
              Sort by price: High to Low
            </option>

            <option value="newest">
              Sort by: Newest
            </option>

          </select>

        </div>



        {/* Map Products */}
        <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 gap-y-6'>

          {
            filterProducts.map((item)=>(
              <ProductItem
                key={item._id}
                name={item.name}
                id={item._id}
                price={item.price}
                image={item.image}
              />
            ))
          }

        </div>

      </div>

    </div>
  )
}

export default Collection
