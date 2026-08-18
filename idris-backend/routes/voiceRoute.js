import express from "express";
import multer from "multer";
import { transcribeAudio } from "../controllers/voiceController.js";
import createRateLimiter from "../middleware/rateLimit.js";

const voiceRouter = express.Router();
const voiceRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 12 });

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

voiceRouter.post(
  "/transcribe",
  voiceRateLimiter,
  upload.single("audio"),
  transcribeAudio
);

export default voiceRouter;