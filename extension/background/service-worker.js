import { saveProcess, getProcess, getAllProcesses, deleteProcess, saveReviews, getReviewsByProcess } from "./db.js";

const activeScrapers = new Set();
const REQUEST_INTERVAL = 1000 ; // 1 request per second
let lastRequestTime = 0;

// ── Alarm keepalive ───────────────────────────────────────────────────────────
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "keepalive") {
    const processes = await getAllProcesses();
    // Recover an orphaned in_progress runner (SW restart mid-scrape)
    const orphan = processes.find(p => p.status === "in_progress" && !activeScrapers.has(p.processId));
    if (orphan) { runScrapingLoop(orphan.processId); return; }
    // Otherwise promote the next queued item if nothing is running
    await startNextQueued();
    return;
  }

  if (alarm.name.startsWith("delete-")) {
    const processId = alarm.name.replace("delete-", "");
    await deleteProcess(processId);
    notifyPopup({ type: "PROCESS_DELETED", processId });
  }
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true;
});

/**
 * Handles incoming messages from the popup.
 *
 * Supported message types:
 * - "START_SCRAPE": Start a new scraping process.
 * - "GET_PROCESSES": Get all processes.
 * - "GET_REVIEWS": Get all reviews for a given process.
 * - "DELETE_PROCESS": Delete a process.
 * - "SCHEDULE_DELETE": Schedule a process for deletion.
 * - "UPDATE_SETTING": Update a setting.
 * - "GET_SETTINGS": Get all settings.
 *
 * @param {object} message - The incoming message.
 * @returns {Promise<object>} A response object or an error message.
 */
async function handleMessage(message) {
  switch (message.type) {
    case "START_SCRAPE": {
      const { appName, appSlug, keyword } = message;

      const existing = await getAllProcesses();
      const dupe = existing.find(
        (p) =>
          p.appSlug === appSlug &&
          p.keyword === keyword &&
          (p.status === "in_progress" || p.status === "waiting" || p.status === "done")
      );
      if (dupe) return { processId: dupe.processId, alreadyExists: true };

      // activeScrapers covers 429-paused processes (DB shows "waiting" but still running in memory)
      // DB check covers SW restart (activeScrapers cleared but a process is still "in_progress" in DB)
      const hasActive = activeScrapers.size > 0 || existing.some(p => p.status === "in_progress");
      const processId = `${appSlug}-${Date.now()}`;
      const process = {
        processId,
        appName,
        appSlug,
        keyword,
        status: hasActive ? "waiting" : "in_progress",
        currentPage: 1,
        totalPages: null,
        reviewCount: 0,
        createdAt: Date.now(),
        completedAt: null,
      };
      await saveProcess(process);
      if (!hasActive) runScrapingLoop(processId);
      return { processId };
    }

    case "GET_PROCESSES": {
      const processes = await getAllProcesses();
      return { processes: processes.sort((a, b) => b.createdAt - a.createdAt) };
    }

    case "GET_REVIEWS":
      return { reviews: await getReviewsByProcess(message.processId) };

    case "DELETE_PROCESS":
      await deleteProcess(message.processId);
      return { ok: true };

    case "SCHEDULE_DELETE": {
      const { processId, minutes } = message;
      if (minutes > 0) {
        chrome.alarms.create(`delete-${processId}`, { delayInMinutes: minutes });
      }
      return { ok: true };
    }

    case "UPDATE_SETTING":
      await chrome.storage.sync.set({ [message.key]: message.value });
      return { ok: true };

    case "GET_SETTINGS": {
      const settings = await chrome.storage.sync.get({ autoDeleteMinutes: 5 });
      return { settings };
    }

    case "REPLAY_PROCESS": {
      const proc = await getProcess(message.processId);
      if (!proc) return { error: "Not found" };
      proc.status = "waiting";
      proc.currentPage = 1;
      proc.reviewCount = 0;
      proc.totalPages = null;
      proc.completedAt = null;
      await saveProcess(proc);
      await startNextQueued();
      return { ok: true };
    }

    default:
      return { error: "Unknown message type" };
  }
}

/**
 * Run a scraping loop for a given process ID. Will run indefinitely until
 * the process is marked as done or failed.
 *
 * Will fetch and parse pages via an offscreen document, apply a keyword filter
 * to the resulting reviews, and save the filtered reviews to the database.
 * Will also update the process metadata and notify the popup of progress.
 *
 * @param {string} processId - The process ID to run the scraping loop for.
 */
async function runScrapingLoop(processId) {
  if (activeScrapers.has(processId)) return;
  activeScrapers.add(processId);

  try {
    let proc = await getProcess(processId);
    if (!proc || (proc.status !== "in_progress" && proc.status !== "waiting")) return;
    // SW restarted during a wait — reset to in_progress and resume
    if (proc.status === "waiting") {
      proc.status = "in_progress";
      await saveProcess(proc);
    }

    while (true) {
      proc = await getProcess(processId);
      if (!proc || proc.status !== "in_progress") break;

      // Fetch and parse via offscreen document (full browser DOM context)
      let pageData;
      let retries = 0;
      while (retries < 3) {
        try {
          pageData = await rateLimitedFetch(proc.appSlug, proc.currentPage);
          break;
        } catch (err) {
          if (err.message.includes("429")) {
            // Rate limited — back off silently, stay in_progress visually
            lastRequestTime = Date.now() + 60000;
            await sleep(60000);
          } else {
            retries++;
            if (retries >= 3) {
              proc.status = "failed";
              await saveProcess(proc);
              notifyPopup({ type: "PROCESS_FAILED", processId, reason: err.message });
              return;
            }
            await sleep(5000 * retries);
          }
        }
      }

      if (!proc.totalPages) {
        proc.totalPages = pageData.totalPages;
      }

      // Apply keyword filter and attach process metadata
      const kw = proc.keyword.toLowerCase();
      const newReviews = pageData.reviews
        .filter((r) => !kw || r.reviewContent.toLowerCase().includes(kw))
        .map((r) => ({ ...r, processId, scrapedAt: Date.now() }));

      await saveReviews(newReviews);
      proc.reviewCount += newReviews.length;
      proc.currentPage += 1;

      const done = proc.currentPage > proc.totalPages;
      if (done) {
        proc.status = "done";
        proc.completedAt = Date.now();
        await saveProcess(proc);
        notifyPopup({ type: "PROCESS_DONE", processId });
        break;
      }

      await saveProcess(proc);
      notifyPopup({
        type: "PROCESS_PROGRESS",
        processId,
        currentPage: proc.currentPage,
        totalPages: proc.totalPages,
        reviewCount: proc.reviewCount,
      });

    }
  } finally {
    activeScrapers.delete(processId);
    await startNextQueued();
  }
}

async function startNextQueued() {
  if (activeScrapers.size > 0) return; // something is running (even if 429-paused in DB as "waiting")
  const all = await getAllProcesses();
  if (all.some(p => p.status === "in_progress")) return; // guard for SW restart (activeScrapers is empty but DB says running)
  const next = all.filter(p => p.status === "waiting" && !activeScrapers.has(p.processId)).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (next) runScrapingLoop(next.processId);
  return;
}

/**
 * Ensures that an offscreen document is created and ready to be used.
 * The offscreen document is used to parse Shopify review HTML with DOMParser.
 * If the document already exists, this function does nothing and returns immediately.
 */
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: "Parse Shopify review HTML with DOMParser",
  });
}

/**
 * Fetches a Shopify app review page and parses it with an offscreen document.
 * @param {string} appSlug - The slug of the Shopify app.
 * @param {number} pageNumber - The page number to fetch.
 * @returns {Promise<Object>} An object containing the parsed review data.
 * @throws {Error} If the offscreen document fails to parse the page.
 */
async function fetchPage(appSlug, pageNumber) {
  await ensureOffscreen();
  const url = `https://apps.shopify.com/${appSlug}/reviews?page=${pageNumber}`;
  const result = await chrome.runtime.sendMessage({ type: "FETCH_PAGE", url });
  if (result?.error) throw new Error(result.error);
  return result;
}

async function rateLimitedFetch(appSlug, pageNumber) {
  const now = Date.now();
  const scheduledAt = Math.max(now, lastRequestTime + REQUEST_INTERVAL);
  lastRequestTime = scheduledAt; // reserve slot synchronously before any await
  await sleep(scheduledAt - now);
  return fetchPage(appSlug, pageNumber);
}

/**
 * Returns a promise that resolves after the given number of milliseconds.
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>} A promise that resolves after the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Notifies the popup of new data by sending a message to the popup's
 * runtime.onMessage listener.
 *
 * @param {Object} data - The data to send to the popup.
 */
function notifyPopup(data) {
  chrome.runtime.sendMessage(data).catch(() => {});
}
