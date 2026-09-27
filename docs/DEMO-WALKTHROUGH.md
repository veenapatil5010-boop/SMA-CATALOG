# 6-minute demonstration walkthrough

1. **0:00 - 0:35: Architecture.** Show `db/mysql-schema.sql`, then explain: Shopify/WooCommerce APIs -> normalized import adapter -> MySQL (via `lib/mysql-store.js`) -> internal catalog API -> mobile catalog. Mention that customer pages never query suppliers directly.
2. **0:35 - 1:15: Admin access.** Sign in using the environment-configured admin password. Show configuration, WhatsApp number and active design.
3. **1:15 - 2:00: Catalog management.** Add a category and product, update price and stock, then show the customer page updating from the internal API.
4. **2:00 - 3:00: Real import.** Show the Shopify and WooCommerce credentials configured on the deployment (never expose tokens). Run each sync, open sync history, and show 50+ imported products from each source.
5. **3:00 - 3:35: Reliability.** Change a source product price, sync again, show one update; immediately sync again, show it is unchanged. Explain fingerprints, source IDs and error records.
6. **3:35 - 4:45: Customer experience.** Use a phone viewport. Browse categories, search and filter, open details/gallery, choose a variant, save wishlist items, select several pieces, and show the pre-filled WhatsApp message.
7. **4:45 - 5:30: Designs and performance.** Switch from Editorial to Minimal in Admin. Show lazy images, skeleton loading, API pagination and CDN image URLs.
8. **5:30 - 6:00: Deployment.** Show public catalog URL, database connection variable, Docker deployment setup, and summarize security/authentication.

Record with voiceover in Loom, OBS, or Windows Game Bar. Do not show API keys, passwords, database URLs, or customer personal data.
