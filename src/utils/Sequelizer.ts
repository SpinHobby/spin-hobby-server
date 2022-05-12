import { Sequelize } from "sequelize";
import bcrypt from "bcryptjs";
import fs from "fs";
import { Login, Account, LoginError, LoginCallback } from "../types";

const localCredentials = {
  host: "localhost",
  user: "postgres",
  database: "spinhobby",
  port: 5432,
  password: "123",
};

const prodCredentials = {
  host: "ec2-54-164-40-66.compute-1.amazonaws.com",
  user: "tfzdqksnnmvlqh",
  database: "df5khkpeg0npqr",
  port: 5432,
  password: "8e6011d94df8f6725069b6cde989376c7fc7ab619bc3d9d23349cc8dbdfda0d6",
};

export class Sequelizer {
  private sequelize: Sequelize;

  constructor(isProd: boolean) {
    this.sequelize = this.getSequelization(isProd);
  }

  private getSequelization(isProd: boolean) {
    const { host, user, database, port, password } = isProd
      ? prodCredentials
      : localCredentials;
    return new Sequelize(database, user, password, {
      host,
      dialect: "postgres",
      logging: false,
    });
  }

  public init() {
    return new Promise((resolve, reject) =>
      fs.readFile(__dirname + "/../../db/schema.sql", "utf8", (err, data) =>
        err
          ? reject(err)
          : this.sequelize
              .query(data.toString())
              .then(() => resolve(null))
              .catch((e) => reject(e))
      )
    );
  }

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
}
