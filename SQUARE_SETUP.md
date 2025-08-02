# Square Integration Setup Guide

This guide will help you set up Square integration for your Spin Hobby store.

## Prerequisites

1. A Square Developer account
2. A Square application created in the Developer Dashboard
3. Square sandbox or production account

## Step 1: Square Developer Setup

1. Go to [Square Developer Dashboard](https://developer.squareup.com/apps)
2. Create a new application for your Spin Hobby store
3. Note down the following credentials:
   - Application ID
   - Application Secret
   - Access Token (sandbox or production)

## Step 2: Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Square API Configuration
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_APPLICATION_SECRET=your_square_application_secret
SQUARE_ACCESS_TOKEN=your_square_access_token

# Square Webhook Configuration
SQUARE_WEBHOOK_SIGNATURE_KEY=your_webhook_signature_key

# Square Environment ('sandbox' for testing, 'production' for live)
SQUARE_ENVIRONMENT=sandbox

# JWT Secret for authentication
JWT_SECRET=your-super-secret-jwt-key-here

# Optional: Square Location ID
SQUARE_LOCATION_ID=your_square_location_id

# Square Integration Settings
SQUARE_AUTO_SYNC=true
SQUARE_SYNC_FREQUENCY_MINUTES=60
SQUARE_WEBHOOKS_ENABLED=true
```

## Step 3: Install Dependencies

Run the following command to install the new Square dependencies:

```bash
npm install
```

## Step 4: Database Migration

The Square integration requires new database tables. You'll need to create migrations for:

- `square_products` - Stores Square product data with admin controls
- `square_categories` - Stores Square category data with admin controls
- `square_merchants` - Stores Square merchant authentication data
- `square_sync_status` - Tracks sync operations

## Step 5: Webhook Setup (Optional but Recommended)

1. In your Square Developer Dashboard, go to Webhooks
2. Add a new webhook endpoint: `https://yourserver.com/api/v1/square/webhooks`
3. Subscribe to these events:
   - `catalog.version.updated`
   - `inventory.count.updated`
   - `payment.created`
4. Copy the webhook signature key to your environment variables

## Available API Endpoints

### Product Data Retrieval

- `GET /api/v1/square/products` - Get all products from Square
- `GET /api/v1/square/products/:id` - Get specific product
- `GET /api/v1/square/products/search?q=query` - Search products
- `GET /api/v1/square/categories` - Get all categories

### Authentication

- `GET /api/v1/square/auth/url` - Get OAuth authorization URL
- `POST /api/v1/square/auth/callback` - Handle OAuth callback
- `GET /api/v1/square/merchant` - Get merchant info (requires auth)

### Messaging & Webhooks

- `POST /api/v1/square/webhooks` - Receive Square webhooks
- `POST /api/v1/square/sync` - Manually trigger sync (requires auth)

### Admin Controls

- `GET /api/v1/square/admin/featured` - Get featured products config
- `POST /api/v1/square/admin/featured` - Update featured products

## Usage Examples

### 1. Authenticate with Square

```javascript
// Get authorization URL
const response = await fetch("/api/v1/square/auth/url?state=admin_login");
const { authorizationUrl } = await response.json();

// Redirect user to Square OAuth
window.location.href = authorizationUrl;

// Handle callback (user will be redirected back with code)
const tokenResponse = await fetch("/api/v1/square/auth/callback", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: "oauth_code_from_square" }),
});

const { token } = await tokenResponse.json();
// Store token for authenticated requests
```

### 2. Fetch Products from Square

```javascript
// Get all products
const products = await fetch("/api/v1/square/products", {
  headers: { Authorization: `Bearer ${token}` },
});

// Search products
const searchResults = await fetch(
  "/api/v1/square/products/search?q=anime&categories=figures",
  {
    headers: { Authorization: `Bearer ${token}` },
  }
);
```

### 3. Manage Featured Products (Admin)

```javascript
// Get current featured configuration
const featured = await fetch("/api/v1/square/admin/featured", {
  headers: { Authorization: `Bearer ${adminToken}` },
});

// Update featured products
await fetch("/api/v1/square/admin/featured", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    featuredProducts: [
      { squareId: "product_1", displayOrder: 1, isActive: true },
      { squareId: "product_2", displayOrder: 2, isActive: true },
    ],
    featuredCategories: [
      { squareId: "category_1", displayOrder: 1, isActive: true },
    ],
  }),
});
```

## Features

### 1. Product Data Retrieval ✅

- Sync products from Square catalog
- Search and filter products
- Real-time inventory updates via webhooks
- Automatic product data refresh

### 2. Authentication & Login ✅

- Square OAuth integration
- Secure token management
- Merchant account linking
- Admin authentication

### 3. Messaging & Communication ✅

- Webhook support for real-time updates
- Sync status tracking
- Error handling and notifications
- Manual sync triggers

### 4. Admin Controls ✅

- Choose which products to feature on homepage
- Set display order for featured items
- Override product descriptions and prices
- Control category visibility
- Manage sync frequency and settings

## Architecture Benefits

- **Own Database Control**: Your product catalog is stored locally, giving you full control
- **Square Sync**: Products sync from Square while maintaining your customizations
- **Admin Dashboard**: Full control over what products and categories to display
- **Real-time Updates**: Webhooks keep your data synchronized
- **Fallback Support**: System works even if Square API is temporarily unavailable

## Security Considerations

- Never expose Square credentials in frontend code
- Use HTTPS for webhook endpoints
- Validate webhook signatures
- Implement proper authentication for admin endpoints
- Store access tokens securely

## Troubleshooting

### Common Issues

1. **Authentication Errors**: Check Square credentials in environment variables
2. **Webhook Failures**: Verify webhook signature key and endpoint URL
3. **Sync Issues**: Check Square API rate limits and network connectivity
4. **Token Expiry**: Implement refresh token logic for long-term access

### Debug Mode

Enable debug logging by setting:

```bash
DEBUG=square:*
NODE_ENV=development
```
