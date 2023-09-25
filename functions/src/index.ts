import { onRequest } from "firebase-functions/v1/https";
import express from "express";
import cors from "cors";
import * as bodyParser from "body-parser";
import { compareSync } from "bcryptjs";

export const app = express();

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json());

app.use(express.static("./public/"));

app.use(cors());

app.get("/", async (req, res) => {
  res.send("karano a 123555 purple yellow silver");
});

app.post("/loginBeta", (req, res) => {
  const match =
    compareSync(
      req.body.username,
      "$2a$10$UqutFHJydOIYkrW1HINpz.80TOzEE0uoECoydZ.P7VdtDL55Og4iO"
    ) &&
    compareSync(
      req.body.password,
      "$2a$10$BM7looGxSrlIl6rQz4sjrewgUx/W0dKUTzsJTkRxa5tRYDq/Dell6"
    );
  res.send(match ? "SUCCESS" : "FORBIDDEN");
});

exports.api = onRequest(app);
