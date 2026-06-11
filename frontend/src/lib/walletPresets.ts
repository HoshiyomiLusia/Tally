import type { WalletType } from "./api";

export interface WalletPreset {
  name: string;
  type: WalletType;
  currency_code: string;
  color: string;
}

export const WALLET_PRESETS: WalletPreset[] = [
  // Japan banks
  { name: "三井住友銀行", type: "bank", currency_code: "JPY", color: "#0f7d3a" },
  { name: "三菱UFJ銀行", type: "bank", currency_code: "JPY", color: "#a8051c" },
  { name: "みずほ銀行", type: "bank", currency_code: "JPY", color: "#1f4a8b" },
  { name: "りそな銀行", type: "bank", currency_code: "JPY", color: "#0079c1" },
  { name: "ゆうちょ銀行", type: "bank", currency_code: "JPY", color: "#d23a3a" },
  { name: "セブン銀行", type: "bank", currency_code: "JPY", color: "#ec7c2f" },
  { name: "SBI新生銀行", type: "bank", currency_code: "JPY", color: "#0f2c5a" },
  { name: "住信SBIネット銀行", type: "bank", currency_code: "JPY", color: "#102e6d" },
  // Japan e-money / pay
  { name: "Suica", type: "e_wallet", currency_code: "JPY", color: "#1c8456" },
  { name: "PASMO", type: "e_wallet", currency_code: "JPY", color: "#df4081" },
  { name: "ICOCA", type: "e_wallet", currency_code: "JPY", color: "#2b6fbf" },
  { name: "PayPay", type: "e_wallet", currency_code: "JPY", color: "#ff0035" },
  { name: "LINE Pay", type: "e_wallet", currency_code: "JPY", color: "#06c755" },
  { name: "楽天Pay", type: "e_wallet", currency_code: "JPY", color: "#bf0000" },
  // Japan credit cards
  { name: "楽天カード", type: "credit_card", currency_code: "JPY", color: "#bf0000" },
  { name: "PayPayカード", type: "credit_card", currency_code: "JPY", color: "#ff0035" },
  { name: "メルカード", type: "credit_card", currency_code: "JPY", color: "#ff0211" },
  { name: "三井住友カード(NL)", type: "credit_card", currency_code: "JPY", color: "#0f7d3a" },
  { name: "JCBカード", type: "credit_card", currency_code: "JPY", color: "#0e3a8a" },
  { name: "エポスカード", type: "credit_card", currency_code: "JPY", color: "#e2001a" },
  { name: "dカード", type: "credit_card", currency_code: "JPY", color: "#cc0033" },
  { name: "au PAY カード", type: "credit_card", currency_code: "JPY", color: "#eb5505" },
  { name: "イオンカード", type: "credit_card", currency_code: "JPY", color: "#a0258c" },
  { name: "ビューカード", type: "credit_card", currency_code: "JPY", color: "#0a8a3c" },
  { name: "セゾンカード", type: "credit_card", currency_code: "JPY", color: "#003da5" },
  { name: "三菱UFJカード", type: "credit_card", currency_code: "JPY", color: "#a8051c" },
  { name: "JALカード", type: "credit_card", currency_code: "JPY", color: "#c8102e" },
  { name: "ANAカード", type: "credit_card", currency_code: "JPY", color: "#13256b" },
  { name: "AMEX Japan", type: "credit_card", currency_code: "JPY", color: "#006fcf" },
  { name: "现金 (JPY)", type: "cash", currency_code: "JPY", color: "#5f6068" },

  // China banks
  { name: "招商银行", type: "bank", currency_code: "CNY", color: "#c8102e" },
  { name: "工商银行", type: "bank", currency_code: "CNY", color: "#aa0d29" },
  { name: "农业银行", type: "bank", currency_code: "CNY", color: "#0d8a4f" },
  { name: "建设银行", type: "bank", currency_code: "CNY", color: "#0b59a8" },
  { name: "中国银行", type: "bank", currency_code: "CNY", color: "#a8051c" },
  { name: "邮政储蓄银行", type: "bank", currency_code: "CNY", color: "#106e3b" },
  { name: "交通银行", type: "bank", currency_code: "CNY", color: "#1a3a8a" },
  { name: "招商信用卡", type: "credit_card", currency_code: "CNY", color: "#9b1c2f" },
  { name: "中信信用卡", type: "credit_card", currency_code: "CNY", color: "#c8102e" },
  { name: "交通信用卡", type: "credit_card", currency_code: "CNY", color: "#1a3a8a" },
  { name: "工商信用卡", type: "credit_card", currency_code: "CNY", color: "#aa0d29" },
  { name: "广发信用卡", type: "credit_card", currency_code: "CNY", color: "#c4161c" },
  { name: "浦发信用卡", type: "credit_card", currency_code: "CNY", color: "#003da5" },
  // China e-wallets
  { name: "微信钱包", type: "e_wallet", currency_code: "CNY", color: "#07c160" },
  { name: "支付宝", type: "e_wallet", currency_code: "CNY", color: "#1677ff" },
  { name: "云闪付", type: "e_wallet", currency_code: "CNY", color: "#d70022" },

  { name: "现金 (CNY)", type: "cash", currency_code: "CNY", color: "#5f6068" },

  // Global
  { name: "American Express", type: "credit_card", currency_code: "USD", color: "#006fcf" },
  { name: "PayPal", type: "e_wallet", currency_code: "USD", color: "#003087" },
  { name: "Wise", type: "e_wallet", currency_code: "USD", color: "#9fe870" },
  { name: "Apple Cash", type: "e_wallet", currency_code: "USD", color: "#1d1d1f" },
  { name: "现金 (USD)", type: "cash", currency_code: "USD", color: "#5f6068" },
  { name: "现金 (EUR)", type: "cash", currency_code: "EUR", color: "#5f6068" },
];
