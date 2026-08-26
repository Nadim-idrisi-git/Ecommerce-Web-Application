import mongoose from "mongoose";

// Derived/indexing representation of a Product for retrieval - `products`
// stays the ecommerce source of truth (see utils/rag/buildRagDocument.js
// and scripts/syncRagDocuments.js for how these are produced/kept in sync).
// No embedding is populated by this module; the fields below only exist so
// a later module can add one without another schema migration.
const ragDocumentSchema = new mongoose.Schema({
    sourceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
        unique: true,
    },
    type: {
        type: String,
        required: true,
        default: "product",
        index: true,
    },
    // Canonical output of utils/buildSearchableText.js - never generated
    // independently here.
    text: {
        type: String,
        required: true,
    },
    metadata: {
        _id: false,
        gender: { type: String, default: "" },
        category: { type: String, default: "" },
        productType: { type: String, default: "" },
        color: { type: String, default: "" },
        material: { type: String, default: "" },
        fit: { type: String, default: "" },
        pattern: { type: String, default: "" },
        features: { type: [String], default: [] },
        occasions: { type: [String], default: [] },
        seasons: { type: [String], default: [] },
        style: { type: [String], default: [] },
        sizes: { type: [String], default: [] },
        price: { type: Number, default: null },
        bestseller: { type: Boolean, default: false },
    },
    // Deterministic hash of {text, metadata} (see buildRagDocument.js) - lets
    // the sync script skip rewriting a document whose source data hasn't
    // actually changed.
    contentHash: {
        type: String,
        required: true,
        index: true,
    },
    // Populated in a later module. Left untyped-dimension on purpose - the
    // embedding model/dimensionality is a MODULE 3 decision, not this one.
    embedding: {
        type: [Number],
        default: undefined,
    },
    embeddingModel: {
        type: String,
        default: "",
    },
    embeddingVersion: {
        type: String,
        default: "",
    },
    embeddingStatus: {
        type: String,
        enum: ["pending", "ready", "failed"],
        default: "pending",
    },
    // The contentHash the current `embedding` was actually generated from.
    // Comparing this against the document's live `contentHash` is how the
    // sync script tells "still current" apart from "product data changed,
    // needs re-embedding" without re-calling Gemini to find out.
    embeddedContentHash: {
        type: String,
        default: "",
    },
});

const ragDocumentModel = mongoose.models.ragDocument || mongoose.model("RagDocument", ragDocumentSchema);

export default ragDocumentModel;
