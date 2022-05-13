import { SequelizeCredentials } from "../../types";

export function getProdCredentials(): SequelizeCredentials {
  return {
    host: "ec2-54-164-40-66.compute-1.amazonaws.com",
    user: "tfzdqksnnmvlqh",
    database: "df5khkpeg0npqr",
    port: 5432,
    password:
      "8e6011d94df8f6725069b6cde989376c7fc7ab619bc3d9d23349cc8dbdfda0d6",
  };
}
