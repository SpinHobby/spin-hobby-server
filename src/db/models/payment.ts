'use strict';
import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
module.exports = (sequelize: any, DataTypes: { NUMBER: any; STRING: any; DATE: any; }) => {
  class Payment extends Model<InferAttributes<Payment>, InferCreationAttributes<Payment>> {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models: any) {
      // define association here
      Payment.belongsTo(models.User, {

        foreignKey: 'user_id'
      
      });

      Payment.hasOne(models.Order, { foreignKey: 'payment_id' });
    }
  }
  Payment.init({
    user_id: DataTypes.NUMBER,
    payment_type: DataTypes.STRING,
    provider: DataTypes.STRING,
    account_number: DataTypes.NUMBER,
    expiry: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'Payment',
  });
  return Payment;
};