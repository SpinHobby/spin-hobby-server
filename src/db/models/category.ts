'use strict';
import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
module.exports = (sequelize: any, DataTypes: { STRING: any; }) => {
  class Category extends Model<InferAttributes<Category>, InferCreationAttributes<Category>> {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models: any) {
      // define association here
      Category.hasMany(models.Product, {

        foreignKey: 'category_id'
      
      });
    }
  }
  Category.init({
    name: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Category',
  });
  return Category;
};