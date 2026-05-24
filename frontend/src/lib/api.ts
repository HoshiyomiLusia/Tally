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
  aliases: string;
}

export interface Contact {
  id: number;
  name: string;
  color: string;
  note: string;
  archived: boolean;
  created_at: string;
}

export type TransactionKind = "expense" | "income" | "transfer_out" | "transfer_in" | "loan_out" | "loan_repayment";

export interface Transaction {
  id: number;
  wallet_id: number;
  category_id: number | null;
  merchant_id: number | null;
  contact_id: number | null;
  amount: number;
  currency_code: string;
  kind: TransactionKind;
  occurred_on: string;
  note: string;
  split_group_id: string | null;
  is_recurring: boolean;
  recurrence_period_days: number | null;
  recurrence_group_id: string | null;
  transfer_pair_id: number | null;
  created_at: string;
}

export interface LoanAccount {
  contact_id: number;
  contact_name: string;
  currency_code: string;
  balance: number;
  loan_out_total: number;
  loan_repayment_total: number;
}

export interface Budget {
  id: number;
  category_id: number | null;
  currency_code: string;
  period: "monthly" | "yearly";
  amount: number;
  active: boolean;
  note: string;
}

export interface BudgetProgress {
  budget_id: number;
  category_id: number | null;
  category_name: string;
  currency_code: string;
  period: "monthly" | "yearly";
  budget_amount: number;
  spent: number;
  remaining: number;
  percent: number;
}

export interface Attachment {
  id: number;
  transaction_id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface ReconciliationView {
  wallet_id: number;
  currency_code: string;
  system_balance: number;
  loan_out_on_wallet: number;
  loan_repayment_on_wallet: number;
  expected_physical: number;
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
