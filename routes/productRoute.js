import express from "express";
import { addProduct, listProducts, importAssetProducts, removeProduct, updateProduct, singleProduct } from "../controllers/productController.js";
import upload from "../middleware/multer.js";
import adminAuth from "../middleware/adminAuth.js";

const productRouter = express.Router();

// route for add product
productRouter.post("/add",adminAuth,upload.fields([
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 },
    { name: 'image4', maxCount: 1 }])
    ,addProduct);
// route for removing product
productRouter.post("/remove",adminAuth,removeProduct);

// route for updating product
productRouter.post("/update",adminAuth,updateProduct);


// route for list all products
productRouter.get("/list", listProducts);

// route for importing products from frontend assets
productRouter.post("/import-assets",adminAuth,importAssetProducts);



// route for single product details
productRouter.post("/single", singleProduct);

export default productRouter;
