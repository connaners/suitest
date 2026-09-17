export type VideoQuality = "360p" | "480p" | "720p" | "1080p";

export interface ExecutionSettings {
  headless: boolean;
  screenshot: "off" | "only-on-failure" | "on";
  video: "off" | "retain-on-failure" | "on";
  videoQuality: VideoQuality;
  highlightSteps: boolean;
  cleanSessionBetweenCases: boolean;
}

export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  headless: true,
  screenshot: "only-on-failure",
  video: "off",
  videoQuality: "1080p",
  highlightSteps: false,
  cleanSessionBetweenCases: true,
};

export type ExecutionSettingsInput = {
  headless?: boolean | undefined;
  screenshot?: ("off" | "only-on-failure" | "on") | undefined;
  video?: ("off" | "retain-on-failure" | "on") | undefined;
  videoQuality?: VideoQuality | undefined;
  video_quality?: VideoQuality | undefined;
  highlightSteps?: boolean | undefined;
  highlight_steps?: boolean | undefined;
  cleanSessionBetweenCases?: boolean | undefined;
  clean_session_between_cases?: boolean | undefined;
};

export function normalizeExecutionSettings(
  input?: ExecutionSettingsInput | null | undefined,
): ExecutionSettings {
  if (!input) return { ...DEFAULT_EXECUTION_SETTINGS };
  return {
    headless: input.headless ?? DEFAULT_EXECUTION_SETTINGS.headless,
    screenshot: input.screenshot ?? DEFAULT_EXECUTION_SETTINGS.screenshot,
    video: input.video ?? DEFAULT_EXECUTION_SETTINGS.video,
    videoQuality:
      input.videoQuality ?? input.video_quality ?? DEFAULT_EXECUTION_SETTINGS.videoQuality,
    highlightSteps:
      input.highlightSteps ?? input.highlight_steps ?? DEFAULT_EXECUTION_SETTINGS.highlightSteps,
    cleanSessionBetweenCases:
      input.cleanSessionBetweenCases ??
      input.clean_session_between_cases ??
      DEFAULT_EXECUTION_SETTINGS.cleanSessionBetweenCases,
  };
}

export const EXECUTION_SETTINGS_STORAGE_KEY = "suitest.execution-settings";

export function loadSavedExecutionSettings(): ExecutionSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_EXECUTION_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(EXECUTION_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXECUTION_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ExecutionSettings>;
    return normalizeExecutionSettings(parsed);
  } catch {
    return { ...DEFAULT_EXECUTION_SETTINGS };
  }
}

export function saveExecutionSettings(settings: ExecutionSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(EXECUTION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota or private-browsing errors
  }
}

export function extractExecutionConfig(settings: ExecutionSettings): ExecutionSettingsInput {
  return {
    headless: settings.headless,
    screenshot: settings.screenshot,
    video: settings.video,
    videoQuality: settings.videoQuality,
    highlightSteps: settings.highlightSteps,
    cleanSessionBetweenCases: settings.cleanSessionBetweenCases,
  };
}


