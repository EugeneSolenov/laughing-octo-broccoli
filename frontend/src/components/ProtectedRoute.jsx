import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, roles }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  const from = `${location.pathname}${location.search}${location.hash}`;

  if (loading) {
    return (
      <div className="auth-shell">
        <div className="m3-panel" style={{ width: "min(420px, 100%)", padding: 28, textAlign: "center" }}>
          <p className="m3-section-label">Сессия</p>
          <h1 className="m3-title-medium" style={{ marginTop: 8, fontSize: 28 }}>
            Восстанавливаем аккаунт
          </h1>
          <p className="m3-body-small" style={{ marginTop: 10 }}>
            Проверяем ваш аккаунт перед открытием страницы.
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate replace state={{ from }} to="/login" />;
  }

  if (roles?.length && !roles.includes(String(user.role || "").toLowerCase())) {
    return <Navigate replace to="/" />;
  }

  return children;
}
