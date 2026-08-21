import React, { useEffect, useState } from "react";
import { assets } from "../assets/assets";

const Hero = () => {
  const heroImages = [
    assets.hero_img,
    assets.hero_img2,
    assets.hero_img3,
    assets.hero_img4,
    assets.hero_img, // Repeating the first image for a smooth loop
  ];

  const [currentImage, setCurrentImage] = useState(0);
  const [enableTransition, setEnableTransition] = useState(true);

  useEffect(() => {
    setCurrentImage(0);
    setEnableTransition(false);

    const resetTimer = setTimeout(() => {
      setEnableTransition(true);
    }, 50);

    return () => clearTimeout(resetTimer);
  }, []);



  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImage((prev) => {
        if (prev >= heroImages.length - 1) {
          return 0;
        }

        return prev + 1;
      });
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  useEffect(()=>{

heroImages.forEach((image)=>{

const img = new Image();
img.src = image;

});

},[]);
  return (
    <div className="flex flex-col sm:flex-row border border-gray-400">
      {/* Left Side */}

      <div className="w-full sm:w-1/2 flex items-center justify-center py-10 sm:py-0">
        <div className="text-[#414141]">
          <div className="flex items-center gap-2">
            <p className="w-8 md:w-11 h-[2px] bg-[#414141]"></p>

            <p className="font-medium text-sm md:text-base">OUR BESTSELLERS</p>
          </div>

          <h1 className="prata-regular text-2xl sm:text-4xl lg:text-5xl sm:py-3 leading-relaxed">
            Latest Arrivals
          </h1>

          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm md:text-base">SHOP NOW</p>

            <p className="w-8 md:w-11 h-[1px] bg-[#414141]"></p>
          </div>
        </div>
      </div>

      {/* Right Side Slider */}

      <div className="relative w-full sm:w-1/2 overflow-hidden h-[400px] sm:h-[500px]">
        <div
          className={`flex w-full h-full ${
            enableTransition
              ? "transition-transform duration-700 ease-in-out"
              : ""
          }`}
          style={{
            transform: `translateX(-${currentImage * 100}%)`,
          }}
          onTransitionEnd={() => {
            if (currentImage === heroImages.length - 1) {
              setEnableTransition(false);

              setCurrentImage(0);

              setTimeout(() => {
                setEnableTransition(true);
              }, 50);
            }
          }}
        >
          {heroImages.map((image, index) => (
            <img
              key={index}
              src={image}
              alt="hero"
              className="
                w-full
                min-w-full
                h-full
                flex-shrink-0
                object-cover
                scale-[100%] sm:scale-[100%]
                "
            />
          ))}
        </div>

        {/* Dots */}

        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-2">
          {heroImages.slice(0, 4).map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentImage(index)}
              className={`
                h-2 rounded-full transition-all
                ${currentImage === index ? "w-6 bg-black" : "w-2 bg-gray-400"}
                `}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Hero;
