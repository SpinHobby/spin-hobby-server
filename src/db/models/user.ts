'use strict';
import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import bcrypt from "bcryptjs";
import fs from "fs";
import {
  Login,
  Account,
  LoginError,
  LoginCallback,
  UserCredentials,
} from "../../types";
import * as Address from './address';

module.exports = (sequelize: any, DataTypes: { STRING: any; }) => {
  class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {

    public async validateLogin(
      login: Login,
      callback: LoginCallback<LoginError | null>
    ): Promise<void> {
      const account = (await this.sequelize
        .query(
          `
          select * from accounts
          where username = '${login.username}';
        `
        )
        .then((res) => res[0][0])) as Account | undefined;
      if (!account) return callback(LoginError.NoUsername, null);
      const { password, ...userData } = account;
      if (await bcrypt.compare(login.password, password))
        callback(null, userData);
      else callback(LoginError.WrongPassword, null);
    }

    public async addAccount({
      fname,
      lname,
      phone,
      username,
      password,
      email,
      plan,
    }: UserCredentials) {
      const hash = await bcrypt.hash(password, 10);
      await this.sequelize.query(`
      insert into accounts
        ( username, fname, lname, email, password, phone, plan)
      values
        ('${username}', '${fname}', '${lname}', '${email}', '${hash}', '${phone}', '${plan}');
    `);
    }

    static associate(models: any) {
      // define association here
      User.hasMany(models.Address, {foreignKey: 'userId'});
      User.hasMany(models.Payment, {foreignKey: 'userId'});
    }
  }
  User.init({
    username: DataTypes.STRING,
    fname: DataTypes.STRING,
    lname: DataTypes.STRING,
    email: DataTypes.STRING,
    password: DataTypes.STRING,
    phone: DataTypes.STRING,
    avatar: DataTypes.STRING,
    plan: DataTypes.STRING,
  }, {
    sequelize,
    modelName: 'User',
  });
  return User;
};