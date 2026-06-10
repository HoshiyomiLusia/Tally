import type { WalletType } from "./api";

export interface WalletPreset {
  name: string;
  type: WalletType;
  currency_code: string;
  color: string;
  region: "JP" | "CN" | "GLOBAL";
  tag: string;
}

export const WALLET_PRESETS: WalletPreset[] = [
  // Japan banks
  { name: "三井住友銀行", type: "bank", currency_code: "JPY", color: "#0f7d3a", region: "JP", tag: "SMBC" },
  { name: "三菱UFJ銀行", type: "bank", currency_code: "JPY", color: "#a8051c", region: "JP", tag: "MUFG" },
  { name: "みずほ銀行", type: "bank", currency_code: "JPY", color: "#1f4a8b", region: "JP", tag: "Mizuho" },
  { name: "りそな銀行", type: "bank", currency_code: "JPY", color: "#0079c1", region: "JP", tag: "Resona" },
  { name: "ゆうちょ銀行", type: "bank", currency_code: "JPY", color: "#d23a3a", region: "JP", tag: "JP Post" },
  { name: "セブン銀行", type: "bank", currency_code: "JPY", color: "#ec7c2f", region: "JP", tag: "7Bank" },
  { name: "SBI新生銀行", type: "bank", currency_code: "JPY", color: "#0f2c5a", region: "JP", tag: "SBI" },
  { name: "住信SBIネット銀行", type: "bank", currency_code: "JPY", color: "#102e6d", region: "JP", tag: "SBI Net" },
  // Japan e-money / pay
  { name: "Suica", type: "e_wallet", currency_code: "JPY", color: "#1c8456", region: "JP", tag: "IC" },
  { name: "PASMO", type: "e_wallet", currency_code: "JPY", color: "#df4081", region: "JP", tag: "IC" },
  { name: "ICOCA", type: "e_wallet", currency_code: "JPY", color: "#2b6fbf", region: "JP", tag: "IC" },
  { name: "PayPay", type: "e_wallet", currency_code: "JPY", color: "#ff0035", region: "JP", tag: "QR" },
  { name: "LINE Pay", type: "e_wallet", currency_code: "JPY", color: "#06c755", region: "JP", tag: "QR" },
  { name: "楽天Pay", type: "e_wallet", currency_code: "JPY", color: "#bf0000", region: "JP", tag: "QR" },
  // Japan credit cards
  { name: "楽天カード", type: "credit_card", currency_code: "JPY", color: "#bf0000", region: "JP", tag: "Credit" },
  { name: "PayPayカード", type: "credit_card", currency_code: "JPY", color: "#ff0035", region: "JP", tag: "PayPay" },
  { name: "メルカード", type: "credit_card", currency_code: "JPY", color: "#ff0211", region: "JP", tag: "mercari" },
  { name: "三井住友カード(NL)", type: "credit_card", currency_code: "JPY", color: "#0f7d3a", region: "JP", tag: "SMBC" },
  { name: "JCBカード", type: "credit_card", currency_code: "JPY", color: "#0e3a8a", region: "JP", tag: "JCB" },
  { name: "エポスカード", type: "credit_card", currency_code: "JPY", color: "#e2001a", region: "JP", tag: "Epos" },
  { name: "dカード", type: "credit_card", currency_code: "JPY", color: "#cc0033", region: "JP", tag: "docomo" },
  { name: "au PAY カード", type: "credit_card", currency_code: "JPY", color: "#eb5505", region: "JP", tag: "au" },
  { name: "イオンカード", type: "credit_card", currency_code: "JPY", color: "#a0258c", region: "JP", tag: "AEON" },
  { name: "ビューカード", type: "credit_card", currency_code: "JPY", color: "#0a8a3c", region: "JP", tag: "JRE" },
  { name: "セゾンカード", type: "credit_card", currency_code: "JPY", color: "#003da5", region: "JP", tag: "SAISON" },
  { name: "三菱UFJカード", type: "credit_card", currency_code: "JPY", color: "#a8051c", region: "JP", tag: "MUFG" },
  { name: "JALカード", type: "credit_card", currency_code: "JPY", color: "#c8102e", region: "JP", tag: "JAL" },
  { name: "ANAカード", type: "credit_card", currency_code: "JPY", color: "#13256b", region: "JP", tag: "ANA" },
  { name: "AMEX Japan", type: "credit_card", currency_code: "JPY", color: "#006fcf", region: "JP", tag: "AMEX" },
  { name: "现金 (JPY)", type: "cash", currency_code: "JPY", color: "#5f6068", region: "JP", tag: "Cash" },

  // China banks
  { name: "招商银行", type: "bank", currency_code: "CNY", color: "#c8102e", region: "CN", tag: "CMB" },
  { name: "工商银行", type: "bank", currency_code: "CNY", color: "#aa0d29", region: "CN", tag: "ICBC" },
  { name: "农业银行", type: "bank", currency_code: "CNY", color: "#0d8a4f", region: "CN", tag: "ABC" },
  { name: "建设银行", type: "bank", currency_code: "CNY", color: "#0b59a8", region: "CN", tag: "CCB" },
  { name: "中国银行", type: "bank", currency_code: "CNY", color: "#a8051c", region: "CN", tag: "BOC" },
  { name: "邮政储蓄银行", type: "bank", currency_code: "CNY", color: "#106e3b", region: "CN", tag: "PSBC" },
  { name: "交通银行", type: "bank", currency_code: "CNY", color: "#1a3a8a", region: "CN", tag: "BOCOM" },
  { name: "招商信用卡", type: "credit_card", currency_code: "CNY", color: "#9b1c2f", region: "CN", tag: "CMB" },
  { name: "中信信用卡", type: "credit_card", currency_code: "CNY", color: "#c8102e", region: "CN", tag: "CITIC" },
  { name: "交通信用卡", type: "credit_card", currency_code: "CNY", color: "#1a3a8a", region: "CN", tag: "BOCOM" },
  { name: "工商信用卡", type: "credit_card", currency_code: "CNY", color: "#aa0d29", region: "CN", tag: "ICBC" },
  { name: "广发信用卡", type: "credit_card", currency_code: "CNY", color: "#c4161c", region: "CN", tag: "CGB" },
  { name: "浦发信用卡", type: "credit_card", currency_code: "CNY", color: "#003da5", region: "CN", tag: "SPDB" },
  // China e-wallets
  { name: "微信钱包", type: "e_wallet", currency_code: "CNY", color: "#07c160", region: "CN", tag: "QR" },
  { name: "支付宝", type: "e_wallet", currency_code: "CNY", color: "#1677ff", region: "CN", tag: "QR" },
  { name: "云闪付", type: "e_wallet", currency_code: "CNY", color: "#d70022", region: "CN", tag: "QR" },

  { name: "现金 (CNY)", type: "cash", currency_code: "CNY", color: "#5f6068", region: "CN", tag: "Cash" },

  // Global
  { name: "American Express", type: "credit_card", currency_code: "USD", color: "#006fcf", region: "GLOBAL", tag: "AMEX" },
  { name: "PayPal", type: "e_wallet", currency_code: "USD", color: "#003087", region: "GLOBAL", tag: "Online" },
  { name: "Wise", type: "e_wallet", currency_code: "USD", color: "#9fe870", region: "GLOBAL", tag: "Multi" },
  { name: "Apple Cash", type: "e_wallet", currency_code: "USD", color: "#1d1d1f", region: "GLOBAL", tag: "Apple" },
  { name: "现金 (USD)", type: "cash", currency_code: "USD", color: "#5f6068", region: "GLOBAL", tag: "Cash" },
  { name: "现金 (EUR)", type: "cash", currency_code: "EUR", color: "#5f6068", region: "GLOBAL", tag: "Cash" },
];

export const REGION_LABELS: Record<WalletPreset["region"], string> = {
  JP: "🇯🇵 日本",
  CN: "🇨🇳 中国",
  GLOBAL: "🌐 全球",
};
