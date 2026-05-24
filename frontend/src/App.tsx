import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Budgets from "./pages/Budgets";
import Categories from "./pages/Categories";
import Contacts from "./pages/Contacts";
import Dashboard from "./pages/Dashboard";
import Loans from "./pages/Loans";
import Login from "./pages/Login";
import Merchants from "./pages/Merchants";
import Recurring from "./pages/Recurring";
import Register from "./pages/Register";
import Settings from "./pages/Settings";
import Stats from "./pages/Stats";
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
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/wallets" element={<Wallets />} />
        <Route path="/loans" element={<Loans />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/recurring" element={<Recurring />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/merchants" element={<Merchants />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
