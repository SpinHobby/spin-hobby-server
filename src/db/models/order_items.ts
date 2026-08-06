"use strict";
import {
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelizer } from "../../utils";

module.exports = (sequelize: any, DataTypes: { INTEGER: any }) => {
  class Order_items extends Model<
    InferAttributes<Order_items>,
    InferCreationAttributes<Order_items>
  > {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    public static async addOrderItem({
      order_id,
      product_id,
      quantity,
    }: {
      order_id: number;
      product_id: number;
      quantity: number;
    }) {
      try {
        const order_item = await sequelizer.sequelize.query(
          `
      insert into "Order_items"
        ( order_id, product_id, quantity )
      values
        ('${order_id}', '${product_id}', '${quantity}');
    `,
          {
            type: sequelize.QueryTypes.INSERT,
          }
        );

        return order_item;

      } catch (err) {
        throw err;
      }
    }

    static associate(models: any) {
      // define association here
      //Order_items.belongsTo(models.Order, { foreignKey: "order_id"});
      //Order_items.belongsTo(models.Product, { foreignKey: "product_id"});
    }
  }
  Order_items.init(
    {
      order_id: DataTypes.INTEGER,
      product_id: DataTypes.INTEGER,
      quantity: DataTypes.INTEGER,
    },
    {
      sequelize,
      modelName: "Order_items",
    }
  );
  return Order_items;
};
