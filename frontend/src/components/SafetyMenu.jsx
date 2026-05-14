import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Ban, Flag, LoaderCircle, MoreHorizontal, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiError, apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

const REPORT_REASONS = ["Оскорбления", "Спам", "Выдача себя за другого", "Нежелательный контент", "Другое"];
const MENU_WIDTH = 260;
const MENU_VIEWPORT_GAP = 16;
const MENU_TRIGGER_GAP = 8;

export default function SafetyMenu({ onActionComplete, targetUserId, targetUsername, tweetId = null }) {
  const { user } = useAuth();
  const showToast = useToast();
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const [busyAction, setBusyAction] = useState("");
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const canBlockUsers = String(user?.role || "").toLowerCase() === "admin";

  const updateMenuPosition = () => {
    if (typeof window === "undefined" || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, Math.max(180, window.innerWidth - MENU_VIEWPORT_GAP * 2));
    const opensToRight = rect.left + width <= window.innerWidth - MENU_VIEWPORT_GAP;
    const left = opensToRight
      ? rect.left
      : Math.max(MENU_VIEWPORT_GAP, Math.min(rect.right - width, window.innerWidth - width - MENU_VIEWPORT_GAP));
    const estimatedHeight = canBlockUsers ? 172 : 124;
    const bottomTop = rect.bottom + MENU_TRIGGER_GAP;
    const top = bottomTop + estimatedHeight <= window.innerHeight - MENU_VIEWPORT_GAP
      ? bottomTop
      : Math.max(MENU_VIEWPORT_GAP, rect.top - estimatedHeight - MENU_TRIGGER_GAP);

    setMenuPosition({ left, top, width });
  };

  const openMenu = () => {
    updateMenuPosition();
    setIsMenuOpen(true);
  };

  const toggleMenu = () => {
    if (isMenuOpen) {
      setIsMenuOpen(false);
      return;
    }

    openMenu();
  };

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    updateMenuPosition();

    const handlePointerDown = (event) => {
      const target = event.target;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setIsMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen, canBlockUsers]);

  if (!user || user.id === targetUserId) {
    return null;
  }

  const closeReport = () => {
    setIsReportOpen(false);
    setReportDetails("");
    setReportError("");
    setReportReason(REPORT_REASONS[0]);
  };

  const runRelationAction = async (action) => {
    if (action === "block" && !canBlockUsers) {
      return;
    }

    try {
      setBusyAction(action);
      await apiFetch(`/users/${targetUserId}/${action}`, { method: "POST" });
      setIsBlockConfirmOpen(false);
      setIsMenuOpen(false);
      showToast(action === "block" ? `${targetUsername} заблокирован.` : `${targetUsername} скрыт из ленты.`, "success");
      onActionComplete?.(action);
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось выполнить действие.", "info");
    } finally {
      setBusyAction("");
    }
  };

  const submitReport = async (event) => {
    event.preventDefault();

    try {
      setBusyAction("report");
      setReportError("");
      await apiFetch("/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tweet_id: tweetId,
          target_user_id: targetUserId,
          reason: reportReason,
          details: reportDetails.trim() || null,
        }),
      });
      closeReport();
      setIsMenuOpen(false);
      showToast("Жалоба отправлена модерации.", "success");
      onActionComplete?.("report");
    } catch (caughtError) {
      setReportError(caughtError instanceof ApiError ? caughtError.message : "Не удалось отправить жалобу.");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <>
      <div style={{ position: "relative" }}>
        <button
          ref={triggerRef}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={`Открыть действия для ${targetUsername}`}
          className="m3-icon-button m3-interactive safety-menu__trigger"
          onClick={toggleMenu}
          type="button"
        >
          <MoreHorizontal size={16} />
        </button>

        {typeof document !== "undefined"
          ? createPortal(
              <AnimatePresence>
                {isMenuOpen && menuPosition ? (
                  <motion.div
                    ref={menuRef}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="m3-card safety-menu__panel"
                    exit={{ opacity: 0, scale: 0.98, y: -6 }}
                    initial={{ opacity: 0, scale: 0.98, y: -6 }}
                    role="menu"
                    style={{
                      left: menuPosition.left,
                      padding: 8,
                      position: "fixed",
                      top: menuPosition.top,
                      width: menuPosition.width,
                      zIndex: "calc(var(--z-dialog) + 40)",
                    }}
                  >
                    <button
                      className="m3-interactive safety-menu__item"
                      disabled={Boolean(busyAction)}
                      onClick={() => {
                        setIsReportOpen(true);
                        setIsMenuOpen(false);
                      }}
                      role="menuitem"
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: "transparent", border: 0, textAlign: "left" }}
                      type="button"
                    >
                      <Flag size={16} style={{ color: "var(--md-sys-color-primary)" }} />
                      <span className="safety-menu__item-label">Пожаловаться</span>
                    </button>
                    <button
                      className="m3-interactive safety-menu__item"
                      disabled={Boolean(busyAction)}
                      onClick={() => void runRelationAction("mute")}
                      role="menuitem"
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: "transparent", border: 0, textAlign: "left" }}
                      type="button"
                    >
                      {busyAction === "mute" ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite", color: "var(--md-sys-color-primary)" }} /> : <VolumeX size={16} style={{ color: "var(--md-sys-color-primary)" }} />}
                      <span className="safety-menu__item-label">Скрыть {targetUsername}</span>
                    </button>
                    {canBlockUsers ? (
                      <button
                        className="m3-interactive safety-menu__item safety-menu__item--danger"
                        disabled={Boolean(busyAction)}
                        onClick={() => {
                          setIsMenuOpen(false);
                          setIsBlockConfirmOpen(true);
                        }}
                        role="menuitem"
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: "transparent", border: 0, textAlign: "left", color: "var(--md-sys-color-tertiary)" }}
                        type="button"
                      >
                        {busyAction === "block" ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Ban size={16} />}
                        <span className="safety-menu__item-label">Заблокировать {targetUsername}</span>
                      </button>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>,
              document.body,
            )
          : null}
      </div>

      <AnimatePresence>
        {isReportOpen ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="m3-overlay"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={closeReport}
          >
            <motion.section
            animate={{ opacity: 1, scale: 1, y: 0 }}
              aria-label={`Пожаловаться на ${targetUsername}`}
              aria-modal="true"
              className="m3-dialog"
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="dialog-header">
                <div>
                  <p className="m3-section-label">Безопасность</p>
                  <h2 className="m3-title-medium" style={{ marginTop: 4, fontSize: 20 }}>
                    Пожаловаться на {targetUsername}
                  </h2>
                  <p className="m3-body-small" style={{ marginTop: 6 }}>
                    Сообщите о нежелательном поведении или контенте для проверки модераторами.
                  </p>
                </div>
                <button aria-label="Закрыть окно жалобы" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={closeReport} type="button">
                  <X size={16} />
                </button>
              </div>

              <form className="dialog-body" onSubmit={submitReport} style={{ display: "grid", gap: 16 }}>
                <div>
                  <p className="m3-title-medium" style={{ fontSize: 14 }}>
                    Причина
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    {REPORT_REASONS.map((reason) => (
                      <button
                        className={[
                          "m3-chip",
                          "m3-interactive",
                          reportReason === reason ? "m3-chip-filled" : "",
                        ].join(" ")}
                        key={reason}
                        onClick={() => setReportReason(reason)}
                        type="button"
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                </div>

                <label style={{ display: "grid", gap: 8 }}>
                  <span className="m3-title-medium" style={{ fontSize: 14 }}>
                    <AlertTriangle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px", color: "var(--md-sys-color-primary)" }} />
                    Подробности
                  </span>
                  <textarea
                    className="m3-textarea"
                    maxLength={2000}
                    onChange={(event) => setReportDetails(event.target.value)}
                    placeholder="Добавьте детали, которые помогут быстрее проверить жалобу."
                    value={reportDetails}
                  />
                </label>

                {reportError ? <p className="m3-error">{reportError}</p> : null}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <button className="m3-button m3-button-outlined m3-interactive" onClick={closeReport} type="button">
                    Отмена
                  </button>
                  <button className="m3-button m3-button-filled m3-fab m3-interactive" disabled={busyAction === "report"} type="submit">
                    {busyAction === "report" ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Flag size={16} />}
                    {busyAction === "report" ? "Отправка\u2026" : "Отправить жалобу"}
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {canBlockUsers ? (
        <ConfirmDialog
          busy={busyAction === "block"}
          confirmLabel="Заблокировать"
          description={`Записи и профиль ${targetUsername} будут скрыты из вашей ленты.`}
          onCancel={() => setIsBlockConfirmOpen(false)}
          onConfirm={() => void runRelationAction("block")}
          open={isBlockConfirmOpen}
          title={`Заблокировать ${targetUsername}?`}
        />
      ) : null}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
