import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function EditProfileDialog({ onClose, onSaved, open, profile }) {
  const { updateProfile } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setAvatarUrl(profile?.user?.avatar_url || "");
    setBio(profile?.user?.bio || "");
    setError("");
  }, [open, profile]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setBusy(true);
      setError("");
      const updatedProfile = await updateProfile({
        avatar_url: avatarUrl.trim() || null,
        bio: bio.trim() || null,
      });
      onSaved?.(updatedProfile);
      onClose?.();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to update your profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 bg-black/75 px-4 py-6 backdrop-blur-sm"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="mx-auto max-w-[640px] rounded-[24px] border border-x-border bg-black"
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-x-border px-5 py-4">
              <div>
                <p className="text-[20px] font-extrabold text-x-primary">Edit profile</p>
                <p className="text-[13px] text-x-secondary">Update your bio and avatar link.</p>
              </div>
              <button className="x-icon-button h-10 w-10" onClick={onClose} type="button">
                <X className="h-5 w-5" />
              </button>
            </header>

            <form className="space-y-4 p-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-[15px] font-medium text-x-primary">Avatar URL</span>
                <input
                  className="x-input rounded-2xl"
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                  type="url"
                  value={avatarUrl}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[15px] font-medium text-x-primary">Bio</span>
                <textarea
                  className="x-input min-h-[140px] rounded-2xl"
                  maxLength={160}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="Tell people what you are recording and building."
                  value={bio}
                />
              </label>

              {error ? <p className="rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100">{error}</p> : null}

              <div className="flex items-center justify-end gap-3">
                <button
                  className="rounded-full px-4 py-2.5 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
                  onClick={onClose}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-x-blue px-5 py-2.5 text-[15px] font-bold text-white transition hover:bg-[#1a8cd8] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : null}
                  {busy ? "Saving..." : "Save profile"}
                </button>
              </div>
            </form>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
