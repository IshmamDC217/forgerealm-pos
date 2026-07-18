import { PoolClient } from 'pg';

// Apply a delta to a product's central-store quantity, within an existing
// transaction. Stock is global and shared across every stall, so this is the
// single place selling moves it: negative delta when a sale is recorded,
// positive when one is undone. Only products we actually track (a global_stock
// row exists) are touched — untracked products have no stock cap. Floors at 0
// so concurrent sales of the last unit can't drive stock negative.
export async function adjustGlobalStock(
  client: PoolClient,
  productId: string,
  delta: number
): Promise<void> {
  if (!delta) return;
  await client.query(
    `UPDATE global_stock
       SET quantity = GREATEST(quantity + $2, 0), updated_at = NOW()
     WHERE product_id = $1`,
    [productId, delta]
  );
}
