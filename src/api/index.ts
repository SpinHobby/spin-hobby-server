import express from "express";
import auth from "./auth";
import home from "./home";
import products from "./products";
import categories from "./categories";
import series from "./series";
import square from "./square";
import seed from "./seed";
import admin from "./admin";
import payments from "./payments";
import cart from "./cart";
import search from "./search";

const router = express.Router();

// Mount all API routes
router.use("/", auth);
router.use("/", home);
router.use("/", products);
router.use("/", categories);
router.use("/", series);
router.use("/", square);
router.use("/", seed);
router.use("/", admin);
router.use("/", payments);
router.use("/", cart);
router.use("/", search);

export default router;
