const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
if(!DATABASE_URL){
  console.error('DATABASE_URL not set in environment.');
  process.exit(1);
}

async function run(){
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Postgres, applying migrations...');

  // Read and execute migrations.sql
  const sqlPath = path.join(__dirname, 'migrations.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const stmts = sql.split(/;\s*\n/).map(s=>s.trim()).filter(Boolean);
  for(const s of stmts){
    try{ await client.query(s); console.log('Executed:', s.substring(0,50) + '...'); }catch(e){ console.warn('Statement failed (may already exist):', e.message); }
  }

  console.log('Migrations applied.');

  // Optional: seed products if empty
  try{
    const res = await client.query('SELECT count(*)::int as c FROM products');
    if(res.rows[0].c === 0){
      const seedPath = path.join(__dirname, 'data', 'products.json');
      if(fs.existsSync(seedPath)){
        const products = JSON.parse(fs.readFileSync(seedPath));
        for(const p of products){
          await client.query('INSERT INTO products(id,title,price,image,category,description,colors,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING', [p.id, p.title, p.price, p.image, p.category, p.description, JSON.stringify(p.colors||[]), 'approved', new Date().toISOString()]);
        }
        console.log('Seeded products into Postgres.');
      } else {
        console.log('No seed products.json found.');
      }
    } else {
      console.log('Products table already has data, skipping seeding.');
    }
  }catch(e){ console.warn('Seeding failed:', e.message); }

  await client.end();
  console.log('Migration complete.');
}

run().catch(err=>{ console.error(err); process.exit(1); });
