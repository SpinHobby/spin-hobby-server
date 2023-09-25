/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// import {onRequest} from "firebase-functions/v2/https";
// import * as logger from "firebase-functions/logger";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

import { onRequest } from "firebase-functions/v1/https";
import * as express from "express";
import * as cors from "cors";
import * as bodyParser from "body-parser";

// import { app } from "../../src/index";

// import { app } from "../../src";

// const PORT = process.env.PORT || 5000;

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json());

app.use(express.static("./public/"));

app.use(cors());

app.get("/", async (req, res) => {
  // const snapshot = await User.get();
  // const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  res.send("karano a");
});

app.post("/loginBeta", (req, res) => {
  console.log("hello world login Beta");

  res.send("hello hello hello aoru mainichi");
});

exports.api = onRequest(app);

// app.listen(4000, () => console.log("Up & RUnning *4000"));
