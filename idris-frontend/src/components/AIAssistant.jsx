import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiConfig } from "../config/api";
import { ShopContext } from "../context/ShopContext";

export default function AIAssistant() {
  const navigate = useNavigate();
  const { products, setSearch, setShowSearch } = useContext(ShopContext);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");

  const [transcript, setTranscript] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [intent, setIntent] = useState(null);
  const [currentAction, setCurrentAction] = useState("");
  const [searchFilters, setSearchFilters] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [recommendationQuery, setRecommendationQuery] = useState("");
  const [recommendations, setRecommendations] = useState([]);

  const [supported, setSupported] = useState(true);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);

  const recordingMimeTypeRef = useRef("");

  useEffect(() => {
    const hasMediaDevices =
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function";

    const hasMediaRecorder = typeof window.MediaRecorder !== "undefined";

    if (!hasMediaDevices || !hasMediaRecorder) {
      setSupported(false);
      setStatus("unsupported");
    }

    return () => {
      stopRecording();
    };
  }, []);

  const getAudioExtension = (mimeType) => {
    if (mimeType.includes("webm")) return "webm";

    if (mimeType.includes("mp4")) return "mp4";

    if (mimeType.includes("ogg")) return "ogg";

    return "webm";
  };

  const detectIntent = (text) => {
    const normalized = text.toLowerCase().trim();

    const matchers = [
      {
        type: "OPEN_CART",
        values: ["open cart", "show cart", "go to cart", "cart"],
      },
      {
        type: "OPEN_COLLECTION",
        values: [
          "open collection",
          "show collection",
          "show all products",
          "browse products",
          "show products",
        ],
      },
      {
        type: "TRACK_ORDER",
        values: ["track order", "where is my order", "order status", "track my order"],
      },
      {
        type: "SHOW_OFFERS",
        values: ["show offers", "offers", "discounts", "deals", "sale"],
      },
      {
        type: "LOGIN",
        values: ["login", "log in", "sign in", "signin"],
      },
      {
        type: "SEARCH_PRODUCT",
        values: [
          "show me",
          "find",
          "search for",
          "i want",
          "i need",
          "looking for",
        ],
      },
    ];

    const matched = matchers.find(({ values }) =>
      values.some((phrase) => normalized.includes(phrase)),
    );

    if (!matched) {
      return {
        type: "UNKNOWN",
        value: normalized,
      };
    }

    const searchValue =
      matched.type === "SEARCH_PRODUCT"
        ? normalized
            .replace(/^(show me|find|search for|i want|i need|looking for)\s*/i, "")
            .trim()
        : normalized;

    return {
      type: matched.type,
      value: searchValue || normalized,
    };
  };

  const extractSearchFilters = (text) => {
    const normalized = text.toLowerCase();
    const filters = {
      query: text.trim(),
      category: "",
      color: "",
      maxPrice: "",
    };

    const categoryMap = [
      { value: "jacket", terms: ["jacket", "jackets"] },
      { value: "hoodie", terms: ["hoodie", "hoodies"] },
      { value: "sweater", terms: ["sweater", "sweaters"] },
      { value: "shirt", terms: ["shirt", "shirts", "topwear"] },
      { value: "t-shirt", terms: ["t-shirt", "tee", "tees"] },
      { value: "pant", terms: ["pant", "pants", "trouser", "trousers", "bottomwear"] },
      { value: "dress", terms: ["dress", "dresses"] },
      { value: "saree", terms: ["saree", "sarees"] },
      { value: "kids", terms: ["kids", "kid"] },
    ];

    const colorMap = [
      "black",
      "white",
      "blue",
      "red",
      "green",
      "yellow",
      "pink",
      "brown",
      "grey",
      "gray",
      "beige",
      "navy",
      "maroon",
      "olive",
    ];

    const categoryHit = categoryMap.find(({ terms }) =>
      terms.some((term) => normalized.includes(term)),
    );

    if (categoryHit) {
      filters.category = categoryHit.value;
    }

    const colorHit = colorMap.find((color) => normalized.includes(color));
    if (colorHit) {
      filters.color = colorHit;
    }

    const priceMatch = normalized.match(/(?:under|below|less than|within)\s*(?:rs\.?|₹|rupees)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
    if (priceMatch) {
      filters.maxPrice = Number(priceMatch[1].replace(/,/g, ""));
    }

    return filters;
  };

  const getRecommendationKeywords = (text) => {
    const normalized = text.toLowerCase();
    const keywords = [];

    const groups = [
      { keyword: "winter", terms: ["winter", "cold", "warm", "warm clothes", "winter clothes"] },
      { keyword: "office", terms: ["office", "work", "formal", "professional", "business"] },
      { keyword: "party", terms: ["party", "event", "occasion", "wedding", "festive"] },
      { keyword: "casual", terms: ["casual", "daily", "everyday", "regular"] },
      { keyword: "travel", terms: ["travel", "trip", "vacation", "holiday", "journey"] },
      { keyword: "sport", terms: ["sport", "gym", "fitness", "running", "training"] },
      { keyword: "comfort", terms: ["comfortable", "comfort", "soft", "easy"] },
    ];

    groups.forEach(({ keyword, terms }) => {
      if (terms.some((term) => normalized.includes(term))) {
        keywords.push(keyword);
      }
    });

    return keywords;
  };

  const scoreRecommendations = (keywords) => {
    if (!keywords.length) return [];

    const scored = products.map((product) => {
      const haystack = [
        product.name,
        product.category,
        product.subCategory,
        product.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = 0;

      keywords.forEach((keyword) => {
        if (haystack.includes(keyword)) score += 3;
      });

      if (keywords.includes("winter") && /jacket|hoodie|sweater|coat|shawl/.test(haystack)) {
        score += 5;
      }

      if (keywords.includes("office") && /shirt|trouser|pant|blazer|formal/.test(haystack)) {
        score += 5;
      }

      if (keywords.includes("party") && /dress|topwear|shirt|fashion|stylish/.test(haystack)) {
        score += 4;
      }

      if (keywords.includes("travel") && /jacket|hoodie|shirt|pant|casual/.test(haystack)) {
        score += 3;
      }

      if (keywords.includes("sport") && /t-shirt|tee|shirt|track|short|jogger/.test(haystack)) {
        score += 4;
      }

      if (product.bestseller) {
        score += 2;
      }

      return { product, score };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.product)
      .slice(0, 3);
  };

  const isRecommendationRequest = (text) => {
    const normalized = text.toLowerCase();
    return [
      "recommend",
      "suggest",
      "best for",
      "what should i wear",
      "what can you suggest",
      "need clothes for",
      "i need",
      "show me something",
      "outfit",
    ].some((phrase) => normalized.includes(phrase));
  };

  const filterProducts = (filters) => {
    if (!filters) return [];

    const query = filters.query.toLowerCase();

    return products.filter((product) => {
      const name = (product.name || "").toLowerCase();
      const category = (product.category || "").toLowerCase();
      const subCategory = (product.subCategory || "").toLowerCase();
      const description = (product.description || "").toLowerCase();
      const color = (product.color || "").toLowerCase();
      const price = Number(product.price || 0);

      const queryMatch =
        !query ||
        name.includes(query) ||
        description.includes(query) ||
        category.includes(query);

      const categoryMatch = !filters.category || category.includes(filters.category) || subCategory.includes(filters.category);
      const colorMatch = !filters.color || color.includes(filters.color) || name.includes(filters.color) || description.includes(filters.color);
      const priceMatch = !filters.maxPrice || price <= filters.maxPrice;

      return queryMatch && categoryMatch && colorMatch && priceMatch;
    });
  };

  const executeIntentAction = (detectedIntent) => {
    if (!detectedIntent?.type) return;

    switch (detectedIntent.type) {
      case "OPEN_CART":
        setCurrentAction("Opening cart");
        navigate("/cart");
        setAiReply("Opening your cart.");
        return;

      case "OPEN_COLLECTION":
        setCurrentAction("Opening collection");
        navigate("/collection");
        setAiReply("Showing the collection.");
        return;

      case "LOGIN":
        setCurrentAction("Opening login");
        navigate("/login");
        setAiReply("Taking you to login.");
        return;

      case "TRACK_ORDER":
        setCurrentAction("Track order needs order ID");
        setAiReply("Please open the order tracking page and enter your order ID.");
        return;

      case "SHOW_OFFERS":
        setCurrentAction("Showing offers");
        navigate("/collection");
        setAiReply("I am showing available offers in the collection.");
        return;

      case "SEARCH_PRODUCT":
        setCurrentAction("Search intent detected");
        setSearchFilters(extractSearchFilters(detectedIntent.value));
        return;

      default:
        setCurrentAction("");
    }
  };

  const handleRecommendationQuery = (text) => {
    const keywords = getRecommendationKeywords(text);
    const picks = scoreRecommendations(keywords);

    setRecommendationQuery(text.trim());
    setRecommendations(picks);
    setCurrentAction(
      picks.length > 0
        ? `Showing ${picks.length} recommended products`
        : "No strong recommendation match found",
    );
    setAiReply(
      picks.length > 0
        ? `I recommend ${picks.map((item) => item.name).join(", ")}.`
        : "I could not find a strong recommendation, so I opened the catalog.",
    );
    setSearch("");
    setShowSearch(false);
    navigate("/collection");
  };

  const sendTranscriptToAI = async (text) => {
    try {
      setStatus("thinking");

      const { backendUrl, apiConfigError } = getApiConfig();

      if (!backendUrl) {
        throw new Error(apiConfigError || "Backend URL is not configured");
      }

      const response = await fetch(`${backendUrl}/api/chat`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          message: text,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "AI failed");
      }

      setAiReply(data.reply);

      setStatus("idle");
    } catch (error) {
      console.log("AI reply error:", error);

      setAiReply("Sorry, I am unable to answer right now.");

      setStatus("error");
    }
  };

  const getSupportedMimeType = () => {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "";
  };

  const startRecording = async () => {
    try {
      setTranscript("");
      setAiReply("");
      setIntent(null);

      setStatus("requesting-mic");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      const mimeType = getSupportedMimeType();

      recordingMimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(
        stream,

        mimeType ? { mimeType } : undefined,
      );

      mediaRecorderRef.current = recorder;

      audioChunksRef.current = [];

      recorder.onstart = () => {
        console.log("Recording started");

        setStatus("listening");
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type:
            recordingMimeTypeRef.current || recorder.mimeType || "audio/webm",
        });

        audioChunksRef.current = [];

        if (!audioBlob.size) {
          setStatus("error");
          return;
        }

        try {
          setStatus("transcribing");

          const formData = new FormData();

          formData.append(
            "audio",
            audioBlob,
            `idris.${getAudioExtension(audioBlob.type)}`,
          );

      const { backendUrl, apiConfigError } = getApiConfig();

      if (!backendUrl) {
        throw new Error(apiConfigError || "Backend URL is not configured");
      }

      const response = await fetch(`${backendUrl}/api/voice/transcribe`, {
        method: "POST",
        body: formData,
      });

          const data = await response.json();

          if (!data.success) {
            throw new Error(data.message);
          }

          const text = data.transcript.trim();

          setTranscript(text);
          const detectedIntent = detectIntent(text);
          setIntent(detectedIntent);
          executeIntentAction(detectedIntent);
          const filters = detectedIntent.type === "SEARCH_PRODUCT" ? extractSearchFilters(text) : null;
          setSearchFilters(filters);
          const matchingProducts = filters ? filterProducts(filters) : [];
          setSearchResults(matchingProducts);

          if (filters) {
            setSearch(filters.query);
            setShowSearch(true);
            navigate("/collection");
            setCurrentAction(
              matchingProducts.length > 0
                ? `Showing ${matchingProducts.length} matching products`
                : "No exact match found, showing collection",
            );
            setAiReply(
              matchingProducts.length > 0
                ? `I found ${matchingProducts.length} matching products.`
                : "I could not find an exact match, so I opened the collection.",
            );
          } else if (isRecommendationRequest(text)) {
            handleRecommendationQuery(text);
          } else {
            await sendTranscriptToAI(text);
          }
        } catch (error) {
          console.log("Voice error:", error);

          setStatus("error");
        }
      };

      recorder.start(250);
    } catch (error) {
      console.log("Mic error", error);

      setStatus("permission-denied");
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    mediaRecorderRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());

      mediaStreamRef.current = null;
    }
  };

  const handleAssistantClick = () => {
    if (!open) {
      setOpen(true);

      setTimeout(() => {
        startRecording();
      }, 400);

      return;
    }

    stopRecording();

    setStatus("idle");
  };

  const closeAssistant = () => {
    stopRecording();

    setOpen(false);
  };

  const getStatusText = () => {
    switch (status) {
      case "requesting-mic":
        return "Requesting microphone";

      case "listening":
        return "Listening";

      case "transcribing":
        return "Converting voice";

      case "thinking":
        return "Thinking";

      case "permission-denied":
        return "Microphone denied";

      case "error":
        return "Something went wrong";

      default:
        return "Ready to talk";
    }
  };

  const formatIntent = (value) => {
    if (!value) return "";

    return value
      .split("_")
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(" ");
  };

  const getFilterLabel = () => {
    if (!searchFilters) return "";

    const parts = [];

    if (searchFilters.category) parts.push(searchFilters.category);
    if (searchFilters.color) parts.push(searchFilters.color);
    if (searchFilters.maxPrice) parts.push(`under ${searchFilters.maxPrice}`);

    return parts.join(", ");
  };

  return (
    <>
      <style>{`

@keyframes pulse{

0%{
transform:scale(1);
opacity:.5;
}

100%{
transform:scale(1.8);
opacity:0;
}

}



@keyframes orb{

50%{
transform:scale(1.08);
}

}



.idris-ai-container{

position:fixed;

right:12px;

bottom:85px;

z-index:9999;


transition:.5s ease;

}



.idris-ai-container.open{

left:50%;

right:auto;

bottom:30px;

transform:translateX(-50%);

}




.idris-ai-button{


width:56px;

height:56px;

border-radius:50%;

border:none;

background:#1a1a1a;

display:flex;

align-items:center;

justify-content:center;

cursor:pointer;

box-shadow:
0 8px 30px rgba(0,0,0,.3);


position:relative;
z-index:10001;


}



.idris-ai-container.open
.idris-ai-button{


width:74px;

height:74px;


}



.idris-ai-container.listening
.idris-ai-button{


animation:orb 1s infinite;

}




.idris-ai-button::before{


content:"";

position:absolute;

inset:0;

border-radius:50%;

background:#b89f8a;

z-index:-1;

animation:pulse 1.5s infinite;


}




.idris-ai-orb{


width:35px;

height:35px;

border-radius:50%;


background:
radial-gradient(
circle at 30% 30%,
white,
#b89f8a,
#1a1a1a
);



}



.idris-ai-box{

  position:absolute;

  bottom:80px;

  left:50%;

  transform:translateX(-50%);

  width:min(350px,85vw);

  display:flex;

  flex-direction:column;

  gap:8px;
  pointer-events:none;
  }






.idris-ai-message{


background:white;

border:1px solid #e8e0d8;

padding:12px 15px;

border-radius:12px;

font-family:Outfit;

font-size:13px;

text-align:center;


box-shadow:
0 10px 30px rgba(0,0,0,.12);


}



.idris-ai-status{


background:#1a1a1a;

color:white;

padding:7px 14px;

border-radius:20px;

font-size:12px;

margin:auto;

font-family:Outfit;


}



@media(max-width:480px){


.idris-ai-container.open{

bottom:20px;

}



}

`}</style>

      <div className={`idris-ai-container ${open ? "open" : ""}`}>
        {open && (
          <div className="idris-ai-box">
            <div className="idris-ai-status">{getStatusText()}</div>

            {transcript && (
              <div className="idris-ai-message">
                <strong>You:</strong>
                <br />

                {transcript}
              </div>
            )}

            {intent && (
              <div className="idris-ai-message">
                <strong>Intent:</strong>
                <br />
                {formatIntent(intent.type)}
                {intent.value && intent.type !== "UNKNOWN" && (
                  <>
                    <br />
                    <span style={{ color: "#6b6b6b" }}>{intent.value}</span>
                  </>
                )}
              </div>
            )}

            {currentAction && (
              <div className="idris-ai-message">
                <strong>Action:</strong>
                <br />
                {currentAction}
              </div>
            )}

            {searchFilters && (
              <div className="idris-ai-message">
                <strong>Search:</strong>
                <br />
                {getFilterLabel() || searchFilters.query}
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="idris-ai-message" style={{ textAlign: "left" }}>
                <strong>Matching Products:</strong>
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {searchResults.slice(0, 3).map((product) => (
                    <div key={product._id} style={{ padding: 8, borderRadius: 10, background: "#f8f4ef" }}>
                      <div style={{ fontWeight: 600 }}>{product.name}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>
                        {product.category} {product.subCategory ? `• ${product.subCategory}` : ""} • ${product.price}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recommendations.length > 0 && (
              <div className="idris-ai-message" style={{ textAlign: "left" }}>
                <strong>Recommended For You:</strong>
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {recommendations.map((product) => (
                    <div key={product._id} style={{ padding: 8, borderRadius: 10, background: "#f8f4ef" }}>
                      <div style={{ fontWeight: 600 }}>{product.name}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>
                        {product.category} {product.subCategory ? `• ${product.subCategory}` : ""} • ${product.price}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aiReply && (
              <div className="idris-ai-message">
                <strong>IDRIS AI:</strong>

                <br />

                {aiReply}
              </div>
            )}

            {!transcript && !aiReply && (
              <div className="idris-ai-message">Speak something...</div>
            )}
          </div>
        )}

        <button
          className="idris-ai-button"
          onClick={open ? closeAssistant : handleAssistantClick}
        >
          {open ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeAssistant();
              }}
              style={{
                color: "white",
                fontSize: "28px",
                cursor: "pointer",
                zIndex: 10002,
                position: "relative",
              }}
            >
              ×
            </span>
          ) : (
            <span className="idris-ai-orb" />
          )}
        </button>
      </div>
    </>
  );
}
