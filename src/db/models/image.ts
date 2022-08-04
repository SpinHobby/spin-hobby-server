"use strict";
import {
  Model,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";
import { Image as ImageType } from "../../types";
import { sequelizer } from "../../utils";

module.exports = (
  sequelize: any,
  DataTypes: { STRING: any; TEXT: any; NUMBER: any; FLOAT: any }
) => {
  class Image extends Model<
    InferAttributes<Image>,
    InferCreationAttributes<Image>
  > {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */

    public static async addImage(
      images: Omit<ImageType, "id" | "product_id">[]
    ): Promise<void> {
      for (const image of images) {
        const {
          fieldname,
          originalname,
          encoding,
          mimetype,
          destination,
          filename,
          path,
          size,
        } = image;

        await sequelizer.sequelize
          .query(
            `
        insert into "Images"
          ( fieldname, originalname, encoding, mimetype, destination, filename, path, size)
        values
          ('${fieldname}', '${originalname}', '${encoding}', '${mimetype}', '${destination}', '${filename}', '${path}', '${size}');
      `
          )
          .catch((err) => {
            throw err;
          });
      }
    }

    static associate(models: any) {
      // define association here
      Image.belongsTo(models.Product, {
        foreignKey: "product_id",
      });
    }
  }
  Image.init(
    {
      fieldname: DataTypes.STRING,
      originalname: DataTypes.STRING,
      encoding: DataTypes.STRING,
      mimetype: DataTypes.STRING,
      destination: DataTypes.STRING,
      filename: DataTypes.STRING,
      path: DataTypes.STRING,
      size: DataTypes.NUMBER,
    },
    {
      sequelize,
      modelName: "Image",
    }
  );
  return Image;
};
