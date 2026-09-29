import express from "express";

const router = express.Router();

// Import dummy data
import { animeSeriesData, charactersData } from "../data/dummyData";

// GET /api/v1/series - Get all anime series
router.get("/v1/series", (req, res) => {
  try {
    res.json(animeSeriesData);
  } catch (error) {
    console.error("Error fetching anime series:", error);
    res.status(500).json({ error: "Failed to fetch anime series" });
  }
});

// GET /api/v1/series/:seriesId - Get specific series
router.get("/v1/series/:seriesId", (req, res) => {
  try {
    const { seriesId } = req.params;
    const series = animeSeriesData.find((s) => s.id === seriesId);

    if (!series) {
      return res.status(404).json({ error: "Series not found" });
    }

    res.json(series);
  } catch (error) {
    console.error("Error fetching series:", error);
    res.status(500).json({ error: "Failed to fetch series" });
  }
});

// GET /api/v1/series/:seriesId/characters - Get characters for a series
router.get("/v1/series/:seriesId/characters", (req, res) => {
  try {
    const { seriesId } = req.params;
    const characters = charactersData.filter(
      (char) => char.seriesId === seriesId
    );

    res.json(characters);
  } catch (error) {
    console.error("Error fetching characters:", error);
    res.status(500).json({ error: "Failed to fetch characters" });
  }
});

export default router;
