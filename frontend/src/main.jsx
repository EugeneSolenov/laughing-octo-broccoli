import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.jsx";
import { initObservability } from "./observability.js";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import "./index.css";

initObservability();

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

async function unregisterServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
}

async function clearAppCaches() {
  if (!("caches" in window)) {
    return;
  }

  const cacheKeys = await caches.keys();
  await Promise.all(
    cacheKeys
      .filter((cacheKey) => cacheKey.startsWith("voice-atlas-"))
      .map((cacheKey) => caches.delete(cacheKey)),
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const shouldUseServiceWorker =
      import.meta.env.PROD && !LOOPBACK_HOSTS.has(window.location.hostname);

    if (shouldUseServiceWorker) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Service worker registration is optional.
      });
      return;
    }

    Promise.all([unregisterServiceWorkers(), clearAppCaches()])
      .catch(() => {
        // Ignore local service worker cleanup failures.
      });
  });
}
