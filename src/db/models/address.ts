'use strict';
import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

module.exports = (sequelize: any, DataTypes: { NUMBER: any; STRING: any; }) => {
  class Address extends Model<InferAttributes<Address>, InferCreationAttributes<Address>> {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models: any) {
      // define association here
      Address.belongsTo(models.User, {

        foreignKey: 'user_id'
      
      });
      Address.hasOne(models.Order, { foreignKey: 'address_id' });
    }
  }
  Address.init({
    user_id: DataTypes.NUMBER,
    address_line1: DataTypes.STRING,
    address_line2: DataTypes.STRING,
    city: DataTypes.STRING,
    country: DataTypes.STRING,
    postal_code: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Address',
  });
  return Address;
};