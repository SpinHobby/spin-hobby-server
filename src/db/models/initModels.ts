// Initialize all Sequelize models and their associations
import SquareCategory from "./squareCategory";
import SquareProduct from "./squareProduct";
import SquareMerchant from "./squareMerchant";
import SquareSyncStatus from "./squareSyncStatus";

// Create models object for associations
const models = {
  SquareCategory,
  SquareProduct,
  SquareMerchant,
  SquareSyncStatus,
};

// Initialize all associations
export function initializeModels() {
  console.log("🔗 Initializing Sequelize model associations...");

  try {
    // Call associate method for each model that has it
    if (SquareCategory.associate) {
      SquareCategory.associate(models);
    }

    if (SquareProduct.associate) {
      SquareProduct.associate(models);
    }

    if (SquareMerchant.associate) {
      SquareMerchant.associate(models);
    }

    if (SquareSyncStatus.associate) {
      SquareSyncStatus.associate(models);
    }

    console.log("✅ Model associations initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize model associations:", error);
    throw error;
  }
}

// Export models for use in other parts of the application
export { SquareCategory, SquareProduct, SquareMerchant, SquareSyncStatus };
export default models;
