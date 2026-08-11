import express from "express";
import square from "./square";
import cashier from "./cashier";
import homepage from "./homepage";
// Legacy DB-backed routes from an early merge, kept disabled while we run a
// minimal Square-only API (their AdminJS/Sequelize scaffold was broken and
// has been removed - see src/db/pool.ts + src/api/homepage.ts for the real
// Postgres-backed admin routes).
// import auth from "./auth";
// import cart from "./cart";
// import order from "./order";
// import search from "./search";

const router = express.Router();

router.use("/", square);
router.use("/", cashier);
router.use("/", homepage);
// router.use("/", auth);
// router.use("/cart", cart);
// router.use("/order", order);
// router.use("/search", search);

export default router;
