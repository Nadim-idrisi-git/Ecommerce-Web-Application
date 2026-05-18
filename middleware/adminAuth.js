import jwt from "jsonwebtoken";

const adminAuth = async (req, res, next) => {
  try {

    const { token } = req.headers;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not Authorized Login Again",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );
    if (decoded.email !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        message: "Not Authorized Login Again",
      });
    }

    next();

  } catch (error) {
    console.error("Admin auth failed:", error.message);

    res.status(401).json({
      success: false,
      message: "Not Authorized Login Again",
    });
  }
};

export default adminAuth;
