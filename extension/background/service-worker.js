import { saveProcess, getProcess, getAllProcesses, deleteProcess, saveReviews, getReviewsByProcess } from "./db.js";

const activeScrapers = new Set();
const REQUEST_INTERVAL = 1000 / 3; // 3 requests per second
let lastRequestTime = 0;

// ── Alarm keepalive ───────────────────────────────────────────────────────────
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "keepalive") {
    const processes = await getAllProcesses();
    for (const proc of processes) {
      if (proc.status === "in_progress" && !activeScrapers.has(proc.processId)) {
        runScrapingLoop(proc.processId);
      }
    }
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
          (p.status === "in_progress" || p.status === "done")
      );
      if (dupe) return { processId: dupe.processId, alreadyExists: true };

      const processId = `${appSlug}-${Date.now()}`;
      const process = {
        processId,
        appName,
        appSlug,
        keyword,
        status: "in_progress",
        currentPage: 1,
        totalPages: null,
        reviewCount: 0,
        createdAt: Date.now(),
        completedAt: null,
      };
      await saveProcess(process);
      runScrapingLoop(processId);
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
    if (!proc || proc.status !== "in_progress") return;

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
          retries++;
          if (retries >= 3) {
            proc.status = "failed";
            await saveProcess(proc);
            notifyPopup({ type: "PROCESS_FAILED", processId, reason: err.message });
            return;
          }
          await sleep(3000 * retries);
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

      // Rate limit: max 3 requests per second
      let numberOfProcesses = (await getAllProcesses()).filter((p) => p.status === "in_progress").length;
      let delay = Math.max(1000 * numberOfProcesses / 3, 1000);
      await sleep(delay);
    }
  } finally {
    activeScrapers.delete(processId);
  }
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
  const waitTime = Math.max(REQUEST_INTERVAL - (now - lastRequestTime), 0);
  await sleep(waitTime);
  lastRequestTime = now;
  return await fetchPage(appSlug, pageNumber);
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
