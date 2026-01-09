// run_sql.js — small helper to promote a user to admin by email
const { Client } = require('pg');
require('dotenv').config();

const email = process.env.ADMIN_EMAIL || process.argv[2];
if(!email){
  console.error('Usage: ADMIN_EMAIL=you@host node run_sql.js  OR node run_sql.js you@host');
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL;
if(!DATABASE_URL){
  console.error('DATABASE_URL not set in environment.');
  process.exit(1);
}

(async ()=>{
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try{
    await client.connect();
    console.log('Connected to Postgres');
    const res = await client.query('UPDATE users SET role=$1, verified = true WHERE email=$2 RETURNING id,email,role', ['admin', email]);
    if(res.rowCount === 0){
      console.error('No user found with email', email);
      process.exit(3);
    }
    console.log('Updated user:', res.rows[0]);
    await client.end();
    process.exit(0);
  }catch(err){
    console.error('Error:', err.message || err);
    try{ await client.end(); }catch(e){}
    process.exit(1);
  }
})();
