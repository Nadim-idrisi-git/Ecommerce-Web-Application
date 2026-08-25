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
    // Audience the product is sectioned under - "Men"/"Women"/"Kids". Was
    // previously named "category" and conflated with garment classification
    // (see `category` below); split so each is independently filterable.
    gender: {
        type: String,
        required: true
    },
    // Garment classification - "Topwear"/"Bottomwear"/"Winterwear". Was
    // previously named "subCategory".
    category: {
        type: String,
        required: true
    },
    // More granular than `category`, e.g. "T-Shirt", "Jacket", "Trousers".
    // Optional - backfilled from the product name where inferable (see
    // utils/inferProductAttributes.js), admin-curated otherwise.
    productType: {
        type: String,
        default: ""
    },
    // Optional - not required so existing products aren't broken by this
    // field's addition. Empty means "not set yet" (excluded from color
    // filter results until an admin sets it), not "colorless". Always
    // stored lowercase; display-casing is a UI concern.
    color: {
        type: String,
        default: ""
    },
    sizes: {
        type: Array,
        required: true
    },
    material: {
        type: String,
        default: ""
    },
    fit: {
        type: String,
        default: ""
    },
    pattern: {
        type: String,
        default: ""
    },
    // Open-ended tags (e.g. "Lightweight", "Breathable") - free text, not a
    // controlled list, since features aren't a fixed vocabulary.
    features: {
        type: [String],
        default: []
    },
    occasions: {
        type: [String],
        default: []
    },
    seasons: {
        type: [String],
        default: []
    },
    style: {
        type: [String],
        default: []
    },
    // Server-generated (see utils/buildSearchableText.js) from the
    // structured fields + description on every add/update - never
    // admin-entered, so it can't drift out of sync with them. Prepares the
    // catalog for future embedding/RAG without requiring one yet.
    searchableText: {
        type: String,
        default: ""
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
