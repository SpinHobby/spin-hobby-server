// Comprehensive anime inventory seeds that map to actual Square catalog items
// This data represents real inventory that would exist in a Square catalog

export interface AnimeProductSeed {
  squareId: string; // Simulated Square catalog object ID
  name: string;
  description: string;
  price: number;
  images: string[];
  variations: {
    id: string;
    name: string;
    price: number;
    sku?: string;
  }[];
  categoryIds: string[]; // Multiple categories
  series: string;
  character?: string;
  tags: string[];
  isFeatured?: boolean;
  isNewArrival?: boolean;
  isPreorder?: boolean;
}

export interface AnimeCategorySeed {
  squareId: string;
  name: string;
  description: string;
  parentCategoryId?: string;
  isFeatured?: boolean;
  customName?: string;
  customDescription?: string;
}

// Anime Categories with hierarchical structure
export const animeCategoriesSeeds: AnimeCategorySeed[] = [
  // Main Categories
  {
    squareId: "CAT_FIGURES_MAIN",
    name: "Figures & Collectibles",
    description: "Premium anime figures and collectible items",
    isFeatured: true,
    customDescription:
      "Discover our premium collection of anime figures and collectibles from your favorite series!",
  },
  {
    squareId: "CAT_APPAREL_MAIN",
    name: "Anime Apparel",
    description: "Stylish anime clothing and accessories",
    isFeatured: true,
    customDescription:
      "Show your anime love with our exclusive apparel collection!",
  },
  {
    squareId: "CAT_ACCESSORIES_MAIN",
    name: "Accessories & Lifestyle",
    description: "Anime accessories for daily life",
    isFeatured: true,
    customDescription: "Add anime magic to your everyday life!",
  },
  {
    squareId: "CAT_PLUSHIES_MAIN",
    name: "Plushies & Soft Goods",
    description: "Cute and cuddly anime plushies",
    isFeatured: true,
  },
  {
    squareId: "CAT_GAMING_MAIN",
    name: "Gaming & Tech",
    description: "Anime-themed gaming accessories and tech",
    isFeatured: false,
  },

  // Sub-categories for Figures
  {
    squareId: "CAT_SCALE_FIGURES",
    name: "Scale Figures",
    description: "High-quality scale figures",
    parentCategoryId: "CAT_FIGURES_MAIN",
  },
  {
    squareId: "CAT_NENDOROIDS",
    name: "Nendoroids",
    description: "Adorable chibi-style figures",
    parentCategoryId: "CAT_FIGURES_MAIN",
  },
  {
    squareId: "CAT_FIGMAS",
    name: "Figma Action Figures",
    description: "Highly articulated action figures",
    parentCategoryId: "CAT_FIGURES_MAIN",
  },
  {
    squareId: "CAT_PRIZE_FIGURES",
    name: "Prize Figures",
    description: "Affordable high-quality figures",
    parentCategoryId: "CAT_FIGURES_MAIN",
  },

  // Sub-categories for Apparel
  {
    squareId: "CAT_TSHIRTS",
    name: "T-Shirts",
    description: "Anime graphic tees",
    parentCategoryId: "CAT_APPAREL_MAIN",
  },
  {
    squareId: "CAT_HOODIES",
    name: "Hoodies & Sweatshirts",
    description: "Cozy anime hoodies",
    parentCategoryId: "CAT_APPAREL_MAIN",
  },
  {
    squareId: "CAT_COSPLAY",
    name: "Cosplay & Costumes",
    description: "Authentic cosplay outfits",
    parentCategoryId: "CAT_APPAREL_MAIN",
  },

  // Series-specific categories
  {
    squareId: "CAT_DEMON_SLAYER",
    name: "Demon Slayer",
    description: "Kimetsu no Yaiba merchandise",
    isFeatured: true,
    customName: "Demon Slayer Collection",
  },
  {
    squareId: "CAT_ONE_PIECE",
    name: "One Piece",
    description: "Pirate adventure merchandise",
    isFeatured: true,
  },
  {
    squareId: "CAT_NARUTO",
    name: "Naruto",
    description: "Hidden Leaf Village merchandise",
    isFeatured: true,
  },
  {
    squareId: "CAT_ATTACK_ON_TITAN",
    name: "Attack on Titan",
    description: "Shingeki no Kyojin merchandise",
    isFeatured: true,
  },
  {
    squareId: "CAT_MY_HERO_ACADEMIA",
    name: "My Hero Academia",
    description: "Boku no Hero Academia merchandise",
    isFeatured: true,
  },
  {
    squareId: "CAT_JUJUTSU_KAISEN",
    name: "Jujutsu Kaisen",
    description: "Sorcery fight merchandise",
    isFeatured: true,
  },
];

// Comprehensive Anime Product Seeds
export const animeProductSeeds: AnimeProductSeed[] = [
  // Demon Slayer Products
  {
    squareId: "PROD_DS_TANJIRO_SCALE",
    name: "Tanjiro Kamado Scale Figure 1/8",
    description:
      "Premium 1/8 scale figure of Tanjiro Kamado in his iconic demon slayer uniform. Highly detailed with authentic coloring and dynamic pose.",
    price: 189.99,
    images: [
      "https://images.goodsmile.info/cgm/images/product/20200730/9943/78032/large/4562ee8e3d6c24e8c7d7a8b64c8e9a6f.jpg",
      "https://images.goodsmile.info/cgm/images/product/20200730/9943/78033/large/c8f7d6a5b4e3e2d1c0b9a8c7b6a5d4e3.jpg",
    ],
    variations: [
      {
        id: "VAR_DS_TANJIRO_STANDARD",
        name: "Standard Edition",
        price: 189.99,
        sku: "DS-TNJ-001",
      },
      {
        id: "VAR_DS_TANJIRO_DX",
        name: "Deluxe Edition with Effects",
        price: 249.99,
        sku: "DS-TNJ-001-DX",
      },
    ],
    categoryIds: ["CAT_SCALE_FIGURES", "CAT_DEMON_SLAYER", "CAT_FIGURES_MAIN"],
    series: "Demon Slayer",
    character: "Tanjiro Kamado",
    tags: ["premium", "scale-figure", "male-character", "protagonist"],
    isFeatured: true,
    isNewArrival: false,
  },
  {
    squareId: "PROD_DS_NEZUKO_NENDOROID",
    name: "Nezuko Kamado Nendoroid",
    description:
      "Adorable Nendoroid of Nezuko Kamado with multiple face plates and accessories including bamboo muzzle and demon form parts.",
    price: 54.99,
    images: [
      "https://images.goodsmile.info/cgm/images/product/20210225/10855/85521/large/nendoroid-nezuko-kamado.jpg",
    ],
    variations: [
      {
        id: "VAR_DS_NEZUKO_NENDO",
        name: "Standard Nendoroid",
        price: 54.99,
        sku: "DS-NEZ-NENDO-001",
      },
    ],
    categoryIds: ["CAT_NENDOROIDS", "CAT_DEMON_SLAYER", "CAT_FIGURES_MAIN"],
    series: "Demon Slayer",
    character: "Nezuko Kamado",
    tags: ["nendoroid", "cute", "female-character", "demon"],
    isFeatured: true,
  },
  {
    squareId: "PROD_DS_CORPS_TSHIRT",
    name: "Demon Slayer Corps T-Shirt",
    description:
      "Official Demon Slayer Corps uniform-inspired t-shirt with authentic emblem design. Premium cotton blend.",
    price: 24.99,
    images: ["https://m.media-amazon.com/images/I/71jK8qF2KNL._AC_UX679_.jpg"],
    variations: [
      {
        id: "VAR_DS_SHIRT_S",
        name: "Size S",
        price: 24.99,
        sku: "DS-SHIRT-S",
      },
      {
        id: "VAR_DS_SHIRT_M",
        name: "Size M",
        price: 24.99,
        sku: "DS-SHIRT-M",
      },
      {
        id: "VAR_DS_SHIRT_L",
        name: "Size L",
        price: 24.99,
        sku: "DS-SHIRT-L",
      },
      {
        id: "VAR_DS_SHIRT_XL",
        name: "Size XL",
        price: 26.99,
        sku: "DS-SHIRT-XL",
      },
    ],
    categoryIds: ["CAT_TSHIRTS", "CAT_DEMON_SLAYER", "CAT_APPAREL_MAIN"],
    series: "Demon Slayer",
    tags: ["apparel", "official", "unisex", "cotton"],
    isFeatured: false,
  },

  // One Piece Products
  {
    squareId: "PROD_OP_LUFFY_GEAR5_FIGURE",
    name: "Monkey D. Luffy Gear 5 Figure",
    description:
      "Epic Gear 5 Luffy figure capturing his awakened Devil Fruit powers. Dynamic sculpting with special translucent effects.",
    price: 299.99,
    images: [
      "https://cdn.animenewsnetwork.com/thumbnails/max1000x1500/cms/news.6/192589/luffy-gear-5-figure.jpg",
    ],
    variations: [
      {
        id: "VAR_OP_LUFFY_G5",
        name: "Gear 5 Edition",
        price: 299.99,
        sku: "OP-LUF-G5-001",
      },
    ],
    categoryIds: ["CAT_SCALE_FIGURES", "CAT_ONE_PIECE", "CAT_FIGURES_MAIN"],
    series: "One Piece",
    character: "Monkey D. Luffy",
    tags: ["premium", "gear-5", "special-edition", "protagonist"],
    isFeatured: true,
    isNewArrival: true,
  },
  {
    squareId: "PROD_OP_ZORO_SWORDS_SET",
    name: "Roronoa Zoro Three Sword Style Set",
    description:
      "Replica set of Zoro's three swords: Wado Ichimonji, Sandai Kitetsu, and Shusui. Display-ready with wooden stand.",
    price: 149.99,
    images: ["https://m.media-amazon.com/images/I/71sK9QZdX8L._AC_SX679_.jpg"],
    variations: [
      {
        id: "VAR_OP_ZORO_SWORDS",
        name: "Three Sword Set",
        price: 149.99,
        sku: "OP-ZOR-SWD-001",
      },
    ],
    categoryIds: ["CAT_ACCESSORIES_MAIN", "CAT_ONE_PIECE"],
    series: "One Piece",
    character: "Roronoa Zoro",
    tags: ["replica", "weapons", "display", "collector"],
    isFeatured: false,
  },
  {
    squareId: "PROD_OP_STRAWHAT_HOODIE",
    name: "Straw Hat Pirates Hoodie",
    description:
      "Official Straw Hat Pirates crew hoodie with Jolly Roger emblem. Premium fleece interior for ultimate comfort.",
    price: 49.99,
    images: ["https://m.media-amazon.com/images/I/71BQFDyBQdL._AC_UX679_.jpg"],
    variations: [
      {
        id: "VAR_OP_HOODIE_S",
        name: "Size S",
        price: 49.99,
        sku: "OP-HOOD-S",
      },
      {
        id: "VAR_OP_HOODIE_M",
        name: "Size M",
        price: 49.99,
        sku: "OP-HOOD-M",
      },
      {
        id: "VAR_OP_HOODIE_L",
        name: "Size L",
        price: 49.99,
        sku: "OP-HOOD-L",
      },
      {
        id: "VAR_OP_HOODIE_XL",
        name: "Size XL",
        price: 54.99,
        sku: "OP-HOOD-XL",
      },
    ],
    categoryIds: ["CAT_HOODIES", "CAT_ONE_PIECE", "CAT_APPAREL_MAIN"],
    series: "One Piece",
    tags: ["hoodie", "crew", "official", "fleece"],
    isFeatured: true,
  },

  // Naruto Products
  {
    squareId: "PROD_NARUTO_ITACHI_FIGURE",
    name: "Itachi Uchiha Susanoo Figure",
    description:
      "Magnificent figure of Itachi in his Susanoo form. Translucent orange Susanoo with incredible detail and LED base lighting.",
    price: 399.99,
    images: [
      "https://cdn.shopify.com/s/files/1/0552/1401/9299/products/HTB1_1024x1024.jpg",
    ],
    variations: [
      {
        id: "VAR_NAR_ITACHI_SUSANOO",
        name: "Susanoo Edition with LED",
        price: 399.99,
        sku: "NAR-ITA-SUS-001",
      },
    ],
    categoryIds: ["CAT_SCALE_FIGURES", "CAT_NARUTO", "CAT_FIGURES_MAIN"],
    series: "Naruto",
    character: "Itachi Uchiha",
    tags: ["premium", "led-effects", "susanoo", "villain"],
    isFeatured: true,
    isNewArrival: false,
  },
  {
    squareId: "PROD_NARUTO_HEADBAND_SET",
    name: "Hidden Village Headband Collection",
    description:
      "Complete set of ninja headbands from all major hidden villages. Authentic metal plates with adjustable cloth bands.",
    price: 89.99,
    images: ["https://m.media-amazon.com/images/I/91jKqZvvzBL._AC_SX679_.jpg"],
    variations: [
      {
        id: "VAR_NAR_HEADBAND_SET",
        name: "5-Piece Village Set",
        price: 89.99,
        sku: "NAR-HEAD-SET-001",
      },
    ],
    categoryIds: ["CAT_ACCESSORIES_MAIN", "CAT_NARUTO", "CAT_COSPLAY"],
    series: "Naruto",
    tags: ["cosplay", "authentic", "metal", "complete-set"],
    isFeatured: false,
  },

  // Attack on Titan Products
  {
    squareId: "PROD_AOT_EREN_TITAN_FIGURE",
    name: "Attack Titan Eren Jaeger Figure",
    description:
      "Massive Attack Titan form figure with articulated jaw and detailed musculature. Premium sculpting captures the terror and power.",
    price: 279.99,
    images: [
      "https://images.goodsmile.info/cgm/images/product/20210623/11232/89654/large/attack-titan-eren.jpg",
    ],
    variations: [
      {
        id: "VAR_AOT_EREN_TITAN",
        name: "Attack Titan Form",
        price: 279.99,
        sku: "AOT-ERE-TIT-001",
      },
    ],
    categoryIds: [
      "CAT_SCALE_FIGURES",
      "CAT_ATTACK_ON_TITAN",
      "CAT_FIGURES_MAIN",
    ],
    series: "Attack on Titan",
    character: "Eren Jaeger",
    tags: ["titan-form", "large-scale", "detailed", "protagonist"],
    isFeatured: true,
  },
  {
    squareId: "PROD_AOT_SURVEY_CORPS_CAPE",
    name: "Survey Corps Cloak",
    description:
      "Official Survey Corps green cloak with Wings of Freedom emblem. High-quality fabric perfect for cosplay or display.",
    price: 79.99,
    images: ["https://m.media-amazon.com/images/I/71FpZKoaKUL._AC_UX679_.jpg"],
    variations: [
      {
        id: "VAR_AOT_CAPE_ADULT",
        name: "Adult Size",
        price: 79.99,
        sku: "AOT-CAPE-A-001",
      },
    ],
    categoryIds: ["CAT_COSPLAY", "CAT_ATTACK_ON_TITAN", "CAT_APPAREL_MAIN"],
    series: "Attack on Titan",
    tags: ["cosplay", "cloak", "wings-of-freedom", "official"],
    isFeatured: false,
  },

  // My Hero Academia Products
  {
    squareId: "PROD_MHA_DEKU_FIGMA",
    name: "Izuku Midoriya Figma Action Figure",
    description:
      "Highly articulated Figma of Deku with multiple face plates, hero costume, and One For All effect parts.",
    price: 74.99,
    images: [
      "https://images.goodsmile.info/cgm/images/product/20190228/8365/62154/large/figma-izuku-midoriya.jpg",
    ],
    variations: [
      {
        id: "VAR_MHA_DEKU_FIGMA",
        name: "Hero Costume Version",
        price: 74.99,
        sku: "MHA-DEK-FIG-001",
      },
    ],
    categoryIds: ["CAT_FIGMAS", "CAT_MY_HERO_ACADEMIA", "CAT_FIGURES_MAIN"],
    series: "My Hero Academia",
    character: "Izuku Midoriya",
    tags: ["figma", "articulated", "hero-costume", "effects"],
    isFeatured: true,
  },
  {
    squareId: "PROD_MHA_ALLMIGHT_PLUSH",
    name: "All Might Plushie",
    description:
      "Adorable All Might plushie in his classic hero pose. Super soft and cuddly, perfect for fans of the Symbol of Peace.",
    price: 29.99,
    images: [
      "https://cdn.shopify.com/s/files/1/2348/0623/products/all-might-plush.jpg",
    ],
    variations: [
      {
        id: "VAR_MHA_ALLMIGHT_PLUSH",
        name: "Standard Plushie",
        price: 29.99,
        sku: "MHA-ALL-PLU-001",
      },
    ],
    categoryIds: ["CAT_PLUSHIES_MAIN", "CAT_MY_HERO_ACADEMIA"],
    series: "My Hero Academia",
    character: "All Might",
    tags: ["plushie", "soft", "symbol-of-peace", "hero"],
    isFeatured: false,
  },

  // Jujutsu Kaisen Products
  {
    squareId: "PROD_JJK_GOJO_NENDOROID",
    name: "Satoru Gojo Nendoroid",
    description:
      "Stylish Nendoroid of the strongest sorcerer Gojo with blindfold, sunglasses, and Limitless technique effect parts.",
    price: 59.99,
    images: [
      "https://images.goodsmile.info/cgm/images/product/20220127/12458/95431/large/nendoroid-satoru-gojo.jpg",
    ],
    variations: [
      {
        id: "VAR_JJK_GOJO_NENDO",
        name: "Teacher Version",
        price: 59.99,
        sku: "JJK-GOJ-NEN-001",
      },
    ],
    categoryIds: ["CAT_NENDOROIDS", "CAT_JUJUTSU_KAISEN", "CAT_FIGURES_MAIN"],
    series: "Jujutsu Kaisen",
    character: "Satoru Gojo",
    tags: ["nendoroid", "teacher", "strongest", "limitless"],
    isFeatured: true,
    isNewArrival: true,
  },
  {
    squareId: "PROD_JJK_SUKUNA_FINGER_REPLICA",
    name: "Ryomen Sukuna Finger Replica Set",
    description:
      "Authentic-looking replica of Sukuna's cursed fingers. Set of 4 detailed resin fingers with display box.",
    price: 64.99,
    images: [
      "https://cdn.shopify.com/s/files/1/0552/1401/9299/products/sukuna-finger-replica.jpg",
    ],
    variations: [
      {
        id: "VAR_JJK_SUKUNA_FINGERS",
        name: "4-Piece Finger Set",
        price: 64.99,
        sku: "JJK-SUK-FIN-001",
      },
    ],
    categoryIds: ["CAT_ACCESSORIES_MAIN", "CAT_JUJUTSU_KAISEN"],
    series: "Jujutsu Kaisen",
    character: "Ryomen Sukuna",
    tags: ["replica", "cursed-object", "resin", "display"],
    isFeatured: false,
  },

  // Gaming & Tech Products
  {
    squareId: "PROD_GAMING_ANIME_MOUSEPAD",
    name: "Anime Gaming Mousepad Collection",
    description:
      "Premium RGB gaming mousepad featuring popular anime artwork. Large size with smooth tracking surface.",
    price: 39.99,
    images: ["https://m.media-amazon.com/images/I/81kKzGbqVyL._AC_SX679_.jpg"],
    variations: [
      {
        id: "VAR_GAME_PAD_NARUTO",
        name: "Naruto Design",
        price: 39.99,
        sku: "GAME-PAD-NAR-001",
      },
      {
        id: "VAR_GAME_PAD_DEMON",
        name: "Demon Slayer Design",
        price: 39.99,
        sku: "GAME-PAD-DS-001",
      },
      {
        id: "VAR_GAME_PAD_ONE_PIECE",
        name: "One Piece Design",
        price: 39.99,
        sku: "GAME-PAD-OP-001",
      },
    ],
    categoryIds: ["CAT_GAMING_MAIN", "CAT_ACCESSORIES_MAIN"],
    series: "Multi-Series",
    tags: ["gaming", "rgb", "mousepad", "tech"],
    isFeatured: false,
  },

  // Preorder Items
  {
    squareId: "PROD_UPCOMING_CHAINSAW_FIGURE",
    name: "Chainsaw Man Denji Figure - Preorder",
    description:
      "Upcoming premium figure of Denji in his Chainsaw Devil form. Expected release in Q3 2024. Limited edition with special base.",
    price: 219.99,
    images: [
      "https://images.goodsmile.info/cgm/images/product/20230815/13890/102547/large/chainsaw-man-denji-figure.jpg",
    ],
    variations: [
      {
        id: "VAR_CSM_DENJI_PREORDER",
        name: "Limited Edition Preorder",
        price: 219.99,
        sku: "CSM-DEN-PRE-001",
      },
    ],
    categoryIds: ["CAT_SCALE_FIGURES", "CAT_FIGURES_MAIN"],
    series: "Chainsaw Man",
    character: "Denji",
    tags: ["preorder", "limited-edition", "chainsaw-devil", "2024"],
    isFeatured: true,
    isPreorder: true,
  },
];

// Helper function to get featured products
export function getFeaturedProducts(): AnimeProductSeed[] {
  return animeProductSeeds.filter((product) => product.isFeatured);
}

// Helper function to get products by series
export function getProductsBySeries(series: string): AnimeProductSeed[] {
  return animeProductSeeds.filter(
    (product) => product.series.toLowerCase() === series.toLowerCase()
  );
}

// Helper function to get products by category
export function getProductsByCategory(categoryId: string): AnimeProductSeed[] {
  return animeProductSeeds.filter((product) =>
    product.categoryIds.includes(categoryId)
  );
}

// Helper function to get new arrivals
export function getNewArrivals(): AnimeProductSeed[] {
  return animeProductSeeds.filter((product) => product.isNewArrival);
}

// Helper function to get preorder items
export function getPreorderItems(): AnimeProductSeed[] {
  return animeProductSeeds.filter((product) => product.isPreorder);
}
