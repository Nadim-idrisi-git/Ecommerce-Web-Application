import express from "express";
import { chatBot } from "../controllers/chatController.js";
import { attachUserIfPresent } from "../middleware/authUser.js";
import createRateLimiter from "../middleware/rateLimit.js";

const chatRouter = express.Router();
const chatRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

chatRouter.post("/", attachUserIfPresent, chatRateLimiter, chatBot);

export default chatRouter;