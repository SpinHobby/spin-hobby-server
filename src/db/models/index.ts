// const User = require('./user');
// const Post = require('./post');
// const UserPost = require('./user_post');

// User.belongsToMany(Post, {
//   through: UserPost,
// });
// Post.belongsToMany(User, {
//   through: UserPost,
// });
// User.hasMany(UserPost);
// UserPost.belongsTo(User);
// Post.hasMany(UserPost);
// UserPost.belongsTo(Post);
const User = require('./user');
const Address = require('./address');
const Category = require('./category');
const Payment = require('./payment');
const Product = require('./product');
const Order = require('./order');
const Order_items = require('./order_items');
const Images = require('./image');

module.exports = {
  User,
  Address,
  Category,
  Payment,
  Product,
  Order,
  Order_items,
  Images
};
