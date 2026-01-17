import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker?worker";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { readBinaryFile } from "@tauri-apps/api/fs";
import { computeFitWidthScale, extractBoxes, getEffectiveScale } from "./app/pdf.js";
import {
  applyBoxVisibility,
  applyTheme,
  updateModeButton,
  updateThemeButton,
} from "./app/ui.js";
import {
  loadDocState,
  loadSettings,
  saveDocState,
  saveSettings,
} from "./lib/storage.js";
import {
  clamp,
  debounce,
  getSelectionRect,
  normalizeQuery,
  rectsIntersect,
} from "./lib/utils.js";

pdfjsLib.GlobalWorkerOptions.workerPort = new pdfWorker();

const viewer = document.getElementById("viewer");
const viewerEmpty = document.getElementById("viewer-empty");
const fileInput = document.getElementById("file-input");
const loadPdfBtn = document.getElementById("load-pdf-btn");
const clearBtn = document.getElementById("clear-btn");
const appHeader = document.getElementById("app-header");
const headerBrand = document.getElementById("header-brand");
const headerControls = document.getElementById("header-controls");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const pageInput = document.getElementById("page-input");
const pageTotal = document.getElementById("page-total");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomLabel = document.getElementById("zoom-label");
const fitWidthBtn = document.getElementById("fit-width-btn");
const modeBtn = document.getElementById("mode-btn");
const themeBtn = document.getElementById("theme-btn");
const aiConfigBtn = document.getElementById("ai-config-btn");
const searchInput = document.getElementById("search-input");
const searchPrevBtn = document.getElementById("search-prev-btn");
const searchNextBtn = document.getElementById("search-next-btn");
const selectionSummary = document.getElementById("selection-summary");
const selectionText = document.getElementById("selection-text");
const aiAnalyzeBtn = document.getElementById("ai-analyze-btn");
const aiAnalyzeWrap = document.getElementById("ai-analyze-wrap");
const selectionTitle = document.getElementById("selection-title");
const aiInstructionInput = document.getElementById("ai-instruction");
const aiAnalysisOutput = document.getElementById("ai-analysis-output");
const aiAnalysisStatus = document.getElementById("ai-analysis-status");
const aiInstructionPanel = document.getElementById("ai-instruction-panel");
const aiInstructionToggle = document.getElementById("ai-instruction-toggle");
const aiConfigModal = document.getElementById("ai-config-modal");
const aiConfigCloseBtn = document.getElementById("ai-config-close");
const aiConfigCancelBtn = document.getElementById("ai-config-cancel");
const aiConfigForm = document.getElementById("ai-config-form");
const aiConfigStatus = document.getElementById("ai-config-status");
const aiConfigModelInput = document.getElementById("ai-config-model");
const aiConfigBaseUrlInput = document.getElementById("ai-config-base-url");
const aiConfigApiKeyInput = document.getElementById("ai-config-api-key");
const aiConfigTemperatureInput = document.getElementById("ai-config-temperature");
const aiConfigMaxTokensInput = document.getElementById("ai-config-max-tokens");
const aiConfigShowBoxesInput = document.getElementById("ai-config-show-boxes");
const lastOpenModal = document.getElementById("last-open-modal");
const lastOpenPath = document.getElementById("last-open-path");
const lastOpenCloseBtn = document.getElementById("last-open-close");
const lastOpenCancelBtn = document.getElementById("last-open-cancel");
const lastOpenOpenBtn = document.getElementById("last-open-open");
const lastOpenSpinner = lastOpenOpenBtn?.querySelector(".last-open-spinner");
const lastOpenLabel = lastOpenOpenBtn?.querySelector(".last-open-label");

let currentPdf = null;
let currentPageNumber = 1;
const selections = new Map();
let dragState = null;
let dragRect = null;
let isDragging = false;
let pageObserver = null;
let currentDocKey = null;
let currentDocState = null;
let scrollScale = 1;

let searchMatches = [];
let searchMatchIndex = -1;

const defaultSettings = {
  mode: "single",
  theme: "sepia",
  scaleMode: "fitWidth",
  manualScale: 1.2,
  aiInstruction: "用中文解释下面的选中内容，并给出要点与可能的上下文。",
};

const defaultAiConfig = {
  model: "gpt-4o-mini",
  base_url: "https://api.openai.com/v1",
  api_key: "",
  temperature: 0.2,
  max_tokens: 1024,
  show_boxes: true,
};

let settings = loadSettings(defaultSettings);
let aiConfig = { ...defaultAiConfig };
const AI_CONFIG_LOCAL_KEY = "pdf-box-explorer:ai-config";
let pendingLastOpenedPath = null;
let currentDocPath = null;

const updateDocState = (patch) => {
  if (!currentDocKey) return;
  const next = { ...(currentDocState ?? {}), ...patch };
  currentDocState = next;
  saveDocState(currentDocKey, next);
};

const canUseTauriInvoke = () =>
  typeof invoke === "function" &&
  (Boolean(window.__TAURI__?.invoke || window.__TAURI__?.tauri?.invoke) ||
    Boolean(window.__TAURI_IPC__));

const safeInvoke = async (command, payload) => {
  if (!canUseTauriInvoke()) return null;
  try {
    return await invoke(command, payload);
  } catch {
    return null;
  }
};

const saveLastOpenedPath = async (path) => {
  if (!path) return;
  await safeInvoke("save_last_opened_path", { path });
};

const loadLastOpenedPath = async () => {
  const result = await safeInvoke("load_last_opened_path");
  return typeof result === "string" && result ? result : null;
};

const loadLastReadingPage = async (path) => {
  const result = await safeInvoke("load_last_reading_page", { path });
  return Number.isFinite(result) ? Number(result) : null;
};

const saveLastReadingPage = async (path, page) => {
  if (!path) return;
  await safeInvoke("save_last_reading_page", { path, page });
};

const scheduleSaveLastReadingPage = debounce(async () => {
  if (!canUseTauriInvoke()) return;
  if (!currentDocPath) return;
  if (!currentPdf) return;
  await saveLastReadingPage(currentDocPath, currentPageNumber);
}, 350);

let lastMinWindowWidth = 0;

const computeHeaderControlsMinWidth = () => {
  if (!appHeader || !headerControls) return 0;
  const style = window.getComputedStyle(appHeader);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const extraGap = 24;
  return Math.ceil(headerControls.scrollWidth + paddingLeft + paddingRight + extraGap);
};

const updateTauriMinWindowWidth = debounce(async () => {
  if (!canUseTauriInvoke()) return;
  const next = computeHeaderControlsMinWidth();
  if (!next) return;
  if (Math.abs(next - lastMinWindowWidth) < 8) return;
  lastMinWindowWidth = next;
  await safeInvoke("set_min_window_width", { width: next });
}, 160);

const updateHeaderCompact = () => {
  if (!appHeader || !headerBrand || !headerControls) return;

  const isCompact = appHeader.classList.contains("header-compact");
  appHeader.classList.remove("header-compact");

  const headerWidth = appHeader.clientWidth;
  const brandWidth = headerBrand.getBoundingClientRect().width;
  const controlsWidth = headerControls.scrollWidth;
  const gap = 24;
  const required = brandWidth + controlsWidth + gap;

  const shouldCompact = isCompact ? required > headerWidth + 64 : required > headerWidth;
  appHeader.classList.toggle("header-compact", shouldCompact);
  updateTauriMinWindowWidth();
};

const setupHeaderCompact = () => {
  updateHeaderCompact();
  updateTauriMinWindowWidth();
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      updateHeaderCompact();
    });
    observer.observe(appHeader);
    observer.observe(headerControls);
  }
  window.addEventListener(
    "resize",
    debounce(() => {
      updateHeaderCompact();
    }, 120)
  );
};

const showEmptyState = () => {
  viewerEmpty.style.display = "flex";
};

const hideEmptyState = () => {
  viewerEmpty.style.display = "none";
};

const resetViewerPages = () => {
  viewer.querySelectorAll(".page").forEach((node) => node.remove());
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }
};

const clearSelections = () => {
  selections.clear();
  viewer.querySelectorAll(".box.is-active").forEach((box) => {
    box.classList.remove("is-active");
  });
};

const clearSearchHighlights = () => {
  searchMatches = [];
  searchMatchIndex = -1;
  viewer.querySelectorAll(".box.is-search, .box.is-search-active").forEach((box) => {
    box.classList.remove("is-search", "is-search-active");
  });
};

const resetAppState = () => {
  resetViewerPages();
  clearSelections();
  currentPdf = null;
  currentDocKey = null;
  currentDocState = null;
  currentPageNumber = 1;
  currentDocPath = null;
  scrollScale = 1;
  clearSearchHighlights();
  showEmptyState();
  renderSelections();
  aiAnalysisMarkdown = "";
  aiAnalysisOutput.textContent = "—";
  setAiAnalysisStatus("使用右上角 AI 配置填写接口信息。");
  setSelectionSummaryCollapsed(false);
  setAiInstructionCollapsed(false);
  updateHeaderUi();
};

const applyThemeWithSettings = () => applyTheme(settings.theme);

const applyBoxVisibilityWithSettings = () =>
  applyBoxVisibility(Boolean(aiConfig.show_boxes));

const updateThemeButtonWithSettings = () => updateThemeButton(themeBtn, settings.theme);

const updateModeButtonWithSettings = () => updateModeButton(modeBtn, settings.mode);

const setAiConfigStatus = (message, isError = false) => {
  if (!aiConfigStatus) return;
  aiConfigStatus.textContent = message;
  aiConfigStatus.classList.toggle("text-red-500", isError);
  aiConfigStatus.classList.toggle("text-neutral-500", !isError);
};

const fillAiConfigForm = (config) => {
  aiConfigModelInput.value = config.model ?? "";
  aiConfigBaseUrlInput.value = config.base_url ?? "";
  aiConfigApiKeyInput.value = config.api_key ?? "";
  aiConfigTemperatureInput.value =
    config.temperature === null || config.temperature === undefined
      ? ""
      : String(config.temperature);
  aiConfigMaxTokensInput.value =
    config.max_tokens === null || config.max_tokens === undefined
      ? ""
      : String(config.max_tokens);
  aiConfigShowBoxesInput.checked = Boolean(config.show_boxes);
};

const readAiConfigForm = () => {
  const temperatureValue = Number.parseFloat(aiConfigTemperatureInput.value);
  const maxTokensValue = Number.parseInt(aiConfigMaxTokensInput.value, 10);
  return {
    model: aiConfigModelInput.value.trim(),
    base_url: aiConfigBaseUrlInput.value.trim(),
    api_key: aiConfigApiKeyInput.value.trim(),
    temperature: Number.isFinite(temperatureValue) ? temperatureValue : null,
    max_tokens: Number.isFinite(maxTokensValue) ? maxTokensValue : null,
    show_boxes: Boolean(aiConfigShowBoxesInput.checked),
  };
};

const openAiConfigModal = () => {
  fillAiConfigForm(aiConfig);
  setAiConfigStatus("配置会保存到应用的配置目录。");
  aiConfigModal.classList.remove("hidden");
  aiConfigModal.classList.add("flex");
};

const closeAiConfigModal = () => {
  aiConfigModal.classList.add("hidden");
  aiConfigModal.classList.remove("flex");
};

const openLastOpenModal = (path) => {
  if (!lastOpenModal) return;
  pendingLastOpenedPath = path;
  lastOpenPath.textContent = path;
  lastOpenModal.classList.remove("hidden");
  lastOpenModal.classList.add("flex");
};

const closeLastOpenModal = () => {
  if (!lastOpenModal) return;
  lastOpenModal.classList.add("hidden");
  lastOpenModal.classList.remove("flex");
  pendingLastOpenedPath = null;
  lastOpenOpenBtn.disabled = false;
  if (lastOpenSpinner) lastOpenSpinner.classList.add("hidden");
  if (lastOpenLabel) lastOpenLabel.textContent = "打开";
};

const loadAiConfigFromBackend = async () => {
  if (!canUseTauriInvoke()) {
    try {
      const raw = window.localStorage.getItem(AI_CONFIG_LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          aiConfig = { ...defaultAiConfig, ...parsed };
        }
      }
    } catch {
      // ignore
    }
    return;
  }

  const config = await safeInvoke("load_ai_config");
  if (config && typeof config === "object") {
    aiConfig = { ...defaultAiConfig, ...config };
  }
  applyBoxVisibilityWithSettings();
};

const saveAiConfigToBackend = async (nextConfig) => {
  if (!canUseTauriInvoke()) {
    try {
      window.localStorage.setItem(AI_CONFIG_LOCAL_KEY, JSON.stringify(nextConfig));
      return { ok: true, local: true };
    } catch {
      return { ok: false, reason: "当前环境无法写入本地存储。" };
    }
  }
  try {
    await invoke("save_ai_config", { config: nextConfig });
    return { ok: true };
  } catch {
    return { ok: false, reason: "保存失败，请查看 Tauri 日志。" };
  }
};

const renderSelections = () => {
  const countLabel = selectionSummary?.querySelector("div");
  if (countLabel) {
    countLabel.textContent = `Selected (${selections.size})`;
  }

  const selectedItems = Array.from(selections.values()).sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y;
    return a.bbox.x - b.bbox.x;
  });

  const combinedText = buildSelectedText(selectedItems);
  selectionText.textContent = combinedText || "—";
  const signature = getSelectionSignature();
  const selectionChanged = signature !== lastAnalyzedSelectionSignature;
  aiAnalyzeBtn.disabled = selections.size === 0 || aiAnalysisInProgress;
  if (selections.size > 0 && selectionChanged && !aiAnalysisInProgress) {
    setSelectionSummaryCollapsed(false);
    setAiAnalysisStatus("选区已更新，可重新 AI 分析。");
  }
};

const buildSelectedText = (selectedItems) => {
  if (selectedItems.length === 0) return "";
  const lines = [];
  let buffer = "";
  let prev = null;

  selectedItems.forEach((item) => {
    if (!prev) {
      buffer += item.char;
      prev = item;
      return;
    }

    const samePage = item.page === prev.page;
    const sameLine = Math.abs(item.bbox.y - prev.bbox.y) <= prev.bbox.height * 0.6;
    const gap = item.bbox.x - (prev.bbox.x + prev.bbox.width);
    const shouldSpace =
      samePage && sameLine && gap > Math.max(2, prev.bbox.width * 0.35);

    if (!samePage) {
      lines.push(buffer);
      buffer = item.char;
      prev = item;
      return;
    }

    if (!sameLine) {
      lines.push(buffer);
      buffer = item.char;
      prev = item;
      return;
    }

    buffer += shouldSpace ? ` ${item.char}` : item.char;
    prev = item;
  });

  lines.push(buffer);
  return lines.join("\n");
};

const computeFitWidthScaleWithSettings = (pdf, pageNumber) =>
  computeFitWidthScale(pdf, pageNumber, { viewerWidth: viewer.clientWidth });

const getEffectiveScaleWithSettings = (pdf, pageNumber) =>
  getEffectiveScale(settings, pdf, pageNumber, { viewerWidth: viewer.clientWidth });

const renderPage = async (pdf, pageNumber, scale, pageWrapper = null) => {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const wrapper = pageWrapper ?? document.createElement("div");
  wrapper.className = "page";
  wrapper.innerHTML = "";

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const overlay = document.createElement("div");
  overlay.className = "overlay";

  wrapper.append(canvas, overlay);
  if (!pageWrapper) {
    viewer.append(wrapper);
  }

  await page.render({ canvasContext: context, viewport }).promise;

  const boxes = await extractBoxes(pdfjsLib, page, viewport);
  boxes.forEach((box) => {
    const key = `${pageNumber}-${box.id}`;
    const el = document.createElement("div");
    el.className = "box";
    el.style.left = `${box.bbox.x}px`;
    el.style.top = `${box.bbox.y}px`;
    el.style.width = `${box.bbox.width}px`;
    el.style.height = `${box.bbox.height}px`;
    el.dataset.page = pageNumber;
    el.dataset.index = box.id;
    el.dataset.char = box.char;
    el.dataset.bbox = JSON.stringify(box.bbox);
    if (selections.has(key)) {
      el.classList.add("is-active");
    }

    el.addEventListener("click", (event) => {
      if (isDragging) return;
      event.stopPropagation();
      if (selections.has(key)) {
        selections.delete(key);
        el.classList.remove("is-active");
      } else {
        selections.set(key, {
          page: pageNumber,
          index: box.id,
          char: box.char,
          bbox: box.bbox,
        });
        el.classList.add("is-active");
      }
      renderSelections();
    });

    overlay.append(el);
  });

  wrapper.dataset.rendered = "true";
};

const scrollToPage = (pageNumber) => {
  const el = viewer.querySelector(`.page[data-page="${pageNumber}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "start", behavior: "smooth" });
};

const renderScrollDocument = async (pdf) => {
  resetViewerPages();
  renderSelections();
  hideEmptyState();
  currentPdf = pdf;
  const scale = await getEffectiveScaleWithSettings(pdf, 1);
  scrollScale = scale;

  const firstPage = await pdf.getPage(1);
  const firstViewport = firstPage.getViewport({ scale });
  const placeholderHeight = Math.round(firstViewport.height) + 32;

  pageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const wrapper = entry.target;
        if (wrapper.dataset.rendered === "true") return;
        wrapper.dataset.rendered = "loading";
        pageObserver.unobserve(wrapper);
        renderPage(currentPdf, Number(wrapper.dataset.page), scale, wrapper);
      });
    },
    {
      root: viewer,
      rootMargin: "400px 0px",
      threshold: 0.15,
    }
  );

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const placeholder = document.createElement("div");
    placeholder.className =
      "page flex items-center justify-center text-sm text-neutral-400";
    placeholder.dataset.page = String(pageNumber);
    placeholder.dataset.rendered = "false";
    placeholder.style.minHeight = `${placeholderHeight}px`;
    placeholder.textContent = `Loading page ${pageNumber}…`;
    viewer.append(placeholder);
    pageObserver.observe(placeholder);
  }
};

const renderSinglePage = async (pdf, pageNumber) => {
  resetViewerPages();
  renderSelections();
  hideEmptyState();

  const wrapper = document.createElement("div");
  wrapper.className = "page";
  wrapper.dataset.page = String(pageNumber);
  wrapper.dataset.rendered = "loading";
  viewer.append(wrapper);

  const scale = await getEffectiveScaleWithSettings(pdf, pageNumber);
  await renderPage(pdf, pageNumber, scale, wrapper);
  viewer.scrollTop = 0;
};

const handlePdfBuffer = async (buffer, { preferredPageNumber = null } = {}) => {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  currentPdf = pdf;
  currentDocKey = pdf.fingerprint ?? null;

  const docState = loadDocState(currentDocKey);
  currentDocState = docState ?? {};
  const fromPreferred = Number.isFinite(preferredPageNumber) ? preferredPageNumber : null;
  currentPageNumber = clamp(
    fromPreferred ?? docState?.lastPage ?? 1,
    1,
    Number(currentPdf.numPages || 1)
  );

  pageTotal.textContent = String(currentPdf.numPages || "—");
  pageInput.value = String(currentPageNumber);

  if (settings.mode === "scroll") {
    await renderScrollDocument(currentPdf);
    scrollToPage(currentPageNumber);
  } else {
    await renderSinglePage(currentPdf, currentPageNumber);
  }
  updateHeaderUi();
};

const handleFile = async (file) => {
  if (!file) return;
  const buffer = await file.arrayBuffer();
  currentDocPath = null;
  await handlePdfBuffer(buffer);
};

const openPdfFromPath = async (path) => {
  if (!path) return;
  try {
    currentDocPath = path;
    const preferredPageNumber = await loadLastReadingPage(path);
    const bytes = await readBinaryFile(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await handlePdfBuffer(buffer, { preferredPageNumber });
    await saveLastOpenedPath(path);
  } catch {
    // ignore
  }
};

const openPdfWithDialog = async () => {
  const selected = await openDialog({
    multiple: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!selected) return;
  const path = Array.isArray(selected) ? selected[0] : selected;
  await openPdfFromPath(path);
};

const updateDragRect = (start, current) => {
  if (!dragRect) {
    dragRect = document.createElement("div");
    dragRect.className = "selection-rect";
    document.body.append(dragRect);
  }
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const width = Math.abs(start.x - current.x);
  const height = Math.abs(start.y - current.y);
  dragRect.style.left = `${left}px`;
  dragRect.style.top = `${top}px`;
  dragRect.style.width = `${width}px`;
  dragRect.style.height = `${height}px`;
  dragRect.style.display = "block";
};

const clearDragRect = () => {
  if (dragRect) {
    dragRect.style.display = "none";
  }
};


fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await handleFile(file);
});

loadPdfBtn.addEventListener("click", async (event) => {
  if (!canUseTauriInvoke()) return;
  event.preventDefault();
  event.stopPropagation();
  await openPdfWithDialog();
});

clearBtn.addEventListener("click", () => {
  fileInput.value = "";
  resetAppState();
});

viewer.addEventListener("dragover", (event) => {
  event.preventDefault();
});

viewer.addEventListener("drop", async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  fileInput.value = "";
  await handleFile(file);
});

viewer.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (!currentPdf) return;
  dragState = {
    start: { x: event.clientX, y: event.clientY },
  };
  isDragging = false;
});

window.addEventListener("mousemove", (event) => {
  if (!dragState) return;
  const current = { x: event.clientX, y: event.clientY };
  const dx = Math.abs(current.x - dragState.start.x);
  const dy = Math.abs(current.y - dragState.start.y);
  if (dx + dy > 4) {
    isDragging = true;
    updateDragRect(dragState.start, current);
  }
});

window.addEventListener("mouseup", (event) => {
  if (!dragState) return;
  const current = { x: event.clientX, y: event.clientY };
  if (isDragging) {
    const selectionRect = getSelectionRect(dragState.start, current);
    selections.clear();
    viewer.querySelectorAll(".box").forEach((box) => {
      box.classList.remove("is-active");
      const rect = box.getBoundingClientRect();
      const intersect = rectsIntersect(selectionRect, {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      });
      if (intersect) {
        const key = `${box.dataset.page}-${box.dataset.index}`;
        selections.set(key, {
          page: Number(box.dataset.page),
          index: Number(box.dataset.index),
          char: box.dataset.char,
          bbox: JSON.parse(box.dataset.bbox),
        });
        box.classList.add("is-active");
      }
    });
    renderSelections();
  }
  clearDragRect();
  dragState = null;
  window.setTimeout(() => {
    isDragging = false;
  }, 0);
});

window.addEventListener(
  "resize",
  debounce(async () => {
    if (!currentPdf) return;
    if (settings.mode === "scroll") {
      await renderScrollDocument(currentPdf);
      scrollToPage(currentPageNumber);
    } else {
      await renderSinglePage(currentPdf, currentPageNumber);
    }
    clearSearchHighlights();
    updateHeaderUi();
  }, 300)
);

const buildAiPayload = () => {
  const selectedItems = Array.from(selections.values()).sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y;
    return a.bbox.x - b.bbox.x;
  });
  const text = buildSelectedText(selectedItems);
  const meta = {
    pages: Array.from(new Set(selectedItems.map((item) => item.page))).sort(
      (a, b) => a - b
    ),
    count: selections.size,
  };
  const instruction = aiInstructionInput.value?.trim() || settings.aiInstruction;
  return { instruction, text, meta };
};

const setAiAnalysisStatus = (message, isError = false) => {
  if (!aiAnalysisStatus) return;
  aiAnalysisStatus.textContent = message;
  aiAnalysisStatus.classList.toggle("text-red-500", isError);
  aiAnalysisStatus.classList.toggle("text-neutral-500", !isError);
  if (selectionSummary?.classList.contains("is-collapsed")) {
    if (selectionTitle) selectionTitle.textContent = message;
  }
};

const setAiAnalysisOutput = (text) => {
  if (!aiAnalysisOutput) return;
  aiAnalysisMarkdown = text || "";
  if (!aiAnalysisMarkdown.trim()) {
    aiAnalysisOutput.textContent = "—";
    return;
  }
  stopAiStreamDisplay();
  scheduleAiMarkdownRender();
};

let aiAnalysisMarkdown = "";
let aiMarkdownRenderTimer = null;
let aiMarkdownRenderVersion = 0;
let aiMarkdownRenderInFlight = false;
let aiMarkdownRenderPending = null;
let aiAnalysisInProgress = false;
let lastAnalyzedSelectionSignature = "";
let aiStreamQueue = "";
let aiStreamDisplayed = "";
let aiStreamTimer = null;
let aiStreamActive = false;

const getSelectionSignature = () => {
  const keys = Array.from(selections.keys()).sort();
  return keys.join("|");
};

const renderAiAnalysisMarkdown = async (markdownSnapshot, versionSnapshot) => {
  if (!aiAnalysisOutput) return;
  const markdown = markdownSnapshot ?? aiAnalysisMarkdown;
  const version = versionSnapshot ?? aiMarkdownRenderVersion;

  if (!markdown.trim()) {
    aiAnalysisOutput.textContent = "—";
    return;
  }

  if (!canUseTauriInvoke()) {
    if (version !== aiMarkdownRenderVersion) return;
    aiAnalysisOutput.textContent = markdown;
    return;
  }

  const html = await safeInvoke("render_markdown", { markdown });
  if (version !== aiMarkdownRenderVersion) return;
  if (typeof html === "string" && html.length > 0) {
    aiAnalysisOutput.innerHTML = html;
  } else {
    aiAnalysisOutput.textContent = markdown;
  }
};

const requestAiMarkdownRender = (markdown) => {
  aiMarkdownRenderVersion += 1;
  const version = aiMarkdownRenderVersion;
  const snapshot = markdown ?? aiAnalysisMarkdown;

  if (aiMarkdownRenderInFlight) {
    aiMarkdownRenderPending = { snapshot, version };
    return;
  }

  aiMarkdownRenderInFlight = true;
  renderAiAnalysisMarkdown(snapshot, version)
    .catch(() => {})
    .finally(() => {
      aiMarkdownRenderInFlight = false;
      if (aiMarkdownRenderPending) {
        const pending = aiMarkdownRenderPending;
        aiMarkdownRenderPending = null;
        requestAiMarkdownRender(pending.snapshot);
      }
    });
};

const startAiStreamDisplay = () => {
  aiStreamQueue = "";
  aiStreamDisplayed = "";
  aiStreamActive = true;
  if (aiStreamTimer) window.clearInterval(aiStreamTimer);
  aiStreamTimer = window.setInterval(() => {
    if (!aiStreamActive) return;
    if (!aiStreamQueue.length) return;
    aiStreamDisplayed += aiStreamQueue[0];
    aiStreamQueue = aiStreamQueue.slice(1);
    aiAnalysisMarkdown = aiStreamDisplayed;
    requestAiMarkdownRender(aiAnalysisMarkdown);
  }, 16);
};

const stopAiStreamDisplay = () => {
  aiStreamActive = false;
  if (aiStreamTimer) {
    window.clearInterval(aiStreamTimer);
    aiStreamTimer = null;
  }
};

const enqueueAiStreamText = (text) => {
  if (!text) return;
  aiStreamQueue += text;
};

const scheduleAiMarkdownRender = () => {
  if (aiMarkdownRenderTimer) window.clearTimeout(aiMarkdownRenderTimer);
  aiMarkdownRenderTimer = window.setTimeout(() => {
    aiMarkdownRenderTimer = null;
    requestAiMarkdownRender(aiAnalysisMarkdown);
  }, 120);
};

const appendAiAnalysisOutput = (text) => {
  aiAnalysisMarkdown = `${aiAnalysisMarkdown}${text}`;
  if (aiStreamActive) {
    enqueueAiStreamText(text);
    return;
  }
  scheduleAiMarkdownRender();
};

const setSelectionSummaryCollapsed = (collapsed) => {
  if (!selectionSummary) return;
  selectionSummary.classList.toggle("is-collapsed", collapsed);
  if (aiAnalyzeWrap) {
    aiAnalyzeWrap.classList.toggle("is-collapsed", collapsed);
  }
  if (selectionTitle) {
    selectionTitle.textContent = collapsed
      ? aiAnalysisStatus?.textContent || "Selection"
      : "Selection";
  }
};

const setAiInstructionCollapsed = (collapsed) => {
  if (!aiInstructionPanel) return;
  aiInstructionPanel.classList.toggle("is-collapsed", collapsed);
};

const buildAiRequestPayload = () => {
  const { instruction, text, meta } = buildAiPayload();
  return {
    model: aiConfig.model,
    messages: [
      { role: "system", content: instruction },
      {
        role: "user",
        content: `【选中内容】\n${text || "—"}\n\n【元信息】\n${JSON.stringify(meta)}`,
      },
    ],
    temperature:
      aiConfig.temperature === null || aiConfig.temperature === undefined
        ? undefined
        : aiConfig.temperature,
    max_tokens:
      aiConfig.max_tokens === null || aiConfig.max_tokens === undefined
        ? undefined
        : aiConfig.max_tokens,
  };
};

const parseAiResponseText = (data) => {
  const choices = data?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = choices[0]?.message?.content;
    if (message) return message;
    const text = choices[0]?.text;
    if (text) return text;
  }
  const outputText = data?.output_text;
  if (outputText) return outputText;
  const responseText = data?.output?.[0]?.content?.[0]?.text;
  if (responseText) return responseText;
  return "";
};

const parseSseEvents = (buffer) => {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  const events = [];
  chunks.forEach((chunk) => {
    const lines = chunk.split("\n").filter(Boolean);
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) return;
    events.push(dataLines.join("\n"));
  });
  return { events, rest };
};

const runAiAnalysis = async () => {
  if (aiAnalysisInProgress) return;
  if (selections.size === 0) {
    setAiAnalysisStatus("请先选择内容。", true);
    return;
  }
  if (!aiConfig.api_key || !aiConfig.base_url || !aiConfig.model) {
    setAiAnalysisStatus("请先在右上角配置 AI 接口信息。", true);
    return;
  }

  const baseUrl = aiConfig.base_url.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const payload = buildAiRequestPayload();
  if (!payload.messages[1].content.trim()) {
    setAiAnalysisStatus("选中文本为空，无法分析。", true);
    return;
  }

  aiAnalyzeBtn.disabled = true;
  aiAnalysisInProgress = true;
  lastAnalyzedSelectionSignature = getSelectionSignature();
  setAiAnalysisStatus("AI 分析中…");
  aiAnalysisMarkdown = "";
  aiAnalysisOutput.textContent = "—";
  startAiStreamDisplay();
  setSelectionSummaryCollapsed(true);
  setAiInstructionCollapsed(true);

  const body = { ...payload, stream: true };
  if (body.temperature === undefined) delete body.temperature;
  if (body.max_tokens === undefined) delete body.max_tokens;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      setAiAnalysisStatus(`请求失败：${response.status}`, true);
      setAiAnalysisOutput(errText || "—");
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream") && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      aiAnalysisMarkdown = "";
      aiAnalysisOutput.textContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseEvents(buffer);
        buffer = rest;
        events.forEach((eventText) => {
          if (eventText === "[DONE]") return;
          try {
            const data = JSON.parse(eventText);
            const delta = data?.choices?.[0]?.delta?.content;
            if (delta) appendAiAnalysisOutput(delta);
          } catch {
            // ignore
          }
        });
      }
      stopAiStreamDisplay();
      requestAiMarkdownRender(aiAnalysisMarkdown);
      setAiAnalysisStatus("分析完成。");
    } else {
      stopAiStreamDisplay();
      const data = await response.json();
      const text = parseAiResponseText(data);
      setAiAnalysisOutput(text || "—");
      setAiAnalysisStatus("分析完成。");
    }
  } catch (error) {
    stopAiStreamDisplay();
    setAiAnalysisStatus("请求异常，请检查网络或配置。", true);
  } finally {
    aiAnalysisInProgress = false;
    renderSelections();
  }
};

aiInstructionInput.value = settings.aiInstruction;
aiInstructionInput.addEventListener(
  "input",
  debounce(() => {
    settings.aiInstruction = aiInstructionInput.value;
    saveSettings(settings);
  }, 250)
);

aiInstructionToggle.addEventListener("click", () => {
  const isCollapsed = aiInstructionPanel.classList.contains("is-collapsed");
  setAiInstructionCollapsed(!isCollapsed);
});

aiAnalyzeBtn.addEventListener("click", async () => {
  await runAiAnalysis();
});

const setCurrentPage = async (pageNumber, { render = true } = {}) => {
  if (!currentPdf) return;
  const nextPageNumber = clamp(pageNumber, 1, currentPdf.numPages);
  const pageChanged = nextPageNumber !== currentPageNumber;
  currentPageNumber = nextPageNumber;
  pageInput.value = String(currentPageNumber);
  updateDocState({ lastPage: currentPageNumber });
  scheduleSaveLastReadingPage();
  if (!render) return;
  if (settings.mode === "scroll") {
    scrollToPage(currentPageNumber);
  } else {
    if (pageChanged) {
      clearSelections();
      renderSelections();
      clearSearchHighlights();
    }
    await renderSinglePage(currentPdf, currentPageNumber);
  }
  updateHeaderUi();
};

let lastSearchQuery = "";
let lastSearchPage = 0;

const ensurePageRendered = async (pageNumber) => {
  if (settings.mode !== "scroll") return;
  const wrapper = viewer.querySelector(`.page[data-page="${pageNumber}"]`);
  if (!wrapper) return;
  if (wrapper.dataset.rendered === "true") return;
  wrapper.dataset.rendered = "loading";
  try {
    pageObserver?.unobserve(wrapper);
  } catch {
    // ignore
  }
  await renderPage(currentPdf, pageNumber, scrollScale, wrapper);
};

const getBoxesForPage = async (pageNumber) => {
  if (settings.mode === "scroll") {
    await ensurePageRendered(pageNumber);
  }
  const pageEl = viewer.querySelector(`.page[data-page="${pageNumber}"]`);
  if (!pageEl) return [];
  const boxes = Array.from(pageEl.querySelectorAll(".box"));
  boxes.sort(
    (a, b) => Number(a.dataset.index ?? 0) - Number(b.dataset.index ?? 0)
  );
  return boxes;
};

const applySearchState = (boxes, matches, activeIndex) => {
  boxes.forEach((box) => box.classList.remove("is-search", "is-search-active"));
  matches.forEach((match) => {
    for (let i = 0; i < match.length; i += 1) {
      const el = boxes[match.start + i];
      if (el) el.classList.add("is-search");
    }
  });

  const active = matches[activeIndex];
  if (!active) return;
  for (let i = 0; i < active.length; i += 1) {
    const el = boxes[active.start + i];
    if (el) el.classList.add("is-search-active");
  }
  const anchor = boxes[active.start];
  anchor?.scrollIntoView({ block: "center", behavior: "smooth" });
};

const runSearch = async ({ direction = 1, reset = false } = {}) => {
  if (!currentPdf) return;
  const query = normalizeQuery(searchInput.value || "");
  if (!query) {
    clearSearchHighlights();
    return;
  }

  const pageNumber = currentPageNumber;
  const queryChanged = query !== lastSearchQuery || pageNumber !== lastSearchPage;
  if (reset || queryChanged) {
    lastSearchQuery = query;
    lastSearchPage = pageNumber;
    searchMatches = [];
    searchMatchIndex = -1;

    const boxes = await getBoxesForPage(pageNumber);
    const text = boxes.map((box) => box.dataset.char || "").join("");
    let idx = 0;
    while (idx <= text.length) {
      const found = text.indexOf(query, idx);
      if (found === -1) break;
      searchMatches.push({ start: found, length: query.length });
      idx = found + Math.max(1, query.length);
    }
  }

  const boxes = await getBoxesForPage(pageNumber);
  if (searchMatches.length === 0) {
    applySearchState(boxes, [], -1);
    return;
  }

  if (searchMatchIndex === -1) {
    searchMatchIndex = 0;
  } else {
    const nextIndex = (searchMatchIndex + direction) % searchMatches.length;
    searchMatchIndex = nextIndex < 0 ? searchMatches.length - 1 : nextIndex;
  }

  applySearchState(boxes, searchMatches, searchMatchIndex);
};

const updateHeaderUi = debounce(async () => {
  const hasDoc = Boolean(currentPdf);
  const controls = [
    searchInput,
    searchPrevBtn,
    searchNextBtn,
    prevBtn,
    nextBtn,
    pageInput,
    zoomOutBtn,
    zoomInBtn,
    fitWidthBtn,
    modeBtn,
    themeBtn,
    aiConfigBtn,
    aiAnalyzeBtn,
  ];
  controls.forEach((el) => {
    el.disabled =
      !hasDoc &&
      el !== modeBtn &&
      el !== themeBtn &&
      el !== aiConfigBtn;
  });
  if (aiAnalyzeBtn) {
    aiAnalyzeBtn.disabled = !hasDoc || selections.size === 0;
  }

  updateModeButtonWithSettings();
  updateThemeButtonWithSettings();
  updateTauriMinWindowWidth();

  if (!hasDoc) {
    pageTotal.textContent = "—";
    pageInput.value = "";
    zoomLabel.textContent = "—";
    return;
  }

  pageTotal.textContent = String(currentPdf.numPages);
  prevBtn.disabled = currentPageNumber <= 1;
  nextBtn.disabled = currentPageNumber >= currentPdf.numPages;

  const scale =
    settings.scaleMode === "fitWidth"
      ? await computeFitWidthScaleWithSettings(currentPdf, currentPageNumber)
      : settings.manualScale;
  zoomLabel.textContent =
    settings.scaleMode === "fitWidth" ? "适配" : `${Math.round(scale * 100)}%`;

}, 80);

prevBtn.addEventListener("click", async () => {
  await setCurrentPage(currentPageNumber - 1);
});

nextBtn.addEventListener("click", async () => {
  await setCurrentPage(currentPageNumber + 1);
});

pageInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  const value = Number.parseInt(pageInput.value, 10);
  if (!Number.isFinite(value)) return;
  await setCurrentPage(value);
});

searchNextBtn.addEventListener("click", async () => {
  await runSearch({ direction: 1 });
});

searchPrevBtn.addEventListener("click", async () => {
  await runSearch({ direction: -1 });
});

searchInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await runSearch({ direction: event.shiftKey ? -1 : 1 });
});

searchInput.addEventListener(
  "input",
  debounce(() => {
    clearSearchHighlights();
  }, 120)
);

zoomOutBtn.addEventListener("click", async () => {
  settings.scaleMode = "manual";
  settings.manualScale = clamp(settings.manualScale - 0.1, 0.5, 4);
  saveSettings(settings);
  if (!currentPdf) return;
  if (settings.mode === "scroll") {
    await renderScrollDocument(currentPdf);
    scrollToPage(currentPageNumber);
  } else {
    await renderSinglePage(currentPdf, currentPageNumber);
  }
  clearSearchHighlights();
  updateHeaderUi();
});

zoomInBtn.addEventListener("click", async () => {
  settings.scaleMode = "manual";
  settings.manualScale = clamp(settings.manualScale + 0.1, 0.5, 4);
  saveSettings(settings);
  if (!currentPdf) return;
  if (settings.mode === "scroll") {
    await renderScrollDocument(currentPdf);
    scrollToPage(currentPageNumber);
  } else {
    await renderSinglePage(currentPdf, currentPageNumber);
  }
  clearSearchHighlights();
  updateHeaderUi();
});

fitWidthBtn.addEventListener("click", async () => {
  settings.scaleMode = "fitWidth";
  saveSettings(settings);
  if (!currentPdf) return;
  if (settings.mode === "scroll") {
    await renderScrollDocument(currentPdf);
    scrollToPage(currentPageNumber);
  } else {
    await renderSinglePage(currentPdf, currentPageNumber);
  }
  clearSearchHighlights();
  updateHeaderUi();
});

modeBtn.addEventListener("click", async () => {
  settings.mode = settings.mode === "scroll" ? "single" : "scroll";
  saveSettings(settings);
  if (!currentPdf) {
    updateHeaderUi();
    return;
  }
  if (settings.mode === "scroll") {
    await renderScrollDocument(currentPdf);
    scrollToPage(currentPageNumber);
  } else {
    await renderSinglePage(currentPdf, currentPageNumber);
  }
  clearSearchHighlights();
  updateHeaderUi();
});

themeBtn.addEventListener("click", () => {
  const cycle = ["sepia", "light", "dark"];
  const idx = cycle.indexOf(settings.theme);
  settings.theme = cycle[(idx + 1) % cycle.length] ?? "sepia";
  saveSettings(settings);
  applyThemeWithSettings();
  updateHeaderUi();
});

aiConfigBtn.addEventListener("click", () => {
  openAiConfigModal();
});

aiConfigCloseBtn.addEventListener("click", () => {
  closeAiConfigModal();
});

aiConfigCancelBtn.addEventListener("click", () => {
  closeAiConfigModal();
});

aiConfigModal.addEventListener("click", (event) => {
  if (event.target === aiConfigModal) {
    closeAiConfigModal();
  }
});

aiConfigForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nextConfig = readAiConfigForm();
  setAiConfigStatus("保存中…");
  const result = await saveAiConfigToBackend(nextConfig);
  if (!result.ok) {
    setAiConfigStatus(result.reason, true);
    return;
  }
  aiConfig = { ...defaultAiConfig, ...nextConfig };
  applyBoxVisibilityWithSettings();
  setAiConfigStatus(result.local ? "已保存到浏览器本地存储。" : "已保存。");
  closeAiConfigModal();
});

lastOpenCloseBtn.addEventListener("click", () => {
  closeLastOpenModal();
});

lastOpenCancelBtn.addEventListener("click", () => {
  closeLastOpenModal();
});

lastOpenOpenBtn.addEventListener("click", async () => {
  if (lastOpenOpenBtn.disabled) return;
  lastOpenOpenBtn.disabled = true;
  if (lastOpenSpinner) lastOpenSpinner.classList.remove("hidden");
  if (lastOpenLabel) lastOpenLabel.textContent = "打开中…";
  if (pendingLastOpenedPath) {
    await openPdfFromPath(pendingLastOpenedPath);
  }
  closeLastOpenModal();
});

lastOpenModal.addEventListener("click", (event) => {
  if (event.target === lastOpenModal) {
    closeLastOpenModal();
  }
});

viewer.addEventListener(
  "scroll",
  debounce(() => {
    if (!currentPdf) return;
    if (settings.mode !== "scroll") return;
    const pages = Array.from(viewer.querySelectorAll(".page"));
    if (pages.length === 0) return;
    const scrollTop = viewer.scrollTop;
    let bestPage = 1;
    for (const page of pages) {
      const pageTop = page.offsetTop;
      if (pageTop - 24 <= scrollTop) {
        bestPage = Number(page.dataset.page) || bestPage;
      } else {
        break;
      }
    }
    if (bestPage !== currentPageNumber) {
      currentPageNumber = bestPage;
      pageInput.value = String(currentPageNumber);
      updateDocState({ lastPage: currentPageNumber });
      scheduleSaveLastReadingPage();
      updateHeaderUi();
    }
  }, 120)
);

window.addEventListener("keydown", async (event) => {
  if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select?.();
    return;
  }
  if (event.target && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
  if (!currentPdf) return;

  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    await setCurrentPage(currentPageNumber - 1);
    return;
  }
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    await setCurrentPage(currentPageNumber + 1);
    return;
  }
  if (event.key === "f" || event.key === "F") {
    event.preventDefault();
    settings.scaleMode = "fitWidth";
    saveSettings(settings);
    if (settings.mode === "scroll") {
      await renderScrollDocument(currentPdf);
      scrollToPage(currentPageNumber);
    } else {
      await renderSinglePage(currentPdf, currentPageNumber);
    }
    updateHeaderUi();
    return;
  }
  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    modeBtn.click();
    return;
  }
  if (event.key === "t" || event.key === "T") {
    event.preventDefault();
    themeBtn.click();
    return;
  }
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomInBtn.click();
    return;
  }
  if (event.key === "-") {
    event.preventDefault();
    zoomOutBtn.click();
    return;
  }
  if (event.key === "Escape") {
    clearSelections();
    renderSelections();
  }
});

applyThemeWithSettings();
applyBoxVisibilityWithSettings();
resetAppState();
setupHeaderCompact();
loadAiConfigFromBackend();
const bootstrapLastOpened = async () => {
  if (!canUseTauriInvoke()) return;
  const path = await loadLastOpenedPath();
  if (!path) return;
  openLastOpenModal(path);
};
bootstrapLastOpened();
