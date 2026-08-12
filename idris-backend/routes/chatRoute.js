import express from "express";
import { chatBot } from "../controllers/chatController.js";

const chatRouter = express.Router();

chatRouter.post("/", chatBot);

export default chatRouter;