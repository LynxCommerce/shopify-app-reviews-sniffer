import { buildHTMLReport } from "../template/pdf-generator.js";

// ── State ─────────────────────────────────────────────────────────────────────
let currentAppSlug = null;
let currentAppName = null;

// ── Elements ──────────────────────────────────────────────────────────────────
const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
const autoDeleteInput = document.getElementById("autoDeleteInput");
const saveSettingsBtn = document.getElementById("saveSettings");

const addBtn = document.getElementById("addBtn");
const addPanel = document.getElementById("addPanel");
const addAppName = document.getElementById("addAppName");
const keywordInput = document.getElementById("keywordInput");
const startBtn = document.getElementById("startBtn");
const cancelAdd = document.getElementById("cancelAdd");

const processList = document.getElementById("processList");

// ── Tab detection ─────────────────────────────────────────────────────────────
const SYSTEM_PATHS = ["search", "categories", "collections", "partners"];

/**
 * Detects the currently active tab and extracts the Shopify app slug from its URL.
 * If the slug is not one of the system paths, it sets the currentAppSlug state variable.
 * Additionally, it tries to extract the app name from the page's JSON-LD and sets the currentAppName state variable.
 * If the extraction fails, it sets the currentAppName to the formatted slug.
 * Finally, it enables the add button and sets its title to include the app name.
 */
async function detectCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const match = tab.url.match(/apps\.shopify\.com\/([^/?#]+)/);
    if (!match) return;

    const slug = match[1];
    if (SYSTEM_PATHS.includes(slug)) return;

    currentAppSlug = slug;

    // Try to get the real app name from the page's JSON-LD
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const el = document.querySelector('script[type="application/ld+json"]');
            if (el) {
              const data = JSON.parse(el.textContent);
              if (data.name) return data.name;
            }
          } catch {}
          return null;
        },
      });
      currentAppName = result || formatSlug(slug);
    } catch {
      currentAppName = formatSlug(slug);
    }

    addBtn.disabled = false;
    addBtn.title = `Add scrape for ${currentAppName}`;
  } catch {
    // Not on a supported page — add button stays disabled
  }
}

/**
 * Formats a slug by replacing hyphens with spaces and capitalizing the first letter of each word.
 * @param {string} slug The slug to format.
 * @returns {string} The formatted slug.
 */
function formatSlug(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Settings ──────────────────────────────────────────────────────────────────
settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
  addPanel.classList.add("hidden");
});

saveSettingsBtn.addEventListener("click", async () => {
  await send("UPDATE_SETTING", {
    key: "autoDeleteMinutes",
    value: parseInt(autoDeleteInput.value, 10) || 0,
  });
  settingsPanel.classList.add("hidden");
});

async function loadSettings() {
  const { settings } = await send("GET_SETTINGS");
  autoDeleteInput.value = settings.autoDeleteMinutes ?? 5;
}

// ── Add panel ─────────────────────────────────────────────────────────────────
addBtn.addEventListener("click", () => {
  addPanel.classList.toggle("hidden");
  settingsPanel.classList.add("hidden");
  if (!addPanel.classList.contains("hidden")) {
    addAppName.textContent = currentAppName;
    keywordInput.value = "";
    keywordInput.focus();
  }
});

cancelAdd.addEventListener("click", () => {
  addPanel.classList.add("hidden");
});

startBtn.addEventListener("click", async () => {
  if (!currentAppSlug) return;
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";

  await send("START_SCRAPE", {
    appName: currentAppName,
    appSlug: currentAppSlug,
    keyword: keywordInput.value.trim(),
  });

  addPanel.classList.add("hidden");
  startBtn.disabled = false;
  startBtn.textContent = "Start";

  // Immediately show the new process — no waiting for the poll interval
  await loadProcesses();
});

// ── Process list ──────────────────────────────────────────────────────────────
async function loadProcesses() {
  const { processes } = await send("GET_PROCESSES");
  renderProcesses(processes || []);
}

function renderProcesses(processes) {
  if (!processes.length) {
    processList.innerHTML = `<div class="empty-state">Navigate to a Shopify app page and click + to start.</div>`;
    return;
  }

  processList.innerHTML = processes
    .map((p) => {
      const progress = p.totalPages
        ? Math.round((p.currentPage / p.totalPages) * 100)
        : 0;
      const progressWidth = p.status === "done" ? 100 : Math.max(progress, 5);
      const keyword = p.keyword ? `<b>${escHtml(p.keyword)}</b>` : "All reviews";
      const pageInfo = p.totalPages
        ? `Page ${Math.min(p.currentPage, p.totalPages)} / ${p.totalPages}`
        : "Starting…";

      return `
        <div class="process-card ${p.status}" data-id="${p.processId}">
          <div class="process-header">
            <span class="process-name">${escHtml(p.appName)}</span>
            <span class="badge ${p.status}">${p.status === "done" ? "Done" : p.status === "failed" ? "Failed" : "Sniffing..."}</span>
          </div>
          <div class="process-meta">
            <span>Keyword: ${keyword}</span>
            <span>${
              p.status === "done"
                ? `${p.reviewCount} reviews found`
                : `${pageInfo} · ${p.reviewCount} so far`
            }</span>
          </div>
          ${
            p.status === "in_progress"
              ? `<div class="progress-bar-wrap"><div class="progress-bar" style="width:${progressWidth}%"></div></div>`
              : ""
          }
          <div class="process-actions">
            ${
              p.status === "done"
                ? `<div class="export-wrap">
                    <button class="btn btn-export export-toggle" data-id="${p.processId}">Export ▾</button>
                    <div class="export-menu" hidden>
                      <button data-action="export" data-format="pdf" data-id="${p.processId}" title="Cmd/Ctrl+P to print PDF">PDF Report</button>
                      <button data-action="export" data-format="csv" data-id="${p.processId}">CSV</button>
                      <button data-action="export" data-format="json" data-id="${p.processId}">JSON</button>
                    </div>
                  </div>`
                : ""
            }
            <button class="btn btn-danger" data-action="delete" data-id="${p.processId}">Delete</button>
          </div>
        </div>`;
    })
    .join("");

  processList.querySelectorAll(".export-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const isOpen = !menu.hidden;
      // close all open menus first
      processList.querySelectorAll(".export-menu").forEach((m) => (m.hidden = true));
      menu.hidden = isOpen;
    });
  });
  processList.querySelectorAll("[data-action='export']").forEach((btn) => {
    btn.addEventListener("click", () => handleExport(btn.dataset.id, btn.dataset.format));
  });
  processList.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.id));
  });
}

async function handleExport(processId, format) {
  const { processes } = await send("GET_PROCESSES");
  const proc = processes.find((p) => p.processId === processId);
  if (!proc) return;

  const [{ reviews }, { settings }] = await Promise.all([
    send("GET_REVIEWS", { processId }),
    send("GET_SETTINGS"),
  ]);

  const slug = proc.appSlug;
  const data = reviews || [];

  if (format === "json") {
    const payload = JSON.stringify(
      { meta: { appName: proc.appName, appSlug: slug, keyword: proc.keyword || null, exportedAt: new Date().toISOString(), totalReviews: data.length, totalPages: proc.totalPages }, reviews: data.map(({ reviewerName, reviewContent, country, date, stars }) => ({ reviewerName, reviewContent, country, date, stars })) },
      null, 2
    );
    triggerDownload(`${slug}-reviews.json`, payload, "application/json");
  } else if (format === "csv") {
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Reviewer", "Stars", "Country", "Date", "Review"].join(","),
      ...data.map((r) => [escape(r.reviewerName), r.stars, escape(r.country), escape(r.date), escape(r.reviewContent)].join(",")),
    ];
    triggerDownload(`${slug}-reviews.csv`, rows.join("\n"), "text/csv");
  } else {
    // Schedule delete first — opening the tab closes the popup
    if (settings.autoDeleteMinutes > 0) {
      await send("SCHEDULE_DELETE", { processId, minutes: settings.autoDeleteMinutes });
    }
    const html = buildHTMLReport(proc, data);
    const blob = new Blob([html], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    chrome.tabs.create({ url: blobUrl }, (tab) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.addEventListener("load", () => setTimeout(() => window.print(), 300)),
      });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    });
    return; // popup closes after tabs.create — skip the schedule below
  }

  if (settings.autoDeleteMinutes > 0) {
    await send("SCHEDULE_DELETE", { processId, minutes: settings.autoDeleteMinutes });
  }
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function handleDelete(processId) {
  await send("DELETE_PROCESS", { processId });
  loadProcesses();
}

// ── Live updates from background ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (
    ["PROCESS_DONE", "PROCESS_PROGRESS", "PROCESS_DELETED", "PROCESS_FAILED"].includes(
      message.type
    )
  ) {
    loadProcesses();
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Close export menus when clicking outside
document.addEventListener("click", () => {
  processList.querySelectorAll(".export-menu").forEach((m) => (m.hidden = true));
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await detectCurrentTab();
  await loadSettings();
  await loadProcesses();
}

init();
