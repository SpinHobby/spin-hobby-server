import express from "express";
const router = express.Router();
// const { User } = require("../db/models"); // Temporarily disabled
import { Plan, RegisterError } from "../types";
// import upload from "./multer"; // Temporarily disabled
import {
  sequelizer,
  getLoginRequestData,
  getRegisterRequestData,
} from "../utils";
import "dotenv/config";

import {
  Login,
  Account,
  LoginError,
  LoginCallback,
  UserCredentials,
} from "../types";

// Temporary basic routes for testing
router.get("/test", (req, res) => {
  res.json({ message: "Auth API is working!" });
});

router.post("/test-login", (req, res) => {
  res.json({ message: "Login endpoint reached", body: req.body });
});

/* 
// TODO: Re-enable these routes once database models are properly set up for ES modules

router.post(
  "/login",
  (
    req: { body: Login },
    res: {
      sendStatus: (arg0: number) => any;
      json: (arg0: { error?: any; status?: string }) => void;
    }
  ) => {
    const login = getLoginRequestData(req.body);
    if (!login) return res.sendStatus(400);

    sequelizer.db.User.validateLogin(login, (error: any, userData: any) => {
      if (error) res.json({ error });
      else res.json({ status: "valid" });
    });
  }
);

router.post(
  "/register",
  // upload.single("avatar"), // Disabled until multer is added
  (
    req: { body: any; file: string | undefined },
    res: {
      sendStatus: (arg0: number) => void;
      status: (arg0: number) => {
        (): any;
        new (): any;
        send: { (arg0: { message: RegisterError }): void; new (): any };
      };
    }
  ) => {
    const credentials = getRegisterRequestData({
      ...req.body,
      plan: Plan.Standard,
    });
    if (!credentials) {
      return res.sendStatus(400);
    }

    if (req.file) {
      credentials.avatar = req.file;
    }

    sequelizer.db.User.addAccount(credentials)
      .then(() => res.sendStatus(200))
      .catch((e: { errors: { message: any }[] }) => {
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
  }
);
*/

export default router;
