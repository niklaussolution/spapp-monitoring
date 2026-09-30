import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DevicesListPage from "./pages/DevicesListPage";
import DeviceDetailPage from "./pages/DeviceDetailPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/devices" element={<DevicesListPage />} />
              <Route path="/devices/:id" element={<DeviceDetailPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
