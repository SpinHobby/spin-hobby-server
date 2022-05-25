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
  avatar: string | null;
}

export interface Category {
  id: number;
  name: string;
}

export interface Product {

  id: number;
  name: string;
  description: string;
  category_id: number;
  inventory_id: number;
  price: number;
  discount_id:number;

}
