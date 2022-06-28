const express = require('express');
const router = express.Router();
const AdminJS = require('adminjs');
const AdminJSExpress = require('@adminjs/express');
const AdminJSSequelize = require('@adminjs/sequelize');
const db = require('../../db/models');
import {
  sequelizer
} from "../../utils";

AdminJS.registerAdapter(AdminJSSequelize);

let dbArr: any = [];

Object.keys(sequelizer.db).forEach(model => dbArr.push({resource: sequelizer.db[model]}));

//Object.keys(db).forEach(model => dbArr.push(db[model]));

const adminJs = new AdminJS({
  resources: dbArr,
  rootPath: '/admin',
});

const adminRouter = AdminJSExpress.buildRouter(adminJs);

router.use('/admin', adminRouter);

module.exports = router;