import type { AuthResponse, LoginRequest, RegisterRequest, User } from "@jobilee/shared-types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiFetch } from "../api/client.ts";
import { clearTokens, getRefreshToken, setAccessToken, setRefreshToken } from "../api/tokens.ts";

interface AuthState {
  user: User | null;
  /** True until the initial "am I still logged in?" check settles. */
  loading: boolean;
  login(body: LoginRequest): Promise<void>;
  register(body: RegisterRequest): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On boot the access token is gone (it only ever lived in memory), so trade
  // the stored refresh token for a new one and recover the session.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!getRefreshToken()) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const { user: me } = await apiFetch<{ user: User }>("/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        clearTokens();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
    setUser(session.user);
  }, []);

  const login = useCallback(
    async (body: LoginRequest) => {
      adopt(await apiFetch<AuthResponse>("/auth/login", { method: "POST", body }));
    },
    [adopt],
  );

  const register = useCallback(
    async (body: RegisterRequest) => {
      adopt(await apiFetch<AuthResponse>("/auth/register", { method: "POST", body }));
    },
    [adopt],
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
