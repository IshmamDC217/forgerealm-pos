export interface Session {
  id: string;
  name: string;
  location: string | null;
  date: string;
  notes: string | null;
  status: 'active' | 'closed';
  card_fee_applied: boolean;
  card_fee_rate: number;
  // Set when this stall is part of a multi-location event day. group_name and
  // group_date are joined in by the API for display.
  group_id: string | null;
  group_name?: string | null;
  group_date?: string | null;
  // Set once a stall's leftover stock has been returned to the central store,
  // so the "return to inventory" action can't double-credit.
  stock_returned_at: string | null;
  created_at: string;
  updated_at: string;
  total_revenue?: number;
  total_units?: number;
  stats?: SessionStats;
}

export interface SessionGroup {
  id: string;
  name: string;
  date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionStats {
  total_revenue: number;
  total_units: number;
  total_sales: number;
  best_seller: string | null;
}

export interface Product {
  id: string;
  name: string;
  default_price: number;
  image_url: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: string;
  session_id: string;
  product_id: string;
  quantity: number;
  price_charged: number;
  payment_method: 'cash' | 'card';
  timestamp: string;
  created_at: string;
  // Shared by all sales recorded in the same cart checkout. NULL for legacy
  // single-item sales.
  transaction_id: string | null;
  product_name?: string;
  product_category?: string;
}

export interface StockItem {
  id: string;
  session_id: string;
  product_id: string;
  initial_quantity: number;
  final_quantity: number | null;
  product_name: string;
  product_category: string | null;
  default_price: number;
  total_sold: number;
}

export interface StockSummaryItem {
  product_id: string;
  product_name: string;
  product_category: string | null;
  default_price: number;
  initial_quantity: number;
  final_quantity: number | null;
  total_sold: number;
  total_revenue: number;
  sold_by_count: number | null;
  sold_by_pos: number;
  sold: number;
  remaining: number;
}

export interface StockCarryover {
  previous_session: { id: string; name: string; date: string } | null;
  items: {
    product_id: string;
    product_name: string;
    product_category: string | null;
    initial_quantity: number;
    final_quantity: number | null;
    total_sold: number;
    remaining: number;
  }[];
}

// A product row on the central Inventory screen. `quantity` is what's in the
// store; `deployed` is how many units are currently out on active stalls.
export interface GlobalStockItem {
  product_id: string;
  product_name: string;
  product_category: string | null;
  default_price: number;
  quantity: number;
  deployed: number;
}

// Result of moving stock from the store onto a stall.
export interface StockTransferResult {
  moved: { product_id: string; quantity: number }[];
  session_stock: StockItem[];
  global: GlobalStockItem[];
}

// Result of returning a stall's leftovers to the store.
export interface StockReturnResult {
  returned: { product_id: string; quantity: number }[];
  global: GlobalStockItem[];
}

export interface PendingTransaction {
  id: string;
  sumup_transaction_id: string;
  session_id: string | null;
  amount: number | string;
  currency: string;
  sumup_timestamp: string;
  card_type: string | null;
  status: 'pending' | 'allocated' | 'dismissed';
  created_at: string;
}

export interface StockSummary {
  items: StockSummaryItem[];
  totals: {
    initial: number;
    sold: number;
    remaining: number;
    revenue: number;
    has_final_counts: boolean;
  };
}
