import { Pool, QueryResult, QueryResultRow } from 'pg';

const dbUrl = process.env.DATABASE_URL || '';
const needsSsl = dbUrl.includes('neon.tech') || dbUrl.includes('render.com') || dbUrl.includes('sslmode=require');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  // Neon's free-tier compute auto-suspends after inactivity; cold-start can
  // take 5-15s. Give the connection plenty of headroom so the first query
  // after a suspension doesn't 500 the API.
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 30_000,
});

function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export { query, pool };
