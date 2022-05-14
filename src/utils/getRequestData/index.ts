import { Login, UserCredentials } from "../../types";
import { emailRegex } from "../../utils";

export function getLoginRequestData(body: any): Login | null {
  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (!username || !password) return null;
  return { username, password } as Login;
}

export function getRegisterRequestData(body: any): UserCredentials | null {
  const { fname, lname, phone, username, password, email, plan, photo } = body;
  const data = { fname, lname, phone, username, password, email, plan };
  if (Object.values(data).some((val) => !val || typeof val !== "string"))
    return null;
  if (!emailRegex.test(email)) return null;
  return { ...data, photo: photo || null } as UserCredentials;
}
