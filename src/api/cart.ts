const router = require("express").Router();
//const { User } = require('../db/models');
import { Operation, RegisterError } from "../types";
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

router.get("/", async (req: any, res: any) => {
  let cartItems: any[] = [];
  console.log("get before", req.session);
  req.session.cart = req.session.cart || {};

  for (const cartItem of Object.keys(req.session.cart)) {
    await sequelizer.db.Product.findAll({
      where: {
        id: cartItem,
      },
    })
      .then((res: any) => {
        cartItems.push(res[0]);
      })
      .catch((err: any) => console.log(err));
  }

  //{"24": 5, "1": 1}
  res.json({ cartItems, quantity: req.session.cart });
});

router.post("/:id", async (req: any, res: any) => {
  const product_id = req.params.id;

  console.log("before", req.session, req.body);
  req.session.cart = req.session.cart || {};

  switch (req.body.operation) {
    case Operation.ADD:
      req.session.cart[product_id] =
        (req.session.cart[product_id] || 0) + req.body.delta;
      break;
    case Operation.REMOVE:
      req.session.cart[product_id] =
        (req.session.cart[product_id] || 0) + req.body.delta;
      if (req.session.cart[product_id] <= 0)
        delete req.session.cart[product_id];
      break;
    case Operation.SET:
      req.session.cart[product_id] = req.body.quantity;
      break;
    case Operation.CLEAR:
      req.session.cart = {};
      break;
    default:
  }

  // if (req.body.operation === "ADD" || req.body.operation === "REMOVE") {
  //   req.session.cart[product_id] =
  //     (req.session.cart[product_id] || 0) + req.body.delta;
  //   if (req.session.cart[product_id] <= 0) delete req.session.cart[product_id];
  // } else if (req.body.operation === "SET") {
  //   req.session.cart[product_id] = req.body.quantity;
  // } else if (req.body.operation === "CLEAR") {
  //   req.session.cart = {};
  // }

  let cartItems: any[] = [];

  for (const cartItem of Object.keys(req.session.cart)) {
    await sequelizer.db.Product.findAll({
      where: {
        id: cartItem,
      },
    })
      .then((res: any) => {
        cartItems.push(res[0]);
      })
      .catch((err: any) => console.log(err));
  }
  console.log("AFTER", req.session);

  res.json({ cartItems: cartItems, quantity: req.session.cart });

  //req.body : {product_id, delta, quantity, operation}
  //res.send : {[{product details}], quantity: req.session.cart}
});

// router.post('/remove/:id', (req: any, res: any) => {

//   const product_id = req.params.id;

//   console.log("before", req.session)

//   req.session.cart[product_id] > 1 ? req.session.cart[product_id] -= 1 : delete req.session.cart[product_id];

//   console.log(req.session);

//   res.sendStatus(200);
// });

module.exports = router;
