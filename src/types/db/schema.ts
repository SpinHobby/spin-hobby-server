export enum Plan {
  Admin = "admin",
  Standard = "standard",
}

export enum Operation {
  ADD = "ADD",
  REMOVE = "REMOVE",
  SET = "SET",
  CLEAR = "CLEAR",
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

export interface Image {
  id: number;
  product_id: number;
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

