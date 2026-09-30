import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "../api/types";

interface AuthContextValue {
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("spapp_user");
    return stored ? JSON.parse(stored) : null;
  });

  function login(token: string, user: User) {
    localStorage.setItem("spapp_token", token);
    localStorage.setItem("spapp_user", JSON.stringify(user));
    setUser(user);
  }

  function logout() {
    localStorage.removeItem("spapp_token");
    localStorage.removeItem("spapp_user");
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
