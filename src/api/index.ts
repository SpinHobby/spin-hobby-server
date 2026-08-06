import express from "express";
import square from "./square";
// DB-backed routes from adminRoute are merged in but disabled while we run
// a minimal Square-only API (no Postgres connection tonight).
// import auth from "./auth";
// import product from "./admin/product";
// import adminRouter from "./admin";
// import cart from "./cart";
// import order from "./order";
// import search from "./search";

const router = express.Router();

router.use("/", square);
// router.use("/", auth);
// router.use("/product", product);
// router.use("/cart", cart);
// router.use("/order", order);
// router.use("/search", search);
// router.use(adminRouter);

export default router;
