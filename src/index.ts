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
import bcrypt from "bcryptjs";
import { initializeModels } from "./db/models/initModels";

const PORT = process.env.EXPRESS_PORT || 8001;

export const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static("./public/"));
app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello World from Spin Hobby Server!");
});

// Mount your API routes
app.use("/api", api);

// Optional: Add a test login endpoint
app.post("/loginBeta", (req, res) => {
  const { username, password } = req.body;
  console.log("received login attempt:", username);
  res.send("SUCCESS");
});

async function assertDatabaseConnectionOk() {
  console.log(`Checking database connection...`);
  try {
    await sequelizer.sequelize.authenticate();
    console.log("Database connection OK!");
  } catch (error: any) {
    console.log("Unable to connect to the database:");
    console.log(error.message);
    console.log(
      "Make sure your .env file is configured or start the database with: docker-compose up -d db"
    );
    process.exit(1);
  }
}

async function init() {
  try {
    console.log("Initializing server...");

    // Initialize Sequelize model associations
    initializeModels();

    // await assertDatabaseConnectionOk(); // Disabled - no database setup yet

    console.log(`Starting Spin Hobby Server on port ${PORT}...`);

    const server = app.listen(PORT, () => {
      console.log(`🚀 Express server started on port ${PORT}`);
      console.log(`📊 API available at: http://localhost:${PORT}/api`);
      console.log(`🏠 Home page: http://localhost:${PORT}/`);
      console.log("Server is running and waiting for requests...");
    });

    // Keep the process alive
    server.on("error", (error) => {
      console.error("Server error:", error);
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\nReceived SIGINT. Graceful shutdown...");
      server.close(() => {
        console.log("Server closed.");
        process.exit(0);
      });
    });

    console.log("Init function completed successfully");
  } catch (error) {
    console.error("Error in init function:", error);
    process.exit(1);
  }
}

// Add global error handlers
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

console.log("About to call init()...");
init().catch((error) => {
  console.error("Failed to initialize server:", error);
  process.exit(1);
});
