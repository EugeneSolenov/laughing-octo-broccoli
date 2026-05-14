const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}][\p{L}\p{N}_-]{1,29})/gu;

export function extractHashtags(text, { limit = Infinity } = {}) {
  if (!text?.trim()) {
    return [];
  }

  const unique = [];

  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const tag = `#${match[2].toLowerCase()}`;
    if (!unique.includes(tag)) {
      unique.push(tag);
    }
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function formatPostCount(count) {
  const normalized = Math.abs(Number(count) || 0);
  const lastTwo = normalized % 100;
  const lastOne = normalized % 10;

  if (lastTwo >= 11 && lastTwo <= 14) {
    return `${count} записей`;
  }

  if (lastOne === 1) {
    return `${count} запись`;
  }

  if (lastOne >= 2 && lastOne <= 4) {
    return `${count} записи`;
  }

  return `${count} записей`;
}

export function buildTrendingHashtags(items, { limit = 6 } = {}) {
  const counts = new Map();

  for (const item of items) {
    for (const hashtag of extractHashtags(item.caption || "")) {
      const normalized = hashtag.replace(/^#/, "");
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([title, count]) => ({
      title,
      meta: count > 1 ? "Популярный хэштег" : "Новый хэштег",
      count: formatPostCount(count),
    }));
}
