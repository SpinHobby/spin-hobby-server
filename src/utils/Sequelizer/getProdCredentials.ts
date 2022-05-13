import { SequelizeCredentials } from "../../types";

export function getProdCredentials(): SequelizeCredentials {
  return {
    host: "ec2-34-201-95-176.compute-1.amazonaws.com",
    user: "huqtogqxfmrkyp",
    database: "dfknjud0c0kur5",
    port: 5432,
    password:
      "3fbf2767d09a5d740ba2f59681a0115753c77e6d1f519e49b7f3c2df9ed0dfb3",
  };
}
