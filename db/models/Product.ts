const Sequelize = require('sequelize');
const db = require('../db');
// const UserPost = require('./user_post');

const Product = db.define(
  'product',
  {
    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    price: {
      type: Sequelize.NUMBER,
      allowNull: false,
      defaultValue: 0,
    },
    createdAt: {
      allowNull: false,
      type: Sequelize.DATE,
    },
    updatedAt: {
      allowNull: false,
      type: Sequelize.DATE,
    },
    tags: {
      // note: comma separated string since sqlite does not support arrays
      type: Sequelize.STRING,
      allowNull: false,
    },
  },
  {
    timestamps: true,
  }
);
