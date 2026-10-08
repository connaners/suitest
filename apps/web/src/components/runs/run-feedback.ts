export type RunFeedbackMap = Record<string, string>;

const STORAGE_PREFIX = "suitest:run-feedback:";
const memoryCache = new Map<string, RunFeedbackMap>();

function getStorageKey(runId: string): string {
  return `${STORAGE_PREFIX}${runId}`;
}

export function getRunFeedback(runId: string): RunFeedbackMap {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return memoryCache.get(runId) ?? {};
  }
  try {
    const raw = window.sessionStorage.getItem(getStorageKey(runId));
    if (raw) {
      const parsed = JSON.parse(raw) as RunFeedbackMap;
      memoryCache.set(runId, parsed);
      return parsed;
    }
  } catch {
    // Fall back to memoryCache below
  }
  return memoryCache.get(runId) ?? {};
}

export function setRunCaseFeedback(
  runId: string,
  caseId: string,
  feedback: string,
): RunFeedbackMap {
  const current = getRunFeedback(runId);
  const updated: RunFeedbackMap = { ...current, [caseId]: feedback };
  memoryCache.set(runId, updated);

  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(getStorageKey(runId), JSON.stringify(updated));
    } catch {
      // Memory cache serves as resilient fallback
    }
  }
  return updated;
}

export function clearRunFeedback(runId: string): void {
  memoryCache.delete(runId);
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(getStorageKey(runId));
    } catch {
      // Ignore
    }
  }
}
