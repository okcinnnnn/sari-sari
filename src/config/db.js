const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Return NUMERIC columns (money, quantities stored as NUMERIC) as JS numbers
// instead of node-postgres's default string representation.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

// Vercel's Postgres integrations (Neon, Supabase, ...) inject different
// variable names, so accept any of the common ones. Pooled URLs come first —
// serverless functions open many short-lived connections.
const ENV_VARS = [
  'POSTGRES_URL',
  'DATABASE_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
];

function getConnectionString() {
  for (const name of ENV_VARS) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'No Postgres connection string found. Set POSTGRES_URL (or DATABASE_URL) in your environment — ' +
        'on Vercel, connect a Postgres database under Storage (e.g. Neon) and redeploy; locally, point it at any Postgres instance.'
    );
    this.name = 'DatabaseNotConfiguredError';
  }
}

// node-postgres lets SSL params in the URL (e.g. ?sslmode=require) override
// the `ssl` option and treats them as strict certificate verification, which
// fails against poolers with self-signed chains (Supabase, some RDS setups).
// Strip them and configure SSL explicitly instead.
function buildPoolConfig(connectionString) {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(connectionString);
  let cleaned = connectionString;
  try {
    const url = new URL(connectionString);
    ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'].forEach((p) =>
      url.searchParams.delete(p)
    );
    cleaned = url.toString();
  } catch {
    // Not a parseable URL (e.g. key=value DSN) — use it as-is.
  }
  return {
    connectionString: cleaned,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    // Each serverless instance handles one request at a time, so a small pool
    // avoids exhausting the database's connection limit under load.
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
}

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = getConnectionString();
    if (!connectionString) throw new DatabaseNotConfiguredError();
    pool = new Pool(buildPoolConfig(connectionString));
    // An idle client erroring (e.g. the DB closed the connection) must not
    // crash the whole function.
    pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  }
  return pool;
}

let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        // Advisory lock inside a transaction so concurrent cold starts don't
        // race each other on CREATE TABLE IF NOT EXISTS.
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(727274)');
        await client.query(schema);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    })().catch((err) => {
      schemaReady = null; // allow a retry on the next call if it failed
      throw err;
    });
  }
  return schemaReady;
}

async function query(text, params) {
  await ensureSchema();
  return getPool().query(text, params);
}

// For multi-statement transactions (checkout, inventory adjustments) where
// several writes must succeed or fail together. Caller is responsible for
// BEGIN/COMMIT/ROLLBACK and must always release the client.
async function getClient() {
  await ensureSchema();
  return getPool().connect();
}

async function end() {
  if (pool) await pool.end();
}

module.exports = {
  query,
  getClient,
  ensureSchema,
  end,
  getConnectionString,
  DatabaseNotConfiguredError,
};
