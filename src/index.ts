import "dotenv/config";
import express from "express";
import { Sequelizer } from "./utils/Sequelizer";
import bodyParser from "body-parser";
import { Login } from "./types";

const PORT = process.env.PORT || 8080;

const sequelizer = new Sequelizer(!!process.env.PORT);

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Hello World at port " + process.env.PORT);
});

app.post("/login", (req, res) => {
  const login = req.body as Login;
  sequelizer.validateLogin(login, (error, userData) => {
    if (error) res.json({ error });
    else res.json({ status: "valid" });
  });
});

sequelizer
  .init()
  .then(() => app.listen(PORT, () => console.log("Running on port ", PORT)));
