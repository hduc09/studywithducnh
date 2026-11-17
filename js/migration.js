// Chuyển tên kho dữ liệu; giữ bản gốc cho tới khi người dùng xác nhận bản sao.
export const STORAGE_KEY = 'studywithducnh-v1';
export const PREVIOUS_STORAGE_KEY = 'studynest-v1';
export const DATABASE_NAME = 'studywithducnh-assets';
export const PREVIOUS_DATABASE_NAME = 'studynest-assets';
const MARK_KEY = 'studywithducnh-migration-v1';
const ARCHIVE_KEY = 'studywithducnh-legacy-archive-v1';
export const RETENTION_MS = 30 * 86400000;

const parse = value => {
  try { return value ? JSON.parse(value) : null } catch { return null }
};
const items = data => ({
  flashcards: Array.isArray(data?.flashcards) ? data.flashcards : [],
  habits: Array.isArray(data?.habits) ? data.habits : []
});
export const legacyCounts = data => {
  const old = items(data);
  return { decks: old.flashcards.length, trackers: old.habits.length };
};
export const hasLegacyContent = data => {
  const count = legacyCounts(data);
  return count.decks > 0 || count.trackers > 0;
};
export function normalizeLegacyFields(data) {
  if (!data || typeof data !== 'object') return data;
  const next = { ...data };
  if (!hasLegacyContent(next)) {
    delete next.flashcards;
    delete next.habits;
  }
  return next;
}
export const acceptsBackupApp = value =>
  value === 'studywithducnh' || value === 'StudyNest';
const readMark = storage => parse(storage.getItem(MARK_KEY));
const sameLegacy = (a, b) => JSON.stringify(items(a)) === JSON.stringify(items(b));
const fingerprint = text => {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
};

export function prepareMigration(storage = localStorage, now = Date.now()) {
  const previousRaw = storage.getItem(PREVIOUS_STORAGE_KEY);
  let currentRaw = storage.getItem(STORAGE_KEY);
  let copied = false;
  let copyError = false;
  if (!currentRaw && previousRaw) {
    const previous = parse(previousRaw);
    if (previous && typeof previous === 'object') {
      try {
        storage.setItem(STORAGE_KEY, previousRaw);
        currentRaw = previousRaw;
        copied = true;
      } catch {
        copyError = true;
        currentRaw = previousRaw;
      }
    }
  }
  if (previousRaw && !readMark(storage)) {
    try {
      storage.setItem(MARK_KEY, JSON.stringify({
        migratedAt: now,
        requiresConfirmation: hasLegacyContent(parse(previousRaw)),
        sourceHash: fingerprint(previousRaw)
      }));
    } catch { /* Bản gốc vẫn được giữ nếu bộ nhớ đầy. */ }
  }
  cleanupMigration(storage, now);
  return { data: parse(currentRaw), copied, copyError };
}

export function cleanupMigration(storage = localStorage, now = Date.now()) {
  const mark = readMark(storage);
  if (!mark?.migratedAt) return false;
  if (mark.retiredAt) return false;
  if (mark.requiresConfirmation && !mark.confirmedAt) return false;
  const from = Math.max(mark.migratedAt, mark.confirmedAt || 0);
  if (now - from < RETENTION_MS) return false;
  const previousRaw = storage.getItem(PREVIOUS_STORAGE_KEY);
  if (previousRaw && (!mark.sourceHash || fingerprint(previousRaw) !== mark.sourceHash)) return false;
  storage.setItem(MARK_KEY, JSON.stringify({ ...mark, retiredAt: now }));
  storage.removeItem(PREVIOUS_STORAGE_KEY);
  storage.removeItem(ARCHIVE_KEY);
  return true;
}

export function legacyArchive(data, storage = localStorage) {
  if (hasLegacyContent(data)) {
    return { app: 'studywithducnh', kind: 'legacy-archive', data };
  }
  const stored = parse(storage.getItem(ARCHIVE_KEY));
  if (stored?.data && hasLegacyContent(stored.data)) return stored;
  const previous = parse(storage.getItem(PREVIOUS_STORAGE_KEY));
  if (previous && hasLegacyContent(previous)) {
    return { app: 'studywithducnh', kind: 'legacy-archive', data: previous };
  }
  return null;
}

export function makeArchive(data, storage = localStorage, now = Date.now()) {
  const existing = parse(storage.getItem(ARCHIVE_KEY));
  if (existing?.data && sameLegacy(existing.data, data)) return existing;
  const archive = {
    app: 'studywithducnh',
    kind: 'legacy-archive',
    schemaVersion: 4,
    createdAt: new Date(now).toISOString(),
    data
  };
  try {
    storage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
    return archive;
  } catch {
    const previous = parse(storage.getItem(PREVIOUS_STORAGE_KEY));
    if (previous && sameLegacy(previous, data)) return {
      app: 'studywithducnh', kind: 'legacy-archive', data: previous
    };
    throw new Error('Không đủ bộ nhớ để giữ bản lưu phục hồi. Dữ liệu cũ vẫn nguyên vẹn.');
  }
}

export function confirmLegacyRemoval(data, storage = localStorage, now = Date.now()) {
  if (!hasLegacyContent(data)) return data;
  makeArchive(data, storage, now);
  const next = structuredClone(data);
  delete next.flashcards;
  delete next.habits;
  next.version = 4;
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  const mark = readMark(storage) || { migratedAt: now, requiresConfirmation: true };
  try {
    storage.setItem(MARK_KEY, JSON.stringify({
      ...mark, requiresConfirmation: true, confirmedAt: now, retiredAt: null
    }));
  } catch { /* Bản cũ sẽ được giữ lâu hơn 30 ngày. */ }
  return next;
}

export function archiveFilename(now = new Date()) {
  const day = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  return 'studywithducnh-du-lieu-cu-' + day + '.json';
}
