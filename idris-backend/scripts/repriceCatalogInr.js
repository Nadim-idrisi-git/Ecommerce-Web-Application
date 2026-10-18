// Moves the catalog to realistic Indian-rupee pricing (the store and every
// payment path now use INR - see orderController.js). Prices follow Indian
// mid-range fashion retail: everyday kids/basics from ~1,049, jackets by
// construction (fleece < denim < puffer < faux-suede biker).
//
// Only `price` on the listed products is changed. Orders keep the price they
// were placed at. Afterwards, re-sync the RAG index so search sees the new
// prices:
//   node scripts/syncRagDocuments.js --apply && node scripts/syncRagEmbeddings.js --apply
//
//   node scripts/repriceCatalogInr.js                   # dry run (default)
//   node scripts/repriceCatalogInr.js --apply           # backup, then write
//   node scripts/repriceCatalogInr.js --revert <file>   # restore a backup
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import connectDB from "../config/mongodb.js";
import productModel from "../models/productModel.js";

const PRICES_INR = {
  // Kids
  "6a0b8473e5e588d569121043": 1049, // Girls Flutter Sleeve Front-Knot Graphic T-Shirt
  "6a0b891c50f304f37558c6ef": 1049, // Boys USA Graphic Sleeveless Active Tank Top
  "6a0b8e9950f304f37558c709": 1099, // Girls Foil Heart Print Stretchable Leggings
  "6a0b86f450f304f37558c6e6": 1099, // Boys Textured Short Sleeve Casual Shirt
  "6a0b884f50f304f37558c6eb": 1099, // Boys Solid Raglan Sleeve Active T-Shirt
  "6a0b8306e5e588d56912103f": 1099, // Girls Textured Round Neck Short Sleeve Top
  "6a0b882650f304f37558c6ea": 1149, // Boys Graphic Print Round Neck Active T-Shirt
  "6a0b899150f304f37558c6f1": 1199, // Girls Drop Shoulder Cropped Typographic T-Shirt
  "6a0b8e4c50f304f37558c707": 1199, // Girls Typographic All-Over Print Fleece Joggers
  "6a0b877250f304f37558c6e8": 1249, // Girls Ribbed Puff Sleeve Lace Trim Top
  "6a0b894c50f304f37558c6f0": 1299, // Boys Striped Pikachu Graphic Baseball Shirt
  "6a0b8da150f304f37558c703": 1299, // Kids Elasticated Paperbag Waist Washed Jeans
  "6a0b8ebd50f304f37558c70a": 1299, // Girls Textured Tie-Up Wide Leg Culottes
  "6a0b8208e5e588d56912103c": 1499, // Girls Floral Print Square Neck A-Line Dress

  // Men
  "6a0b862550f304f37558c6e4": 1049, // Men Solid Round Neck Slim Fit T-Shirt
  "6a0b8264e5e588d56912103d": 1099, // Men Graphic Print Round Neck Active T-Shirt
  "6a0b85d650f304f37558c6e3": 1199, // Men Raglan Sleeve Boston Graphic T-Shirt
  "6a0b8b3950f304f37558c6f7": 1299, // Men Brand Logo Graphic Print Round Neck T-Shirt
  "6a0b872850f304f37558c6e7": 1299, // Men Striped Waistband Slim Fit Track Pants
  "6a0b8d4150f304f37558c701": 1399, // Men Abstract Face Graphic Print Round Neck T-Shirt
  "6a0b87ae50f304f37558c6e9": 1399, // Men Slim Fit Graphic Print Track Pants
  "6a0b83dee5e588d569121041": 1499, // Men Colorblock Long Sleeve Polo T-Shirt
  "6a0b81c1e5e588d56912103b": 1599, // Men Oversized Polo Collar T-Shirt
  "6a0b859550f304f37558c6e2": 1599, // Men Slim Fit Multi-Pocket Cargo Joggers
  "6a0b8cc750f304f37558c6ff": 1799, // Men Micro Printed Slim Fit Casual Shirt
  "6a0b835de5e588d569121040": 1999, // Men Slim Fit Solid Chino Trousers
  "6a0b8d1250f304f37558c700": 2799, // Men Hooded Sleeveless Zip-Front Puffer Vest Jacket
  "6a0b8e7150f304f37558c708": 3299, // Men Light Distressed Washed Denim Trucker Jacket
  "6a0b8a9950f304f37558c6f4": 3499, // Men Stand Collar Zip-Front Puffer Jacket
  "6a0b8f1250f304f37558c70c": 3499, // Men Dark Wash Button-Front Denim Trucker Jacket
  "6a0b8dfa50f304f37558c705": 3999, // Men Colourblock Hooded Zip-Front Quilted Puffer Jacket
  "6a0b8e2150f304f37558c706": 4499, // Men Band Collar Faux Suede Biker Jacket

  // Women
  "6a0b82b5e5e588d56912103e": 1049, // Women Graphic Print Round Neck Casual T-Shirt
  "6a0b8bbb50f304f37558c6fa": 1099, // Women V-Neck Drop Shoulder Casual T-Shirt
  "6a0b88ef50f304f37558c6ee": 1199, // Women High-Rise Wide Leg Solid Palazzos
  "6a0b8111e5e588d56912103a": 1299, // Women Off-Shoulder Floral Puff Sleeve Top
  "6a0b888d50f304f37558c6ec": 1299, // Women Animal Print Wide Leg Palazzos
  "6a0b868c50f304f37558c6e5": 1399, // Women Spread Collar Extended Sleeve Casual Shirt
  "6a0b88bd50f304f37558c6ed": 2299, // Women Zip-Front Stand Collar Fleece Jacket
  "6a0b8bec50f304f37558c6fb": 2499, // Women Stand Collar Zip-Front Athletic Track Jacket
  "6a0b89e450f304f37558c6f2": 2799, // Women Washed Cropped Denim Jacket
  "6a0b8dcd50f304f37558c704": 2999, // Women High Neck Zip-Front Windbreaker Jacket
  "6a0b8eea50f304f37558c70b": 3299, // Women Zip-Front Ribbed Trim Bomber Jacket
  "6a0b8c1f50f304f37558c6fc": 3999, // Women Fur Hooded Zip-Front Quilted Puffer Jacket
};

const MIN_PRICE_INR = 1000;
const APPLY = process.argv.includes("--apply");
const revertIndex = process.argv.indexOf("--revert");
const REVERT_FILE = revertIndex > -1 ? process.argv[revertIndex + 1] : "";
const BACKUP_DIR = path.resolve(process.cwd(), "scripts", "data");

const main = async () => {
  Object.entries(PRICES_INR).forEach(([id, price]) => {
    if (!Number.isInteger(price) || price < MIN_PRICE_INR) {
      throw new Error(`Refusing: price for ${id} (${price}) is below ${MIN_PRICE_INR}`);
    }
  });

  await connectDB();

  if (REVERT_FILE) {
    const backup = JSON.parse(fs.readFileSync(REVERT_FILE, "utf8"));
    for (const { id, price } of backup.products) {
      await productModel.updateOne({ _id: id }, { $set: { price } });
    }
    console.log(`Restored ${backup.products.length} prices from ${REVERT_FILE}.`);
    return;
  }

  const products = await productModel.find().select("name price").lean();
  const unpriced = products.filter((product) => !PRICES_INR[String(product._id)]);
  const unknown = Object.keys(PRICES_INR).filter((id) => !products.some((product) => String(product._id) === id));

  products.forEach((product) => {
    const next = PRICES_INR[String(product._id)];
    console.log(`${String(product.price).padStart(5)} -> ${next ? String(next).padStart(5) : "  (no change)"}  ${product.name}`);
  });
  if (unpriced.length) console.warn(`\nWARNING: ${unpriced.length} product(s) have no new price and keep their current one.`);
  if (unknown.length) console.warn(`WARNING: ${unknown.length} id(s) in the price list no longer exist: ${unknown.join(", ")}`);

  if (!APPLY) {
    console.log("\nDry run - nothing written. Re-run with --apply to update prices.");
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `price-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ createdAt: new Date().toISOString(), products: products.map((product) => ({ id: String(product._id), name: product.name, price: product.price })) }, null, 2),
  );
  console.log(`\nBackup of current prices: ${backupFile}`);

  const operations = products
    .filter((product) => PRICES_INR[String(product._id)])
    .map((product) => ({
      updateOne: { filter: { _id: product._id }, update: { $set: { price: PRICES_INR[String(product._id)] } } },
    }));
  const result = await productModel.bulkWrite(operations);
  console.log(`Updated ${result.modifiedCount} product price(s).`);
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
