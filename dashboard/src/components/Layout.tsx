import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary-dark text-white px-6 py-4 flex items-center justify-between">
        <Link to="/devices" className="text-lg font-bold">
          Spapp Monitor
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-300">{user?.tenantName}</span>
          <button onClick={handleLogout} className="text-gray-300 hover:text-white transition">
            Sign out
          </button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
