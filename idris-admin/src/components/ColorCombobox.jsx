import { useEffect, useRef, useState } from "react";

// Native <datalist> renders inconsistently across browsers (Safari in
// particular shows a broken/blank floating box), so this is a small
// self-rendered dropdown instead: pick a suggestion, or just type a color
// that isn't in the list - either way the input's own value is what's saved.
const ColorCombobox = ({ value, onChange, options, className, placeholder }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter((option) =>
    option.toLowerCase().includes(value.trim().toLowerCase()),
  );

  return (
    <div ref={containerRef} className={`relative ${className || ""}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full border border-gray-300 px-3 py-2"
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto border border-gray-300 bg-white shadow-md">
          {filtered.map((option) => (
            <li
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-gray-100"
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ColorCombobox;
