import { useState, useRef, useEffect, useContext } from "react";
import axios from "axios";
import { ShopContext } from "../context/ShopContext";

const BOT_NAME = "IDRIS. Assistant";
const QUICK_REPLIES = [
  { label: "New Arrivals", value: "Show me the latest arrivals" },
  { label: "Track Order", value: "Track my order" },
  { label: "Returns & Exchanges", value: "How do I return an item?" },
  { label: "Contact Support", value: "I need customer support" },
];

function TypingIndicator() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "10px 14px",
        background: "#f5f0eb",
        borderRadius: 16,
        borderBottomLeftRadius: 3,
        width: "fit-content",
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#b89f8a",
            display: "inline-block",
            animation: "bounce 1.2s infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 10,
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "#1a1a1a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "-0.5px",
              fontFamily: "Georgia,serif",
            }}
          >
            I.
          </span>
        </div>
      )}
      <div
        style={{
          maxWidth: "85%",
          padding: "10px 14px",
          wordBreak:"break-word",
          overflowWrap:"break-word",
          background: isUser ? "#1a1a1a" : "#f5f0eb",
          color: isUser ? "#fff" : "#2c2c2c",
          borderRadius: 16,
          borderBottomRightRadius: isUser ? 3 : 16,
          borderBottomLeftRadius: isUser ? 16 : 3,
          fontSize: 13.5,
          lineHeight: 1.55,
          fontFamily: "Georgia, serif",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        {msg.text}
      </div>
      {isUser && (
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "#c9b09a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>
            U
          </span>
        </div>
      )}
    </div>
  );
}

function ChatWindow({ onClose }) {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const { token } = useContext(ShopContext);
  const isMobile = window.innerWidth <= 768;
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "bot",
      text: `Welcome to IDRIS. 🖤 I'm your personal style assistant. How can I help you today?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [showQuick, setShowQuick] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const sendMessage = async (text) => {

  if (!text.trim()) return;

  setMessages(prev => [
    ...prev,
    {
      id: Date.now(),
      role: "user",
      text
    }
  ]);

  setInput("");
  setShowQuick(false);
  setTyping(true);

  try {

    const { data } = await axios.post(
      `${backendUrl}/api/chat`,
      {
        message: text
      },
      token ? { headers: { token } } : undefined
    );

    setTyping(false);

    setMessages(prev => [
      ...prev,
      {
        id: Date.now() + 1,
        role: "bot",
        text: data.reply
      }
    ]);

  } catch (error) {

    setTyping(false);

    setMessages(prev => [
      ...prev,
      {
        id: Date.now() + 1,
        role: "bot",
        text: "Unable to connect to AI."
      }
    ]);

  }
};

  return (
    <div
      style={{
        width:isMobile ? "100%" : "355px",
        height:isMobile ? "calc(100vh - 80px)" : "510px",
        //height: window.innerWidth <= 768 ? "calc(100vh - 90px)" : "510px",
        maxHeight: "85vh",
        background: "#fff",
        borderRadius:isMobile ? 12 : 4,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
        fontFamily: "'Segoe UI', sans-serif",
        border: "1px solid #e8e0d8",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#1a1a1a",
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: "-0.5px",
              color: "#1a1a1a",
              fontFamily: "Georgia,serif",
            }}
          >
            I.
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "0.05em",
              fontFamily: "Georgia, serif",
            }}
          >
            IDRIS.
          </div>
          <div
            style={{
              color: "#a0a0a0",
              fontSize: 11.5,
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 2,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#b89f8a",
                display: "inline-block",
              }}
            />
            Style Assistant • Always here
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid #444",
            color: "#aaa",
            width: 28,
            height: 28,
            borderRadius: "50%",
            cursor: "pointer",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 14px",
          display: "flex",
          flexDirection: "column",
          background: "#fdfcfa",
        }}
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {typing && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "#1a1a1a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: "Georgia,serif",
                }}
              >
                I.
              </span>
            </div>
            <TypingIndicator />
          </div>
        )}
        {showQuick && !typing && (
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontSize: 11,
                color: "#b0a090",
                marginBottom: 8,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              How can I help?
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q.value}
                  onClick={() => sendMessage(q.value)}
                  style={{
                    padding: "7px 13px",
                    borderRadius: 2,
                    border: "1px solid #d4c8bc",
                    background: "#fff",
                    color: "#2c2c2c",
                    fontSize: 12.5,
                    cursor: "pointer",
                    fontFamily: "Georgia, serif",
                    letterSpacing: "0.02em",
                    transition: "all 0.15s",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = "#1a1a1a";
                    e.currentTarget.style.color = "#fff";
                    e.currentTarget.style.borderColor = "#1a1a1a";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = "#fff";
                    e.currentTarget.style.color = "#2c2c2c";
                    e.currentTarget.style.borderColor = "#d4c8bc";
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ height: 1, background: "#ede8e2" }} />

      {/* Input */}
      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "#fff",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
          placeholder="Ask about our collection…"
          style={{
            flex: 1,
            padding: "9px 14px",
            borderRadius: 2,
            border: "1px solid #ddd6ce",
            outline: "none",
            fontSize: 16,
            background: "#fdfcfa",
            color: "#2c2c2c",
            fontFamily: "Georgia, serif",
            letterSpacing: "0.01em",
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 2,
            background: input.trim() ? "#1a1a1a" : "#e8e0d8",
            border: "none",
            cursor: input.trim() ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.2s",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path
              d="M22 2L11 13M22 2L15 22L11 13M11 13L2 9L22 2"
              stroke={input.trim() ? "#fff" : "#b0a090"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div
        style={{
          textAlign: "center",
          padding: "6px 0 8px",
          fontSize: 10.5,
          color: "#c0b4a8",
          letterSpacing: "0.08em",
          background: "#fff",
        }}
      >
        POWERED BY <strong style={{ color: "#1a1a1a" }}>Gemini.</strong>
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <style>{`
        @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes pulseRing { 0%{transform:scale(1);opacity:0.5} 100%{transform:scale(1.65);opacity:0} }
        @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ONLY the floating widget — no background, no wrapper page */}
      <div
        style={{
          position: "fixed",
          bottom: "16px",
          right: "10px", left: "10px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, zIndex: 9999,}}>
        {open && (
          <div style={{ animation: "slideUp 0.25s ease" }}>
            <ChatWindow onClose={() => setOpen(false)} />
          </div>
        )}

        <div style={{ position: "relative" }}>
          {pulse && !open && (
            <span
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: "#1a1a1a",
                animation: "pulseRing 1.6s ease-out infinite",
              }}
            />
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#1a1a1a",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 6px 24px rgba(0,0,0,0.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.2s",
              transform: open ? "rotate(45deg)" : "rotate(0deg)",
            }}
          >
            {open ? (
              <span style={{ color: "#fff", fontSize: 20 }}>✕</span>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
