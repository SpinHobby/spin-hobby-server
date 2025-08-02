import express from "express";
import { squareService } from "../services/square";

const router = express.Router();

// In-memory cart storage (in production, use database or session storage)
const cartStorage: { [sessionId: string]: CartSession } = {};

interface CartItem {
  product_id: string;
  variation_id?: string;
  name: string;
  price: number;
  quantity: number;
  image_url?: string;
  catalog_object_id: string;
}

interface CartSession {
  items: CartItem[];
  created_at: Date;
  updated_at: Date;
}

// Helper function to get or create session ID
function getSessionId(req: express.Request): string {
  // In production, use proper session management
  const sessionId =
    (req.headers["x-session-id"] as string) ||
    req.ip + "-" + Date.now().toString();
  return sessionId;
}

// Helper function to get cart for session
function getCartForSession(sessionId: string): CartSession {
  if (!cartStorage[sessionId]) {
    cartStorage[sessionId] = {
      items: [],
      created_at: new Date(),
      updated_at: new Date(),
    };
  }
  return cartStorage[sessionId];
}

/**
 * CART MANAGEMENT ENDPOINTS
 */

// GET /cart - Get current cart contents
router.get("/cart", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const cart = getCartForSession(sessionId);

    // Calculate totals
    const cartItems = cart.items;
    const quantity: { [key: string]: number } = {};

    cartItems.forEach((item) => {
      quantity[item.product_id] = item.quantity;
    });

    const subtotal = cartItems.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    res.json({
      success: true,
      data: {
        cartItems: cartItems.map((item) => ({
          id: item.product_id,
          name: item.name,
          price: item.price,
          image_url: item.image_url,
          catalog_object_id: item.catalog_object_id,
        })),
        quantity,
        subtotal: Math.round(subtotal * 100) / 100, // Round to 2 decimal places
        item_count: cartItems.reduce((total, item) => total + item.quantity, 0),
        session_id: sessionId,
      },
    });
  } catch (error: any) {
    console.error("Error fetching cart:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch cart",
    });
  }
});

// POST /cart/:product_id - Add/Update item in cart
router.post("/cart/:product_id", async (req, res) => {
  try {
    const { product_id } = req.params;
    const {
      delta = 1,
      quantity,
      operation = "ADD",
      variation_id,
      name,
      price,
      image_url,
    } = req.body;

    const sessionId = getSessionId(req);
    const cart = getCartForSession(sessionId);

    // If product info not provided, get it from Square
    let productInfo = { name, price, image_url };
    if (!name || price === undefined) {
      try {
        const squareProduct = await squareService.getProductById(product_id);
        if (squareProduct) {
          productInfo = {
            name: squareProduct.name || `Product ${product_id}`,
            price: squareProduct.price || 0,
            image_url: squareProduct.image_url || "",
          };
        }
      } catch (error) {
        console.warn("Could not fetch product from Square:", error);
        // Use fallback values
        if (!productInfo.name) productInfo.name = `Product ${product_id}`;
        if (productInfo.price === undefined) productInfo.price = 0;
      }
    }

    // Find existing item
    const existingItemIndex = cart.items.findIndex(
      (item) =>
        item.product_id === product_id && item.variation_id === variation_id
    );

    if (operation === "CLEAR") {
      // Remove all items
      cart.items = [];
    } else if (operation === "REMOVE" && existingItemIndex >= 0) {
      // Remove specific item or reduce quantity
      const existingItem = cart.items[existingItemIndex];
      if (quantity !== undefined) {
        // Set to specific quantity
        if (quantity <= 0) {
          cart.items.splice(existingItemIndex, 1);
        } else {
          existingItem.quantity = quantity;
        }
      } else if (delta) {
        // Reduce by delta
        existingItem.quantity -= delta;
        if (existingItem.quantity <= 0) {
          cart.items.splice(existingItemIndex, 1);
        }
      } else {
        // Remove entirely
        cart.items.splice(existingItemIndex, 1);
      }
    } else if (operation === "SET") {
      // Set to specific quantity
      if (existingItemIndex >= 0) {
        if (quantity <= 0) {
          cart.items.splice(existingItemIndex, 1);
        } else {
          cart.items[existingItemIndex].quantity = quantity;
        }
      } else if (quantity > 0) {
        // Add new item
        cart.items.push({
          product_id,
          variation_id,
          name: productInfo.name,
          price: productInfo.price,
          quantity,
          image_url: productInfo.image_url,
          catalog_object_id: product_id,
        });
      }
    } else {
      // ADD operation
      if (existingItemIndex >= 0) {
        // Update existing item
        if (quantity !== undefined) {
          cart.items[existingItemIndex].quantity = quantity;
        } else {
          cart.items[existingItemIndex].quantity += delta;
        }
      } else {
        // Add new item
        cart.items.push({
          product_id,
          variation_id,
          name: productInfo.name,
          price: productInfo.price,
          quantity: quantity !== undefined ? quantity : delta,
          image_url: productInfo.image_url,
          catalog_object_id: product_id,
        });
      }
    }

    // Update timestamp
    cart.updated_at = new Date();

    // Return updated cart
    const cartItems = cart.items;
    const quantityMap: { [key: string]: number } = {};

    cartItems.forEach((item) => {
      quantityMap[item.product_id] = item.quantity;
    });

    const subtotal = cartItems.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    res.json({
      success: true,
      data: {
        cartItems: cartItems.map((item) => ({
          id: item.product_id,
          name: item.name,
          price: item.price,
          image_url: item.image_url,
          catalog_object_id: item.catalog_object_id,
        })),
        quantity: quantityMap,
        subtotal: Math.round(subtotal * 100) / 100,
        item_count: cartItems.reduce((total, item) => total + item.quantity, 0),
        session_id: sessionId,
      },
    });
  } catch (error: any) {
    console.error("Error updating cart:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update cart",
    });
  }
});

// DELETE /cart/:product_id - Remove item from cart
router.delete("/cart/:product_id", async (req, res) => {
  try {
    const { product_id } = req.params;
    const { variation_id } = req.query;

    const sessionId = getSessionId(req);
    const cart = getCartForSession(sessionId);

    // Remove item
    cart.items = cart.items.filter(
      (item) =>
        !(item.product_id === product_id && item.variation_id === variation_id)
    );

    cart.updated_at = new Date();

    // Return updated cart
    const cartItems = cart.items;
    const quantity: { [key: string]: number } = {};

    cartItems.forEach((item) => {
      quantity[item.product_id] = item.quantity;
    });

    const subtotal = cartItems.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    res.json({
      success: true,
      data: {
        cartItems: cartItems.map((item) => ({
          id: item.product_id,
          name: item.name,
          price: item.price,
          image_url: item.image_url,
          catalog_object_id: item.catalog_object_id,
        })),
        quantity,
        subtotal: Math.round(subtotal * 100) / 100,
        item_count: cartItems.reduce((total, item) => total + item.quantity, 0),
        session_id: sessionId,
      },
    });
  } catch (error: any) {
    console.error("Error removing from cart:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to remove item from cart",
    });
  }
});

// DELETE /cart - Clear entire cart
router.delete("/cart", async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const cart = getCartForSession(sessionId);

    cart.items = [];
    cart.updated_at = new Date();

    res.json({
      success: true,
      data: {
        cartItems: [],
        quantity: {},
        subtotal: 0,
        item_count: 0,
        session_id: sessionId,
      },
    });
  } catch (error: any) {
    console.error("Error clearing cart:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to clear cart",
    });
  }
});

// POST /cart/checkout - Create Square hosted checkout session
router.post("/cart/checkout", async (req, res) => {
  try {
    const {
      customer_info,
      redirect_url = "http://localhost:3000/checkout/success",
      cancel_url = "http://localhost:3000/cart",
    } = req.body;

    const sessionId = getSessionId(req);
    const cart = getCartForSession(sessionId);

    if (cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Cart is empty",
      });
    }

    // Create Square checkout session
    const checkoutRequest = {
      order: {
        line_items: cart.items.map((item) => ({
          quantity: item.quantity.toString(),
          catalog_object_id: item.catalog_object_id,
          item_type: "ITEM",
          name: item.name,
          base_price_money: {
            amount: Math.round(item.price * 100), // Convert to cents
            currency: "USD",
          },
        })),
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: {
        redirect_url,
        cancel_url,
        ask_for_shipping_address: customer_info?.ask_for_shipping || true,
        accepted_payment_methods: {
          apple_pay: true,
          google_pay: true,
          cash_app_pay: true,
          afterpay_clearpay: true,
        },
      },
      pre_populated_data: customer_info
        ? {
            buyer_email: customer_info.email,
            buyer_phone_number: customer_info.phone,
            buyer_address: customer_info.address,
          }
        : {},
    };

    const checkoutResult = await squareService.createCheckoutSession(
      checkoutRequest
    );

    if (checkoutResult.success) {
      // Clear cart after successful checkout creation
      cart.items = [];
      cart.updated_at = new Date();

      res.json({
        success: true,
        data: {
          checkout_url: checkoutResult.checkout_url,
          checkout_id: checkoutResult.checkout_id,
          order_id: checkoutResult.order_id,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: checkoutResult.error || "Failed to create checkout session",
      });
    }
  } catch (error: any) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create checkout session",
    });
  }
});

export default router;
