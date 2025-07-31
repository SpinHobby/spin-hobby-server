import express from "express";

const router = express.Router();

// Import dummy data
import { categoriesData } from "../data/dummyData";

// GET /api/v1/categories - Get all categories
router.get("/v1/categories", (req, res) => {
  try {
    res.json(categoriesData);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// GET /api/v1/categories/:name - Get specific category
router.get("/v1/categories/:name", (req, res) => {
  try {
    const { name } = req.params;
    const category = categoriesData.find(
      (cat) => cat.name.toLowerCase() === name.toLowerCase()
    );

    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json(category);
  } catch (error) {
    console.error("Error fetching category:", error);
    res.status(500).json({ error: "Failed to fetch category" });
  }
});

export default router;
