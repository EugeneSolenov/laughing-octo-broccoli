import { describe, expect, it } from "vitest";

import { buildTrendingHashtags, extractHashtags } from "./hashtags.js";

describe("extractHashtags", () => {
  it("returns only explicit hashtags from the optional user note", () => {
    expect(extractHashtags("Short note about the clip #VoiceAtlas #Новости transcript words")).toEqual(["#voiceatlas", "#новости"]);
  });

  it("ignores plain transcript-like words when they are not prefixed with #", () => {
    expect(extractHashtags("Привет это обычный текст без тегов")).toEqual([]);
  });

  it("deduplicates hashtags and respects the limit", () => {
    expect(extractHashtags("#Launch #launch #Audio #Updates", { limit: 2 })).toEqual(["#launch", "#audio"]);
  });
});

describe("buildTrendingHashtags", () => {
  it("counts hashtags from captions only and ignores transcription content", () => {
    expect(
      buildTrendingHashtags([
        { caption: "Optional note #launch #audio", transcription_text: "these words should not matter" },
        { caption: "Another note #launch", transcription_text: "#ignored-from-transcript" },
        { caption: "", transcription_text: "#transcribed should stay out of trends" },
      ]),
    ).toEqual([
      { title: "launch", meta: "Популярный хэштег", count: "2 записи" },
      { title: "audio", meta: "Новый хэштег", count: "1 запись" },
    ]);
  });
});
