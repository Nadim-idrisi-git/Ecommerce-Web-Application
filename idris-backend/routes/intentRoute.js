import express from "express";
import { detectAIIntent } from "../controllers/intentController.js";

const intentRouter = express.Router();

intentRouter.post("/", detectAIIntent);

export default intentRouter;