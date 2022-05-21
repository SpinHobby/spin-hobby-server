import { Sequelize, DataTypes } from "sequelize";
// import bcrypt from "bcryptjs";
import fs from "fs";
// import {
//   Login,
//   Account,
//   LoginError,
//   LoginCallback,
//   UserCredentials,
// } from "../../types";
import { getLocalCredentials } from "./getLocalCredentials";
import { getProdCredentials } from "./getProdCredentials";
import path from 'path';
const basename = path.basename(__filename);

let db: any = {};

export class Sequelizer {
  public sequelize: Sequelize;

  public db: any;

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

    fs
      .readdirSync('src/db/models')
      .filter((file: string) => {
        return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.ts');
      })
      .forEach((file: any) => {
        const model = require(path.join('../../db/models', file))(this.sequelize, DataTypes);
        db[model.name] = model;
      });

      //console.log(db.Address.findAll());
    Object.keys(db).forEach(modelName => {
      if (db[modelName].associate) {
        db[modelName].associate(db);
      }
    });

    this.db = db;
    this.db.sequelize = this.sequelize;
  }

  // public init() {
  //   return new Promise((resolve, reject) =>
  //     fs.readFile(__dirname + "/../../../db/schema.sql", "utf8", (err, data) =>
  //       err
  //         ? reject(err)
  //         : this.sequelize
  //             .query(data.toString())
  //             .then(() => resolve(null))
  //             .catch((e) => reject(e))
  //     )
  //   );
  // }


  // public async validateLogin(
  //   login: Login,
  //   callback: LoginCallback<LoginError | null>
  // ): Promise<void> {
  //   const account = (await this.sequelize
  //     .query(
  //       `
  //         select * from accounts
  //         where username = '${login.username}';
  //       `
  //     )
  //     .then((res) => res[0][0])) as Account | undefined;
  //   if (!account) return callback(LoginError.NoUsername, null);
  //   const { password, ...userData } = account;
  //   if (await bcrypt.compare(login.password, password))
  //     callback(null, userData);
  //   else callback(LoginError.WrongPassword, null);
  // }

  // public async addAccount({
  //   fname,
  //   lname,
  //   phone,
  //   username,
  //   password,
  //   email,
  //   plan,
  // }: UserCredentials) {
  //   const hash = await bcrypt.hash(password, 10);
  //   await this.sequelize.query(`
  //     insert into accounts
  //       ( username, fname, lname, email, password, phone, plan)
  //     values
  //       ('${username}', '${fname}', '${lname}', '${email}', '${hash}', '${phone}', '${plan}');
  //   `);
  // }
}


