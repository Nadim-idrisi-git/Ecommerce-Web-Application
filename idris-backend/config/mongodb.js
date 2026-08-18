import mongoose from "mongoose";

// Tracks the single in-flight (or completed) connect() call. Concurrent
// requests arriving before the first connection finishes must all await this
// same promise rather than each calling mongoose.connect() again - a second
// concurrent connect() call resolves immediately without waiting for the
// connection to actually be ready, which let requests through to run
// queries before readyState reached 1 (bufferCommands: false then throws).
let connectionPromise = null;

const connectDB = () => {
    if (mongoose.connection.readyState === 1) {
        return Promise.resolve(mongoose.connection);
    }

    if (!connectionPromise) {
        if (!process.env.MONGODB_URI) {
            return Promise.reject(new Error("MONGODB_URI is missing"));
        }

        connectionPromise = mongoose
            .connect(process.env.MONGODB_URI, {
                serverSelectionTimeoutMS: 10000,
                bufferCommands: false,
            })
            .catch((error) => {
                // Let the next request retry instead of staying rejected forever.
                connectionPromise = null;
                throw error;
            });
    }

    return connectionPromise;
};

export default connectDB;
