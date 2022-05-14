export enum Plan {
  Admin = "admin",
  Standard = "standard",
}

export interface Account {
  id: number;
  username: string;
  fname: string;
  lname: string;
  email: string;
  password: string;
  phone: number;
  plan: Plan;
  photo: string | null;
}
