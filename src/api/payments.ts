import express from "express";
import { squareService } from "../services/square";
import { randomUUID } from "crypto";

const router = express.Router();

/**
 * SQUARE PAYMENT PROCESSING FOR CUSTOMERS
 * Note: This does NOT require customer login - just payment processing
 */

// POST /api/v1/payments/create - Process customer payment
router.post("/v1/payments/create", async (req, res) => {
  try {
    const {
      sourceId,
      amount,
      currency = "USD",
      orderId,
      customerInfo,
    } = req.body;

    // Validate required fields
    if (!sourceId || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: sourceId and amount are required",
      });
    }

    // Create payment request
    const paymentRequest = {
      sourceId, // Payment token from Square Web Payments SDK
      amountMoney: {
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toUpperCase(),
      },
      idempotencyKey: randomUUID(), // Prevent duplicate payments
      note: `Spin Hobby Order ${orderId || "N/A"}`,
      buyerEmailAddress: customerInfo?.email,
      billingAddress: customerInfo?.billingAddress,
      shippingAddress: customerInfo?.shippingAddress,
    };

    // Process payment through Square
    const paymentResult = await squareService.createPayment(paymentRequest);

    if (paymentResult.success) {
      res.json({
        success: true,
        data: {
          paymentId: paymentResult.payment.id,
          status: paymentResult.payment.status,
          amount: paymentResult.payment.amountMoney,
          receiptUrl: paymentResult.payment.receiptUrl,
          orderId,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: paymentResult.error || "Payment processing failed",
      });
    }
  } catch (error: any) {
    console.error("Payment processing error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error during payment processing",
    });
  }
});

// POST /api/v1/payments/refund - Process refund (admin only)
router.post("/v1/payments/refund", async (req, res) => {
  try {
    const { paymentId, amount, reason } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: "Payment ID is required for refund",
      });
    }

    const refundRequest = {
      paymentId,
      amountMoney: amount
        ? {
            amount: Math.round(amount * 100),
            currency: "USD",
          }
        : undefined, // If no amount, refund full payment
      idempotencyKey: randomUUID(),
      reason: reason || "Customer requested refund",
    };

    const refundResult = await squareService.createRefund(refundRequest);

    if (refundResult.success) {
      res.json({
        success: true,
        data: {
          refundId: refundResult.refund.id,
          status: refundResult.refund.status,
          amount: refundResult.refund.amountMoney,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: refundResult.error || "Refund processing failed",
      });
    }
  } catch (error: any) {
    console.error("Refund processing error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error during refund processing",
    });
  }
});

// GET /api/v1/payments/:paymentId - Get payment details
router.get("/v1/payments/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await squareService.getPayment(paymentId);

    if (payment) {
      res.json({
        success: true,
        data: payment,
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Payment not found",
      });
    }
  } catch (error: any) {
    console.error("Error fetching payment:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch payment details",
    });
  }
});

// GET /api/v1/payments/config/application-id - Get Square Application ID for Web Payments SDK
router.get("/v1/payments/config/application-id", async (req, res) => {
  try {
    const applicationId = process.env.SQUARE_APPLICATION_ID;
    const environment =
      process.env.NODE_ENV === "production" ? "production" : "sandbox";

    if (!applicationId) {
      return res.status(500).json({
        success: false,
        error: "Square Application ID not configured",
      });
    }

    res.json({
      success: true,
      data: {
        applicationId,
        environment,
        locationId: process.env.SQUARE_LOCATION_ID || "main", // You'll need to set this
      },
    });
  } catch (error: any) {
    console.error("Error getting payment config:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get payment configuration",
    });
  }
});

export default router;
