import express from "express";
import multer from "multer";
import { transcribeAudio, streamSpeech } from "../controllers/voiceController.js";
import { createLiveSession, runLiveTool } from "../controllers/liveVoiceController.js";
import { attachUserIfPresent } from "../middleware/authUser.js";
import createRateLimiter from "../middleware/rateLimit.js";

const voiceRouter = express.Router();
const voiceRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 12 });
const speakRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
// A live session is one token per conversation (plus one per reconnect), so
// this is generous for real use while still capping token minting.
const liveSessionRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 8 });
// Catalog lookups the live session makes mid-conversation - several per
// minute is normal when a customer is browsing quickly.
const liveToolRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40 });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

// attachUserIfPresent mirrors chatRoute/intentRoute: same rate limiter
// benefit (keyed by user, not just IP, so unrelated customers behind the
// same NAT/carrier IP don't share one bucket) - never blocks anonymous
// requests, and neither endpoint needs req.userId for anything else.
voiceRouter.post(
  "/transcribe",
  attachUserIfPresent,
  voiceRateLimiter,
  upload.single("audio"),
  transcribeAudio
);

voiceRouter.post("/speak", attachUserIfPresent, speakRateLimiter, streamSpeech);

// Realtime speech-to-speech (Gemini Live) - see controllers/liveVoiceController.js.
voiceRouter.post("/live/session", attachUserIfPresent, liveSessionRateLimiter, createLiveSession);
voiceRouter.post("/live/tool", attachUserIfPresent, liveToolRateLimiter, runLiveTool);

export default voiceRouter;