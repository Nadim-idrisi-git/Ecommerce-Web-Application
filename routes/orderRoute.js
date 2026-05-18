import express from "express";
import { placeOrder, verifyStripe, verifyRazorpay, verifyPaymentStatus, cancelPayment, cancelUserOrder, userOrders, allOrders, updateOrder } from "../controllers/orderController.js";
import authUser from "../middleware/authUser.js";
import adminAuth from "../middleware/adminAuth.js";

const orderRouter = express.Router();

orderRouter.post("/place", authUser, placeOrder);
orderRouter.post("/verify-stripe", authUser, verifyStripe);
orderRouter.post("/verify-razorpay", authUser, verifyRazorpay);
orderRouter.post("/verify-payment", authUser, verifyPaymentStatus);
orderRouter.post("/cancel-payment", authUser, cancelPayment);
orderRouter.post("/cancel", authUser, cancelUserOrder);
orderRouter.get("/userorders", authUser, userOrders);
orderRouter.get("/list", adminAuth, allOrders);
orderRouter.post("/update", adminAuth, updateOrder);

export default orderRouter;
