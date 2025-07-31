import express from "express";
import auth from "./auth";
import home from "./home";
import products from "./products";
import categories from "./categories";
import series from "./series";

const router = express.Router();

// Mount all API routes
router.use("/", auth);
router.use("/", home);
router.use("/", products);
router.use("/", categories);
router.use("/", series);

export default router;
