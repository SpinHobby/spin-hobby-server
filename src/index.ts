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
import api from "./api";

const PORT = process.env.PORT || 8001;

const sequelizer = new Sequelizer(!!process.env.PORT);

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));

app.use(bodyParser.json());

app.use(express.static("./public/"));

app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello World at port " + process.env.PORT);
});

app.use("/api", api);

async function assertDatabaseConnectionOk() {
	console.log(`Checking database connection...`);
	try {
		await sequelizer.sequelize.authenticate();
		console.log('Database connection OK!');
	} catch (error:any) {
		console.log('Unable to connect to the database:');
		console.log(error.message);
		process.exit(1);
	}
}

async function init() {
	await assertDatabaseConnectionOk();

	sequelizer.init();

	console.log(`Starting Sequelize + Express example on port ${PORT}...`);
	console.log('db', sequelizer.db);

	app.listen(PORT, () => {
		console.log(`Express server started on port ${PORT}. Try some routes, such as '/api/users'.`);
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
