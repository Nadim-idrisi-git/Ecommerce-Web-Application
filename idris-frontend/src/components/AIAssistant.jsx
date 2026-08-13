import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiConfig } from "../config/api";

export default function AIAssistant() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");

  const [transcript, setTranscript] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [intent, setIntent] = useState(null);
  const [currentAction, setCurrentAction] = useState("");

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
        return;

      default:
        setCurrentAction("");
    }
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

          await sendTranscriptToAI(text);
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
