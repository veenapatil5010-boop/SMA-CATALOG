// MySQL persistence layer for Catalog Maker.
//
// Design: the server keeps its fast in-process JSON cache (data/catalog.json)
// for request-time reads/writes because it is synchronous and simple, which
// matches the "speed first" requirement of the assignment. When DB_DRIVER=mysql
// this module makes MySQL the durable system of record:
//   - on boot, ensureSchema() creates the tables if missing, then loadState()
//     pulls the latest MySQL data into the JSON cache so the app always starts
//     from durable storage.
//   - on every save(), the server calls persistState() which mirrors the full
//     state to MySQL in the background. If MySQL is briefly unavailable the
//     write is logged and skipped rather than crashing the request (see
//     assignment requirement 16: a failed sync/write must not corrupt existing
//     catalog data or break the customer-facing site).
const fs = require('fs');
const path = require('path');

let pool = null;
function enabled() { return (process.env.DB_DRIVER || 'json').toLowerCase() === 'mysql'; }

function getPool() {
  if (pool) return pool;
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'catalog_maker',
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: true,
  });
  return pool;
}

async function ensureSchema() {
  const db = getPool();
  const schemaPath = path.join(__dirname, '..', 'db', 'mysql-schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  // The schema file includes CREATE DATABASE + USE; run it once at boot.
  await db.query(sql);
}

async function loadState() {
  const db = getPool();
  const [[config]] = await db.query('SELECT * FROM catalog_config WHERE id=1');
  const [categories] = await db.query('SELECT * FROM categories ORDER BY sort_order');
  const [products] = await db.query('SELECT * FROM products');
  const [images] = await db.query('SELECT * FROM product_images ORDER BY position');
  const [variants] = await db.query('SELECT * FROM product_variants');
  const [syncRuns] = await db.query('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 50');
  const [syncErrors] = await db.query('SELECT * FROM sync_errors');

  if (!config) return null; // nothing migrated yet, caller should fall back to seed data

  const imagesByProduct = {}, variantsByProduct = {};
  for (const img of images) (imagesByProduct[img.product_id] ??= []).push(img.url);
  for (const v of variants) (variantsByProduct[v.product_id] ??= []).push({ name: v.title, sku: v.sku, price: v.price, stock: v.stock, options: typeof v.options === 'string' ? JSON.parse(v.options) : v.options });
  const errorsByRun = {};
  for (const e of syncErrors) (errorsByRun[e.sync_run_id] ??= []).push(e.message);
  const catById = Object.fromEntries(categories.map(c => [c.id, c.name]));

  return {
    config: { clientName: config.client_name, whatsAppNumber: config.whatsapp_number, activeDesign: config.active_design, pageSize: 12 },
    categories: categories.map(c => ({ id: c.id, slug: c.slug, name: c.name, sortOrder: c.sort_order, visible: !!c.visible })),
    products: products.map(p => ({
      id: p.id, source: p.source, sourceId: p.source_id, sourceUrl: p.source_url, name: p.name, sku: p.sku,
      price: Number(p.price), compareAtPrice: p.compare_at_price == null ? null : Number(p.compare_at_price),
      currency: p.currency, description: p.description, categoryId: p.category_id, categoryName: catById[p.category_id] || 'Uncategorized',
      stock: p.stock, variants: variantsByProduct[p.id] || [], images: imagesByProduct[p.id] || [],
      metadata: typeof p.metadata === 'string' ? JSON.parse(p.metadata) : (p.metadata || {}),
      sourceFingerprint: p.source_fingerprint, createdAt: p.created_at, updatedAt: p.updated_at,
    })),
    syncHistory: syncRuns.map(r => ({ id: r.id, source: r.source, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, created: r.created_count, updated: r.updated_count, unchanged: r.unchanged_count, errors: errorsByRun[r.id] || [] })),
    updatedAt: new Date().toISOString(),
  };
}

const id = () => require('crypto').randomUUID();

async function persistState(d) {
  const db = getPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO catalog_config (id,client_name,whatsapp_number,active_design) VALUES (1,?,?,?) ON DUPLICATE KEY UPDATE client_name=VALUES(client_name),whatsapp_number=VALUES(whatsapp_number),active_design=VALUES(active_design)',
      [d.config.clientName, d.config.whatsAppNumber, d.config.activeDesign]
    );
    for (const c of d.categories) {
      await conn.query(
        'INSERT INTO categories (id,slug,name,sort_order,visible) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),sort_order=VALUES(sort_order),visible=VALUES(visible)',
        [c.id, c.slug, c.name, c.sortOrder, !!c.visible]
      );
    }
    for (const p of d.products) {
      await conn.query(
        'INSERT INTO products (id,source,source_id,source_url,name,sku,price,compare_at_price,currency,description,category_id,stock,metadata,source_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),stock=VALUES(stock),description=VALUES(description),metadata=VALUES(metadata),source_fingerprint=VALUES(source_fingerprint)',
        [p.id, p.source, p.sourceId || null, p.sourceUrl || null, p.name, p.sku || null, p.price || 0, p.compareAtPrice ?? null, p.currency || 'INR', p.description || '', p.categoryId || null, p.stock || 0, JSON.stringify(p.metadata || {}), p.sourceFingerprint || null]
      );
      await conn.query('DELETE FROM product_images WHERE product_id=?', [p.id]);
      let pos = 0;
      for (const url of p.images || []) await conn.query('INSERT INTO product_images (id,product_id,url,position) VALUES (?,?,?,?)', [id(), p.id, url, pos++]);
      await conn.query('DELETE FROM product_variants WHERE product_id=?', [p.id]);
      for (const v of p.variants || []) await conn.query('INSERT INTO product_variants (id,product_id,source_id,title,sku,price,stock,options) VALUES (?,?,?,?,?,?,?,?)', [id(), p.id, v.sourceId || null, v.name || v.title || 'Default', v.sku || null, v.price ?? null, v.stock ?? null, JSON.stringify(v.options || {})]);
    }
    const latestRuns = (d.syncHistory || []).slice(0, 20);
    for (const r of latestRuns) {
      await conn.query(
        'INSERT INTO sync_runs (id,source,status,started_at,finished_at,created_count,updated_count,unchanged_count,error_count,summary) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),finished_at=VALUES(finished_at),created_count=VALUES(created_count),updated_count=VALUES(updated_count),unchanged_count=VALUES(unchanged_count),error_count=VALUES(error_count)',
        [r.id, r.source, r.status, r.startedAt, r.finishedAt || null, r.created || 0, r.updated || 0, r.unchanged || 0, (r.errors || []).length, JSON.stringify(r)]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error('[mysql-store] persistState failed, JSON cache remains the source of truth for this write:', e.message);
  } finally {
    conn.release();
  }
}

module.exports = { enabled, ensureSchema, loadState, persistState };
