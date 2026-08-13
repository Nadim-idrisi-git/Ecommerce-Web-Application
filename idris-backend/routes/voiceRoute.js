import express from "express";
import multer from "multer";
import { transcribeAudio } from "../controllers/voiceController.js";

const voiceRouter = express.Router();

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
  upload.single("audio"),
  transcribeAudio
);

export default voiceRouter;