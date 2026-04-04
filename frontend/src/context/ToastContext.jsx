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
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div
        aria-atomic="true"
        aria-live="polite"
        className="fixed bottom-24 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 tablet:bottom-6"
        role="status"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex items-center gap-3 rounded-full border border-x-border bg-[#1c1e21] px-4 py-3 text-[14px] font-medium text-x-primary shadow-lift"
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              key={toast.id}
              transition={{ duration: 0.2 }}
            >
              {toast.type === "success" ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-x-green" />
              ) : (
                <Info className="h-4 w-4 shrink-0 text-x-blue" />
              )}
              <span>{toast.message}</span>
              <button
                aria-label="Dismiss notification"
                className="ml-1 rounded-full p-0.5 text-x-secondary transition hover:text-x-primary"
                onClick={() => dismiss(toast.id)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
