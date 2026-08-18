import express from "express";
import { chatBot } from "../controllers/chatController.js";
import { attachUserIfPresent } from "../middleware/authUser.js";

const chatRouter = express.Router();

chatRouter.post("/", attachUserIfPresent, chatBot);

export default chatRouter;