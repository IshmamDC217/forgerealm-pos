export interface Session {
  id: string;
  name: string;
  location: string | null;
  date: string;
  notes: string | null;
  status: 'active' | 'closed';
  card_fee_applied: boolean;
  card_fee_rate: number;
  created_at: string;
  updated_at: string;
  total_revenue?: number;
  total_units?: number;
  stats?: SessionStats;
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
