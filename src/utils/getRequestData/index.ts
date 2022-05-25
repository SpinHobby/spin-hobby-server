import { Login, UserCredentials, Product } from "../../types";
import { emailRegex } from "../../utils";

export function getLoginRequestData(body: any): Login | null {
  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (!username || !password) return null;
  return { username, password } as Login;
}

export function getRegisterRequestData(body: any): UserCredentials | null {
  const { fname, lname, phone, username, password, email, plan } = body;
  const data = { fname, lname, phone, username, password, email, plan };
  if (Object.values(data).some((val) => !val || typeof val !== "string")){
    return null;
  }  
  if (!emailRegex.test(email)) {
    return null
  };
  return { ...data } as UserCredentials;
}

export function getProductData(body: any): Omit<Product, "id"> | null {

  const { name, description, category_id, inventory_id, price, discount_id } = body;
  const data = { name, description, category_id, inventory_id, price, discount_id };

  if (Object.values(data).some((val) => !val)){
    return null;
  }

  return data;

}
