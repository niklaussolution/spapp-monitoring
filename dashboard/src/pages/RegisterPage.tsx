import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authApi } from "../api/auth";
import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function RegisterPage() {
  const [tenantName, setTenantName] = useState("");
  const [tenantType, setTenantType] = useState<"family" | "company">("family");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = await authApi.register({ tenantName, tenantType, email, password, fullName });
      // /api/auth/register's response shape differs slightly from /login's —
      // reuse the token to fetch the canonical /login-shaped user via /tenants/me.
      localStorage.setItem("spapp_token", token);
      const me = await apiClient.get("/api/tenants/me");
      login(token, {
        id: "",
        email,
        fullName,
        role: "owner",
        tenantId: me.data.id,
        tenantName: me.data.name,
      });
      navigate("/devices");
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Registration failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-primary-dark mb-1">Create Account</h1>
        <p className="text-sm text-gray-500 mb-6">Spapp Monitor Admin Dashboard</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account name</label>
            <input
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              placeholder="e.g. Smith Family, Acme Inc."
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account type</label>
            <select
              value={tenantType}
              onChange={(e) => setTenantType(e.target.value as "family" | "company")}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="family">Family</option>
              <option value="company">Company</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white rounded py-2 font-medium hover:bg-primary-dark transition disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Account"}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-6 text-center">
          Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
