# eBay

The shop sells on eBay as well as on the website and at the till. Square holds the one count of what is on the shelf; eBay is kept in step
with it, so a one-of-a-kind figure can never sell twice.

## How stock stays in step

- **An eBay sale takes the unit off Square.** eBay's orders are read every 2 minutes (`EBAY_SYNC_INTERVAL_MINUTES`), from a little before
  where the last read stopped. Every order line is recorded in `ebay_order_lines`, and the Square change is an adjustment (IN_STOCK → SOLD)
  carrying an idempotency key made from the order line (`ebay-sale-<order>-<line>`). Reading the same order again, a check that stops
  halfway, or a retry after Square was down all count the sale once.
- **A cancelled eBay order puts the unit back, once** (`ebay-restock-<order>-<line>`, line status `restocked`).
- **A sale Square refused** (Square down) is recorded as `failed` and tried again on every check with the same key until it goes through.
- **Square's count goes to eBay.** Whenever Square's stock changes (its `inventory.count.updated` webhook, the scheduled catalog sync, a
  restock in the admin, an eBay sale just applied), the eBay listings of those products get Square's count, read fresh from Square
  (`src/common/inventory-events.ts` → `EbaySyncService.stockChanged`). A website order or a till sale lowers Square's count, so eBay follows
  within seconds.
- **Every 30 minutes every listing is set to Square's count again** (`EBAY_RECONCILE_INTERVAL_MINUTES`), whether or not it seems to have
  changed: any drift is corrected.
- **Sold out:** a listing at 0 is shown as "sold out". If the eBay account does not have eBay's *out-of-stock control* turned on, eBay ends a
  listing at 0; when Square has stock again the sync publishes it again (a new eBay listing). Turning on out-of-stock control in eBay's
  Seller Hub (Account → Site preferences → Sell your item) keeps the same listing.
- **Items listed on eBay by hand** (not from the admin) have SKUs the shop does not know: their orders are recorded as `skipped` and never
  touch Square.
- The admin shows the sync's state (Settings → eBay): when orders were last checked, when quantities were last sent, the last full check, the
  last problem, and recent eBay sales with what was done with each. **Check now** runs both directions at once.

## Setting it up (once)

1. **Developer keys.** At developer.ebay.com, create (or open) the shop's application. Sandbox keys work straight away; production keys need
   step 2 first. Put `EBAY_CLIENT_ID` (App ID), `EBAY_CLIENT_SECRET` (Cert ID) and `EBAY_ENVIRONMENT` (`sandbox` or `production`) on the
   server.
2. **Account deletion notices (production only).** In the developer portal, Alerts & Notifications → Marketplace account deletion: endpoint
   `https://<api>/ebay/account-deletion`, and a verification token you make up (32–80 letters, digits, `_` or `-`). Put the same two in
   `EBAY_DELETION_ENDPOINT` and `EBAY_VERIFICATION_TOKEN` **before** pressing Save there: eBay calls the endpoint to check it. The shop
   keeps no eBay buyer's data, so a notice has nothing to delete.
3. **Sign-in return address (RuName).** User Tokens → "Get a Token from eBay via Your Application" → add an eBay redirect URL: *Your
   auth accepted URL* = `https://<api>/ebay/oauth/callback` (declined URL: the same). eBay shows its name (the RuName, like
   `Spin_Hobby-SpinHobb-shop-abcdef`): put it in `EBAY_RU_NAME`.
4. **Token key.** `EBAY_TOKEN_KEY` = `openssl rand -base64 32`. It encrypts the seller's tokens in the database; changing it means
   connecting eBay again.
5. **Seller account.** In eBay's Seller Hub, opt in to business policies and create a shipping, a payment and a return policy for eBay
   Canada.
6. **Connect.** As an owner: Admin → Settings → eBay → **Connect eBay**, sign in on eBay's page and approve. Back in Settings, choose the
   three policies and where items ship from (or **+ New location**), and **Save eBay setup**.
7. **List.** Open a product → eBay → **List on eBay**: check the title (80 characters at most), pick the category eBay suggests, fill the
   item specifics marked `*`, the condition and the price. The quantity is never typed: it is Square's count. Photos are the ones picked
   for eBay (the "eBay" chips on the product's photos), or else the product's photos; eBay fetches them itself, so they must be on
   https (Square's and our storage's are).

## Routes

| Route | Who | What |
| --- | --- | --- |
| `GET /admin/ebay` | staff | connection, setup, sync state, recent eBay sales |
| `POST /admin/ebay/connect` | owner | eBay's sign-in page address |
| `GET /ebay/oauth/callback` | eBay | the end of the sign-in; redirects to the admin |
| `GET/PUT /admin/ebay/setup` | owner | the seller's policies and locations; save the ones to use |
| `POST /admin/ebay/locations` | owner | create a location on eBay |
| `POST /admin/ebay/sync` | staff | check orders and set every listing to Square's count now |
| `GET /admin/ebay/categories?q=`, `GET /admin/ebay/categories/:id/aspects` | staff | category suggestions, item specifics |
| `GET/PUT /admin/ebay/products/:id`, `POST /admin/ebay/products/:id/end` | staff | a product's listing: read, list or revise, end |
| `DELETE /admin/ebay/connection` | owner | disconnect (refused while listings are live) |
| `GET/POST /ebay/account-deletion` | eBay | marketplace account deletion challenge and notices |

Tables: `ebay_connection` (one row; tokens encrypted), `ebay_oauth_states`, `ebay_listings`, `ebay_order_lines` (migration
`20261017140000_ebay.sql`). Tests: `test/e2e/ebay.e2e-spec.ts` (eBay and Square stand in).
