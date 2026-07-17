import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// 币种是极少变动的种子表。把标准币种的小数位烘焙成 ["currencies"] 查询的 initialData,
// 保证 currencies.data 永不为 undefined —— 从根上消除"currencies 未加载/请求失败时
// decimal_digits ?? 2 对 JPY/KRW(0 位)造成金额 100 倍缩放"这条系统性根因(审计 #77/#85-88 类,
// 涉及新建交易/转账/投资买卖/新建钱包/借出/还款/坏账核销/信用卡还款/对账/报销等所有写路径)。
// initialDataUpdatedAt: 0 让它被视为过期, 挂载时仍立即向服务器拉最新全量币种。
const SEED_CURRENCIES = [
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimal_digits: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", decimal_digits: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", decimal_digits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimal_digits: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", decimal_digits: 2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", decimal_digits: 2 },
  { code: "KRW", name: "Korean Won", symbol: "₩", decimal_digits: 0 },
  { code: "TWD", name: "Taiwan Dollar", symbol: "NT$", decimal_digits: 2 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimal_digits: 2 },
];
qc.setQueryDefaults(["currencies"], { initialData: SEED_CURRENCIES, initialDataUpdatedAt: 0 });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
