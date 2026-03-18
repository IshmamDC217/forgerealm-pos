import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from './index';

const USERNAME = process.argv[2] || process.env.POS_ADMIN_USER || 'admin';
const PASSWORD = process.argv[3] || process.env.POS_ADMIN_PASS || 'forgerealm';

async function createUser(): Promise<void> {
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(PASSWORD, 12);

    // Upsert: update password if user exists, otherwise insert
    await client.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = $2`,
      [USERNAME, hash]
    );

    console.log(`User "${USERNAME}" created/updated successfully.`);
    console.log(`Username: ${USERNAME}`);
    console.log(`Password: ${PASSWORD}`);
  } catch (err) {
    console.error('Failed to create user:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

createUser();
