import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelizer } from "../../utils";

interface SquareMerchantAttributes {
  id: CreationOptional<number>;
  merchantId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  merchantName?: string;
  businessName?: string;
  country?: string;
  currency?: string;
  status: "active" | "inactive" | "revoked";
  lastSyncAt?: Date;

  // Merchant settings
  autoSync: boolean;
  syncFrequency: number; // minutes
  webhooksEnabled: boolean;

  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

class SquareMerchant extends Model<
  InferAttributes<SquareMerchant>,
  InferCreationAttributes<SquareMerchant>
> {
  declare id: CreationOptional<number>;
  declare merchantId: string;
  declare accessToken: string;
  declare refreshToken?: string;
  declare tokenExpiresAt?: Date;
  declare merchantName?: string;
  declare businessName?: string;
  declare country?: string;
  declare currency?: string;
  declare status: "active" | "inactive" | "revoked";
  declare lastSyncAt?: Date;

  declare autoSync: boolean;
  declare syncFrequency: number;
  declare webhooksEnabled: boolean;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Get active merchant
  public static async getActiveMerchant() {
    return await SquareMerchant.findOne({
      where: { status: "active" },
      order: [["updatedAt", "DESC"]],
    });
  }

  // Create or update merchant from OAuth
  public static async createOrUpdateFromOAuth(oauthData: {
    merchantId: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  }) {
    const [merchant, created] = await SquareMerchant.upsert({
      merchantId: oauthData.merchantId,
      accessToken: oauthData.accessToken,
      refreshToken: oauthData.refreshToken,
      tokenExpiresAt: oauthData.expiresAt
        ? new Date(oauthData.expiresAt)
        : undefined,
      status: "active",
    });

    // Deactivate other merchants if this is a new one
    if (created) {
      await SquareMerchant.update(
        { status: "inactive" },
        {
          where: {
            id: { $ne: merchant.id },
            status: "active",
          },
        }
      );
    }

    return merchant;
  }

  // Update merchant info from Square API
  public async updateMerchantInfo(merchantInfo: any) {
    return await this.update({
      merchantName: merchantInfo.merchantName,
      businessName: merchantInfo.businessName,
      country: merchantInfo.country,
      currency: merchantInfo.currency,
    });
  }

  // Check if token is expired
  public isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) {
      return false; // Assume non-expiring token
    }
    return new Date() >= this.tokenExpiresAt;
  }

  // Update last sync time
  public async updateLastSync() {
    return await this.update({ lastSyncAt: new Date() });
  }

  // Get sync settings
  public getSyncSettings() {
    return {
      autoSync: this.autoSync,
      syncFrequency: this.syncFrequency,
      webhooksEnabled: this.webhooksEnabled,
      lastSyncAt: this.lastSyncAt,
    };
  }

  // Update sync settings
  public async updateSyncSettings(settings: {
    autoSync?: boolean;
    syncFrequency?: number;
    webhooksEnabled?: boolean;
  }) {
    return await this.update(settings);
  }

  // Revoke merchant access
  public async revoke() {
    return await this.update({ status: "revoked" });
  }

  // Check if merchant needs sync (based on frequency)
  public needsSync(): boolean {
    if (!this.autoSync || !this.lastSyncAt) {
      return this.autoSync; // Sync if auto-sync enabled and never synced
    }

    const nextSyncTime = new Date(
      this.lastSyncAt.getTime() + this.syncFrequency * 60 * 1000
    );
    return new Date() >= nextSyncTime;
  }
}

SquareMerchant.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    merchantId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
      },
    },
    accessToken: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    refreshToken: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    tokenExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    merchantName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    businessName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    currency: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "USD",
    },
    status: {
      type: DataTypes.ENUM("active", "inactive", "revoked"),
      allowNull: false,
      defaultValue: "active",
    },
    lastSyncAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    autoSync: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    syncFrequency: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 60, // 60 minutes
    },
    webhooksEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize: sequelizer.sequelize,
    modelName: "SquareMerchant",
    tableName: "square_merchants",
    indexes: [
      {
        fields: ["merchantId"],
        unique: true,
      },
      {
        fields: ["status"],
      },
    ],
  }
);

export default SquareMerchant;
