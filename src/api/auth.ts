const router = require('express').Router();
const { User } = require('../db/models');
import { Plan, RegisterError } from "../types";
import upload from './multer';
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

// router.get('/', (req: any, res: { send: (arg0: string) => void; }) => {

//   console.log('dfadsf')
//   res.send('hell0')
// })

router.post("/login", (req: { body: Login; }, res: { sendStatus: (arg0: number) => any; json: (arg0: { error?: any; status?: string; }) => void; }) => {
  const login = getLoginRequestData(req.body);
  if (!login) return res.sendStatus(400);

  // const users = sequelizer.db.User.findAll();
  // res.json(users);
  // sequelizer.db.User.validateLogin();
  sequelizer.db.User.validateLogin(login, (error: any, userData: any) => {

    // if (error) {
    //   console.log(error);
    // } else {
    //   console.log('ok');
    // }
    if (error) res.json({ error });
    else res.json({ status: "valid" });
  });
});

router.post("/register", upload.single("avatar"), (req: { body: any; file: string | undefined; }, res: { sendStatus: (arg0: number) => void; status: (arg0: number) => { (): any; new(): any; send: { (arg0: { message: RegisterError; }): void; new(): any; }; }; }) => {
  const credentials = getRegisterRequestData({
    ...req.body,
    plan: Plan.Standard,
  });
  if (!credentials) {
    return res.sendStatus(400)
  };

  if(req.file) {

    credentials.avatar = req.file;

  };

  sequelizer.db.User
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
