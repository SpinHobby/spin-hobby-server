import { Account } from "./index";

export interface Login {
  username: string;
  password: string;
}

export type UserData = Omit<Account, "password">;

export enum LoginError {
  NoUsername = "NoUsername",
  WrongPassword = "WrongPassword",
}

export type LoginCallback<Error extends LoginError | null> = (
  error: Error,
  userData: Error extends LoginError ? null : UserData
) => void;
