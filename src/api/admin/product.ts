const router = require('express').Router();
const { User } = require('../db/models');
import { Plan, RegisterError } from "../../types";
import upload from '../multer';
import {
  sequelizer,
  getProductData
} from "../../utils";
import "dotenv/config";

import {
  Login,
  Account,
  LoginError,
  LoginCallback,
  UserCredentials,
} from "../../types";

//add product
router.post("/", upload.array('photos'), (req: { files: any[]; body: any; }, res: { sendStatus: (arg0: number) => any; json: (arg0: { error?: any; status?: string; }) => void; }) => {

  const images = req.files?.join(',');

  const product = getProductData(req.body);

  if (!product) return res.sendStatus(400);

  sequelizer.db.Product.addProduct(product)
    .then(() => res.sendStatus(200))
    .catch((err: any) => res.json({ error:err }));
    
});

//edit product

//delete product
module.exports = router;