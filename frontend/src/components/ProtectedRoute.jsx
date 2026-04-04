import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, roles }) {
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4">
        <div className="w-full max-w-md rounded-[24px] border border-x-border bg-[#111214] p-8 text-center">
          <p className="text-[13px] font-medium text-x-secondary">Session</p>
          <h1 className="mt-3 text-[28px] font-extrabold text-x-primary">Restoring your account</h1>
          <p className="mt-2 text-[15px] leading-6 text-x-secondary">Checking your account before opening this page.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }

  if (roles?.length && !roles.includes(String(user.role || "").toLowerCase())) {
    return <Navigate replace to="/" />;
  }

  return children;
}
