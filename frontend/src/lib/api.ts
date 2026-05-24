import axios, { AxiosError } from "axios";

export const TOKEN_KEY = "tally.token";

export const api = axios.create({
  baseURL: "/api",
});

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (e: AxiosError) => {
    if (e.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      if (location.pathname !== "/login" && location.pathname !== "/register") {
        location.href = "/login";
      }
    }
    return Promise.reject(e);
  }
);

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_digits: number;
}

export type WalletType = "cash" | "bank" | "credit_card" | "e_wallet" | "virtual";

export interface Wallet {
  id: number;
  name: string;
  type: WalletType;
  currency_code: string;
  initial_balance: number;
  icon: string;
  color: string;
  archived: boolean;
  sort_order: number;
  created_at: string;
  balance: number;
}

export type CategoryKind = "expense" | "income";

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  kind: CategoryKind;
  emoji: string;
  color: string;
  sort_order: number;
}

export interface Merchant {
  id: number;
  name: string;
  default_category_id: number | null;
  region: string;
  usage_count: number;
}

export type TransactionKind = "expense" | "income" | "transfer";

export interface Transaction {
  id: number;
  wallet_id: number;
  category_id: number | null;
  merchant_id: number | null;
  amount: number;
  currency_code: string;
  kind: TransactionKind;
  occurred_on: string;
  note: string;
  created_at: string;
}

export interface DashboardData {
  month: string;
  wallet_balances: {
    wallet_id: number;
    wallet_name: string;
    currency_code: string;
    balance: number;
    type: WalletType;
    archived: boolean;
  }[];
  month_totals: {
    currency_code: string;
    income: number;
    expense: number;
    net: number;
  }[];
  category_breakdown: {
    category_id: number | null;
    category_name: string;
    emoji: string;
    amount: number;
    currency_code: string;
  }[];
  recent_transactions: Transaction[];
}
