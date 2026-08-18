import express from "express";
import { detectAIIntent } from "../controllers/intentController.js";
import createRateLimiter from "../middleware/rateLimit.js";

const intentRouter = express.Router();
const intentRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

intentRouter.post("/", intentRateLimiter, detectAIIntent);

export default intentRouter;