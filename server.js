const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// Load a local .env file without requiring an extra runtime dependency.
// Existing process environment variables always take precedence.
function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

const mysqlStore = require('./lib/mysql-store');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'catalog.json');
const PUBLIC = path.join(ROOT, 'public');
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
function seed() {
  const categories = [
    ['living','Living Room',1], ['bedroom','Bedroom',2], ['dining','Dining',3], ['office','Office',4], ['outdoor','Outdoor',5]
  ].map(([slug,name,sort]) => ({id:slug,slug,name,sortOrder:sort,visible:true}));
  const adjectives=['Amber','Sage','Indigo','Terracotta','Ivory','Olive','Sand','Cobalt','Rose','Slate'];
  const nouns=['Weave','Loom','Textile','Runner','Cushion','Throw','Rug','Pattern','Fabric','Mat'];
  const products=[];
  ['shopify','woocommerce'].forEach((source, si) => {
    for(let n=1;n<=50;n++) {
      const category=categories[(n+si)%categories.length]; const a=adjectives[(n+si*3)%adjectives.length], b=nouns[(n*3+si)%nouns.length];
      const sourceId=`${source}-${n}`; const price=1299+(n*137)%6200;
      products.push({id:id(),source,sourceId,sourceUrl:`https://example-${source}.test/products/${sourceId}`,name:`${a} ${b} ${String(n).padStart(2,'0')}`,sku:`${source.slice(0,3).toUpperCase()}-${String(n).padStart(4,'0')}`,price,compareAtPrice:n%4===0?price+800:null,currency:'INR',description:`A hand-selected ${a.toLowerCase()} ${b.toLowerCase()} designed for everyday spaces. Soft texture, considered colour, and durable construction.`,categoryId:category.id,categoryName:category.name,stock:n%11===0?0:3+(n%18),variants:n%3===0?[{name:'Size',options:['Small','Medium','Large']}]:[],images:[`https://images.unsplash.com/photo-${1513694203232 + ((n+si)%20)}?auto=format&fit=crop&w=900&q=75`],metadata:{material:n%2?'Cotton blend':'Wool blend',sourceStatus:'active'},updatedAt:now(),createdAt:now()});
    }
  });
  return {config:{clientName:'Atelier Home',whatsAppNumber:'919999999999',activeDesign:'editorial',pageSize:12},categories,products,syncHistory:[],updatedAt:now()};
}
function store() { if(!fs.existsSync(DATA)){fs.mkdirSync(path.dirname(DATA),{recursive:true});fs.writeFileSync(DATA,JSON.stringify(seed(),null,2));} return JSON.parse(fs.readFileSync(DATA)); }
function save(d){d.updatedAt=now();fs.writeFileSync(DATA,JSON.stringify(d,null,2));if(mysqlStore.enabled())mysqlStore.persistState(d).catch(e=>console.error('[mysql-store] background persist failed:',e.message));}
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function body(req){return new Promise((ok,bad)=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){bad(e)}})})}
function publicProduct(p){return {...p,available:p.stock>0};}
function adapterProducts(source){const d=store(); return d.products.filter(p=>p.source===source).map(p=>({...p,updatedAt:now()}));}
function sync(source){const d=store(), run={id:id(),source,status:'running',startedAt:now(),created:0,updated:0,errors:[]}; try { for(const incoming of adapterProducts(source)){const i=d.products.findIndex(p=>p.source===source&&p.sourceId===incoming.sourceId); if(i<0){d.products.push(incoming);run.created++}else{d.products[i]={...d.products[i],...incoming};run.updated++}} run.status='completed'; } catch(e){run.status='failed';run.errors.push(e.message)} run.finishedAt=now();d.syncHistory.unshift(run);save(d);return run;}
const secret=process.env.SESSION_SECRET||'development-only-change-me';
const sign=v=>crypto.createHmac('sha256',secret).update(v).digest('hex');
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x[0]));}
function isAdmin(req){const t=cookies(req).catalog_admin;return !!t&&crypto.timingSafeEqual(Buffer.from(t),Buffer.from(`${sign('admin')}`));}
function unauthorized(res){return json(res,401,{error:'Admin authentication required'});}
function fingerprint(p){return crypto.createHash('sha256').update(JSON.stringify({name:p.name,sku:p.sku,price:p.price,stock:p.stock,description:p.description,images:p.images,variants:p.variants})).digest('hex');}
async function shopifyProducts(){const domain=process.env.SHOPIFY_SHOP_DOMAIN,token=process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;if(!domain||!token)throw Error('Shopify credentials are not configured');const query=`{ products(first: 250) { nodes { id title handle descriptionHtml updatedAt totalInventory featuredImage { url altText } images(first:10){nodes{url altText}} variants(first:100){nodes{id title sku price inventoryQuantity selectedOptions{name value}}} collections(first:1){nodes{title handle}} } } }`;const r=await fetch(`https://${domain}/admin/api/${process.env.SHOPIFY_API_VERSION||'2025-01'}/graphql.json`,{method:'POST',headers:{'X-Shopify-Access-Token':token,'Content-Type':'application/json'},body:JSON.stringify({query})});const data=await r.json();if(!r.ok||data.errors)throw Error(data.errors?.[0]?.message||'Shopify request failed');return data.data.products.nodes.map(x=>{const v=x.variants.nodes;const c=x.collections.nodes[0];return {source:'shopify',sourceId:x.id,sourceUrl:`https://${domain}/products/${x.handle}`,name:x.title,sku:v[0]?.sku||'',price:+(v[0]?.price||0),currency:'INR',description:x.descriptionHtml.replace(/<[^>]*>/g,''),categoryName:c?.title||'Uncategorized',categoryId:(c?.handle||'uncategorized').replace(/[^a-z0-9]+/gi,'-').toLowerCase(),stock:Math.max(0,x.totalInventory||0),variants:v.map(a=>({name:a.title,sku:a.sku,price:+a.price,stock:a.inventoryQuantity,options:a.selectedOptions})),images:x.images.nodes.map(a=>a.url),metadata:{provider:'shopify'},updatedAt:x.updatedAt};});}
async function wooProducts(){const base=process.env.WOO_BASE_URL,key=process.env.WOO_CONSUMER_KEY,sec=process.env.WOO_CONSUMER_SECRET;if(!base||!key||!sec)throw Error('WooCommerce credentials are not configured');let out=[],page=1;while(true){const r=await fetch(`${base.replace(/\/$/,'')}/wp-json/wc/v3/products?per_page=100&page=${page}`,{headers:{Authorization:'Basic '+Buffer.from(`${key}:${sec}`).toString('base64')}});if(!r.ok)throw Error(`WooCommerce request failed (${r.status})`);const list=await r.json();out.push(...list);if(list.length<100)break;page++}return out.map(x=>({source:'woocommerce',sourceId:String(x.id),sourceUrl:x.permalink,name:x.name,sku:x.sku,price:+x.price||0,currency:x.currency||'INR',description:(x.description||'').replace(/<[^>]*>/g,''),categoryName:x.categories[0]?.name||'Uncategorized',categoryId:(x.categories[0]?.slug||'uncategorized').replace(/[^a-z0-9]+/gi,'-').toLowerCase(),stock:x.stock_status==='instock'?(x.stock_quantity??1):0,variants:[],images:x.images.map(a=>a.src),metadata:{provider:'woocommerce',type:x.type},updatedAt:x.date_modified_gmt||now()}));}
async function syncExternal(source){
  const d=store(),run={id:id(),source,status:'running',startedAt:now(),created:0,updated:0,unchanged:0,errors:[]};
  try{
    const remote=source==='shopify'?await shopifyProducts():await wooProducts();
    for(const incoming of remote){
      try{
        let cat=d.categories.find(c=>c.id===incoming.categoryId);
        if(!cat){cat={id:incoming.categoryId,slug:incoming.categoryId,name:incoming.categoryName,sortOrder:d.categories.length+1,visible:true};d.categories.push(cat)}
        const i=d.products.findIndex(p=>p.source===source&&p.sourceId===incoming.sourceId), hash=fingerprint(incoming);
        if(i<0){d.products.push({...incoming,id:id(),sourceFingerprint:hash,createdAt:now()});run.created++}
        else if(d.products[i].sourceFingerprint===hash){run.unchanged++}
        else{d.products[i]={...d.products[i],...incoming,sourceFingerprint:hash,updatedAt:now()};run.updated++}
      }catch(e){run.errors.push(`${incoming.name||incoming.sourceId}: ${e.message}`)}
    }
    run.status=run.errors.length?'completed_with_errors':'completed';
  }catch(e){
    run.status='failed';
    run.errors.push(e.message);
  }
  run.finishedAt=now();
  d.syncHistory.unshift(run);
  save(d);
  return run;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};

async function bootstrap(){
  if(!mysqlStore.enabled()) return; // DB_DRIVER=json (default): JSON file is the whole database.
  try{
    console.log('[mysql-store] DB_DRIVER=mysql — ensuring schema and loading durable state from MySQL...');
    await mysqlStore.ensureSchema();
    const remoteState=await mysqlStore.loadState();
    if(remoteState){
      fs.mkdirSync(path.dirname(DATA),{recursive:true});
      fs.writeFileSync(DATA,JSON.stringify(remoteState,null,2));
      console.log(`[mysql-store] Loaded ${remoteState.products.length} products and ${remoteState.categories.length} categories from MySQL.`);
    }else{
      // First run against an empty database: seed locally, then push the seed into MySQL so it becomes the source of truth.
      const seeded=store();
      await mysqlStore.persistState(seeded);
      console.log('[mysql-store] MySQL was empty; seeded it from the local demo catalog.');
    }
  }catch(e){
    console.error('[mysql-store] Could not reach MySQL at startup, continuing on the local JSON cache:',e.message);
  }
}

bootstrap().then(()=>{
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'); const parts=u.pathname.split('/').filter(Boolean); const d=store();
 if(u.pathname==='/api/auth/login'&&req.method==='POST'){const x=await body(req), expected=process.env.ADMIN_PASSWORD,attempt=String(x.password||'');if(!expected)return json(res,503,{error:'Set ADMIN_PASSWORD before enabling admin'});if(attempt.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(attempt),Buffer.from(expected)))return json(res,401,{error:'Invalid password'});res.setHeader('Set-Cookie',`catalog_admin=${sign('admin')}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);return json(res,200,{ok:true});}
 if(u.pathname==='/api/auth/logout'&&req.method==='POST'){res.setHeader('Set-Cookie','catalog_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,204,{})}
 if(u.pathname==='/api/auth/session')return json(res,200,{authenticated:isAdmin(req)});
 if(process.env.ADMIN_PASSWORD&&u.pathname.startsWith('/api/admin/')&&!isAdmin(req))return unauthorized(res);
 if(u.pathname==='/api/health') return json(res,200,{ok:true,productCount:d.products.length,lastUpdated:d.updatedAt});
 if(u.pathname==='/api/catalog/config') return json(res,200,{...d.config,publicBaseUrl:process.env.PUBLIC_BASE_URL||''});
 if(u.pathname==='/api/categories') return json(res,200,d.categories.filter(c=>c.visible).sort((a,b)=>a.sortOrder-b.sortOrder));
 if(u.pathname==='/api/products'&&req.method==='GET'){const q=(u.searchParams.get('q')||'').toLowerCase(), cat=u.searchParams.get('category'), availability=u.searchParams.get('availability');const page=Math.max(1,+u.searchParams.get('page')||1),limit=Math.min(48,Math.max(1,+u.searchParams.get('limit')||d.config.pageSize));let items=d.products.filter(p=>(!cat||p.categoryId===cat)&&(!availability||availability!=='in-stock'||p.stock>0)&&(!q||`${p.name} ${p.sku} ${p.description}`.toLowerCase().includes(q)));return json(res,200,{items:items.slice((page-1)*limit,page*limit).map(publicProduct),total:items.length,page,limit,hasMore:page*limit<items.length});}
 if(parts[0]==='api'&&parts[1]==='products'&&parts[2]&&req.method==='GET'){const p=d.products.find(x=>x.id===parts[2]);if(!p)return json(res,404,{error:'Product not found'});const related=d.products.filter(x=>x.categoryId===p.categoryId&&x.id!==p.id).slice(0,4).map(publicProduct);return json(res,200,{...publicProduct(p),related});}
 if(u.pathname==='/api/admin/state') return json(res,200,d);
 if(u.pathname==='/api/admin/products'&&req.method==='POST'){const x=await body(req);const category=d.categories.find(c=>c.id===x.categoryId);const p={id:id(),source:'manual',sourceId:id(),sourceUrl:'',name:x.name||'Untitled product',sku:x.sku||'',price:+x.price||0,currency:'INR',description:x.description||'',categoryId:category?.id||d.categories[0].id,categoryName:category?.name||d.categories[0].name,stock:+x.stock||0,variants:[],images:x.images||[],metadata:{},createdAt:now(),updatedAt:now()};d.products.unshift(p);save(d);return json(res,201,p);}
 if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='products'&&parts[3]&&req.method==='PUT'){const x=await body(req),i=d.products.findIndex(p=>p.id===parts[3]);if(i<0)return json(res,404,{error:'Not found'});const category=d.categories.find(c=>c.id===x.categoryId);d.products[i]={...d.products[i],...x,price:+x.price,stock:+x.stock,categoryName:category?.name||d.products[i].categoryName,updatedAt:now()};save(d);return json(res,200,d.products[i]);}
 if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='products'&&parts[3]&&req.method==='DELETE'){d.products=d.products.filter(p=>p.id!==parts[3]);save(d);return json(res,204,{})}
 if(u.pathname==='/api/admin/categories'&&req.method==='POST'){const x=await body(req);const c={id:(x.slug||x.name||id()).toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:x.name||'New category',slug:(x.slug||x.name||'category').toLowerCase().replace(/[^a-z0-9]+/g,'-'),sortOrder:d.categories.length+1,visible:true};d.categories.push(c);save(d);return json(res,201,c)}
 if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='categories'&&parts[3]&&req.method==='PUT'){const x=await body(req),i=d.categories.findIndex(c=>c.id===parts[3]);if(i<0)return json(res,404,{error:'Category not found'});d.categories[i]={...d.categories[i],name:x.name||d.categories[i].name,slug:(x.slug||d.categories[i].slug).toLowerCase().replace(/[^a-z0-9]+/g,'-'),visible:x.visible===undefined?d.categories[i].visible:!!x.visible,sortOrder:Number.isFinite(+x.sortOrder)?+x.sortOrder:d.categories[i].sortOrder};for(const p of d.products)if(p.categoryId===d.categories[i].id)p.categoryName=d.categories[i].name;save(d);return json(res,200,d.categories[i]);}
 if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='categories'&&parts[3]&&req.method==='DELETE'){const categoryId=parts[3],used=d.products.some(p=>p.categoryId===categoryId);if(used)return json(res,409,{error:'Category contains products. Hide it instead or move products first.'});d.categories=d.categories.filter(c=>c.id!==categoryId);save(d);return json(res,204,{})}
 if(u.pathname==='/api/admin/config'&&req.method==='PUT'){Object.assign(d.config,await body(req));save(d);return json(res,200,d.config)}
 if(parts[0]==='api'&&parts[1]==='admin'&&parts[2]==='sync'&&parts[3]&&req.method==='POST'){if(!['shopify','woocommerce'].includes(parts[3]))return json(res,400,{error:'Unknown source'});const configured=parts[3]==='shopify'?process.env.SHOPIFY_SHOP_DOMAIN&&process.env.SHOPIFY_ADMIN_ACCESS_TOKEN:process.env.WOO_BASE_URL&&process.env.WOO_CONSUMER_KEY&&process.env.WOO_CONSUMER_SECRET;return json(res,200,configured?await syncExternal(parts[3]):sync(parts[3]));}
 let file=u.pathname==='/'?'index.html':u.pathname.replace(/^\//,''); file=path.normalize(path.join(PUBLIC,file));if(!file.startsWith(PUBLIC)||!fs.existsSync(file))file=path.join(PUBLIC,'index.html');return fs.readFile(file,(e,b)=>{if(e)return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(b)});
 }catch(e){console.error(e);json(res,500,{error:'A safe server error occurred'})}}).listen(process.env.PORT||3000,()=>console.log(`Catalog Maker running at http://localhost:${process.env.PORT||3000} (DB_DRIVER=${process.env.DB_DRIVER||'json'})`));
});
