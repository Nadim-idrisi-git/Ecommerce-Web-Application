import multer from "multer";
import fs from "fs";
import path from "path";

const uploadDir = path.resolve("uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, callback) {
        callback(null, uploadDir);
    },

    filename: function (req, file, callback) {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        callback(null, Date.now() + "-" + safeName);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 4,
    },
    fileFilter(req, file, callback) {
        if (!file.mimetype.startsWith("image/")) {
            return callback(new Error("Only image uploads are allowed"));
        }

        callback(null, true);
    },
});

export default upload;
