import { v2 as cloudinary } from "cloudinary";
import productModel from "../models/productModel.js";
import fs from "fs";
import path from "path";

// function for add product

const addProduct = async (req, res) => {
    try {
        const { name, description, price, category, subCategory, bestseller, size } = req.body;

        const image1 = req.files?.image1 && req.files.image1[0];
        const image2 = req.files?.image2 && req.files.image2[0];
        const image3 = req.files?.image3 && req.files.image3[0];
        const image4 = req.files?.image4 && req.files.image4[0];

        const images = [image1, image2, image3, image4].filter((item) => item !== undefined);
        if (images.length === 0) {
            return res.status(400).json({ success: false, message: "Please upload at least one product image" });
        }

        let imageUrls = await Promise.all(
            images.map(async (item) => {

                try {

                    const result = await cloudinary.uploader.upload(item.path)

                    return result.secure_url

                } catch (error) {
                    console.error("Cloudinary upload failed:", error.message);
                    throw error;
                }

            })

        );




        const productData = {
            name,
            price: Number(price),
            description,
            images: imageUrls,
            category,
            subCategory,
            size: JSON.parse(size),
            bestseller: bestseller === "true" ? true : false,
            date: Date.now()
        };


        const product = new productModel(productData);
        await product.save();

        res.json({ success: true, message: "Product added successfully" });
    } catch (error) {
        console.error("Add product failed:", error.message);
        res.status(500).json({ success: false, message: "Unable to add product" });
    }

};

//function for list all products
const listProducts = async (req, res) => {
    try {
        const products = await productModel.find();
        res.json({ success: true, products });
    } catch (error) {
        console.error("List products failed:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }

};

const getAssetProducts = () => {
    const assetsPath = path.resolve(process.cwd(), "../frontend/src/assets/assets.js");
    const source = fs.readFileSync(assetsPath, "utf8");

    const imageImports = Object.fromEntries(
        [...source.matchAll(/^import\s+(p_img\d+(?:_\d+)?)\s+from\s+'\.\/(p_img[^']+)'/gm)]
            .map((match) => [match[1], match[2]])
    );

    const productsStart = source.indexOf("export const products = [");
    const arrayStart = source.indexOf("[", productsStart);

    let depth = 0;
    let arrayEnd = -1;

    for (let i = arrayStart; i < source.length; i += 1) {
        if (source[i] === "[") depth += 1;
        if (source[i] === "]") depth -= 1;

        if (depth === 0) {
            arrayEnd = i + 1;
            break;
        }
    }

    const productsCode = source.slice(arrayStart, arrayEnd);
    const assetProducts = Function(
        ...Object.keys(imageImports),
        `return ${productsCode}`
    )(...Object.values(imageImports));

    return assetProducts.map(({ _id, image, sizes, ...product }) => ({
        assetId: _id,
        ...product,
        images: image.map((fileName) => `/assets/${fileName}`),
        size: sizes,
    }));
};

// function for importing products from frontend assets
const importAssetProducts = async (req, res) => {
    try {
        const assetProducts = getAssetProducts();
        const existingAssetIds = await productModel.distinct("assetId", {
            assetId: { $in: assetProducts.map((product) => product.assetId) }
        });

        const productsToInsert = assetProducts.filter(
            (product) => !existingAssetIds.includes(product.assetId)
        );

        if (productsToInsert.length > 0) {
            await productModel.insertMany(productsToInsert);
        }

        res.json({
            success: true,
            message: `${productsToInsert.length} asset products imported`,
            insertedCount: productsToInsert.length,
            skippedCount: assetProducts.length - productsToInsert.length,
        });
    } catch (error) {
        console.error("Import products failed:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// function for removing product
const removeProduct = async (req, res) => {
    try {
        await productModel.findByIdAndDelete(req.body.id);
        res.json({ success: true, message: "Product removed successfully" });
    } catch (error) {
        console.error("Remove product failed:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }

};

// function for updating product details
const updateProduct = async (req, res) => {
    try {
        const { id, name, description, price, category, subCategory, bestseller, size } = req.body;

        const updatedProduct = await productModel.findByIdAndUpdate(
            id,
            {
                name,
                description,
                price: Number(price),
                category,
                subCategory,
                bestseller: bestseller === true || bestseller === "true",
                size: Array.isArray(size) ? size : JSON.parse(size),
            },
            { new: true, runValidators: true }
        );

        if (!updatedProduct) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        res.json({ success: true, message: "Product updated successfully", product: updatedProduct });
    } catch (error) {
        console.error("Update product failed:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// function for single product details
const singleProduct = async (req, res) => {
    try {
        const {productId} = req.body;
        const product = await productModel.findById(productId);
        res.json({ success: true, product });
    } catch (error) {
        console.error("Single product failed:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

export { addProduct, listProducts, importAssetProducts, removeProduct, updateProduct, singleProduct };
