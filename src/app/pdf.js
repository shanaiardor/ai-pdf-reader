export const computeFitWidthScale = async (
  pdf,
  pageNumber,
  { viewerWidth, padding = 80, minWidth = 320, maxWidth = 900 } = {}
) => {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(0, (viewerWidth ?? 0) - padding);
  const targetWidth = Math.min(maxWidth, Math.max(minWidth, availableWidth));
  return targetWidth / viewport.width;
};

export const getEffectiveScale = async (
  settings,
  pdf,
  pageNumber,
  { viewerWidth } = {}
) => {
  if (settings.scaleMode === "fitWidth") {
    return computeFitWidthScale(pdf, pageNumber, { viewerWidth });
  }
  return settings.manualScale;
};

export const extractBoxes = async (pdfjsLib, page, viewport) => {
  const textContent = await page.getTextContent();
  const boxes = [];
  let runningIndex = 0;

  textContent.items.forEach((item) => {
    if (!item.str) return;
    const text = item.str;
    const trimmed = text.trim();
    if (!trimmed) return;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const height = item.height * viewport.scale;
    const width = item.width * viewport.scale;
    const charWidth = width / text.length;
    const baseX = tx[4];
    const baseY = tx[5] - height;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (!char.trim()) continue;
      const x = baseX + i * charWidth;
      boxes.push({
        id: runningIndex,
        char,
        bbox: {
          x: Math.round(x),
          y: Math.round(baseY),
          width: Math.round(charWidth),
          height: Math.round(height),
        },
      });
      runningIndex += 1;
    }
  });

  return boxes;
};

