import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelizer } from "../../utils";

interface SquareProductAttributes {
  id: CreationOptional<number>;
  squareId: string;
  squareVersion: number;
  name: string;
  description?: string;
  categoryId?: string;
  squareCategoryId?: string;
  images: any[]; // JSON array of image data
  variations: any[]; // JSON array of variation data
  isDeleted: boolean;
  squareUpdatedAt: Date;
  lastSyncedAt: Date;

  // Admin control fields
  isFeatured: boolean;
  featuredOrder?: number;
  isVisible: boolean;
  adminNotes?: string;
  customPrice?: number; // Override Square price if needed
  customDescription?: string; // Override Square description if needed

  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

class SquareProduct extends Model<
  InferAttributes<SquareProduct>,
  InferCreationAttributes<SquareProduct>
> {
  declare id: CreationOptional<number>;
  declare squareId: string;
  declare squareVersion: number;
  declare name: string;
  declare description?: string;
  declare categoryId?: string;
  declare squareCategoryId?: string;
  declare images: any[];
  declare variations: any[];
  declare isDeleted: boolean;
  declare squareUpdatedAt: Date;
  declare lastSyncedAt: Date;

  declare isFeatured: boolean;
  declare featuredOrder?: number;
  declare isVisible: boolean;
  declare adminNotes?: string;
  declare customPrice?: number;
  declare customDescription?: string;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Get featured products for homepage
  public static async getFeaturedProducts(limit: number = 6) {
    return await SquareProduct.findAll({
      where: {
        isFeatured: true,
        isVisible: true,
        isDeleted: false,
      },
      order: [
        ["featuredOrder", "ASC"],
        ["createdAt", "DESC"],
      ],
      limit,
    });
  }

  // Sync product from Square data
  public static async syncFromSquare(squareProductData: any) {
    const [product, created] = await SquareProduct.upsert({
      squareId: squareProductData.squareId,
      squareVersion: squareProductData.version,
      name: squareProductData.name,
      description: squareProductData.description,
      categoryId: squareProductData.categoryId,
      squareCategoryId: squareProductData.categoryId,
      images: squareProductData.images || [],
      variations: squareProductData.variations || [],
      isDeleted: squareProductData.isDeleted || false,
      squareUpdatedAt: squareProductData.updatedAt,
      lastSyncedAt: new Date(),
      // Preserve admin settings if product already exists
      isFeatured: false, // Default for new products
      isVisible: true, // Default for new products
    });

    return { product, created };
  }

  // Update admin settings
  public async updateAdminSettings(settings: {
    isFeatured?: boolean;
    featuredOrder?: number;
    isVisible?: boolean;
    adminNotes?: string;
    customPrice?: number;
    customDescription?: string;
  }) {
    return await this.update(settings);
  }

  // Get display data (combines Square data with admin overrides)
  public getDisplayData() {
    return {
      id: this.id,
      squareId: this.squareId,
      name: this.name,
      description: this.customDescription || this.description,
      price: this.customPrice || this.variations[0]?.price || 0,
      images: this.images,
      variations: this.variations,
      isFeatured: this.isFeatured,
      isVisible: this.isVisible,
      categoryId: this.categoryId,
      squareCategoryId: this.squareCategoryId,
    };
  }

  static associate(models: any) {
    SquareProduct.belongsTo(models.SquareCategory, {
      foreignKey: "squareCategoryId",
      targetKey: "squareId",
      as: "squareCategory",
    });

    // Many-to-many relationship through product_categories table
    SquareProduct.belongsToMany(models.SquareCategory, {
      through: "product_categories",
      foreignKey: "product_square_id",
      otherKey: "category_square_id",
      sourceKey: "squareId",
      targetKey: "squareId",
      as: "SquareCategories",
    });
  }
}

SquareProduct.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    squareId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "square_id", // Map to snake_case database column
      validate: {
        notEmpty: true,
      },
    },
    squareVersion: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "square_version", // Map to snake_case database column
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    categoryId: {
      type: DataTypes.STRING,
      field: "category_id", // Map to snake_case database column
      allowNull: true,
    },
    squareCategoryId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "square_category_id", // Map to snake_case database column
    },
    images: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    variations: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_deleted", // Map to snake_case database column
    },
    squareUpdatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "square_updated_at", // Map to snake_case database column
    },
    lastSyncedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "last_synced_at", // Map to snake_case database column
    },
    isFeatured: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_featured", // Map to snake_case database column
    },
    featuredOrder: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "featured_order", // Map to snake_case database column
    },
    isVisible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_visible", // Map to snake_case database column
    },
    adminNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "admin_notes", // Map to snake_case database column
    },
    customPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "custom_price", // Map to snake_case database column
    },
    customDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "custom_description", // Map to snake_case database column
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "created_at", // Map to snake_case database column
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "updated_at", // Map to snake_case database column
    },
  },
  {
    sequelize: sequelizer.sequelize,
    modelName: "SquareProduct",
    tableName: "square_products",
    indexes: [
      {
        fields: ["squareId"],
        unique: true,
      },
      {
        fields: ["isFeatured", "featuredOrder"],
      },
      {
        fields: ["isVisible", "isDeleted"],
      },
      {
        fields: ["squareCategoryId"],
      },
    ],
  }
);

export default SquareProduct;
