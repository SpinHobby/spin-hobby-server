import "dotenv/config";
import { squareService } from "../services/square";
import { Currency } from "square";

const items = [
  {
    name: "Tanjiro Kamado Scale Figure 1/8",
    description: "Premium 1/8 scale figure of Tanjiro Kamado from Demon Slayer.",
    price: 18999,
    currency: Currency.Cad,
  },
  {
    name: "Nezuko Kamado Nendoroid",
    description: "Adorable chibi-style Nendoroid figure of Nezuko Kamado.",
    price: 5499,
    currency: Currency.Cad,
  },
  {
    name: "Demon Slayer Corps T-Shirt",
    description: "Official Demon Slayer Corps graphic t-shirt.",
    price: 2499,
    currency: Currency.Cad,
  },
  {
    name: "Luffy Figma Action Figure",
    description: "Highly articulated Figma action figure of Monkey D. Luffy.",
    price: 6999,
    currency: Currency.Cad,
  },
  {
    name: "Attack on Titan Survey Corps Hoodie",
    description: "Cozy hoodie featuring the Survey Corps emblem.",
    price: 5999,
    currency: Currency.Cad,
  },
  {
    name: "Jujutsu Kaisen Gojo Plush",
    description: "Soft plush toy of Satoru Gojo.",
    price: 3499,
    currency: Currency.Cad,
  },
];

squareService
  .upsertItems(items)
  .then((objects) => {
    console.log(`Seeded ${objects.length} catalog objects.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to seed catalog:", error);
    process.exit(1);
  });
