import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelizer } from "../../utils";

type SyncType = "products" | "categories" | "inventory" | "full";
type SyncStatus = "pending" | "in_progress" | "completed" | "failed";

interface SquareSyncStatusAttributes {
  id: CreationOptional<number>;
  syncType: SyncType;
  status: SyncStatus;
  startedAt: Date;
  completedAt?: Date;
  itemsProcessed: number;
  itemsTotal?: number;
  errorMessage?: string;
  metadata?: any; // JSON for additional sync info

  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

class SquareSyncStatus extends Model<
  InferAttributes<SquareSyncStatus>,
  InferCreationAttributes<SquareSyncStatus>
> {
  declare id: CreationOptional<number>;
  declare syncType: SyncType;
  declare status: SyncStatus;
  declare startedAt: Date;
  declare completedAt?: Date;
  declare itemsProcessed: number;
  declare itemsTotal?: number;
  declare errorMessage?: string;
  declare metadata?: any;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Start a new sync operation
  public static async startSync(syncType: SyncType, itemsTotal?: number) {
    return await SquareSyncStatus.create({
      syncType,
      status: "in_progress",
      startedAt: new Date(),
      itemsProcessed: 0,
      itemsTotal,
    });
  }

  // Update sync progress
  public async updateProgress(itemsProcessed: number, metadata?: any) {
    return await this.update({
      itemsProcessed,
      metadata: metadata ? { ...this.metadata, ...metadata } : this.metadata,
    });
  }

  // Complete sync operation
  public async completeSync(success: boolean, errorMessage?: string) {
    return await this.update({
      status: success ? "completed" : "failed",
      completedAt: new Date(),
      errorMessage,
    });
  }

  // Get latest sync status for a type
  public static async getLatestSync(syncType: SyncType) {
    return await SquareSyncStatus.findOne({
      where: { syncType },
      order: [["startedAt", "DESC"]],
    });
  }

  // Get sync statistics
  public static async getSyncStats(days: number = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const stats = await SquareSyncStatus.findAll({
      where: {
        startedAt: { $gte: since },
      },
      attributes: [
        "syncType",
        "status",
        [sequelizer.sequelize.fn("COUNT", "*"), "count"],
        [
          sequelizer.sequelize.fn(
            "AVG",
            sequelizer.sequelize.col("itemsProcessed")
          ),
          "avgItems",
        ],
      ],
      group: ["syncType", "status"],
      raw: true,
    });

    return stats;
  }

  // Check if sync is currently running
  public static async isSyncRunning(syncType?: SyncType) {
    const where: any = { status: "in_progress" };
    if (syncType) {
      where.syncType = syncType;
    }

    const runningSyncs = await SquareSyncStatus.findAll({ where });
    return runningSyncs.length > 0;
  }

  // Get sync progress percentage
  public getProgressPercentage(): number {
    if (!this.itemsTotal || this.itemsTotal === 0) {
      return 0;
    }
    return Math.round((this.itemsProcessed / this.itemsTotal) * 100);
  }

  // Get sync duration in seconds
  public getDurationSeconds(): number {
    const end = this.completedAt || new Date();
    return Math.round((end.getTime() - this.startedAt.getTime()) / 1000);
  }
}

SquareSyncStatus.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    syncType: {
      type: DataTypes.ENUM("products", "categories", "inventory", "full"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "in_progress", "completed", "failed"),
      allowNull: false,
      defaultValue: "pending",
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    itemsProcessed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    itemsTotal: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
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
    modelName: "SquareSyncStatus",
    tableName: "square_sync_status",
    indexes: [
      {
        fields: ["syncType", "startedAt"],
      },
      {
        fields: ["status"],
      },
    ],
  }
);

export default SquareSyncStatus;
