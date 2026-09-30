import { apiClient } from "./client";
import type { User } from "./types";

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<{ token: string; user: User }>("/api/auth/login", { email, password }).then((r) => r.data),

  register: (data: {
    tenantName: string;
    tenantType: "family" | "company";
    email: string;
    password: string;
    fullName?: string;
  }) =>
    apiClient
      .post<{ token: string; tenant: unknown; user: { id: string; email: string; full_name: string; role: string } }>(
        "/api/auth/register",
        data
      )
      .then((r) => r.data),
};
