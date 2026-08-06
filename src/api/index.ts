import express from "express";
import square from "./square";
import auth from "./auth";
import product from "./admin/product";
import adminRouter from "./admin";
import cart from "./cart";
import order from "./order";
import search from "./search";

const router = express.Router();

router.use("/", square);
router.use("/", auth);
router.use("/product", product);
router.use("/cart", cart);
router.use("/order", order);
router.use("/search", search);
router.use(adminRouter);

export default router;
