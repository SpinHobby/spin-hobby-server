import express from "express";
import { squareService } from "../services/square";
import jwt from "jsonwebtoken";

const router = express.Router();

/**
 * PRODUCT DATA RETRIEVAL ENDPOINTS
 */

// GET /api/v1/square/products - Get all products from Square
router.get("/v1/square/products", async (req, res) => {
  try {
    const { cursor, limit } = req.query;

    const result = await squareService.getProducts(cursor as string);

    res.json({
      success: true,
      data: result.products,
      pagination: {
        cursor: result.cursor,
        hasMore: result.hasMore,
      },
    });
  } catch (error: any) {
    console.error("Error fetching Square products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch products from Square",
    });
  }
});

// GET /api/v1/square/products/:id - Get specific product from Square
router.get("/v1/square/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const product = await squareService.getProductById(id);

    res.json({
      success: true,
      data: product,
    });
  } catch (error: any) {
    console.error(`Error fetching Square product ${req.params.id}:`, error);
    res.status(404).json({
      success: false,
      error: error.message || "Product not found",
    });
  }
});

// GET /api/v1/square/products/search - Search products in Square
router.get("/v1/square/products/search", async (req, res) => {
  try {
    const { q, categories } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: "Search query parameter 'q' is required",
      });
    }

    const categoryIds = categories
      ? (categories as string).split(",")
      : undefined;
    const products = await squareService.searchProducts(
      q as string,
      categoryIds
    );

    res.json({
      success: true,
      data: products,
      count: products.length,
    });
  } catch (error: any) {
    console.error("Error searching Square products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to search products in Square",
    });
  }
});

// GET /api/v1/square/categories - Get all categories from Square
router.get("/v1/square/categories", async (req, res) => {
  try {
    const categories = await squareService.getCategories();

    res.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (error: any) {
    console.error("Error fetching Square categories:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch categories from Square",
    });
  }
});

/**
 * AUTHENTICATION ENDPOINTS
 */

// GET /api/v1/square/auth/url - Get Square OAuth authorization URL
router.get("/v1/square/auth/url", async (req, res) => {
  try {
    const { state, redirect_uri } = req.query;
    const redirectUri =
      (redirect_uri as string) ||
      `${req.protocol}://${req.get("host")}/api/v1/square/auth/callback`;

    const authUrl = squareService.getOAuthUrl(redirectUri, state as string);

    res.json({
      success: true,
      data: {
        authorizationUrl: authUrl,
        redirectUri,
        state: state || "default",
      },
    });
  } catch (error: any) {
    console.error("Error generating Square auth URL:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate authorization URL",
    });
  }
});

// POST /api/v1/square/auth/callback - Handle Square OAuth callback
router.post("/v1/square/auth/callback", async (req, res) => {
  try {
    const { code, state } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: "Authorization code is required",
      });
    }

    const redirectUri =
      req.body.redirect_uri ||
      `${req.protocol}://${req.get("host")}/api/v1/square/auth/callback`;
    const tokenData = await squareService.exchangeCodeForToken(
      code,
      redirectUri
    );

    if (tokenData.success) {
      // Generate JWT token for your app
      const jwtToken = jwt.sign(
        {
          squareAccessToken: tokenData.accessToken,
          squareMerchantId: tokenData.merchantId,
          merchantDbId: tokenData.merchant.id,
          exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
        },
        process.env.JWT_SECRET || "your-secret-key"
      );

      res.json({
        success: true,
        data: {
          token: jwtToken,
          merchant: {
            id: tokenData.merchant.id,
            merchantId: tokenData.merchantId,
            businessName: tokenData.merchant.merchantName,
            status: tokenData.merchant.status,
          },
          expiresAt: tokenData.expiresAt,
        },
      });
    } else {
      throw new Error("Authentication failed");
    }
  } catch (error: any) {
    console.error("Error handling Square auth callback:", error);
    res.status(400).json({
      success: false,
      error: error.message || "Failed to authenticate with Square",
    });
  }
});

// GET /api/v1/square/auth/verify - Verify JWT token
router.get("/v1/square/auth/verify", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided",
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );

    if (decoded) {
      res.json({
        success: true,
        data: {
          valid: true,
          user: decoded,
        },
      });
    } else {
      res.status(401).json({
        success: false,
        error: "Invalid token",
      });
    }
  } catch (error: any) {
    console.error("Token verification error:", error);
    res.status(401).json({
      success: false,
      error: "Token verification failed",
    });
  }
});

// GET /api/v1/square/merchant - Get merchant information
router.get("/v1/square/merchant", authenticateSquare, async (req, res) => {
  try {
    const merchant = await squareService.getMerchantInfo(req.squareAccessToken);

    res.json({
      success: true,
      data: merchant,
    });
  } catch (error: any) {
    console.error("Error fetching merchant info:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch merchant information",
    });
  }
});

/**
 * MESSAGING & WEBHOOK ENDPOINTS
 */

// POST /api/v1/square/webhooks - Handle Square webhooks
router.post(
  "/v1/square/webhooks",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.get("X-Square-Signature");
      const body = req.body.toString();

      if (!signature) {
        return res.status(400).json({
          success: false,
          error: "Missing Square signature header",
        });
      }

      // Verify webhook signature
      const isValid = squareService.verifyWebhookSignature(body, signature);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: "Invalid webhook signature",
        });
      }

      const event = JSON.parse(body);

      // Process the webhook event
      await squareService.processWebhookEvent(event.type, event.data);

      res.json({
        success: true,
        message: "Webhook processed successfully",
      });
    } catch (error: any) {
      console.error("Error processing Square webhook:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to process webhook",
      });
    }
  }
);

// POST /api/v1/square/sync - Manually trigger product sync
router.post("/v1/square/sync", authenticateSquare, async (req, res) => {
  try {
    // This would trigger a full sync from Square to your database
    const result = await squareService.getProducts();

    res.json({
      success: true,
      message: "Product sync initiated",
      data: {
        productCount: result.products.length,
        hasMore: result.hasMore,
      },
    });
  } catch (error: any) {
    console.error("Error syncing Square products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to sync products",
    });
  }
});

/**
 * ADMIN ENDPOINTS FOR FEATURED PRODUCTS & CATEGORIES
 */

// GET /api/v1/square/admin/featured - Get featured products configuration
router.get("/v1/square/admin/featured", authenticateAdmin, async (req, res) => {
  try {
    // This would get your admin's featured product configuration from database
    // For now, return mock data
    res.json({
      success: true,
      data: {
        featuredProducts: [
          { squareId: "square_product_1", displayOrder: 1, isActive: true },
          { squareId: "square_product_2", displayOrder: 2, isActive: true },
        ],
        featuredCategories: [
          { squareId: "square_category_1", displayOrder: 1, isActive: true },
        ],
      },
    });
  } catch (error: any) {
    console.error("Error fetching featured configuration:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch featured configuration",
    });
  }
});

// POST /api/v1/square/admin/featured - Update featured products configuration
router.post(
  "/v1/square/admin/featured",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { featuredProducts, featuredCategories } = req.body;

      // Here you would save the admin's featured configuration to database
      console.log("Updating featured configuration:", {
        featuredProducts,
        featuredCategories,
      });

      res.json({
        success: true,
        message: "Featured configuration updated successfully",
        data: {
          featuredProducts,
          featuredCategories,
        },
      });
    } catch (error: any) {
      console.error("Error updating featured configuration:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to update featured configuration",
      });
    }
  }
);

/**
 * MIDDLEWARE
 */

// Middleware to authenticate Square access token
async function authenticateSquare(req: any, res: any, next: any) {
  try {
    const authHeader = req.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid authorization header",
      });
    }

    const token = authHeader.substring(7);
    const decoded: any = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );

    req.squareAccessToken = decoded.squareAccessToken;
    req.squareMerchantId = decoded.squareMerchantId;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired token",
    });
  }
}

// Middleware to authenticate admin users
async function authenticateAdmin(req: any, res: any, next: any) {
  try {
    // First authenticate with Square
    await new Promise((resolve, reject) => {
      authenticateSquare(req, res, (err: any) => {
        if (err) reject(err);
        else resolve(true);
      });
    });

    // Then check if user has admin privileges
    // You would implement your own admin authorization logic here
    const isAdmin = true; // Replace with actual admin check

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: "Admin privileges required",
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed",
    });
  }
}

export default router;
