import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve(".qa");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const consoleErrors = [];

page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
  if (message.type() === "warning") consoleErrors.push(`warning: ${message.text()}`);
});
if (process.env.QA_BLOCK_MODEL === "1") {
  await page.route("https://staticimgly.com/**", (route) => route.fulfill({ status: 404, body: "" }));
}

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(outputDir, "01-initial.png") });

const initial = await page.evaluate(() => ({
  hint: document.querySelector("#emptyHint")?.textContent?.trim(),
  hintOpacity: getComputedStyle(document.querySelector("#emptyHint")).opacity,
  topbarOpacity: getComputedStyle(document.querySelector(".topbar")).opacity,
  actionsOpacity: getComputedStyle(document.querySelector(".topbar-actions")).opacity,
  logoVisible: getComputedStyle(document.querySelector(".wordmark")).pointerEvents,
  visibleActions: [...document.querySelectorAll("#topbar [data-action]")]
    .filter((element) => getComputedStyle(element).display !== "none")
    .map((element) => element.dataset.action),
  topbarActions: [...document.querySelectorAll("#topbar [data-action]")].map(
    (element) => element.dataset.action,
  ),
  items: document.querySelectorAll(".piece").length,
}));

await page.mouse.click(720, 450);
await page.waitForTimeout(300);
const singleClickItemCount = await page.locator(".piece").count();
await page.mouse.dblclick(720, 450);
const typingUi = await page.evaluate(() => {
  const piece = document.querySelector(".piece-text");
  const content = piece?.querySelector(".text-content");
  const rect = piece?.getBoundingClientRect();
  return {
    placeholder: getComputedStyle(content, "::before").content,
    outline: getComputedStyle(content).outlineStyle,
    background: getComputedStyle(content).backgroundColor,
    hasRotateHandle: Boolean(piece.querySelector(".rotate-handle")),
    resizeHandle: getComputedStyle(piece.querySelector(".resize-handle")).display,
    centerOffset: rect
      ? [
          rect.left + rect.width / 2 - innerWidth / 2,
          rect.top + rect.height / 2 - innerHeight / 2,
        ]
      : null,
  };
});
await page.keyboard.type("十月二十七日\n把日常，剪贴成一页。");
await page.keyboard.press("Escape");
const textResizeGap = await page.evaluate(() => {
  const piece = document.querySelector(".piece-text");
  const content = piece?.querySelector(".text-content");
  const handle = piece?.querySelector(".resize-handle");
  const contentRect = content?.getBoundingClientRect();
  const handleRect = handle?.getBoundingClientRect();
  return contentRect && handleRect
    ? {
        pieceWidth: piece.getBoundingClientRect().width,
        contentWidth: contentRect.width,
        gapX: handleRect.left - contentRect.right,
        gapY: handleRect.top - contentRect.bottom,
      }
    : null;
});
await page.locator(".piece-text").click({ button: "right", position: { x: 70, y: 30 } });
const textMenu = await page.evaluate(() => ({
  hasPixel: Boolean(document.querySelector('#contextMenu [data-value="pixel"]')),
  hasFlower: Boolean(document.querySelector('#contextMenu [data-value="script"]')),
  hasEdit: Boolean(document.querySelector('#contextMenu [data-action="edit-text"]')),
  hasInk: Boolean(document.querySelector("#contextMenu .ink-swatch")),
}));
await page.locator('#contextMenu [data-value="pixel"]').click();

await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const context = canvas.getContext("2d");
  context.fillStyle = "#dedbd2";
  context.fillRect(0, 0, 320, 240);
  context.fillStyle = "#b66d50";
  context.beginPath();
  context.ellipse(160, 126, 82, 62, -0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#211c19";
  context.fillRect(134, 104, 52, 44);
  context.fillStyle = "#8b9a77";
  context.fillRect(126, 92, 22, 95);
  context.beginPath();
  context.ellipse(154, 82, 38, 24, 0.7, 0, Math.PI * 2);
  context.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], "autumn-sprig.png", { type: "image/png" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  document.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: 920,
      clientY: 330,
      dataTransfer: transfer,
    }),
  );
});
await page.waitForSelector(".piece-image");
await page.waitForTimeout(500);
const imageChrome = await page.locator(".piece-image .sticker-body").evaluate((element) => {
  const style = getComputedStyle(element);
  return {
    padding: style.padding,
    background: style.backgroundColor,
    shadow: style.boxShadow,
    filter: style.filter,
  };
});
await page.screenshot({ path: path.join(outputDir, "02-composed.png") });

const image = page.locator(".piece-image");
const viewportBeforePan = await page.locator("#itemsLayer").evaluate((element) => element.style.transform);
await page.mouse.move(1110, 760);
await page.mouse.down();
await page.mouse.move(980, 670, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
const viewportAfterPan = await page.locator("#itemsLayer").evaluate((element) => element.style.transform);
const cutoutDownload = page.waitForFunction(
  () => document.querySelector(".piece-image.is-cutout") || document.querySelector("#toast")?.textContent.includes("Could not find"),
  null,
  { timeout: 100000 },
);
await image.click({ button: "right", position: { x: 80, y: 80 } });
await page.locator('#contextMenu [data-action="toggle-cutout"]').click();
await page.waitForTimeout(120);
const cutoutUi = await page.evaluate(() => ({
  processingText: document.querySelector(".piece-image")?.innerText.includes("Removing"),
  toastVisible: document.querySelector("#toast")?.classList.contains("is-visible"),
  toastText: document.querySelector("#toast")?.textContent,
}));
await cutoutDownload;
const cutoutApplied = await page.locator(".piece-image").evaluate((element) =>
  element.classList.contains("is-cutout"),
);
const cutoutAlpha = await page.locator(".piece-image img").evaluate(async (image) => {
  const bitmap = await createImageBitmap(await (await fetch(image.src)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  const center = context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1)
    .data[3];
  const corner = context.getImageData(2, 2, 1, 1).data[3];
  bitmap.close();
  return { center, corner };
});
const cutoutToast = await page.locator("#toast").textContent();
await page.screenshot({ path: path.join(outputDir, "03-cutout.png") });

await image.dblclick({ position: { x: 80, y: 80 } });
const cutoutRestored = await page.locator(".piece-image").evaluate((element) =>
  element.classList.contains("is-whole"),
);
await image.click({ button: "right", position: { x: 80, y: 80 } });
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(outputDir, "04-context.png") });

const contextVisible = await page.locator("#contextMenu").evaluate((element) =>
  element.classList.contains("is-open"),
);
if (contextVisible) {
  await page.locator("#contextMenu").getByRole("button", { name: "Duplicate" }).click();
} else {
  throw new Error("Image context menu did not open.");
}
const imageCountAfterCopy = await page.locator(".piece-image").count();
const resizeUi = await page.evaluate(() => {
  const handle = document.querySelector(".piece-image .resize-handle");
  const style = getComputedStyle(handle);
  return {
    width: style.width,
    height: style.height,
    hasRotateHandle: Boolean(document.querySelector(".rotate-handle")),
  };
});

const downloadPromise = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
await page.getByRole("button", { name: "Export" }).click();
const download = await downloadPromise;
if (download) {
  const downloadPath = path.join(outputDir, "export.png");
  await download.saveAs(downloadPath);
}

const composed = await page.evaluate(() => ({
  text: document.querySelector(".text-content")?.textContent,
  textFont: getComputedStyle(document.querySelector(".text-content")).fontFamily,
  images: document.querySelectorAll(".piece-image").length,
  crop: Boolean(document.querySelector(".sticker-body img")?.src),
  hasObjectToolbar: Boolean(document.querySelector("#objectToolbar")),
  toast: document.querySelector("#toast")?.textContent,
}));
await page.keyboard.press("Shift+Enter");
await page.waitForFunction(
  () =>
    document.querySelector("#pagesCount")?.textContent === "1 page" &&
    document.querySelectorAll(".piece").length === 0,
  null,
  { timeout: 10000 },
);
const archived = await page.evaluate(() => ({
  itemsOnCanvas: document.querySelectorAll(".piece").length,
  pageCount: document.querySelector("#pagesCount")?.textContent,
}));
await page.locator(".wordmark").click();
await page.waitForTimeout(150);
const pagesPanelState = await page.evaluate(() => ({
  open: document.querySelector("#pagesPanel")?.classList.contains("is-visible"),
  count: document.querySelector("#pagesCount")?.textContent,
  storage: document.querySelector("#pagesStorage")?.textContent,
  hasNewPage: Boolean(document.querySelector("#pagesPanel [data-action='new-page']")),
  hasFootnote: Boolean(document.querySelector(".pages-footnote")),
  entries: [...document.querySelectorAll(".page-entry")].map((element) => element.textContent.trim()),
  hasNameInput: Boolean(document.querySelector("#pagesPanel input")),
}));
await page.locator("#pagesPanel [data-action='new-page']").click();
await page.waitForFunction(() => document.querySelectorAll(".piece").length === 0);
const newPageState = await page.evaluate(() => ({
  items: document.querySelectorAll(".piece").length,
  panelOpen: document.querySelector("#pagesPanel")?.classList.contains("is-visible"),
  pageCount: document.querySelector("#pagesCount")?.textContent,
}));
await page.locator(".wordmark").click();
await page.locator(".page-entry").first().click();
await page.waitForFunction(() => document.querySelectorAll(".piece").length === 3);
const reopened = await page.evaluate(() => ({
  items: document.querySelectorAll(".piece").length,
  panelOpen: document.querySelector("#pagesPanel")?.classList.contains("is-visible"),
}));
await page.locator(".piece-text").dblclick({ position: { x: 24, y: 20 } });
await page.keyboard.type(" 已修改");
await page.keyboard.press("Shift+Enter");
await page.waitForFunction(
  () =>
    document.querySelector("#toast")?.textContent.includes("Page 1 saved") &&
    document.querySelector("#pagesCount")?.textContent === "1 page",
  null,
  { timeout: 10000 },
);
const updatedSavedPage = await page.evaluate(() => ({
  pageCount: document.querySelector("#pagesCount")?.textContent,
  itemsOnCanvas: document.querySelectorAll(".piece").length,
  text: document.querySelector(".text-content")?.textContent,
  toast: document.querySelector("#toast")?.textContent,
}));
await page.waitForTimeout(1200);
const stored = await page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open("paper-pieces", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const request = open.result.transaction("boards").objectStore("boards").get("current");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          resolve({
            items: request.result?.items?.length || 0,
            hasText: Boolean(request.result?.items?.some((item) => item.type === "text")),
          });
          open.result.close();
        };
      };
    }),
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const storedAfterReload = await page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open("paper-pieces", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const request = open.result.transaction("boards").objectStore("boards").get("current");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          resolve(request.result?.items?.length || 0);
          open.result.close();
        };
      };
    }),
);
const persistence = await page.evaluate(() => ({
  items: document.querySelectorAll(".piece").length,
  text: document.querySelector(".text-content")?.textContent,
  viewport: document.querySelector("#itemsLayer")?.style.transform,
  pageCount: document.querySelector("#pagesCount")?.textContent,
  storage: document.querySelector("#pagesStorage")?.textContent,
}));

await context.close();
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const mobilePage = await mobileContext.newPage();
await mobilePage.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await mobilePage.mouse.dblclick(195, 420);
await mobilePage.keyboard.type("一页小记");
await mobilePage.keyboard.press("Escape");
await mobilePage.locator(".piece-text").click({ button: "right", position: { x: 45, y: 25 } });
await mobilePage.locator('#contextMenu [data-value="pixel"]').click();
const mobileFileChooserPromise = mobilePage.waitForEvent("filechooser");
await mobilePage.getByRole("button", { name: "Add image", exact: true }).click();
const mobileFileChooser = await mobileFileChooserPromise;
await mobileFileChooser.setFiles({
  name: "mobile-test.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7Wf8AAAAASUVORK5CYII=",
    "base64",
  ),
});
await mobilePage.waitForFunction(() => document.querySelectorAll(".piece-image").length === 1);
await mobilePage.screenshot({ path: path.join(outputDir, "05-mobile.png") });
const mobile = await mobilePage.evaluate(() => {
  const topbar = document.querySelector("#topbar").getBoundingClientRect();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    scrollWidth: document.documentElement.scrollWidth,
    topbar: { left: topbar.left, right: topbar.right },
    topbarActions: [...document.querySelectorAll("#topbar [data-action]")].map(
      (element) => element.dataset.action,
    ),
    hasObjectToolbar: Boolean(document.querySelector("#objectToolbar")),
    itemsBeforeHelpClose: document.querySelectorAll(".piece").length,
  };
});
await mobilePage.getByRole("button", { name: "How to use" }).click();
await mobilePage.mouse.click(18, 340);
const helpClosed = await mobilePage.locator("#app").evaluate((element) => !element.classList.contains("help-open"));
const itemCountAfterHelpClose = await mobilePage.locator(".piece").count();
await mobileContext.close();

console.log(
  JSON.stringify(
    {
      initial,
      singleClickItemCount,
      typingUi,
      textResizeGap,
      textMenu,
      cutoutApplied,
      cutoutAlpha,
      cutoutUi,
      cutoutToast,
      cutoutRestored,
      contextVisible,
      imageChrome,
      resizeUi,
      viewportBeforePan,
      viewportAfterPan,
      imageCountAfterCopy,
      exportDownloaded: Boolean(download),
      composed,
      archived,
      pagesPanelState,
      newPageState,
      reopened,
      updatedSavedPage,
      stored,
      storedAfterReload,
      persistence,
      mobile: { ...mobile, helpClosed, itemCountAfterHelpClose },
      consoleErrors,
    },
    null,
    2,
  ),
);
await browser.close();
