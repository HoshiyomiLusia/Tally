import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Categories from "./pages/Categories";
import Contacts from "./pages/Contacts";
import Home from "./pages/Home";
import Investments from "./pages/Investments";
import Loans from "./pages/Loans";
import Login from "./pages/Login";
import Merchants from "./pages/Merchants";
import Register from "./pages/Register";
import Settings from "./pages/Settings";
import Transactions from "./pages/Transactions";
import Wallets from "./pages/Wallets";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/wallets" element={<Wallets />} />
        <Route path="/loans" element={<Loans />} />
        <Route path="/investments" element={<Investments />} />
        <Route path="/contacts" element={<Contacts />} />
        {/* 旧路由重定向: 统计/周期/预算 都并进首页 */}
        <Route path="/stats" element={<Navigate to="/" replace />} />
        <Route path="/recurring" element={<Navigate to="/" replace />} />
        <Route path="/budgets" element={<Navigate to="/" replace />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/merchants" element={<Merchants />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
