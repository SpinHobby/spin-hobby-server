const router = require("express").Router();
//const { User } = require('../db/models');
const { Op } = require("sequelize");
import { Plan, RegisterError } from "../types";
import jwt from "jsonwebtoken";
import upload from "./multer";
import {
  sequelizer,
  getLoginRequestData,
  getRegisterRequestData,
} from "../utils";
import "dotenv/config";
import authenticateToken from "./middleware/authenticateToken";
import {
  Login,
  Account,
  LoginError,
  LoginCallback,
  UserCredentials,
} from "../types";

router.get("/", async (req: any, res: any) => {
  try {
    const page = req.query.page as number;

    console.log("hello ++++++++++++++++++++++");

    const searchString = req.query.keywords as string;

    const products = await sequelizer.db.Product.findAll({
      where: {
        name: {
          [Op.like]: `%${searchString}%`,
        },
      },
      offset: 10 * page,
      limit: 10,
    });

    console.log(products);
    res.json(products);
  } catch (err) {
    console.log(err);
  }
});

module.exports = router;
