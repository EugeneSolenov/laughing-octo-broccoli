import { createContext, startTransition, useContext, useEffect, useState } from "react";

import { ApiError, apiFetch } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const updateUser = (nextUser) => {
    startTransition(() => {
      setUser(nextUser);
    });
  };

  const refreshSession = async () => {
    try {
      const session = await apiFetch("/auth/session");
      updateUser(session.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        try {
          const refreshed = await apiFetch("/auth/refresh", { method: "POST" });
          updateUser(refreshed.user);
        } catch {
          updateUser(null);
        }
      } else {
        updateUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await apiFetch("/auth/csrf");
      } catch {
        // Ignore CSRF bootstrap failures here. Auth requests will surface actionable errors later.
      }
      await refreshSession();
    })();
  }, []);

  const login = async (payload) => {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    updateUser(data.user);
    return data;
  };

  const register = async (payload) => {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    updateUser(data.user);
    return data;
  };

  const logout = async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    updateUser(null);
  };

  const refreshProfile = async () => {
    const profile = await apiFetch("/profile");
    updateUser(profile.user);
    return profile;
  };

  const updateProfile = async (payload) => {
    const profile = await apiFetch("/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    updateUser(profile.user);
    return profile;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refreshProfile,
        refreshSession,
        register,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
