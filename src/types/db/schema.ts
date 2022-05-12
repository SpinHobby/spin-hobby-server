enum Plan {
  Admin = "admin",
  Standard = "standard",
}

export interface Account {
  id: number;
  username: string;
  email: string;
  password: string;
  phone: number;
  plan: Plan;
}
