import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Ban, Flag, LoaderCircle, MoreHorizontal, VolumeX, X } from "lucide-react";
import { useState } from "react";

import { ApiError, apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

const REPORT_REASONS = ["Harassment", "Spam", "Impersonation", "Explicit content", "Other"];

export default function SafetyMenu({
  onActionComplete,
  targetUserId,
  targetUsername,
  tweetId = null,
}) {
  const { user } = useAuth();
  const showToast = useToast();
  const [busyAction, setBusyAction] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);

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
    try {
      setBusyAction(action);
      await apiFetch(`/users/${targetUserId}/${action}`, { method: "POST" });
      setIsMenuOpen(false);
      showToast(
        action === "block" ? `Blocked ${targetUsername}.` : `Muted ${targetUsername}.`,
        "success",
      );
      onActionComplete?.(action);
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to complete the action.", "info");
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
      showToast("Report submitted to moderation.", "success");
      onActionComplete?.("report");
    } catch (caughtError) {
      setReportError(caughtError instanceof ApiError ? caughtError.message : "Unable to submit the report.");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <>
      <div className="relative">
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={`Open safety actions for ${targetUsername}`}
          className="x-icon-button h-9 w-9"
          onClick={() => setIsMenuOpen((current) => !current)}
          type="button"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" />
        </button>

        <AnimatePresence>
          {isMenuOpen ? (
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="absolute right-0 top-11 z-20 w-[220px] rounded-[20px] border border-white/10 bg-[#0f1115] p-2 shadow-lift"
              exit={{ opacity: 0, scale: 0.98, y: -8 }}
              initial={{ opacity: 0, scale: 0.98, y: -8 }}
            >
              <button
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[14px] text-x-primary transition hover:bg-white/[0.04]"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  setIsReportOpen(true);
                  setIsMenuOpen(false);
                }}
                type="button"
              >
                <Flag className="h-4 w-4 text-x-blue" />
                Report
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[14px] text-x-primary transition hover:bg-white/[0.04] disabled:opacity-60"
                disabled={Boolean(busyAction)}
                onClick={() => void runRelationAction("mute")}
                type="button"
              >
                {busyAction === "mute" ? <LoaderCircle className="h-4 w-4 animate-spin text-x-blue" /> : <VolumeX className="h-4 w-4 text-x-blue" />}
                Mute {targetUsername}
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[14px] text-red-100 transition hover:bg-x-red/10 disabled:opacity-60"
                disabled={Boolean(busyAction)}
                onClick={() => void runRelationAction("block")}
                type="button"
              >
                {busyAction === "block" ? <LoaderCircle className="h-4 w-4 animate-spin text-red-100" /> : <Ban className="h-4 w-4" />}
                Block {targetUsername}
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isReportOpen ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-black/75 px-4 py-6 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={closeReport}
          >
            <motion.section
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="mx-auto max-w-[540px] rounded-[24px] border border-white/10 bg-[#090b0f]"
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-[20px] font-extrabold text-x-primary">Report {targetUsername}</p>
                  <p className="text-[13px] text-x-secondary">Flag unsafe content or behavior for moderation review.</p>
                </div>
                <button aria-label="Close report dialog" className="x-icon-button h-10 w-10" onClick={closeReport} type="button">
                  <X className="h-5 w-5" />
                </button>
              </header>

              <form className="space-y-4 p-5" onSubmit={submitReport}>
                <div>
                  <p className="text-[14px] font-semibold text-x-primary">Reason</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {REPORT_REASONS.map((reason) => (
                      <button
                        className={[
                          "rounded-full px-4 py-2 text-[14px] font-semibold transition",
                          reportReason === reason ? "bg-x-blue text-white" : "bg-white/[0.04] text-x-secondary hover:bg-white/[0.08] hover:text-x-primary",
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

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-x-primary">
                    <AlertTriangle className="h-4 w-4 text-x-blue" />
                    Extra context
                  </span>
                  <textarea
                    className="x-input min-h-[132px] rounded-[20px]"
                    maxLength={2000}
                    onChange={(event) => setReportDetails(event.target.value)}
                    placeholder="Add any details that will help the moderation queue triage this faster."
                    value={reportDetails}
                  />
                </label>

                {reportError ? <p className="rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100">{reportError}</p> : null}

                <div className="flex items-center justify-end gap-3">
                  <button
                    className="rounded-full px-4 py-2.5 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
                    onClick={closeReport}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-x-blue px-5 py-2.5 text-[15px] font-bold text-white transition hover:bg-[#1a8cd8] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busyAction === "report"}
                    type="submit"
                  >
                    {busyAction === "report" ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : <Flag className="h-[18px] w-[18px]" />}
                    {busyAction === "report" ? "Submitting..." : "Send report"}
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
