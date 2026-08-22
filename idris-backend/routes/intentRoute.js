import express from "express";
import { detectAIIntent } from "../controllers/intentController.js";
import { attachUserIfPresent } from "../middleware/authUser.js";
import createRateLimiter from "../middleware/rateLimit.js";

const intentRouter = express.Router();
const intentRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

// This endpoint now also answers general conversation directly (previously
// only chatRoute did), so it needs req.userId the same way chatRoute does,
// to personalize replies with the customer's first name when logged in.
// Never blocks anonymous requests - same middleware chatRoute already uses.
intentRouter.post("/", attachUserIfPresent, intentRateLimiter, detectAIIntent);

export default intentRouter;