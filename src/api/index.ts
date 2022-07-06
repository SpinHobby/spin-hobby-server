const express = require('express');

const auth = require('./auth');

const product = require('./admin/product');

const adminRouter = require('./admin');

const cart = require('./cart');

const order = require('./order');

const search = require('./search');

const router = express.Router();

router.use('/', auth);

router.use('/product', product);

router.use('/cart', cart);

router.use('/order', order);

router.use('/search', search);

router.use(adminRouter);

export default router;
