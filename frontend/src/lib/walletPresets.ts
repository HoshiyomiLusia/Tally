import type { WalletType } from "./api";

export interface WalletPreset {
  name: string;
  type: WalletType;
  currency_code: string;
  color: string;
  tag: string;  // 卡片右上角小标识: 银行/品牌简写
}

export const WALLET_PRESETS: WalletPreset[] = [
  // Japan banks
  { name: "三井住友銀行", type: "bank", currency_code: "JPY", color: "#0f7d3a", tag: "SMBC" },
  { name: "三菱UFJ銀行", type: "bank", currency_code: "JPY", color: "#a8051c", tag: "MUFG" },
  { name: "みずほ銀行", type: "bank", currency_code: "JPY", color: "#1f4a8b", tag: "Mizuho" },
  { name: "りそな銀行", type: "bank", currency_code: "JPY", color: "#0079c1", tag: "Resona" },
  { name: "ゆうちょ銀行", type: "bank", currency_code: "JPY", color: "#d23a3a", tag: "JP Post" },
  { name: "セブン銀行", type: "bank", currency_code: "JPY", color: "#ec7c2f", tag: "7Bank" },
  { name: "SBI新生銀行", type: "bank", currency_code: "JPY", color: "#0f2c5a", tag: "SBI" },
  { name: "住信SBIネット銀行", type: "bank", currency_code: "JPY", color: "#102e6d", tag: "SBI Net" },
  // Japan e-money / pay
  { name: "Suica", type: "e_wallet", currency_code: "JPY", color: "#1c8456", tag: "IC" },
  { name: "PASMO", type: "e_wallet", currency_code: "JPY", color: "#df4081", tag: "IC" },
  { name: "ICOCA", type: "e_wallet", currency_code: "JPY", color: "#2b6fbf", tag: "IC" },
  { name: "PayPay", type: "e_wallet", currency_code: "JPY", color: "#ff0035", tag: "QR" },
  { name: "LINE Pay", type: "e_wallet", currency_code: "JPY", color: "#06c755", tag: "QR" },
  { name: "楽天Pay", type: "e_wallet", currency_code: "JPY", color: "#bf0000", tag: "QR" },
  // Japan credit cards
  { name: "楽天カード", type: "credit_card", currency_code: "JPY", color: "#bf0000", tag: "Rakuten" },
  { name: "PayPayカード", type: "credit_card", currency_code: "JPY", color: "#ff0035", tag: "PayPay" },
  { name: "メルカード", type: "credit_card", currency_code: "JPY", color: "#ff0211", tag: "mercari" },
  { name: "三井住友カード(NL)", type: "credit_card", currency_code: "JPY", color: "#0f7d3a", tag: "SMBC" },
  { name: "JCBカード", type: "credit_card", currency_code: "JPY", color: "#0e3a8a", tag: "JCB" },
  { name: "エポスカード", type: "credit_card", currency_code: "JPY", color: "#e2001a", tag: "Epos" },
  { name: "dカード", type: "credit_card", currency_code: "JPY", color: "#cc0033", tag: "docomo" },
  { name: "au PAY カード", type: "credit_card", currency_code: "JPY", color: "#eb5505", tag: "au" },
  { name: "イオンカード", type: "credit_card", currency_code: "JPY", color: "#a0258c", tag: "AEON" },
  { name: "ビューカード", type: "credit_card", currency_code: "JPY", color: "#0a8a3c", tag: "JRE" },
  { name: "セゾンカード", type: "credit_card", currency_code: "JPY", color: "#003da5", tag: "SAISON" },
  { name: "三菱UFJカード", type: "credit_card", currency_code: "JPY", color: "#a8051c", tag: "MUFG" },
  { name: "JALカード", type: "credit_card", currency_code: "JPY", color: "#c8102e", tag: "JAL" },
  { name: "ANAカード", type: "credit_card", currency_code: "JPY", color: "#13256b", tag: "ANA" },
  { name: "AMEX Japan", type: "credit_card", currency_code: "JPY", color: "#006fcf", tag: "AMEX" },
  { name: "现金 (JPY)", type: "cash", currency_code: "JPY", color: "#5f6068", tag: "Cash" },

  // China banks
  { name: "招商银行", type: "bank", currency_code: "CNY", color: "#c8102e", tag: "CMB" },
  { name: "工商银行", type: "bank", currency_code: "CNY", color: "#aa0d29", tag: "ICBC" },
  { name: "农业银行", type: "bank", currency_code: "CNY", color: "#0d8a4f", tag: "ABC" },
  { name: "建设银行", type: "bank", currency_code: "CNY", color: "#0b59a8", tag: "CCB" },
  { name: "中国银行", type: "bank", currency_code: "CNY", color: "#a8051c", tag: "BOC" },
  { name: "邮政储蓄银行", type: "bank", currency_code: "CNY", color: "#106e3b", tag: "PSBC" },
  { name: "交通银行", type: "bank", currency_code: "CNY", color: "#1a3a8a", tag: "BOCOM" },
  { name: "招商信用卡", type: "credit_card", currency_code: "CNY", color: "#9b1c2f", tag: "CMB" },
  { name: "中信信用卡", type: "credit_card", currency_code: "CNY", color: "#c8102e", tag: "CITIC" },
  { name: "交通信用卡", type: "credit_card", currency_code: "CNY", color: "#1a3a8a", tag: "BOCOM" },
  { name: "工商信用卡", type: "credit_card", currency_code: "CNY", color: "#aa0d29", tag: "ICBC" },
  { name: "广发信用卡", type: "credit_card", currency_code: "CNY", color: "#c4161c", tag: "CGB" },
  { name: "浦发信用卡", type: "credit_card", currency_code: "CNY", color: "#003da5", tag: "SPDB" },
  // China e-wallets
  { name: "微信钱包", type: "e_wallet", currency_code: "CNY", color: "#07c160", tag: "QR" },
  { name: "支付宝", type: "e_wallet", currency_code: "CNY", color: "#1677ff", tag: "QR" },
  { name: "云闪付", type: "e_wallet", currency_code: "CNY", color: "#d70022", tag: "QR" },

  { name: "现金 (CNY)", type: "cash", currency_code: "CNY", color: "#5f6068", tag: "Cash" },

  // Global
  { name: "American Express", type: "credit_card", currency_code: "USD", color: "#006fcf", tag: "AMEX" },
  { name: "PayPal", type: "e_wallet", currency_code: "USD", color: "#003087", tag: "Online" },
  { name: "Wise", type: "e_wallet", currency_code: "USD", color: "#9fe870", tag: "Multi" },
  { name: "Apple Cash", type: "e_wallet", currency_code: "USD", color: "#1d1d1f", tag: "Apple" },
  { name: "现金 (USD)", type: "cash", currency_code: "USD", color: "#5f6068", tag: "Cash" },
  { name: "现金 (EUR)", type: "cash", currency_code: "EUR", color: "#5f6068", tag: "Cash" },
];
