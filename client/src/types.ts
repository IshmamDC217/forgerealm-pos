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
