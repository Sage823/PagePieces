import { toPng } from "html-to-image";
import "./styles.css";

const appEl = document.querySelector("#app");
const board = document.querySelector("#board");
const itemsLayer = document.querySelector("#itemsLayer");
const contextMenu = document.querySelector("#contextMenu");
const undoButton = document.querySelector("#undoButton");
const redoButton = document.querySelector("#redoButton");
const dropCurtain = document.querySelector("#dropCurtain");
const helpPanel = document.querySelector("#helpPanel");
const pagesPanel = document.querySelector("#pagesPanel");
const pagesCount = document.querySelector("#pagesCount");
const pagesList = document.querySelector("#pagesList");
const pagesStorage = document.querySelector("#pagesStorage");
const toastEl = document.querySelector("#toast");
const imageInput = document.querySelector("#imageInput");

const FONTS = {
  pixel: {
    label: "Pixel",
    family: '"DotGothic16", "Zpix", "Courier New", monospace',
    tracking: "0.015em",
  },
  serif: {
    label: "Serif",
    family: '"Noto Serif SC", "Songti SC", STSong, SimSun, serif',
    tracking: "0.045em",
  },
  sans: {
    label: "Sans",
    family: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    tracking: "0.055em",
  },
  times: {
    label: "Times",
    family: '"Times New Roman", "Noto Serif SC", serif',
    tracking: "0.025em",
  },
};

const DEFAULT_INK = "#35322d";
const CUTOUT_VERSION = 2;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_HISTORY = 35;

const state = {
  items: [],
  selectedId: null,
};

const viewport = { x: 0, y: 0 };
let savedPages = [];
let undoStack = [];
let redoStack = [];
let activeSavedPageId = null;
let saveTimer = 0;
let toastTimer = 0;
let dragDepth = 0;
let contextItemId = null;
let databasePromise = null;
let archivingPage = false;
const removeBackgroundPromises = new Map();
const editSnapshots = new WeakMap();
let removeBackgroundModulePromise = null;

init();

async function init() {
  bindTopLevelEvents();
  updateTopbarState();
  navigator.storage?.persist?.()?.catch(() => {});

  try {
    const [saved, pages] = await Promise.all([loadBoard(), loadSavedPages()]);
    savedPages = pages;
    activeSavedPageId =
      saved?.activePageId && pages.some((page) => page.id === saved.activePageId)
        ? saved.activePageId
        : null;
    if (saved?.items?.length && state.items.length === 0) {
      state.items = sanitizeSavedItems(saved.items);
      viewport.x = Number.isFinite(saved.viewport?.x) ? saved.viewport.x : 0;
      viewport.y = Number.isFinite(saved.viewport?.y) ? saved.viewport.y : 0;
      applyViewport();
      renderAll();
      updateTopbarState();
    }
    renderPagesPanel();
  } catch (error) {
    console.warn("Could not restore the previous page.", error);
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function boardPoint(clientX, clientY) {
  const rect = board.getBoundingClientRect();
  return {
    x: clientX - rect.left - viewport.x,
    y: clientY - rect.top - viewport.y,
  };
}

function applyViewport() {
  itemsLayer.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0)`;
  board.style.setProperty("--paper-x", `${viewport.x * 0.18}px`);
  board.style.setProperty("--paper-y", `${viewport.y * 0.18}px`);
}

function topZ() {
  return state.items.reduce((max, item) => Math.max(max, item.z || 0), 0) + 1;
}

function getSelectedItem() {
  return state.items.find((item) => item.id === state.selectedId) || null;
}

function getPieceElement(id) {
  return [...itemsLayer.querySelectorAll(".piece")].find((element) => element.dataset.id === id);
}

function sanitizeSavedItems(items) {
  return items
    .filter((item) => item && (item.type === "text" || item.type === "image"))
    .map((item, index) => ({
      ...item,
      id: item.id || uid(),
      x: Number.isFinite(item.x) ? item.x : 80,
      y: Number.isFinite(item.y) ? item.y : 80,
      w: Number.isFinite(item.w) ? Math.max(40, item.w) : 260,
      h: Number.isFinite(item.h) ? Math.max(40, item.h) : 200,
      rotation: Number.isFinite(item.rotation) ? item.rotation : 0,
      z: Number.isFinite(item.z) ? item.z : index + 1,
      font: item.type === "text" && !FONTS[item.font] ? "serif" : item.font,
      processing: false,
      editing: false,
    }));
}

function capture() {
  return {
    items: state.items.map((item) => ({ ...item, processing: false, editing: false })),
    selectedId: state.selectedId,
  };
}

function applySnapshot(snapshot) {
  state.items = sanitizeSavedItems(snapshot.items);
  state.selectedId = state.items.some((item) => item.id === snapshot.selectedId)
    ? snapshot.selectedId
    : null;
  renderAll();
  scheduleSave();
}

function remember(snapshot = capture()) {
  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
  scheduleSave();
}

function updateUndoButtons() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function undo() {
  finishActiveEditing();
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(capture());
  applySnapshot(previous);
  updateUndoButtons();
  hideContextMenu();
}

function redo() {
  finishActiveEditing();
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(capture());
  applySnapshot(next);
  updateUndoButtons();
  hideContextMenu();
}

function updateTopbarState() {
  appEl.classList.toggle("has-content", state.items.length > 0);
  updateUndoButtons();
}

function renderAll() {
  itemsLayer.replaceChildren();

  for (const item of state.items) {
    const element = createPieceElement(item);
    itemsLayer.append(element);
  }

  syncSelection();
  updateTopbarState();
  hideContextMenu();
}

function createPieceElement(item) {
  const element = document.createElement("article");
  element.className = `piece piece-${item.type}`;
  if (item.type === "image") {
    element.classList.add(item.mode === "cutout" ? "is-cutout" : "is-whole");
  }
  element.dataset.id = item.id;
  element.setAttribute("aria-label", item.type === "image" ? item.name || "Image" : "Text");
  element.tabIndex = 0;
  setPiecePosition(element, item);

  if (item.type === "image") {
    const body = document.createElement("div");
    body.className = "sticker-body";
    const image = document.createElement("img");
    image.alt = item.name || "";
    image.draggable = false;
    image.src = item.mode === "cutout" && item.cutoutSrc ? item.cutoutSrc : item.originalSrc;
    body.append(image);
    element.append(body);
  } else {
    const text = document.createElement("div");
    text.className = "text-content";
    text.dataset.placeholder = "Start typing";
    text.textContent = item.content || "";
    text.setAttribute("spellcheck", "false");
    text.contentEditable = "false";
    element.append(text);
    syncTextStyle(item, element);
  }

  element.append(createPieceControls());
  if (state.selectedId === item.id) element.classList.add("is-selected");
  return element;
}

function createPieceControls() {
  const fragment = document.createDocumentFragment();
  const resize = document.createElement("button");
  resize.className = "resize-handle selection-ui";
  resize.type = "button";
  resize.tabIndex = -1;
  resize.setAttribute("aria-label", "Resize");

  fragment.append(resize);
  return fragment;
}

function setPiecePosition(element, item) {
  element.style.left = `${item.x}px`;
  element.style.top = `${item.y}px`;
  if (item.type === "image") {
    element.style.width = `${item.w}px`;
    element.style.height = `${item.h}px`;
  }
  element.style.transform = `rotate(${item.rotation || 0}deg)`;
  element.style.zIndex = String(item.z || 1);
}

function syncPieceElement(item) {
  const element = getPieceElement(item.id);
  if (!element) return;

  setPiecePosition(element, item);
  element.classList.toggle("is-selected", item.id === state.selectedId);
  element.classList.toggle("is-editing", Boolean(item.editing));

  if (item.type === "image") {
    element.classList.toggle("is-cutout", item.mode === "cutout");
    element.classList.toggle("is-whole", item.mode !== "cutout");
    element.classList.toggle("is-processing", Boolean(item.processing));
    const image = element.querySelector("img");
    const nextSource = item.mode === "cutout" && item.cutoutSrc ? item.cutoutSrc : item.originalSrc;
    if (image && image.getAttribute("src") !== nextSource) image.src = nextSource;
  }

  if (item.type === "text") {
    const content = element.querySelector(".text-content");
    if (content && content.textContent !== (item.content || "") && document.activeElement !== content) {
      content.textContent = item.content || "";
    }
    syncTextStyle(item, element);
  }
}

function syncTextStyle(item, element) {
  const font = FONTS[item.font] || FONTS.serif;
  element.style.setProperty("--text-font", font.family);
  element.style.setProperty("--text-size", `${item.fontSize || 30}px`);
  element.style.setProperty("--text-color", item.color || DEFAULT_INK);
  element.style.setProperty("--text-tracking", font.tracking);
}

function syncSelection() {
  for (const element of itemsLayer.querySelectorAll(".piece")) {
    element.classList.toggle("is-selected", element.dataset.id === state.selectedId);
  }
  if (!state.selectedId) hideContextMenu();
}

function selectItem(id) {
  if (!state.items.some((item) => item.id === id)) return;
  if (state.selectedId !== id) {
    finishActiveEditing(id);
    state.selectedId = id;
    syncSelection();
  }
}

function deselectItem() {
  finishActiveEditing();
  state.selectedId = null;
  syncSelection();
}

function addTextAt(x, y, { centered = false } = {}) {
  const snapshot = capture();
  const width = Math.min(300, Math.max(188, board.clientWidth * 0.3));
  const centerX = board.clientWidth / 2 - viewport.x;
  const left = centered
    ? centerX - width / 2
    : x - 18;
  const top = centered
    ? board.clientHeight / 2 - viewport.y - 23
    : y - 25;
  const item = {
    id: uid(),
    type: "text",
    x: left,
    y: top,
    w: width,
    h: 54,
    rotation: 0,
    z: topZ(),
    content: "",
    font: "serif",
    fontSize: centered ? 24 : 30,
    color: DEFAULT_INK,
  };

  state.items.push(item);
  state.selectedId = item.id;
  remember(snapshot);
  renderAll();
  if (centered) {
    const element = getPieceElement(item.id);
    if (element) {
      item.x = centerX - element.offsetWidth / 2;
      setPiecePosition(element, item);
    }
  }
  beginTextEdit(item);
}

function beginTextEdit(item) {
  if (!item || item.type !== "text") return;
  selectItem(item.id);
  const element = getPieceElement(item.id);
  if (!element) return;

  const content = element.querySelector(".text-content");
  if (!content) return;
  if (item.editing && document.activeElement === content) return;

  item.editing = true;
  element.classList.add("is-editing");
  content.contentEditable = "true";
  editSnapshots.set(element, capture());
  content.focus({ preventScroll: true });

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(content);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function finishActiveEditing(exceptId = null) {
  const editingItem = state.items.find((item) => item.editing && item.id !== exceptId);
  if (!editingItem) return;
  const element = getPieceElement(editingItem.id);
  const content = element?.querySelector(".text-content");
  if (content) content.blur();
}

function handleTextBlur(element, item) {
  if (!item.editing) return;
  const content = element.querySelector(".text-content");
  const nextContent = content?.textContent || "";
  const before = editSnapshots.get(element);
  item.editing = false;
  if (content) content.contentEditable = "false";
  element.classList.remove("is-editing");
  editSnapshots.delete(element);

  if (!nextContent.trim()) {
    const index = state.items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) state.items.splice(index, 1);
    if (state.selectedId === item.id) state.selectedId = null;
    renderAll();
    scheduleSave();
    return;
  }

  item.content = nextContent;
  if (before && JSON.stringify(before.items) !== JSON.stringify(capture().items)) {
    remember(before);
  } else {
    scheduleSave();
  }
}

function deleteSelected() {
  const item = getSelectedItem();
  if (!item) return;
  const snapshot = capture();
  state.items = state.items.filter((entry) => entry.id !== item.id);
  state.selectedId = null;
  remember(snapshot);
  renderAll();
  showToast("Deleted");
}

function duplicateSelected() {
  const item = getSelectedItem();
  if (!item) return;
  const snapshot = capture();
  const copy = {
    ...item,
    id: uid(),
    x: item.x + 22,
    y: item.y + 22,
    z: topZ(),
    processing: false,
    editing: false,
  };
  state.items.push(copy);
  state.selectedId = copy.id;
  remember(snapshot);

  const element = createPieceElement(copy);
  itemsLayer.append(element);
  syncSelection();
  scheduleSave();
}

function setLayer(direction) {
  const item = getSelectedItem();
  if (!item) return;
  const snapshot = capture();
  item.z = direction === "top" ? topZ() : Math.min(0, ...state.items.map((entry) => entry.z || 0)) - 1;
  remember(snapshot);
  syncPieceElement(item);
}

function updateSelectedText(property, value) {
  const item = getSelectedItem();
  if (!item || item.type !== "text") return;
  const snapshot = capture();
  item[property] = value;
  remember(snapshot);
  syncPieceElement(item);
}

async function addImageFiles(fileList, anchor) {
  const files = [...fileList].filter(isSupportedImage);
  if (!files.length) {
    showToast("This image format is not supported");
    return;
  }

  const snapshot = capture();
  const boardRect = board.getBoundingClientRect();
  let added = 0;

  for (const [index, file] of files.entries()) {
    try {
      const { src, width, height } = await readImageFile(file);
      const maxSide = Math.min(380, boardRect.width * 0.53, boardRect.height * 0.62);
      const ratio = Math.min(1, maxSide / Math.max(width, height));
      const w = Math.max(82, width * ratio);
      const h = Math.max(82, height * ratio);
      const stagger = added * 18;
      const item = {
        id: uid(),
        type: "image",
        name: file.name,
        x: (anchor?.x ?? boardRect.width / 2) - w / 2 + stagger,
        y: (anchor?.y ?? boardRect.height / 2) - h / 2 + stagger,
        w,
        h,
        rotation: 0,
        z: topZ() + index,
        mode: "whole",
        originalSrc: src,
        cutoutSrc: "",
        processing: false,
      };
      state.items.push(item);
      state.selectedId = item.id;
      added += 1;
    } catch (error) {
      console.warn(`Could not import ${file.name}.`, error);
      showToast(`Could not open “${file.name}”`);
    }
  }

  if (!added) return;
  remember(snapshot);
  renderAll();
  if (added > 1) showToast(`Added ${added} images`);
}

function isSupportedImage(file) {
  return (
    ALLOWED_IMAGE_TYPES.has(file.type) ||
    /\.(?:jpe?g|png|webp|gif)$/i.test(file.name || "")
  );
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Invalid image"));
      image.onload = () =>
        resolve({
          src: reader.result,
          width: image.naturalWidth || 320,
          height: image.naturalHeight || 240,
        });
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function toggleCutout() {
  const item = getSelectedItem();
  if (!item || item.type !== "image" || item.processing) return;

  if (item.mode === "cutout") {
    const snapshot = capture();
    item.mode = "whole";
    remember(snapshot);
    syncPieceElement(item);
    scheduleSave();
    showToast("Full image restored");
    return;
  }

  if (item.cutoutSrc && item.cutoutVersion === CUTOUT_VERSION) {
    const snapshot = capture();
    item.mode = "cutout";
    remember(snapshot);
    syncPieceElement(item);
    scheduleSave();
    showToast("Subject restored");
    return;
  }

  const snapshot = capture();
  item.processing = true;
  syncPieceElement(item);

  try {
    const result = await extractForeground(item.originalSrc);
    item.cutoutSrc = result.src;
    item.cutoutVersion = CUTOUT_VERSION;
    item.mode = "cutout";
    item.processing = false;
    remember(snapshot);
    syncPieceElement(item);
    scheduleSave();
  } catch (error) {
    console.error("Background removal failed.", error);
    item.processing = false;
    syncPieceElement(item);
    showToast("Could not find a subject. The original image was kept.", 3200);
  }
}

async function extractForeground(src) {
  try {
    const maskBlob = await withTimeout(
      withRemoveBackground(src),
      90000,
      new Error("The matting model took too long to load."),
    );
    return { src: await refineCutout(src, maskBlob), fallback: false };
  } catch (error) {
    console.warn("The neural matting model was unavailable; using the local edge fallback.", error);
    return { src: await localBackgroundRemoval(src), fallback: true };
  }
}

function withTimeout(promise, duration, timeoutError) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(timeoutError), duration);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function withRemoveBackground(src) {
  if (!removeBackgroundPromises.has(src)) {
    if (!removeBackgroundModulePromise) {
      removeBackgroundModulePromise = import("@imgly/background-removal").catch((error) => {
        removeBackgroundModulePromise = null;
        throw error;
      });
    }
    const pending = removeBackgroundModulePromise
      .then(({ segmentForeground }) =>
        segmentForeground(src, {
          device: "cpu",
          model: "isnet",
          rescale: true,
          output: {
            format: "image/png",
            quality: 1,
          },
        }),
      )
      .finally(() => removeBackgroundPromises.delete(src));
    removeBackgroundPromises.set(src, pending);
  }
  return removeBackgroundPromises.get(src);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function refineCutout(src, maskBlob) {
  const maskUrl = await blobToDataUrl(maskBlob);
  const [image, maskImage] = await Promise.all([loadImage(src), loadImage(maskUrl)]);
  const maxSide = 2000;
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d", { willReadFrequently: true });
  outputContext.drawImage(image, 0, 0, width, height);
  const imageData = outputContext.getImageData(0, 0, width, height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  maskContext.drawImage(maskImage, 0, 0, width, height);
  const maskData = maskContext.getImageData(0, 0, width, height).data;

  const pixelCount = width * height;
  const outside = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const backgroundCutoff = 74;

  const addSeed = (x, y) => {
    const index = y * width + x;
    if (outside[index] || maskData[index * 4 + 3] >= 96) return;
    outside[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    addSeed(x, 0);
    addSeed(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    addSeed(0, y);
    addSeed(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];
    for (const next of neighbors) {
      if (next < 0 || outside[next]) continue;
      if (maskData[next * 4 + 3] < backgroundCutoff) {
        outside[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  for (let index = 0; index < pixelCount; index += 1) {
    if (outside[index]) {
      imageData.data[index * 4 + 3] = 0;
      continue;
    }

    const maskAlpha = maskData[index * 4 + 3];
    const refinedAlpha =
      maskAlpha < 16 ? 255 : Math.round(255 * Math.pow(maskAlpha / 255, 0.84));
    imageData.data[index * 4 + 3] = refinedAlpha;
  }

  outputContext.putImageData(imageData, 0, 0);
  return output.toDataURL("image/png");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function localBackgroundRemoval(src) {
  const image = await loadImage(src);
  const maxSide = 1000;
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const samples = [];
  const borderStep = Math.max(1, Math.floor(Math.max(width, height) / 90));

  for (let x = 0; x < width; x += borderStep) {
    samples.push(readRgb(data, x, 0, width));
    samples.push(readRgb(data, x, height - 1, width));
  }
  for (let y = 0; y < height; y += borderStep) {
    samples.push(readRgb(data, 0, y, width));
    samples.push(readRgb(data, width - 1, y, width));
  }

  const background = samples
    .reduce(
      (sum, color) => {
        sum[0] += color[0];
        sum[1] += color[1];
        sum[2] += color[2];
        return sum;
      },
      [0, 0, 0],
    )
    .map((sum) => sum / samples.length);

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const tolerance = 48;

  const addSeed = (x, y) => {
    const index = y * width + x;
    if (visited[index]) return;
    if (colorDistance(readRgb(data, x, y, width), background) < tolerance + 18) {
      visited[index] = 1;
      queue[tail++] = index;
    }
  };

  for (let x = 0; x < width; x += 1) {
    addSeed(x, 0);
    addSeed(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    addSeed(0, y);
    addSeed(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * 4 + 3] = 0;

    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];
    for (const next of neighbors) {
      if (next < 0 || visited[next]) continue;
      const nx = next % width;
      const ny = Math.floor(next / width);
      if (colorDistance(readRgb(data, nx, ny, width), background) < tolerance) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function readRgb(data, x, y, width) {
  const index = (y * width + x) * 4;
  return [data[index], data[index + 1], data[index + 2]];
}

function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function showContextMenu(event, item) {
  event.preventDefault();
  event.stopPropagation();
  selectItem(item.id);
  contextItemId = item.id;

  let actions;
  if (item.type === "text") {
    const fontButtons = Object.entries(FONTS)
      .map(
        ([key, font]) =>
          `<button class="context-font ${item.font === key ? "is-active" : ""}" type="button" data-action="font" data-value="${key}">${font.label}</button>`,
      )
      .join("");
    actions = `
      <div class="context-fonts-label">Font</div>
      <div class="context-fonts">${fontButtons}</div>
      <div class="menu-separator"></div>
      <button type="button" data-action="duplicate"><span>Duplicate</span><span class="menu-shortcut">⌘ D</span></button>
      <button type="button" data-action="layer-top"><span>Bring to front</span></button>
      <button type="button" data-action="layer-bottom"><span>Send to back</span></button>
      <div class="menu-separator"></div>
      <button class="danger" type="button" data-action="delete"><span>Delete</span><span class="menu-shortcut">DEL</span></button>
    `;
  } else {
    actions = `
      <button type="button" data-action="toggle-cutout"><span>${item.mode === "cutout" ? "Restore full image" : "Remove background"}</span><span class="menu-shortcut">DOUBLE CLICK</span></button>
      <button type="button" data-action="duplicate"><span>Duplicate</span><span class="menu-shortcut">⌘ D</span></button>
      <button type="button" data-action="layer-top"><span>Bring to front</span></button>
      <button type="button" data-action="layer-bottom"><span>Send to back</span></button>
      <div class="menu-separator"></div>
      <button class="danger" type="button" data-action="delete"><span>Delete</span><span class="menu-shortcut">DEL</span></button>
    `;
  }

  contextMenu.innerHTML = actions;
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.add("is-open");
  contextMenu.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    const rect = contextMenu.getBoundingClientRect();
    const left = clamp(event.clientX, 8, window.innerWidth - rect.width - 8);
    const top = clamp(event.clientY, 8, window.innerHeight - rect.height - 8);
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
  });
}

function hideContextMenu() {
  contextItemId = null;
  contextMenu.classList.remove("is-open");
  contextMenu.setAttribute("aria-hidden", "true");
}

function startPan(event) {
  const start = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    viewportX: viewport.x,
    viewportY: viewport.y,
    moved: false,
  };
  board.classList.add("is-panning");

  const move = (moveEvent) => {
    const dx = moveEvent.clientX - start.pointerX;
    const dy = moveEvent.clientY - start.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 2) start.moved = true;
    viewport.x = start.viewportX + dx;
    viewport.y = start.viewportY + dy;
    applyViewport();
  };

  const end = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    board.classList.remove("is-panning");
    if (start.moved) scheduleSave();
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end, { once: true });
  document.addEventListener("pointercancel", end, { once: true });
}

function startDrag(event, item) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
  selectItem(item.id);

  const element = getPieceElement(item.id);
  if (!element) return;
  const start = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    x: item.x,
    y: item.y,
    snapshot: capture(),
    moved: false,
  };

  const move = (moveEvent) => {
    const dx = moveEvent.clientX - start.pointerX;
    const dy = moveEvent.clientY - start.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 1) start.moved = true;
    item.x = start.x + dx;
    item.y = start.y + dy;
    setPiecePosition(element, item);
  };

  const end = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    if (start.moved) remember(start.snapshot);
    scheduleSave();
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end, { once: true });
  document.addEventListener("pointercancel", end, { once: true });
}

function startResize(event, item) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
  selectItem(item.id);

  const element = getPieceElement(item.id);
  if (!element) return;
  const start = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    w: item.type === "text" ? element.offsetWidth : item.w,
    h: item.h || 30,
    fontSize: item.fontSize || 30,
    snapshot: capture(),
    moved: false,
  };

  const move = (moveEvent) => {
    const dx = moveEvent.clientX - start.pointerX;
    const dy = moveEvent.clientY - start.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 1) start.moved = true;
    const basis = item.type === "image" ? Math.min(start.w, start.h) : start.w;
    const directional = Math.max(dx, dy * 0.82);
    const ratio = clamp(1 + directional / Math.max(48, basis), 0.24, 4.5);

    if (item.type === "image") {
      item.w = Math.min(start.w * ratio, board.clientWidth * 1.25);
      item.h = start.h * (item.w / start.w);
    } else {
      item.fontSize = clamp(Math.round(start.fontSize * ratio), 10, 180);
    }
    syncPieceElement(item);
  };

  const end = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    if (start.moved) remember(start.snapshot);
    scheduleSave();
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end, { once: true });
  document.addEventListener("pointercancel", end, { once: true });
}

function showToast(message, duration = 2300) {
  window.clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toastEl.classList.remove("is-visible"), duration);
}

function setHelp(open) {
  if (open) {
    setPagesPanel(false);
    finishActiveEditing();
    hideContextMenu();
  }
  appEl.classList.toggle("help-open", open);
  helpPanel.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    requestAnimationFrame(() => helpPanel.querySelector(".panel-close")?.focus());
  }
}

async function exportPage() {
  if (!state.items.length) return;
  finishActiveEditing();
  state.selectedId = null;
  syncSelection();
  itemsLayer.classList.add("is-exporting");
  showToast("Preparing your page…", 6000);

  try {
    await document.fonts.ready;
    const width = board.clientWidth;
    const height = board.clientHeight;
    const dataUrl = await toPng(board, {
      cacheBust: true,
      width,
      height,
      pixelRatio: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
      backgroundColor: "#f2efe7",
      skipFonts: true,
      style: {
        width: `${width}px`,
        height: `${height}px`,
      },
    });
    const link = document.createElement("a");
    const date = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll("/", "-");
    link.download = `Paper-Pieces-${date}.png`;
    link.href = dataUrl;
    link.click();
    showToast("Your page is ready");
  } catch (error) {
    console.error("Export failed.", error);
    showToast("Export failed. Please try again.");
  } finally {
    itemsLayer.classList.remove("is-exporting");
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveBoard, 450);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("paper-pieces", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("boards")) {
        database.createObjectStore("boards", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getDatabase() {
  if (!databasePromise) databasePromise = openDatabase();
  return databasePromise;
}

async function saveBoard() {
  try {
    const database = await getDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("boards", "readwrite");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore("boards").put({
        key: "current",
        updatedAt: Date.now(),
        items: state.items.map((item) => ({ ...item, processing: false, editing: false })),
        viewport: { ...viewport },
        activePageId: activeSavedPageId,
      });
    });
    if (appEl.classList.contains("pages-open")) updateStorageUsage();
  } catch (error) {
    console.warn("Autosave is unavailable.", error);
  }
}

async function loadBoard() {
  const database = await getDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("boards", "readonly").objectStore("boards").get("current");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function loadSavedPages() {
  const database = await getDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("boards", "readonly").objectStore("boards").getAll();
    request.onsuccess = () => {
      const pages = (request.result || [])
        .filter((record) => record.key?.startsWith("page:") && record.items?.length)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      resolve(pages);
    };
    request.onerror = () => reject(request.error);
  });
}

async function savePageRecord(page) {
  const database = await getDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("boards", "readwrite");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore("boards").put(page);
  });
}

function renderPagesPanel() {
  pagesCount.textContent = pageCountLabel(savedPages.length);
  updateStorageUsage();
  pagesList.replaceChildren();

  if (!savedPages.length) {
    const empty = document.createElement("p");
    empty.className = "pages-empty";
    empty.textContent = "No saved pages yet.";
    pagesList.append(empty);
    return;
  }

  savedPages.forEach((page, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-entry";
    button.dataset.action = "open-page";
    button.dataset.value = page.id;
    button.setAttribute("aria-label", `Open page ${index + 1}`);

    const number = document.createElement("span");
    number.className = "page-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("span");
    copy.className = "page-copy";
    const textItem = page.items.find((item) => item.type === "text" && item.content?.trim());
    copy.textContent = textItem
      ? textItem.content.replace(/\s+/g, " ").trim().slice(0, 20)
      : `${page.items.filter((item) => item.type === "image").length} ${
          page.items.filter((item) => item.type === "image").length === 1 ? "image" : "images"
        }`;

    const arrow = document.createElement("span");
    arrow.className = "page-arrow";
    arrow.textContent = "↗";

    button.append(number, copy, arrow);
    pagesList.append(button);
  });

  requestAnimationFrame(() => {
    pagesList.scrollTop = pagesList.scrollHeight;
  });
}

function pageCountLabel(count) {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

async function updateStorageUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.usage) {
      pagesStorage.textContent = "Unavailable";
      return;
    }
    pagesStorage.textContent = formatStorageSize(estimate.usage);
  } catch {
    pagesStorage.textContent = "Unavailable";
  }
}

function formatStorageSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function setPagesPanel(open) {
  if (open) {
    setHelp(false);
    hideContextMenu();
  }
  pagesPanel.classList.toggle("is-visible", open);
  pagesPanel.setAttribute("aria-hidden", open ? "false" : "true");
  appEl.classList.toggle("pages-open", open);
  document.querySelector(".wordmark")?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) updateStorageUsage();
}

async function saveCurrentPage() {
  if (archivingPage) return;
  finishActiveEditing();
  if (!state.items.length) {
    showToast("Add something to the page first");
    return;
  }

  archivingPage = true;
  const existingIndex = activeSavedPageId
    ? savedPages.findIndex((page) => page.id === activeSavedPageId)
    : -1;
  const existingPage = existingIndex >= 0 ? savedPages[existingIndex] : null;
  const id = existingPage?.id || uid();
  const page = {
    ...existingPage,
    key: `page:${id}`,
    id,
    createdAt: existingPage?.createdAt || Date.now(),
    updatedAt: Date.now(),
    items: state.items.map((item) => ({ ...item, processing: false, editing: false })),
    viewport: { ...viewport },
  };

  try {
    await savePageRecord(page);
    if (existingIndex >= 0) {
      savedPages[existingIndex] = page;
      renderPagesPanel();
      scheduleSave();
      showToast(`Page ${existingIndex + 1} saved`);
      return;
    }

    savedPages.push(page);
    savedPages.sort((a, b) => a.createdAt - b.createdAt);
    activeSavedPageId = null;
    renderPagesPanel();

    state.items = [];
    state.selectedId = null;
    undoStack = [];
    redoStack = [];
    viewport.x = 0;
    viewport.y = 0;
    applyViewport();
    renderAll();
    updateUndoButtons();
    scheduleSave();
    setPagesPanel(false);
    showToast(`Page ${savedPages.length} saved. Starting a new page.`);
  } catch (error) {
    console.error("Could not save the page.", error);
    showToast("Could not save this page. Please try again.");
  } finally {
    archivingPage = false;
  }
}

function openSavedPage(id) {
  const pageIndex = savedPages.findIndex((page) => page.id === id);
  const page = savedPages[pageIndex];
  if (!page) return;

  activeSavedPageId = id;
  state.items = sanitizeSavedItems(page.items);
  state.selectedId = null;
  undoStack = [];
  redoStack = [];
  viewport.x = Number.isFinite(page.viewport?.x) ? page.viewport.x : 0;
  viewport.y = Number.isFinite(page.viewport?.y) ? page.viewport.y : 0;
  applyViewport();
  renderAll();
  updateUndoButtons();
  scheduleSave();
  setPagesPanel(false);
  showToast(`Opened page ${pageIndex + 1}`);
}

function openNewPage() {
  activeSavedPageId = null;
  state.items = [];
  state.selectedId = null;
  undoStack = [];
  redoStack = [];
  viewport.x = 0;
  viewport.y = 0;
  applyViewport();
  renderAll();
  updateUndoButtons();
  scheduleSave();
  setPagesPanel(false);
  showToast("New page");
}

function handleAction(action, value, sourceButton) {
  switch (action) {
    case "import":
      setPagesPanel(false);
      imageInput.click();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "help":
      setHelp(!appEl.classList.contains("help-open"));
      break;
    case "close-help":
      setHelp(false);
      break;
    case "export":
      exportPage();
      break;
    case "pages":
      setPagesPanel(!appEl.classList.contains("pages-open"));
      break;
    case "open-page":
      openSavedPage(value);
      break;
    case "new-page":
      openNewPage();
      break;
    case "font":
      updateSelectedText("font", value);
      hideContextMenu();
      break;
    case "toggle-cutout": {
      const item = state.items.find((entry) => entry.id === (contextItemId || state.selectedId));
      hideContextMenu();
      if (item) {
        state.selectedId = item.id;
        syncSelection();
        toggleCutout();
      }
      break;
    }
    case "duplicate":
      hideContextMenu();
      duplicateSelected();
      break;
    case "layer-top":
      hideContextMenu();
      setLayer("top");
      break;
    case "layer-bottom":
      hideContextMenu();
      setLayer("bottom");
      break;
    case "delete":
      hideContextMenu();
      deleteSelected();
      break;
    default:
      break;
  }

  if (sourceButton) sourceButton.blur();
}

function bindTopLevelEvents() {
  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) {
      event.preventDefault();
      handleAction(actionTarget.dataset.action, actionTarget.dataset.value, actionTarget);
      return;
    }

    if (!event.target.closest("#contextMenu")) hideContextMenu();
    if (
      appEl.classList.contains("pages-open") &&
      !event.target.closest("#pagesPanel") &&
      !event.target.closest(".topbar")
    ) {
      setPagesPanel(false);
    }
    if (appEl.classList.contains("help-open") && !event.target.closest("#helpPanel")) setHelp(false);
  });

  board.addEventListener("click", (event) => {
    if (event.button !== 0 || event.target.closest(".piece")) return;
    if (appEl.classList.contains("pages-open")) return;
    if (appEl.classList.contains("help-open")) {
      setHelp(false);
      return;
    }
    hideContextMenu();
  });

  board.addEventListener("dblclick", (event) => {
    if (event.button !== 0 || event.target.closest(".piece")) return;
    if (appEl.classList.contains("pages-open")) {
      setPagesPanel(false);
      return;
    }
    if (appEl.classList.contains("help-open")) return;
    const point = state.items.length
      ? boardPoint(event.clientX, event.clientY)
      : { x: board.clientWidth / 2, y: board.clientHeight / 2 };
    addTextAt(point.x, point.y, { centered: state.items.length === 0 });
  });

  board.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (appEl.classList.contains("pages-open")) return;
    if (appEl.classList.contains("help-open")) {
      event.preventDefault();
      return;
    }
    const piece = event.target.closest(".piece");
    if (piece) return;
    if (event.target.closest(".text-content")) return;
    const wasEditing = Boolean(document.activeElement?.isContentEditable);
    const hadSelection = Boolean(state.selectedId);
    if (wasEditing) document.activeElement.blur();
    if (hadSelection) deselectItem();
    hideContextMenu();
    startPan(event);
  });

  itemsLayer.addEventListener("pointerdown", (event) => {
    const piece = event.target.closest(".piece");
    if (!piece) return;
    const item = state.items.find((entry) => entry.id === piece.dataset.id);
    if (!item) return;

    if (event.target.closest(".resize-handle")) {
      startResize(event, item);
      return;
    }
    if (item.type === "text" && event.target.closest(".text-content") && item.editing) {
      return;
    }
    startDrag(event, item);
  });

  itemsLayer.addEventListener("dblclick", (event) => {
    const piece = event.target.closest(".piece");
    if (!piece) return;
    const item = state.items.find((entry) => entry.id === piece.dataset.id);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    if (item.type === "text") {
      beginTextEdit(item);
    } else {
      state.selectedId = item.id;
      syncSelection();
      toggleCutout();
    }
  });

  itemsLayer.addEventListener("contextmenu", (event) => {
    const piece = event.target.closest(".piece");
    if (!piece) return;
    const item = state.items.find((entry) => entry.id === piece.dataset.id);
    if (item) showContextMenu(event, item);
  });

  itemsLayer.addEventListener("focusin", (event) => {
    const content = event.target.closest(".text-content");
    if (!content) return;
    const piece = content.closest(".piece");
    const item = state.items.find((entry) => entry.id === piece?.dataset.id);
    if (item && !item.editing) beginTextEdit(item);
  });

  itemsLayer.addEventListener("input", (event) => {
    const content = event.target.closest(".text-content");
    if (!content) return;
    const piece = content.closest(".piece");
    const item = state.items.find((entry) => entry.id === piece?.dataset.id);
    if (!item) return;
    item.content = content.textContent || "";
    scheduleSave();
  });

  itemsLayer.addEventListener(
    "blur",
    (event) => {
      const content = event.target.closest(".text-content");
      if (!content) return;
      const piece = content.closest(".piece");
      const item = state.items.find((entry) => entry.id === piece?.dataset.id);
      if (item) handleTextBlur(piece, item);
    },
    true,
  );

  itemsLayer.addEventListener("paste", (event) => {
    if (!event.target.closest(".text-content")) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  });

  document.addEventListener("keydown", handleKeyboard);

  imageInput.addEventListener("change", () => {
    if (imageInput.files?.length) {
      const rect = board.getBoundingClientRect();
      addImageFiles(
        imageInput.files,
        boardPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
      );
    }
    imageInput.value = "";
  });

  document.addEventListener("dragenter", (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropCurtain.classList.add("is-visible");
  });

  document.addEventListener("dragover", (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  document.addEventListener("dragleave", (event) => {
    if (!hasFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropCurtain.classList.remove("is-visible");
  });

  document.addEventListener("drop", (event) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropCurtain.classList.remove("is-visible");
    const point = boardPoint(event.clientX, event.clientY);
    addImageFiles(event.dataTransfer.files, point);
  });

  document.addEventListener("paste", (event) => {
    if (event.target.closest?.(".text-content")) return;
    const files = [...(event.clipboardData?.files || [])].filter((file) =>
      isSupportedImage(file),
    );
    if (!files.length) return;
    event.preventDefault();
    const rect = board.getBoundingClientRect();
    addImageFiles(files, boardPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  });

  helpPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
  pagesPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
  helpPanel.addEventListener("click", (event) => {
    if (event.target === helpPanel) setHelp(false);
  });

  window.addEventListener("resize", () => {
    hideContextMenu();
    for (const item of state.items) {
      syncPieceElement(item);
    }
  });
}

function hasFileDrag(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

function handleKeyboard(event) {
  const editing = Boolean(document.activeElement?.isContentEditable);
  const modifier = event.metaKey || event.ctrlKey;

  if (event.key === "Escape") {
    if (appEl.classList.contains("help-open")) {
      setHelp(false);
      return;
    }
    if (contextMenu.classList.contains("is-open")) {
      hideContextMenu();
      return;
    }
    if (appEl.classList.contains("pages-open")) {
      setPagesPanel(false);
      return;
    }
    if (editing) {
      document.activeElement.blur();
      return;
    }
    deselectItem();
    return;
  }

  if (event.key === "Enter" && event.shiftKey && !event.isComposing) {
    event.preventDefault();
    saveCurrentPage();
    return;
  }

  if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    exportPage();
    return;
  }

  if (editing) return;

  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (modifier && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateSelected();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (!state.selectedId) return;
    event.preventDefault();
    deleteSelected();
    return;
  }

  const item = getSelectedItem();
  if (!item) return;
  const movement = event.shiftKey ? 10 : 1;
  const directions = {
    ArrowLeft: [-movement, 0],
    ArrowRight: [movement, 0],
    ArrowUp: [0, -movement],
    ArrowDown: [0, movement],
  };
  if (directions[event.key]) {
    event.preventDefault();
    item.x += directions[event.key][0];
    item.y += directions[event.key][1];
    syncPieceElement(item);
    scheduleSave();
  }
}
