import { SequelizeCredentials } from "../../types";

export function getLocalCredentials(): SequelizeCredentials {
  const { host, user, database, port: portStr, password } = process.env;
  let localCredentials = { host, user, database, port: portStr, password };
  if (Object.values(localCredentials).some((val) => val === undefined))
    return getDefaultLocalCredentials();
  const port = parseInt(localCredentials.port!);
  if (isNaN(port)) return getDefaultLocalCredentials();
  return { ...localCredentials, port } as SequelizeCredentials;
}

function getDefaultLocalCredentials() {
  return {
    host: "localhost",
    user: "postgres",
    database: "spinhobby",
    port: 5432,
    password: "123",
  };
}
