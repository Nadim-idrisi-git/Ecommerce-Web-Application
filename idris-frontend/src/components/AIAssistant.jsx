import { useEffect, useRef, useState } from "react";

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      setStatus("listening");
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];

        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      const currentText = `${finalText}${interimText}`.trim();

      if (currentText) {
        setTranscript(currentText);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);

      if (event.error === "not-allowed") {
        shouldListenRef.current = false;
        setStatus("permission-denied");
        return;
      }

      if (event.error === "no-speech") {
        return;
      }

      setStatus("error");
    };

    recognition.onend = () => {
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch (error) {
          console.log("Recognition restart skipped.");
        }
      } else {
        setStatus("idle");
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;

      try {
        recognition.stop();
      } catch (error) {
        // Recognition may already be stopped.
      }
    };
  }, []);

  const startListening = () => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }

    if (!recognitionRef.current) {
      return;
    }

    setTranscript("");
    shouldListenRef.current = true;

    try {
      recognitionRef.current.start();
    } catch (error) {
      console.log("Recognition already running.");
    }
  };

  const stopListening = () => {
    shouldListenRef.current = false;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        // Already stopped.
      }
    }

    setStatus("idle");
  };

  const handleAssistantClick = () => {
    if (!open) {
      setOpen(true);

      // Start microphone only after explicit user interaction.
      setTimeout(() => {
        startListening();
      }, 450);

      return;
    }

    stopListening();
    setOpen(false);
    setTranscript("");
  };

  const getStatusText = () => {
    switch (status) {
      case "listening":
        return "Listening";

      case "permission-denied":
        return "Microphone access denied";

      case "unsupported":
        return "Voice input not supported";

      case "error":
        return "Voice input unavailable";

      default:
        return "Ready to talk";
    }
  };

  return (
    <>
      <style>{`
        @keyframes aiPulse {
          0% {
            transform: scale(1);
            opacity: 0.55;
          }

          70% {
            transform: scale(1.7);
            opacity: 0;
          }

          100% {
            transform: scale(1.7);
            opacity: 0;
          }
        }

        @keyframes aiOrbPulse {
          0%, 100% {
            transform: scale(1);
          }

          50% {
            transform: scale(1.06);
          }
        }

        @keyframes aiWave {
          0%, 100% {
            transform: scaleY(0.35);
            opacity: 0.5;
          }

          50% {
            transform: scaleY(1);
            opacity: 1;
          }
        }

        @keyframes aiOpen {
          from {
            opacity: 0;
            transform: translate(-50%, 10px) scale(0.9);
          }

          to {
            opacity: 1;
            transform: translate(-50%, 0) scale(1);
          }
        }

        .idris-ai-container {
          position: fixed;
          right: 10px;
          bottom: 84px;
          z-index: 10000;

          transition:
            left 0.55s cubic-bezier(0.22, 1, 0.36, 1),
            right 0.55s cubic-bezier(0.22, 1, 0.36, 1),
            bottom 0.55s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .idris-ai-container.open {
          left: 50%;
          right: auto;
          transform: translateX(-50%);
          bottom: 28px;
        }

        .idris-ai-button {
          position: relative;

          width: 56px;
          height: 56px;

          border: none;
          border-radius: 50%;

          background: #1a1a1a;
          color: #fff;

          cursor: pointer;

          display: flex;
          align-items: center;
          justify-content: center;

          box-shadow:
            0 8px 28px rgba(0, 0, 0, 0.25);

          transition:
            width 0.45s ease,
            height 0.45s ease,
            box-shadow 0.3s ease;
        }

        .idris-ai-container.open .idris-ai-button {
          width: 74px;
          height: 74px;

          box-shadow:
            0 12px 40px rgba(0, 0, 0, 0.3),
            0 0 0 8px rgba(184, 159, 138, 0.08);
        }

        .idris-ai-container.open.listening .idris-ai-button {
          animation: aiOrbPulse 1.4s ease-in-out infinite;
        }

        .idris-ai-button::before {
          content: "";

          position: absolute;
          inset: 0;

          border-radius: 50%;

          background: #b89f8a;

          animation: aiPulse 1.8s ease-out infinite;

          z-index: -1;
        }

        .idris-ai-container.open .idris-ai-button::before {
          animation-duration: 1.4s;
        }

        .idris-ai-orb {
          width: 34px;
          height: 34px;

          border-radius: 50%;

          background:
            radial-gradient(
              circle at 35% 30%,
              #ffffff 0%,
              #ddd4cd 18%,
              #b89f8a 42%,
              #51453d 72%,
              #1a1a1a 100%
            );

          box-shadow:
            inset 0 2px 5px rgba(255,255,255,0.45),
            0 0 16px rgba(184,159,138,0.45);

          transition: all 0.4s ease;
        }

        .idris-ai-container.open .idris-ai-orb {
          width: 46px;
          height: 46px;
        }

        .idris-ai-status {
          position: absolute;

          bottom: calc(100% + 12px);
          left: 50%;

          transform: translateX(-50%);

          background: #1a1a1a;
          color: #fff;

          padding: 7px 12px;

          border-radius: 20px;

          white-space: nowrap;

          font-family: Outfit, sans-serif;
          font-size: 11px;

          letter-spacing: 0.04em;

          box-shadow:
            0 8px 24px rgba(0,0,0,0.16);

          animation: aiOpen 0.3s ease forwards;
        }

        .idris-ai-status::after {
          content: "";

          position: absolute;

          left: 50%;
          top: 100%;

          transform: translateX(-50%);

          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid #1a1a1a;
        }

        .idris-ai-waves {
          display: flex;
          align-items: center;
          justify-content: center;

          gap: 3px;

          height: 20px;
        }

        .idris-ai-wave {
          width: 3px;
          height: 16px;

          border-radius: 10px;

          background: #fff;

          animation:
            aiWave 0.8s ease-in-out infinite;
        }

        .idris-ai-wave:nth-child(1) {
          animation-delay: 0s;
        }

        .idris-ai-wave:nth-child(2) {
          animation-delay: 0.12s;
        }

        .idris-ai-wave:nth-child(3) {
          animation-delay: 0.24s;
        }

        .idris-ai-wave:nth-child(4) {
          animation-delay: 0.36s;
        }

        .idris-ai-transcript {
          position: absolute;

          bottom: calc(100% + 52px);
          left: 50%;

          transform: translateX(-50%);

          width: min(340px, 80vw);

          padding: 10px 14px;

          border: 1px solid #e8e0d8;
          border-radius: 10px;

          background: rgba(255,255,255,0.96);

          color: #2c2c2c;

          font-family: Outfit, sans-serif;
          font-size: 13px;
          line-height: 1.4;

          text-align: center;

          box-shadow:
            0 10px 35px rgba(0,0,0,0.12);

          animation: aiOpen 0.25s ease forwards;
        }

        .idris-ai-hint {
          position: absolute;

          bottom: calc(100% + 52px);
          left: 50%;

          transform: translateX(-50%);

          width: max-content;
          max-width: 80vw;

          padding: 10px 14px;

          background: #fff;

          border: 1px solid #e8e0d8;
          border-radius: 10px;

          color: #777;

          font-family: Outfit, sans-serif;
          font-size: 12px;

          box-shadow:
            0 10px 35px rgba(0,0,0,0.1);

          animation: aiOpen 0.25s ease forwards;
        }

        @media (max-width: 768px) {
          .idris-ai-container {
            right: 10px;
            bottom: 84px;
          }

          .idris-ai-container.open {
            left: 50%;
            right: auto;
            bottom: 22px;
          }
        }

        @media (max-width: 480px) {
          .idris-ai-container {
            right: 12px;
            bottom: 82px;
          }

          .idris-ai-container.open {
            left: 50%;
            right: auto;
            bottom: 18px;
          }

          .idris-ai-button {
            width: 52px;
            height: 52px;
          }

          .idris-ai-container.open .idris-ai-button {
            width: 68px;
            height: 68px;
          }

          .idris-ai-orb {
            width: 31px;
            height: 31px;
          }

          .idris-ai-container.open .idris-ai-orb {
            width: 42px;
            height: 42px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .idris-ai-container,
          .idris-ai-button {
            transition: none;
          }

          .idris-ai-button::before,
          .idris-ai-button,
          .idris-ai-wave {
            animation: none;
          }
        }
      `}</style>

      <div
        className={`idris-ai-container ${
          open ? `open ${status}` : ""
        }`}
      >
        {open && (
          <>
            {transcript ? (
              <div className="idris-ai-transcript">
                {transcript}
              </div>
            ) : (
              <div className="idris-ai-hint">
                {status === "listening"
                  ? "I'm listening..."
                  : getStatusText()}
              </div>
            )}

            <div className="idris-ai-status">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{getStatusText()}</span>

                {status === "listening" && (
                  <div className="idris-ai-waves">
                    <span className="idris-ai-wave" />
                    <span className="idris-ai-wave" />
                    <span className="idris-ai-wave" />
                    <span className="idris-ai-wave" />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <button
          type="button"
          className="idris-ai-button"
          onClick={handleAssistantClick}
          aria-label={
            open
              ? "Stop AI Assistant"
              : "Start AI Assistant"
          }
          aria-pressed={open}
        >
          {open ? (
            <span
              style={{
                color: "#fff",
                fontSize: 25,
                lineHeight: 1,
                fontWeight: 300,
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