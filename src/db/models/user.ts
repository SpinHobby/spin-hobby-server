"use strict";
import {
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import bcrypt from "bcryptjs";
import fs from "fs";
import {
  Login,
  Account,
  LoginError,
  LoginCallback,
  UserCredentials,
} from "../../types";
import * as Address from "./address";
import { sequelizer } from "../../utils";

module.exports = (sequelize: any, DataTypes: { STRING: any }) => {
  class User extends Model<
    InferAttributes<User>,
    InferCreationAttributes<User>
  > {
    public static async validateLogin(
      login: Login,
      callback: LoginCallback<LoginError | null>
    ): Promise<void> {
      const account = (await sequelizer.sequelize
        .query(
          `
          select * from "Users"
          where username = '${login.username.toLowerCase()}';
        `
        )
        .then((res) => res[0][0])
        .catch((err) => {
          throw err;
        })) as Account | undefined;

      if (!account) return callback(LoginError.NoUsername, null);
      const { password, ...userData } = account;
      if (await bcrypt.compare(login.password, password))
        callback(null, userData);
      else callback(LoginError.WrongPassword, null);
    }

    public static async addAccount({
      fname,
      lname,
      phone,
      username,
      password,
      email,
      plan,
    }: UserCredentials): Promise<any> {
      const hash = await User.encryptPassword(password, 10);
      await sequelizer.sequelize
        .query(
          `
      insert into "Users"
        ( username, fname, lname, email, password, phone, plan)
      values
        ('${username.toLowerCase()}', '${fname}', '${lname}', '${email}', '${hash}', '${phone}', '${plan}');
    `,
          {
            type: sequelize.QueryTypes.INSERT,
          }
        )
        .catch((err) => {
          console.log("start the queryu 888888888888");
          throw err;
        });

      return await sequelizer.db.User.findOne({
        where: { username: username.toLowerCase() },
      });

      //console.log(user, "hello")
    }

    public static async encryptPassword(password: string, salt: number) {
      return bcrypt.hash(password, salt);
    }

    static associate(models: any) {
      // define association here
      User.hasMany(models.Address, { foreignKey: "user_id" });
      User.hasMany(models.Payment, { foreignKey: "user_id" });
      User.hasMany(models.Order, { foreignKey: "user_id" });
    }
  }
  User.init(
    {
      username: DataTypes.STRING,
      fname: DataTypes.STRING,
      lname: DataTypes.STRING,
      email: DataTypes.STRING,
      password: DataTypes.STRING,
      phone: DataTypes.STRING,
      avatar: DataTypes.STRING,
      plan: DataTypes.STRING,
    },
    {
      sequelize,
      modelName: "User",
    }
  );

  return User;
};
