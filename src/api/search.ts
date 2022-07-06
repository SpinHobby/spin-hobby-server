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

router.get("/:page", async (req: any, res: any) => {
  try {
    const page = req.params.page.split("&")[0].split("=")[1] as number;

    const searchString = req.params.page.split("&")[1].split("=")[1] as string;

    const products = await sequelizer.db.Product.findAll({
      where: {
        name: {
          [Op.like]: `%${searchString}%`,
        },
      },
      offset: 10 * page,
      limit: 10,
    });

    res.json(products);
  } catch (err) {
    throw err;
  }
});

module.exports = router;
