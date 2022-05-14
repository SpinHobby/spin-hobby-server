import "dotenv/config";
import express from "express";
import {
  Sequelizer,
  getLoginRequestData,
  getRegisterRequestData,
} from "./utils";
import bodyParser from "body-parser";
import { Plan, RegisterError } from "./types";
import cors from "cors";

const PORT = process.env.PORT || 8080;

const sequelizer = new Sequelizer(!!process.env.PORT);

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json());

app.use(express.static("./public/"));

app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello World at port " + process.env.PORT);
});

app.post("/login", (req, res) => {
  const login = getLoginRequestData(req.body);
  if (!login) return res.sendStatus(400);
  sequelizer.validateLogin(login, (error, userData) => {
    if (error) res.json({ error });
    else res.json({ status: "valid" });
  });
});

app.post("/register", (req, res) => {
  const credentials = getRegisterRequestData({
    ...req.body,
    plan: Plan.Standard,
  });
  if (!credentials) return res.sendStatus(400);
  sequelizer
    .addAccount(credentials)
    .then(() => res.sendStatus(200))
    .catch((e) => {
      const message =
        ((e.errors && e.errors[0]?.message) as string | undefined) || null;
      switch (message) {
        case "username must be unique":
          res.status(409).send({ message: RegisterError.UsernameExists });
          break;
        case "email must be unique":
          res.status(409).send({ message: RegisterError.EmailExists });
          break;
        default:
          res.sendStatus(500);
      }
    });
});

sequelizer
  .init()
  .then(() => app.listen(PORT, () => console.log("Running on port ", PORT)));
