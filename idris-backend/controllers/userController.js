import validator from "validator";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken"
import userModel from "../models/userModel.js";
import productModel from "../models/productModel.js";
import crypto from "crypto";

const createToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

const safeUser = (user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    cartData: user.cartData || {},
    addresses: user.addresses || []
});

const requiredAddressFields = ["firstName", "lastName", "email", "street", "city", "state", "zipcode", "country", "phone"];

const sanitizeAddress = (address = {}) => {
    const sanitized = {
        label: String(address.label || "Home").trim() || "Home",
        firstName: String(address.firstName || "").trim(),
        lastName: String(address.lastName || "").trim(),
        email: String(address.email || "").trim(),
        street: String(address.street || "").trim(),
        city: String(address.city || "").trim(),
        state: String(address.state || "").trim(),
        zipcode: String(address.zipcode || "").trim(),
        country: String(address.country || "").trim(),
        phone: String(address.phone || "").trim(),
        isDefault: Boolean(address.isDefault)
    };

    return sanitized;
};

const validateAddress = (address) => {
    const missingField = requiredAddressFields.find((field) => !address[field]);

    if (missingField) {
        return `${missingField} is required`;
    }

    if (!validator.isEmail(address.email)) {
        return "Invalid email address";
    }

    return "";
};

const normalizeDefaultAddress = (user, defaultId = "") => {
    if (!user.addresses.length) return;

    const targetId = defaultId || user.addresses.find((address) => address.isDefault)?._id?.toString() || user.addresses[0]._id.toString();

    user.addresses.forEach((address) => {
        address.isDefault = address._id.toString() === targetId;
    });
};

// route for user login
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await userModel.findOne({ email });

        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            const token = createToken(user._id);
            res.json({ success: true, token, message: "Login successful", user: safeUser(user) });
        } else {
            res.json({ success: false, message: "Invalid credentials" });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// route for user registration
const registerUser = async (req, res) => {
    // implementation for user registration
    try {

        const { name, email, password } = req.body;

        //checking user already exists or not
        const exists = await userModel.findOne({ email });

        if (exists) {
            return res.json({ success: false, message: "User already exists" });
        }

        //validating email format & strong password
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.json({ success: false, message: "Invalid email format" });
        }

        if (password.length < 6) {
            return res.json({ success: false, message: "Password must be at least 6 characters long" });
        }

        // hashing user password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // creating new user
        const newUser = await userModel.create({
            name,
            email,
            password: hashedPassword
        });

        const user = await newUser.save()

        const token = createToken(user._id);

        res.json({ success: true, token, message: "User registered successfully", user: safeUser(user) });

    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }

};

const getProfile = async (req, res) => {
    try {
        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({ success: true, user: safeUser(user) });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getCart = async (req, res) => {
    try {
        const user = await userModel.findById(req.userId);
        res.json({ success: true, cartData: user?.cartData || {} });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCart = async (req, res) => {
    try {
        const { cartData } = req.body;
        await userModel.findByIdAndUpdate(req.userId, { cartData: cartData || {} });
        res.json({ success: true, message: "Cart updated", cartData: cartData || {} });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const CART_QUANTITY_CAP = 10;

const clampCartQuantity = (value) => Math.max(0, Math.min(CART_QUANTITY_CAP, Math.round(Number(value) || 0)));

// Deterministic, backend-verified cart mutations for the AI assistant.
// Unlike updateCart() above (a blind full-cartData overwrite trusted from
// whatever the client last computed), these re-read the user's real stored
// cart and the real product/size before mutating, and report back whether
// the item genuinely existed - the assistant must never decide a cart item
// exists based on generated text or stale client state; this is the
// authoritative check.
const addCartItem = async (req, res) => {
    try {
        const { productId, size, quantity } = req.body;

        if (!productId || !size) {
            return res.status(400).json({ success: false, message: "productId and size are required" });
        }

        const product = await productModel.findById(productId);
        if (!product) {
            return res.json({ success: false, message: "That product no longer exists" });
        }
        if (product.sizes?.length && !product.sizes.includes(size)) {
            return res.json({ success: false, message: `Size ${size} is not available for ${product.name}` });
        }

        const user = await userModel.findById(req.userId);
        const cartData = user.cartData || {};
        const current = Number(cartData[productId]?.[size]) || 0;
        const nextQuantity = clampCartQuantity(current + (Number(quantity) || 1));

        cartData[productId] = { ...(cartData[productId] || {}), [size]: nextQuantity };
        user.cartData = cartData;
        user.markModified("cartData");
        await user.save();

        res.json({
            success: true,
            message: "Item added to cart",
            cartData,
            item: { productId, size, quantity: nextQuantity, name: product.name },
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCartItemQuantity = async (req, res) => {
    try {
        const { productId, size, delta, quantity } = req.body;

        if (!productId || !size) {
            return res.status(400).json({ success: false, message: "productId and size are required" });
        }
        if (delta === undefined && quantity === undefined) {
            return res.status(400).json({ success: false, message: "Provide either quantity or delta" });
        }

        const user = await userModel.findById(req.userId);
        const cartData = user.cartData || {};
        const current = cartData[productId]?.[size];

        if (current === undefined) {
            return res.json({ success: false, message: "That item is not in your cart" });
        }

        const nextQuantity = delta !== undefined
            ? clampCartQuantity(Number(current) + Number(delta))
            : clampCartQuantity(quantity);

        const removed = nextQuantity <= 0;

        if (removed) {
            delete cartData[productId][size];
            if (Object.keys(cartData[productId]).length === 0) delete cartData[productId];
        } else {
            cartData[productId][size] = nextQuantity;
        }

        user.cartData = cartData;
        user.markModified("cartData");
        await user.save();

        const product = await productModel.findById(productId).select("name");

        res.json({
            success: true,
            message: removed ? "Item removed from cart" : "Cart updated",
            cartData,
            item: { productId, size, quantity: removed ? 0 : nextQuantity, name: product?.name || "" },
            removed,
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const removeCartItem = async (req, res) => {
    try {
        const { productId, size } = req.body;

        if (!productId) {
            return res.status(400).json({ success: false, message: "productId is required" });
        }

        const user = await userModel.findById(req.userId);
        const cartData = user.cartData || {};

        if (!cartData[productId]) {
            return res.json({ success: false, message: "That item is not in your cart" });
        }

        let removedSizes;

        if (size) {
            if (!(size in cartData[productId])) {
                return res.json({ success: false, message: `That item is not in your cart in size ${size}` });
            }
            delete cartData[productId][size];
            removedSizes = [size];
            if (Object.keys(cartData[productId]).length === 0) delete cartData[productId];
        } else {
            removedSizes = Object.keys(cartData[productId]);
            delete cartData[productId];
        }

        user.cartData = cartData;
        user.markModified("cartData");
        await user.save();

        const product = await productModel.findById(productId).select("name");

        res.json({
            success: true,
            message: "Item removed from cart",
            cartData,
            removedSizes,
            item: { productId, name: product?.name || "" },
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAddresses = async (req, res) => {
    try {
        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({ success: true, addresses: user.addresses || [] });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const addAddress = async (req, res) => {
    try {
        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const address = sanitizeAddress(req.body.address);
        const validationError = validateAddress(address);

        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        if (!user.addresses.length) {
            address.isDefault = true;
        }

        user.addresses.push(address);

        if (address.isDefault) {
            const newAddress = user.addresses[user.addresses.length - 1];
            normalizeDefaultAddress(user, newAddress._id.toString());
        }

        await user.save();

        res.json({ success: true, message: "Address saved", addresses: user.addresses });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateAddress = async (req, res) => {
    try {
        const { addressId, address: addressData } = req.body;
        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const address = user.addresses.id(addressId);

        if (!address) {
            return res.status(404).json({ success: false, message: "Address not found" });
        }

        const sanitized = sanitizeAddress(addressData);
        const validationError = validateAddress(sanitized);

        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        Object.assign(address, sanitized);

        if (sanitized.isDefault) {
            normalizeDefaultAddress(user, address._id.toString());
        } else if (!user.addresses.some((item) => item.isDefault)) {
            normalizeDefaultAddress(user, address._id.toString());
        }

        await user.save();

        res.json({ success: true, message: "Address updated", addresses: user.addresses });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteAddress = async (req, res) => {
    try {
        const { addressId } = req.body;
        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const address = user.addresses.id(addressId);

        if (!address) {
            return res.status(404).json({ success: false, message: "Address not found" });
        }

        const wasDefault = address.isDefault;
        user.addresses.pull(addressId);

        if (wasDefault) {
            normalizeDefaultAddress(user);
        }

        await user.save();

        res.json({ success: true, message: "Address deleted", addresses: user.addresses });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const setDefaultAddress = async (req, res) => {
    try {
        const { addressId } = req.body;
        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const address = user.addresses.id(addressId);

        if (!address) {
            return res.status(404).json({ success: false, message: "Address not found" });
        }

        normalizeDefaultAddress(user, addressId);
        await user.save();

        res.json({ success: true, message: "Default address updated", addresses: user.addresses });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await userModel.findOne({ email });

        if (!user) {
            return res.json({ success: false, message: "No account found with this email" });
        }

        const resetToken = crypto.randomBytes(20).toString("hex");
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
        await user.save();

        res.json({
            success: true,
            message: "Password reset token created",
            resetToken
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const resetPassword = async (req, res) => {
    try {
        const { email, resetToken, password } = req.body;
        const user = await userModel.findOne({
            email,
            resetPasswordToken: resetToken,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.json({ success: false, message: "Invalid or expired reset token" });
        }

        if (password.length < 6) {
            return res.json({ success: false, message: "Password must be at least 6 characters long" });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        user.resetPasswordToken = "";
        user.resetPasswordExpire = 0;
        await user.save();

        res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

//route for admin login
const adminLogin = async (req, res) => {
    try {

        const { email, password } = req.body;

        if (
            email === process.env.ADMIN_EMAIL &&
            password === process.env.ADMIN_PASSWORD
        ) {

            const token = jwt.sign(
                {
                    email
                   // process.env.JWT_SECRET
                    //email: process.env.ADMIN_EMAIL,
               },
                process.env.JWT_SECRET
              //  {
                //    expiresIn: "1h",
                //}
            );

            res.json({
                success: true,
                token,
            });

        } else {
            res.json({
                success: false,
                message: "Invalid credentials",
            });
        }

    } catch (error) {
        console.log(error);

        res.json({
            success: false,
            message: error.message,
        });
    }
};

export { loginUser, registerUser, getProfile, getCart, updateCart, addCartItem, updateCartItemQuantity, removeCartItem, getAddresses, addAddress, updateAddress, deleteAddress, setDefaultAddress, forgotPassword, resetPassword, adminLogin, sanitizeAddress, validateAddress };
