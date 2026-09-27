# Deployment checklist

1. Create a managed MySQL 8 database, then either run `db/mysql-schema.sql` yourself or just set `DB_DRIVER=mysql` in `.env` — the app creates the schema automatically on first boot. Run `npm run db:migrate` once if you want to carry over the local `data/catalog.json` demo data.
2. Copy `.env.example` to `.env`; set strong `ADMIN_PASSWORD` and `SESSION_SECRET` values.
3. Configure real Shopify custom-app and WooCommerce REST credentials.
4. Use an image service/CDN (Cloudflare Images/R2, Cloudinary, or S3 + CloudFront) and store transformed image URLs.
5. Deploy using Docker or a Node host such as Render/Railway/Fly.io. Set `PUBLIC_BASE_URL` to the HTTPS public domain.
6. Put a CDN in front of public `GET /api/*` endpoints; cache catalog responses by catalog revision and purge after a completed sync.
7. Configure a scheduled job to POST the two sync endpoints with admin service authentication; add monitoring and daily database backups.
8. Verify the public catalog works without login and `/api/admin/*` returns 401 when unauthenticated.
