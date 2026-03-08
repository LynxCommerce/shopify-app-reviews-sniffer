import { generatePDF } from "../template/pdf-generator.js";

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
            <span class="badge ${p.status}">${p.status === "done" ? "Done" : p.status === "failed" ? "Failed" : "Scraping"}</span>
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
                ? `<button class="btn btn-export" data-action="export" data-id="${p.processId}">Export PDF</button>`
                : ""
            }
            <button class="btn btn-danger" data-action="delete" data-id="${p.processId}">Delete</button>
          </div>
        </div>`;
    })
    .join("");

  processList.querySelectorAll("[data-action='export']").forEach((btn) => {
    btn.addEventListener("click", () => handleExport(btn.dataset.id));
  });
  processList.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.id));
  });
}

async function handleExport(processId) {
  const { processes } = await send("GET_PROCESSES");
  const proc = processes.find((p) => p.processId === processId);
  if (!proc) return;

  const { reviews } = await send("GET_REVIEWS", { processId });
  generatePDF(proc, reviews || []);

  const { settings } = await send("GET_SETTINGS");
  if (settings.autoDeleteMinutes > 0) {
    await send("SCHEDULE_DELETE", { processId, minutes: settings.autoDeleteMinutes });
  }

  await loadProcesses();
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

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await detectCurrentTab();
  await loadSettings();
  await loadProcesses();
}

init();
