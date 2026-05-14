import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

export default function ConfirmDialog({
  busy = false,
  cancelLabel = "Отмена",
  confirmLabel = "Подтвердить",
  description,
  onCancel,
  onConfirm,
  open,
  title,
  tone = "danger",
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="m3-overlay confirm-dialog__overlay"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.section
            animate={{ opacity: 1, scale: 1, y: 0 }}
            aria-label={title}
            aria-modal="true"
            className={["m3-dialog", "confirm-dialog", `is-${tone}`].join(" ")}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="confirm-dialog__header">
              <div className="confirm-dialog__icon">
                <AlertTriangle size={18} />
              </div>
              <div className="confirm-dialog__copy">
                <h2 className="confirm-dialog__title">{title}</h2>
                {description ? <p className="confirm-dialog__description">{description}</p> : null}
              </div>
              <button aria-label="Закрыть" className="confirm-dialog__close m3-interactive" onClick={onCancel} type="button">
                <X size={16} />
              </button>
            </div>

            <div className="confirm-dialog__actions">
              <button className="confirm-dialog__button confirm-dialog__button--cancel m3-interactive" disabled={busy} onClick={onCancel} type="button">
                {cancelLabel}
              </button>
              <button className="confirm-dialog__button confirm-dialog__button--confirm m3-interactive" disabled={busy} onClick={onConfirm} type="button">
                {busy ? "Подождите…" : confirmLabel}
              </button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
