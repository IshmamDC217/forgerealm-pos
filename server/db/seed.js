require('dotenv').config({ path: __dirname + '/../.env' });
const { pool } = require('./index');

const products = [
  { name: 'Dragon Figurine', default_price: 25.0, category: 'Figurines' },
  { name: 'Articulated Rose', default_price: 15.0, category: 'Decorative' },
  { name: 'Custom Keychain', default_price: 8.0, category: 'Accessories' },
  { name: 'Desk Organizer', default_price: 20.0, category: 'Functional' },
  { name: 'Phone Stand', default_price: 12.0, category: 'Functional' },
  { name: 'Miniature Castle', default_price: 35.0, category: 'Figurines' },
  { name: 'Geometric Planter', default_price: 18.0, category: 'Decorative' },
  { name: 'LED Lamp Base', default_price: 30.0, category: 'Functional' },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const product of products) {
      await client.query(
        `INSERT INTO products (name, default_price, category)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [product.name, product.default_price, product.category]
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded ${products.length} products successfully.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
