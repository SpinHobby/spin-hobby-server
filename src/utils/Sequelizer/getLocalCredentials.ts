import { SequelizeCredentials } from "../../types";

export function getLocalCredentials(): SequelizeCredentials {
  // First, try to parse DATABASE_URL if it exists
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return {
        host: url.hostname,
        user: url.username,
        database: url.pathname.slice(1), // Remove leading slash
        port: parseInt(url.port) || 5432,
        password: url.password,
      };
    } catch (error) {
      console.warn(
        "Failed to parse DATABASE_URL, falling back to individual env vars"
      );
    }
  }

  // Fallback to individual environment variables
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
    user: "user",
    database: "db",
    port: 5432,
    password: "pass",
  };
}
