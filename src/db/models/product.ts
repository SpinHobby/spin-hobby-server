"use strict";
import {
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { Product as ProductType, Image as ImageType} from "../../types";
import { sequelizer } from "../../utils";

module.exports = (
  sequelize: any,
  DataTypes: { STRING: any; TEXT: any; NUMBER: any; FLOAT: any }
) => {
  class Product extends Model<
    InferAttributes<Product>,
    InferCreationAttributes<Product>
  > {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */

    public static async addProduct(
      product: Omit<ProductType, "id">,
      images: Omit<ImageType, "id" | "product_id">[]
    ) {
      const {
        name,
        description,
        category_id,
        inventory_id,
        price,
        discount_id,
      } = product;

      try {
      //   const prod = await sequelizer.sequelize.query(`
      //   insert into "Products"
      //     ( name, description, category_id, inventory_id, price, discount_id)
      //   values
      //     ('${name}', '${description}', '${category_id}', '${inventory_id}', '${price}', '${discount_id}');
      // `).then((res: any) => console.log(res.id))
      console.log(images)

      const newProduct = await sequelizer.db.Product.create({
        name, description, category_id, inventory_id, price, discount_id, Images:images
      }, {
        include: [ sequelizer.db.Image ]
      });

      return newProduct;

      } catch (err) {
        throw err;
      }
    }

    static associate(models: any) {
      // define association here
      Product.belongsTo(models.Category, {
        foreignKey: "category_id",
      });
      Product.belongsToMany(models.Order, {
        through: "Order_items",
        foreignKey: "product_id",
        otherKey: "order_id",
      });
      Product.hasMany(models.Image, { foreignKey: "product_id" });
      //Product.hasOne(models.Order_items, { foreignKey: 'product_id' });
    }
  }
  Product.init(
    {
      name: DataTypes.STRING,
      description: DataTypes.TEXT,
      //category_id: DataTypes.NUMBER,
      inventory_id: DataTypes.NUMBER,
      price: DataTypes.FLOAT,
      discount_id: DataTypes.NUMBER,
    },
    {
      sequelize,
      modelName: "Product",
    }
  );
  return Product;
};
