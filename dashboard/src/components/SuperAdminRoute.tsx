import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** Guards /admin — a normal tenant user has no business here, even if logged in. */
export default function SuperAdminRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "super_admin") return <Navigate to="/devices" replace />;
  return <Outlet />;
}
