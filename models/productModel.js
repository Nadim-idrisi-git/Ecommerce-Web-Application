import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
    assetId: {
        type: String,
        index: true,
        sparse: true
    },
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    images: {
        type: Array,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    subCategory: {
        type: String,
        required: true
    },
    size: {
        type: Array,
        required: true
    },
    bestseller: {
        type: Boolean,
        default: false
    },
    date: {
        type: Number,
        required: true
    }
});

const productModel = mongoose.models.product || mongoose.model("Product", productSchema);

export default productModel;
