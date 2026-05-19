import mongoose from "mongoose";

let cachedConnection = null;

const connectDB = async () => {
    if (cachedConnection && mongoose.connection.readyState === 1) {
        return cachedConnection;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is missing");
    }

    cachedConnection = mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        bufferCommands: false,
    });

    await cachedConnection;
    return cachedConnection;
};

export default connectDB;
