import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);
let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "info") => {
    const id = ++nextId;
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div aria-atomic="false" aria-live="polite" aria-relevant="additions" className="toast-stack" role="status">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              key={toast.id}
              transition={{ duration: 0.18 }}
            >
              <div className="toast-pill">
                {toast.type === "success" ? <CheckCircle aria-hidden="true" size={16} style={{ color: "var(--md-sys-color-success)" }} /> : <Info aria-hidden="true" size={16} style={{ color: "var(--md-sys-color-primary)" }} />}
                <span style={{ fontSize: 14 }}>{toast.message}</span>
                <button aria-label="Dismiss" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={() => dismiss(toast.id)} style={{ width: 28, height: 28 }} type="button">
                  <X aria-hidden="true" size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}
