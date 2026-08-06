const router = require("express").Router();
//const { User } = require('../db/models');
import { Plan, RegisterError } from "../types";
import jwt from "jsonwebtoken";
import upload from "./multer";
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

router.post("/login", async (req: { body: Login }, res: any) => {
  console.log("LOGIN HERE ---------------> ");

  const login = getLoginRequestData(req.body);
  if (!login) return res.sendStatus(400);

  const user = await sequelizer.db.User.findOne({
    where: {
      username: login.username.toLowerCase(),
    },
  });

  sequelizer.db.User.validateLogin(login, (error: any, userData: any) => {
    if (error) res.json({ error });
    else return;
  }).then(() => {
    const token = jwt.sign({ id: user.dataValues.id }, "secret", {
      expiresIn: 86400,
    });

    // res.json({ status: "valid" });
    res.status(200).json({
      ...user.dataValues,
      token,
    });
  });
});

router.post(
  "/register",
  upload.single("avatar"),
  (req: { body: any; file: string | undefined }, res: any) => {
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

    console.log("===============1 ==============", credentials);

    sequelizer.db.User.addAccount(credentials)
      .then((user: any) => {
        console.log("=============== 1 a =================");

        console.log("here", user);
        const token = jwt.sign({ id: user.dataValues.id }, "secret", {
          expiresIn: 86400,
        });

        console.log("=============== 2 ==============");

        // res.json({ status: "valid" });

        res.status(200).json({
          ...user.dataValues,
          phone: parseInt(user.dataValues.phone),
          token,
        });

        console.log("=============== 3 ==============");

        //res.sendStatus(200)
      })
      .catch((e: { errors: { message: any }[] }) => {
        console.log(e);

        const message =
          ((e.errors && e.errors[0]?.message) as string | undefined) || null;

        console.log("CAUGHT ERROR: ------------", message);

        switch (message) {
          case "username must be unique":
            res.status(409).send({ message: RegisterError.UsernameExists });
            break;
          case "email must be unique":
            res.status(409).send({ message: RegisterError.EmailExists });
            break;
          case "phone must be unique":
            res.status(409).send({ message: RegisterError.PhoneExists });
            break;
          default:
            res.sendStatus(500);
        }
      });
  }
);

module.exports = router;
