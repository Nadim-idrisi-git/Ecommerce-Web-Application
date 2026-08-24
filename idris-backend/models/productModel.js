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
    // Optional - not required so existing products aren't broken by this
    // field's addition. Empty means "not set yet" (excluded from color
    // filter results until an admin sets it), not "colorless".
    color: {
        type: String,
        default: ""
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
