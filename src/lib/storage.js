export const STORAGE_KEY_SETTINGS = "pdf-box-explorer:settings";
export const STORAGE_KEY_DOC_PREFIX = "pdf-box-explorer:doc:";

export const loadSettings = (defaultSettings) => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
};

export const saveSettings = (settings) => {
  try {
    window.localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch {
    // ignore
  }
};

export const loadDocState = (docKey) => {
  if (!docKey) return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_DOC_PREFIX}${docKey}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveDocState = (docKey, state) => {
  if (!docKey) return;
  try {
    window.localStorage.setItem(
      `${STORAGE_KEY_DOC_PREFIX}${docKey}`,
      JSON.stringify(state)
    );
  } catch {
    // ignore
  }
};

