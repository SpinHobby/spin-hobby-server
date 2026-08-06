"use strict";
import {
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
//import { Order } from "../types";
import { sequelizer } from "../../utils";

module.exports = (sequelize: any, DataTypes: { INTEGER: any; DOUBLE: any }) => {
  class Order extends Model<
    InferAttributes<Order>,
    InferCreationAttributes<Order>
  > {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    public static async addOrder({
      user_id,
      payment_id,
      address_id,
      total,
    }: {
      user_id: number;
      payment_id: number;
      address_id: number;
      total: number;
    }) {
      try {
        const order = await sequelizer.sequelize.query(
          `
        insert into "Orders"
          ( user_id, payment_id, address_id, total )
        values
          ('${user_id}', '${payment_id}', '${address_id}', '${total}');
      `,
          {
            type: sequelize.QueryTypes.INSERT,
          }
        );

        return order;
      } catch (err) {
        console.log(err)
      }
    }

    static associate(models: any) {
      // define association here
      Order.belongsTo(models.User, { foreignKey: "user_id" });
      Order.belongsTo(models.Payment, { foreignKey: "payment_id" });
      Order.belongsToMany(models.Product, {
        through: "Order_items",
        foreignKey: "order_id",
        otherKey: "product_id",
      });
      Order.belongsTo(models.Address, { foreignKey: "address_id" });
      //Order.hasMany(models.Order_items, { foreignKey: 'order_id' });
    }
  }
  Order.init(
    {
      user_id: DataTypes.INTEGER,
      payment_id: DataTypes.INTEGER,
      address_id: DataTypes.INTEGER,
      total: DataTypes.DOUBLE,
    },
    {
      sequelize,
      modelName: "Order",
    }
  );
  return Order;
};
