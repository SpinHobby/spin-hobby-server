const router = require('express').Router();
const { User } = require('../db/models');
import { Plan, RegisterError } from "../types";
import {
  Sequelizer,
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

router.get('/', (req: any, res: any) => {

  res.json(User);
  
})

router.post("/login", (req: { body: Login; }, res: { sendStatus: (arg0: number) => any; json: (arg0: { error?: any; status?: string; }) => void; }) => {
  const login = getLoginRequestData(req.body);
  if (!login) return res.sendStatus(400);
  User.validateLogin(login, (error: any, userData: any) => {
    if (error) res.json({ error });
    else res.json({ status: "valid" });
  });
});

router.post("/register", (req: { body: any; }, res: { sendStatus: (arg0: number) => void; status: (arg0: number) => { (): any; new(): any; send: { (arg0: { message: RegisterError; }): void; new(): any; }; }; }) => {
  const credentials = getRegisterRequestData({
    ...req.body,
    plan: Plan.Standard,
  });
  if (!credentials) return res.sendStatus(400);
  User
    .addAccount(credentials)
    .then(() => res.sendStatus(200))
    .catch((e: { errors: { message: any; }[]; }) => {
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

module.exports = router;
