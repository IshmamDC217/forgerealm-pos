require('dotenv').config({ path: __dirname + '/../.env' });
const { pool } = require('./index');

const products = [
  // Articulated
  { name: 'Big Dragon', default_price: 10.00, category: 'Articulated' },
  { name: 'Water Dragon', default_price: 10.00, category: 'Articulated' },
  { name: 'Dragon No Legs', default_price: 7.00, category: 'Articulated' },
  { name: 'Small Dragon', default_price: 8.00, category: 'Articulated' },
  { name: 'Crocodile', default_price: 4.00, category: 'Articulated' },
  { name: 'Cat', default_price: 2.00, category: 'Articulated' },
  { name: 'Bunny', default_price: 3.00, category: 'Articulated' },
  { name: 'Small Bunny', default_price: 2.00, category: 'Articulated' },
  { name: 'Bunny Spring', default_price: 2.00, category: 'Articulated' },

  // Keychains
  { name: 'Big Keychain Dragon', default_price: 4.00, category: 'Keychains' },
  { name: 'Small Keychain Dragon', default_price: 2.00, category: 'Keychains' },
  { name: 'XL Dragon Keychain', default_price: 5.00, category: 'Keychains' },
  { name: 'Bunny Keychain', default_price: 2.00, category: 'Keychains' },
  { name: 'Extra Keychain', default_price: 2.00, category: 'Keychains' },
  { name: 'Hexagon Keychain', default_price: 3.00, category: 'Keychains' },

  // Tealights
  { name: 'Tealight Elephant', default_price: 5.00, category: 'Tealights' },
  { name: 'Tealight Bunny', default_price: 5.00, category: 'Tealights' },
  { name: 'Owl', default_price: 2.00, category: 'Tealights' },
  { name: 'Small Cat', default_price: 3.00, category: 'Tealights' },
  { name: 'Small Elephant', default_price: 3.00, category: 'Tealights' },

  // Voronoi
  { name: 'Voronoi Cat', default_price: 4.00, category: 'Voronoi' },
  { name: 'Voronoi Deer', default_price: 4.00, category: 'Voronoi' },
  { name: 'Voronoi Giraffe', default_price: 4.00, category: 'Voronoi' },
  { name: 'Voronoi Elephant', default_price: 3.00, category: 'Voronoi' },

  // Fidget
  { name: 'Big Spinner', default_price: 4.00, category: 'Fidget' },
  { name: 'Spinner', default_price: 3.00, category: 'Fidget' },
  { name: '4 Leaf Fidget', default_price: 3.00, category: 'Fidget' },
  { name: 'Keytype Fidget', default_price: 3.00, category: 'Fidget' },
  { name: 'Hexagon Fidget', default_price: 6.00, category: 'Fidget' },

  // Other
  { name: 'Big Egg', default_price: 8.00, category: 'Other' },
  { name: 'Egg', default_price: 3.00, category: 'Other' },
  { name: 'Lamp', default_price: 20.00, category: 'Other' },
  { name: 'Knight', default_price: 5.00, category: 'Other' },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing products (and sales referencing them)
    await client.query('DELETE FROM sales');
    await client.query('DELETE FROM products');

    for (const product of products) {
      await client.query(
        `INSERT INTO products (name, default_price, category)
         VALUES ($1, $2, $3)`,
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
