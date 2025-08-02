import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelizer } from "../../utils";

interface SquareCategoryAttributes {
  id: CreationOptional<number>;
  squareId: string;
  squareVersion: number;
  name: string;
  parentCategoryId?: string;
  squareParentCategoryId?: string;
  isDeleted: boolean;
  squareUpdatedAt: Date;
  lastSyncedAt: Date;

  // Admin control fields
  isFeatured: boolean;
  featuredOrder?: number;
  isVisible: boolean;
  adminNotes?: string;
  customName?: string; // Override Square name if needed
  customDescription?: string;

  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

class SquareCategory extends Model<
  InferAttributes<SquareCategory>,
  InferCreationAttributes<SquareCategory>
> {
  declare id: CreationOptional<number>;
  declare squareId: string;
  declare squareVersion: number;
  declare name: string;
  declare parentCategoryId?: string;
  declare squareParentCategoryId?: string;
  declare isDeleted: boolean;
  declare squareUpdatedAt: Date;
  declare lastSyncedAt: Date;

  declare isFeatured: boolean;
  declare featuredOrder?: number;
  declare isVisible: boolean;
  declare adminNotes?: string;
  declare customName?: string;
  declare customDescription?: string;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Get featured categories for homepage
  public static async getFeaturedCategories(limit: number = 7) {
    return await SquareCategory.findAll({
      where: {
        isFeatured: true,
        isVisible: true,
        isDeleted: false,
      },
      order: [
        ["featuredOrder", "ASC"],
        ["name", "ASC"],
      ],
      limit,
    });
  }

  // Sync category from Square data
  public static async syncFromSquare(squareCategoryData: any) {
    const [category, created] = await SquareCategory.upsert({
      squareId: squareCategoryData.squareId,
      squareVersion: squareCategoryData.version,
      name: squareCategoryData.name,
      parentCategoryId: squareCategoryData.parentCategoryId,
      squareParentCategoryId: squareCategoryData.parentCategoryId,
      isDeleted: squareCategoryData.isDeleted || false,
      squareUpdatedAt: squareCategoryData.updatedAt,
      lastSyncedAt: new Date(),
      // Preserve admin settings if category already exists
      isFeatured: false, // Default for new categories
      isVisible: true, // Default for new categories
    });

    return { category, created };
  }

  // Update admin settings
  public async updateAdminSettings(settings: {
    isFeatured?: boolean;
    featuredOrder?: number;
    isVisible?: boolean;
    adminNotes?: string;
    customName?: string;
    customDescription?: string;
  }) {
    return await this.update(settings);
  }

  // Get display data (combines Square data with admin overrides)
  public getDisplayData() {
    return {
      id: this.id,
      squareId: this.squareId,
      name: this.customName || this.name,
      description: this.customDescription,
      isFeatured: this.isFeatured,
      isVisible: this.isVisible,
      parentCategoryId: this.parentCategoryId,
    };
  }

  static associate(models: any) {
    SquareCategory.hasMany(models.SquareProduct, {
      foreignKey: "squareCategoryId",
      sourceKey: "squareId",
      as: "products",
    });

    SquareCategory.belongsTo(models.SquareCategory, {
      foreignKey: "squareParentCategoryId",
      targetKey: "squareId",
      as: "parentCategory",
    });

    SquareCategory.hasMany(models.SquareCategory, {
      foreignKey: "squareParentCategoryId",
      sourceKey: "squareId",
      as: "subcategories",
    });

    // Many-to-many relationship through product_categories table
    SquareCategory.belongsToMany(models.SquareProduct, {
      through: "product_categories",
      foreignKey: "category_square_id",
      otherKey: "product_square_id",
      sourceKey: "squareId",
      targetKey: "squareId",
      as: "SquareProducts",
    });
  }
}

SquareCategory.init(
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
    parentCategoryId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "parent_category_id", // Map to snake_case database column
    },
    squareParentCategoryId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "square_parent_category_id", // Map to snake_case database column
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
    customName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "custom_name", // Map to snake_case database column
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
    modelName: "SquareCategory",
    tableName: "square_categories",
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
        fields: ["squareParentCategoryId"],
      },
    ],
  }
);

export default SquareCategory;
