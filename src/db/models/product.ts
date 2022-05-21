'use strict';
import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
module.exports = (sequelize: any, DataTypes: { STRING: any; TEXT: any; NUMBER: any; FLOAT: any; }) => {
  class Product extends Model<InferAttributes<Product>, InferCreationAttributes<Product>> {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models: any) {
      // define association here
      Product.belongsTo(models.Category);
    }
  }
  Product.init({
    name: DataTypes.STRING,
    description: DataTypes.TEXT,
    category_id: DataTypes.NUMBER,
    inventory_id: DataTypes.NUMBER,
    price: DataTypes.FLOAT,
    discount_id: DataTypes.NUMBER
  }, {
    sequelize,
    modelName: 'Product',
  });
  return Product;
};