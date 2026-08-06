import express from "express";
import square from "./square";
// Rest of the backend is disabled while we run a minimal Square-only API.
// import auth from "./auth";
// import home from "./home";
// import products from "./products";
// import categories from "./categories";
// import series from "./series";
// import seed from "./seed";
// import admin from "./admin";
// import payments from "./payments";
// import cart from "./cart";
// import search from "./search";
// import squareCatalog from "./square-catalog";

const router = express.Router();

router.use("/", square);
// router.use("/", auth);
// router.use("/", home);
// router.use("/", products);
// router.use("/", categories);
// router.use("/", series);
// router.use("/", seed);
// router.use("/", admin);
// router.use("/", payments);
// router.use("/", cart);
// router.use("/", search);
// router.use("/", squareCatalog);

export default router;
