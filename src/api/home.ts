import express from "express";

const router = express.Router();

// Import dummy data (we'll create a shared data file)
import {
  homeData,
  featuredMerchandise,
  categoriesData,
  animeSeriesData,
} from "../data/dummyData";

// GET /api/v1/home - Main home page data
router.get("/v1/home", (req, res) => {
  try {
    res.json(homeData);
  } catch (error) {
    console.error("Error fetching home data:", error);
    res.status(500).json({ error: "Failed to fetch home data" });
  }
});

export default router;
