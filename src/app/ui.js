export const applyTheme = (theme) => {
  const root = document.documentElement;
  if (theme === "light") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
};

export const applyBoxVisibility = (showBoxes) => {
  const root = document.documentElement;
  root.classList.toggle("boxes-hidden", !showBoxes);
};

export const updateThemeButton = (themeBtn, theme) => {
  const labelByTheme = { light: "浅色", sepia: "护眼", dark: "深色" };
  themeBtn.textContent = labelByTheme[theme] ?? "主题";
};

export const updateModeButton = (modeBtn, mode) => {
  modeBtn.textContent = mode === "scroll" ? "滚动" : "单页";
};

export const updateBoxesButton = (toggleBoxesBtn, showBoxes) => {
  toggleBoxesBtn.textContent = showBoxes ? "格子开" : "格子关";
};

