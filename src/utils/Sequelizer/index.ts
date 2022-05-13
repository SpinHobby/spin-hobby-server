import { Sequelize } from "sequelize";
import bcrypt from "bcryptjs";
import fs from "fs";
import { Login, Account, LoginError, LoginCallback } from "../../types";
import { getLocalCredentials } from "./getLocalCredentials";
import { getProdCredentials } from "./getProdCredentials";

export class Sequelizer {
  private sequelize: Sequelize;

  constructor(isProd: boolean) {
    this.sequelize = this.getSequelization(isProd);
  }

  private getSequelization(isProd: boolean) {
    const { host, user, database, port, password } = isProd
      ? getProdCredentials()
      : getLocalCredentials();
    return new Sequelize(database, user, password, {
      host,
      dialect: "postgres",
      logging: false,
      port,
      dialectOptions: { ssl: { rejectUnauthorized: false } },
    });
  }

  public init() {
    return new Promise((resolve, reject) =>
      fs.readFile(__dirname + "/../../../db/schema.sql", "utf8", (err, data) =>
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
