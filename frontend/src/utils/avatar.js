function hashString(value = "") {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  }
  return hash;
}

export function buildAvatarTone(username = "") {
  const colors = [
    "var(--avatar-tone-0)",
    "var(--avatar-tone-1)",
    "var(--avatar-tone-2)",
    "var(--avatar-tone-3)",
    "var(--avatar-tone-4)",
    "var(--avatar-tone-5)",
  ];
  const background = colors[hashString(username) % colors.length];
  return {
    background,
    color: "var(--md-on-primary-container)",
  };
}

export function getAvatarLetter(username = "") {
  return Array.from(username.trim())[0]?.toUpperCase() || "?";
}

export function getAvatarInitials(username = "") {
  return Array.from(username.trim()).slice(0, 2).join("").toUpperCase() || "?";
}

export function isPlaceholderAvatarUrl(value = "") {
  if (!value) {
    return false;
  }

  try {
    const fallbackOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(value, fallbackOrigin);
    const isAppPlaceholder = url.pathname === "/icon.svg";
    if (!isAppPlaceholder) {
      return false;
    }
    return typeof window === "undefined" ? true : url.origin === window.location.origin;
  } catch {
    return value === "/icon.svg" || value.endsWith("/icon.svg");
  }
}
