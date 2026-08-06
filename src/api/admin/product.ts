const router = require("express").Router();
const { User } = require("../../db/models");
import { Plan, RegisterError } from "../../types";
import upload from "../multer";
import { sequelizer, getProductData } from "../../utils";
import "dotenv/config";

import {
  Login,
  Account,
  LoginError,
  LoginCallback,
  UserCredentials,
} from "../../types";

router.get("/", (req: any, res: { json: (arg0: any) => void }) => {
  sequelizer.db.Product.findAll({
    attributes: ["id"],
    where: {
      id: 2,
    },
  })
    .then((res: any) => {
      console.log(res);
    })
    .catch((err: any) => console.log(err));

  // const products = sequelizer.sequelize.query('select * from "Products";').then(res => {console.log('res',res)}).catch(err => console.log(err));

  sequelizer.db.Product.findAll()
    .then((resu: any) => res.json(resu))
    .catch((err: any) => console.log(err));

  //console.log(sequelizer.db,'sdfasdfsadf')

  //res.json({"err": products});
});

router.get("/:id", async (req: any, res: any) => {
  try {
    const id = req.params.id;
    const product = await sequelizer.db.Product.findOne({
      where: {
        id: id,
      },
    });

    console.log(product);

    res.json(product);
  } catch (e) {
    console.log(e);
  }
});

//add product
router.post(
  "/",
  upload.array("photos"),
  (
    req: { files: string[]; body: any },
    res: {
      sendStatus: (arg0: number) => any;
      json: (arg0: { error?: any; status?: string }) => void;
    }
  ) => {
    const images = req.files?.join(",");

    const product = getProductData(req.body);

    if (!product) return res.sendStatus(400);

    sequelizer.db.Product.addProduct(product)
      .then(() => res.sendStatus(200))
      .catch((err: any) => res.json({ error: err }));
  }
);

//edit product
// router.put(`/:id`, upload.array('photos'), (req, res) => {

//   const product_id = req.params.id;

// });

//delete product
module.exports = router;
