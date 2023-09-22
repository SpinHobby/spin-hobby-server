import "dotenv/config";
import express from "express";
import {
  sequelizer,
  getLoginRequestData,
  getRegisterRequestData,
} from "./utils";
import bodyParser from "body-parser";
import { Plan, RegisterError } from "./types";
import cors from "cors";
import api from "./api";
import { compare, compareSync } from "bcryptjs";

const PORT = process.env.PORT || 5000;

// const sequelizer = new Sequelizer(!!process.env.PORT);

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json());

app.use(express.static("./public/"));

app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello World at port " + PORT);
});

app.post("/loginBeta", (req, res) => {
  // const username = req.body.username
  // const password = req.body.password

  //   console.log("req body: ", req);

  const { username, password } = req.body;

  console.log("received: ", username, password);

  res.send("SUCCESS");
});

app.listen(PORT, () => {
  //   console.log(
  //     `Express server started on port ${PORT}. Try some routes, such as '/api/users'.`
  //   );

  console.log("Listening on port " + PORT);

  const match = compareSync(
    "beta",
    "$2a$10$UqutFHJydOIYkrW1HINpz.80TOzEE0uoECoydZ.P7VdtDL55Og4iO"
  );

  console.log("show match: ", match);
});

// ---------------- Previous version. To be brought back. DO NOT DELETE-------------

// function main() {
//   app.use("/api", api);

//   async function assertDatabaseConnectionOk() {
//     console.log(`Checking database connection...`);
//     try {
//       await sequelizer.sequelize.authenticate();
//       console.log("Database connection OK!");
//     } catch (error: any) {
//       console.log("Unable to connect to the database:");
//       console.log(error.message);
//       process.exit(1);
//     }
//   }

//   async function init() {
//     await assertDatabaseConnectionOk();

//     //sequelizer.init();

//     console.log(`Starting Sequelize + Express example on port ${PORT}...`);
//     //console.log('db', sequelizer.db);

//     app.listen(PORT, () => {
//       console.log(
//         `Express server started on port ${PORT}. Try some routes, such as '/api/users'.`
//       );
//     });
//   }

//   init();

//   // sequelizer.sequelize.sync()
//   //   .then(() => {
//   //     app.listen(PORT, () => console.log("Running on port ", PORT));
//   //   })
//   //   .catch(err => console.log(err));

//   // async () => {
//   //   try {
//   //     await sequelizer.sequelize.authenticate();
//   //     console.log('Connection has been established successfully.');
//   //     app.listen(PORT, () => console.log("Running on port ", PORT));
//   //   } catch (error) {
//   //     console.error('Unable to connect to the database:', error);
//   //   }
//   // }

//   // sequelizer.init();
//   // app.listen(PORT, () => console.log("Running on port ", PORT));

//   // console.log(Sequelizer.db)
//   // sequelizer
//   //   .init()
//   //   .then(() => app.listen(PORT, () => console.log("Running on port ", PORT)))
//   //   .catch(err => console.log(err));
// }
