import React from 'react'

const items = [
  'FREE SHIPPING ON ORDERS OVER ₹999',
  'NEW ARRIVALS — LATEST COLLECTION',
  'EASY 30-DAY RETURNS',
  'EXCLUSIVE MEMBERS DISCOUNT',
  'PREMIUM QUALITY FASHION',
  'SHOP THE LOOK',
]

const MarqueeBanner = ({ bg = 'bg-black', text = 'text-white' }) => {
  const repeated = [...items, ...items]

  return (
    <div className={`${bg} ${text} overflow-hidden py-2.5 border-y border-neutral-800`}>
      <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee-track {
          display: flex;
          width: max-content;
          animation: marquee 28s linear infinite;
        }
        .marquee-track:hover { animation-play-state: paused; }
      `}</style>

      <div className="marquee-track">
        {repeated.map((item, i) => (
          <span key={i} className="flex items-center whitespace-nowrap px-8 text-[10px] tracking-[0.2em] font-medium">
            {item}
            <span className="mx-6 text-neutral-400 text-[8px]">◆</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export default MarqueeBanner