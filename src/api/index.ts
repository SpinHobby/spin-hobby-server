const express = require('express');

const auth = require('./auth');

const product = require('./product');

const router = express.Router();

router.use('/', auth);

router.use('/product', product)

export default router;
