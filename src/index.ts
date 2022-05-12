import express from "express";

const PORT = process.env.PORT || 8080;

const app = express();

app.get("/", (req, res) => {
  res.send("HELLO World");
});

app.listen(PORT, () => {
  console.log("App listening on port " + PORT);
});
