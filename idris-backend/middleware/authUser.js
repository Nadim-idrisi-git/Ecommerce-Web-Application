import jwt from "jsonwebtoken";

const authUser = async (req, res, next) => {
    try {
        const { token } = req.headers;

        if (!token) {
            return res.status(401).json({ success: false, message: "Please login first" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (error) {
        console.error("User auth failed:", error.message);
        res.status(401).json({ success: false, message: "Session expired. Please login again" });
    }
};

// Resolves req.userId from a valid token but never blocks the request -
// lets the AI assistant recognize a logged-in user without forcing login.
const attachUserIfPresent = async (req, res, next) => {
    try {
        const { token } = req.headers;

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.userId = decoded.id;
        }
    } catch (error) {
        // Invalid/expired token: continue as an anonymous session.
    }

    next();
};

export default authUser;
export { attachUserIfPresent };
