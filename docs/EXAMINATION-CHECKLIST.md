# Catalog Maker — Examination Completion Checklist

## Implemented in this package
- Admin login/logout with HttpOnly session cookie.
- Product add/edit/delete controls, including description, category and image URL management.
- Category create/edit/delete, visibility and display order controls.
- Wishlist viewing without customer accounts using browser localStorage.
- Multi-image product gallery/lightbox and imported variant display.
- Shopify/WooCommerce sync error capture: failed external requests now create a failed sync run without destroying the existing catalog.
- MySQL persistence path and Docker deployment are included. Use `DB_DRIVER=mysql` for evaluation/deployment.
- Two catalog designs and backend design switching remain supported.

## Still requires external setup (cannot be generated inside a ZIP)
1. Create a Shopify development/test store and add at least 50 products.
2. Create a Shopify Admin API custom app/token and set `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_ADMIN_ACCESS_TOKEN`.
3. Create a WordPress/WooCommerce test store and add at least 50 products.
4. Create WooCommerce REST API credentials and set `WOO_BASE_URL`, `WOO_CONSUMER_KEY`, and `WOO_CONSUMER_SECRET`.
5. Run both live syncs and verify the products in MySQL.
6. Change one source product (price/description/stock/image), run sync again, and record the update demonstration.
7. Deploy the app with MySQL and HTTPS and submit the public catalog URL.
8. Record the required examination videos listed in the assignment.

## Local evaluation
1. Copy `.env.example` to `.env`.
2. Set a strong `ADMIN_PASSWORD` and `SESSION_SECRET`.
3. For Docker evaluation, run `docker compose up --build`.
4. Open `http://localhost:3000` for the public catalog.
5. Open **Admin** and sign in.
6. If live credentials are absent, the built-in demonstration source data provides 50 Shopify-tagged and 50 WooCommerce-tagged products so the UI and sync flow can be exercised.
