export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const debounce = (fn, wait = 200) => {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
};

export const getSelectionRect = (start, current) => ({
  left: Math.min(start.x, current.x),
  top: Math.min(start.y, current.y),
  right: Math.max(start.x, current.x),
  bottom: Math.max(start.y, current.y),
});

export const rectsIntersect = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export const normalizeQuery = (query) => query.replace(/\s+/g, "").trim();

