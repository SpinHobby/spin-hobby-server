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
  phone: string;
  plan: Plan;
  photo: string | null;
}

export interface Category {
  id: number;
  name: string;
}

