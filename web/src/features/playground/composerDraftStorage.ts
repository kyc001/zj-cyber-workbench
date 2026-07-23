const STORAGE_KEY = "zj.playground.composer-drafts.v1";
const MAX_DRAFTS = 30;
const MAX_SERIALIZED_CHARACTERS = 750_000;

type StoredDraftPayload = {
  version: 1;
  drafts: Array<{
    key: string;
    text: string;
  }>;
};

// All mounted composers and lifecycle listeners must mutate the same map;
// otherwise a later save can resurrect a draft that was already discarded.
let sharedDrafts: Map<string, string> | null = null;

export function loadComposerTextDrafts(): Map<string, string> {
  sharedDrafts ??= readComposerTextDrafts();
  return sharedDrafts;
}

function readComposerTextDrafts(): Map<string, string> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const payload = JSON.parse(raw) as Partial<StoredDraftPayload>;
    if (payload.version !== 1 || !Array.isArray(payload.drafts)) return new Map();

    const drafts = new Map<string, string>();
    for (const item of payload.drafts.slice(-MAX_DRAFTS)) {
      if (
        item
        && typeof item === "object"
        && typeof item.key === "string"
        && typeof item.text === "string"
        && item.key
        && item.text
      ) {
        drafts.set(item.key, item.text);
      }
    }
    return drafts;
  } catch {
    return new Map();
  }
}

export function saveComposerTextDraft(
  drafts: Map<string, string>,
  draftKey: string,
  text: string,
) {
  drafts.delete(draftKey);
  if (text) drafts.set(draftKey, text);
  trimOldestDrafts(drafts);
  writeDrafts(drafts);
}

export function deleteComposerTextDraft(drafts: Map<string, string>, draftKey: string) {
  if (!drafts.delete(draftKey)) return;
  writeDrafts(drafts);
}

function trimOldestDrafts(drafts: Map<string, string>) {
  while (drafts.size > MAX_DRAFTS) {
    const oldestKey = drafts.keys().next().value as string | undefined;
    if (!oldestKey) break;
    drafts.delete(oldestKey);
  }
}

function writeDrafts(drafts: Map<string, string>) {
  try {
    let entries = Array.from(drafts, ([key, text]) => ({ key, text }));
    let serialized = serialize(entries);
    while (serialized.length > MAX_SERIALIZED_CHARACTERS && entries.length > 0) {
      entries = entries.slice(1);
      serialized = serialize(entries);
    }

    const retainedKeys = new Set(entries.map((item) => item.key));
    for (const key of drafts.keys()) {
      if (!retainedKeys.has(key)) drafts.delete(key);
    }

    if (entries.length === 0) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Storage can be disabled or full. Drafts remain available in memory.
  }
}

function serialize(drafts: StoredDraftPayload["drafts"]): string {
  return JSON.stringify({ version: 1, drafts } satisfies StoredDraftPayload);
}
