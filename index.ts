const exp = require("express");
const app = exp();
const Sequelize = require("sequelize");

const PORT = 8080;

app.get("/", (req, res) => {
  res.send("HELLO");
});

app.listen(PORT, () => {
  console.log("App listening on port " + PORT);
});
