import "dotenv/config";
import express from "express";
import cookie from "cookie-session";
import {
  sequelizer,
  getLoginRequestData,
  getRegisterRequestData,
} from "./utils";
import bodyParser from "body-parser";
import { Plan, RegisterError } from "./types";
import cors from "cors";
import api from "./api";

const PORT = process.env.PORT || 8001;

//const sequelizer = new Sequelizer(!!process.env.PORT);

const app = express();
app.use(
  cookie({
    name: "session",
    keys: ["secret"],
    maxAge: 24 * 60 * 60 * 1000,
  })
);
app.use(cors(
	{
	origin: "http://localhost:3002",
	methods:['GET', 'POST'],
	credentials: true
}

));

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json());

app.use(express.static("./public/"));

app.get('/product/add', async (req, res) => {

  res.send(`<form action="/product" method="post" enctype="multipart/form-data">
  <label for="name">Product Name: </label>
  <input type="text" id="names" name="name" ></input><br>
  <label for="category_id">Category id: </label>
  <input type="text" id="category_id" name="category_id" ></input><br>
  <label for="Description: ">Description: </label>
  <input type="text" id="description" name="description" ></input><br>
  <label for="price">Price: </label>
  <input type="text" id="price" name="price" ></input><br>
  <label for="inventory_id">Inventory id: </label>
  <input type="text" id="inventory_id" name="inventory_id" ></input><br>
  <label for="discount_id">Discount id: </label>
  <input type="text" id="discount_id" name="discount_id" ></input><br>
  <label for="Pictures">Pictures: </label>
  <input type="file" id="pictures" name="pictures" multiple><br>
  <input type="submit"></form>`);
});

app.get("/", (req, res) => {
  res.send("Hello World at port " + process.env.PORT);
});

app.use("/", api);

async function assertDatabaseConnectionOk() {
  console.log(`Checking database connection...`);
  try {
    await sequelizer.sequelize.authenticate();
    console.log("Database connection OK!");
  } catch (error: any) {
    console.log("Unable to connect to the database:");
    console.log(error.message);
    process.exit(1);
  }
}

async function init() {
  await assertDatabaseConnectionOk();

  //sequelizer.init();

  console.log(`Starting Sequelize + Express example on port ${PORT}...`);
  //console.log('db', sequelizer.db);

  app.listen(PORT, () => {
    console.log(`Express server started on port ${PORT}.`);
  });
}

init();

// sequelizer.sequelize.sync()
//   .then(() => {
//     app.listen(PORT, () => console.log("Running on port ", PORT));
//   })
//   .catch(err => console.log(err));

// async () => {
//   try {
//     await sequelizer.sequelize.authenticate();
//     console.log('Connection has been established successfully.');
//     app.listen(PORT, () => console.log("Running on port ", PORT));
//   } catch (error) {
//     console.error('Unable to connect to the database:', error);
//   }
// }

// sequelizer.init();
// app.listen(PORT, () => console.log("Running on port ", PORT));

// console.log(Sequelizer.db)
// sequelizer
//   .init()
//   .then(() => app.listen(PORT, () => console.log("Running on port ", PORT)))
//   .catch(err => console.log(err));
