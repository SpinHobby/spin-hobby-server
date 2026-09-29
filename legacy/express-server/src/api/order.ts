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
import authenticateToken from "./middleware/authenticateToken";
import {
  Login,
  Account,
  LoginError,
  LoginCallback,
  UserCredentials,
} from "../types";

router.get("/", authenticateToken, async (req: any, res: any) => {
  try {
    const user_id = req.session.user_id;

    const orders = sequelizer.db.Order.findAll({ where: { user_id } });

    res.json(orders);
  } catch (err) {
    throw err;
  }
  //const order = sequelizer.db.Order.findAll().then((res: any) => console.log(res))
  //const decode = jwt.
  // const authHeader = req.headers;

  // sequelizer.db.Order_items
  //const token = authHeader && authHeader.split(' ')[1]
  //console.log('session',req);
  // .res
  //   .json(req.token);
});

router.post("/add", authenticateToken, async (req: any, res: any) => {
  //const decoded = jwt.verify();

  try {
    const user_id = 1;

    const order = await sequelizer.db.Order.addOrder({
      user_id: user_id,
      payment_id: 1,
      address_id: 1,
      total: 100,
    });

    const items = req.session.cart;

    for (const product_id of Object.keys(items)) {
      const order_items = await sequelizer.db.Order_items.addOrderItem({
        order_id: order.id,
        product_id,
        quantity: items[product_id],
      });
    }
  } catch (err) {
    res.json(err);
  }
});

module.exports = router;
