# Shopify Review Sniffer — Chrome Extension

### status: 🟡 In Review @[chrome web store](https://chromewebstore.google.com/)

A Chrome extension (Manifest V3) that scrapes keyword-filtered reviews from Shopify app pages and exports them as a printable PDF report.

<img src="https://github.com/user-attachments/assets/a417457f-5228-4090-a2ea-c88d3d1ede0c"/>

---

## Directory Structure

```
shopify-review-sniffer/
└── extension/
    ├── manifest.json
    ├── icons/
    │   ├── icon16.png
    │   ├── icon48.png
    │   └── icon128.png
    ├── background/
    │   ├── service-worker.js
    │   ├── scraper.js
    │   └── db.js
    ├── offscreen/
    │   ├── offscreen.html
    │   └── offscreen.js
    ├── popup/
    │   ├── popup.html
    │   ├── popup.js
    │   └── popup.css
    └── template/
        └── pdf-generator.js
```

---

## Files & Responsibilities

### `manifest.json`
Manifest V3 configuration. Declares:

| Permission | Why |
|---|---|
| `storage` / `unlimitedStorage` | Persist processes and reviews in IndexedDB |
| `tabs` | Read the active tab URL to detect the current Shopify app |
| `alarms` | Keep the service worker alive and schedule auto-deletions |
| `scripting` | Inject scripts into tabs (read JSON-LD app name, trigger print dialog) |
| `offscreen` | Create an offscreen document for real-DOM HTML parsing |
| `<all_urls>` | Fetch Shopify review pages from the offscreen context |

---

### `background/db.js` — IndexedDB Layer

All persistent data lives in a single IndexedDB database (`ReviewSnifferDB`, version 1) with two object stores:

| Store | Key | Index | Contents |
|---|---|---|---|
| `processes` | `processId` | `status` | One record per scraping job |
| `reviews` | auto-increment `id` | `processId` | Individual review objects |

**Exported functions:**

| Function | Description |
|---|---|
| `saveProcess(process)` | Upsert a process record (`put`) |
| `getProcess(processId)` | Fetch one process by ID |
| `getAllProcesses()` | Fetch all processes |
| `deleteProcess(processId)` | Delete a process **and** all its linked reviews in one transaction |
| `saveReviews(reviews[])` | Append an array of review objects |
| `getReviewsByProcess(processId)` | Fetch all reviews belonging to a process |

**Data shapes:**

```js
// Process
{
  processId,     // "<appSlug>-<timestamp>"
  appName,       // human-readable name
  appSlug,       // URL slug (e.g. "klaviyo")
  keyword,       // filter string (empty = all reviews)
  status,        // "in_progress" | "done" | "failed" | "exported"
  currentPage,   // next page to scrape
  totalPages,    // discovered from pagination
  reviewCount,   // matched reviews accumulated so far
  createdAt,     // timestamp
  completedAt    // timestamp, null while running
}

// Review
{
  id,            // auto-increment (IndexedDB key)
  processId,     // FK to processes store
  reviewerName,
  reviewContent,
  country,
  date,
  stars,         // integer 0–5
  scrapedAt      // timestamp
}
```

---

### `background/scraper.js` — HTML Parsing

Stateless parsing utilities. Receives a `Document` object (parsed by the offscreen context) and extracts data using CSS selectors.

**`parseTotalPages(doc)`**
Finds all pagination anchor buttons (`a[class*="tw-border tw-rounded-xl ..."]`) and reads the last button's text content to determine how many pages exist. Returns `1` if no pagination is present.

**`parseReviews(doc)`**
Selects all elements with `[data-merchant-review]` and extracts per-review:

| Field | Selector |
|---|---|
| `reviewerName` | `span[class*="tw-overflow-hidden"][class*="tw-text-ellipsis"]` |
| `reviewContent` | `p.tw-break-words` |
| `country` | 2nd child of `div[class*="tw-text-fg-tertiary"][class*="tw-space-y"]` |
| `date` | `div[class*="tw-text-body-xs"][class*="tw-text-fg-tertiary"]` |
| `stars` | Count of `path[d="<FILLED_STAR_PATH>"]` elements inside the review |

Reviews where the name or content element is missing are silently skipped.

---

### `background/service-worker.js` — Orchestrator

The MV3 service worker. Manages all scraping state and responds to messages from the popup.

#### Keepalive mechanism
Chrome MV3 service workers can be killed after ~30 seconds of inactivity. To prevent jobs from being orphaned, an alarm fires every **0.4 minutes**. On each alarm tick, any process with `status === "in_progress"` that isn't already being scraped is restarted via `runScrapingLoop`.

#### Message API

Messages are sent from the popup via `chrome.runtime.sendMessage`. All handlers are async and return a response object.

| `message.type` | Payload | Response | Description |
|---|---|---|---|
| `START_SCRAPE` | `appName`, `appSlug`, `keyword` | `{ processId }` or `{ processId, alreadyExists: true }` | Creates and starts a new scraping job. Prevents duplicates (same slug + keyword already `in_progress` or `done`). |
| `GET_PROCESSES` | — | `{ processes[] }` | Returns all processes sorted newest-first. |
| `GET_REVIEWS` | `processId` | `{ reviews[] }` | Returns all reviews for a process. |
| `DELETE_PROCESS` | `processId` | `{ ok }` | Immediately deletes a process and its reviews. |
| `SCHEDULE_DELETE` | `processId`, `minutes` | `{ ok }` | Schedules a `chrome.alarm` to delete the process after N minutes. |
| `UPDATE_SETTING` | `key`, `value` | `{ ok }` | Persists a setting to `chrome.storage.sync`. |
| `GET_SETTINGS` | — | `{ settings }` | Returns sync settings (default: `autoDeleteMinutes: 5`). |

#### `runScrapingLoop(processId)`
The core scraping loop:

1. Guards against concurrent runs for the same process using an `activeScrapers` Set.
2. Fetches each page via `fetchPage()` (delegated to the offscreen document).
3. Retries up to **3 times** on fetch failure, with exponential back-off (3 s, 6 s, 9 s). Marks the process as `failed` after all retries are exhausted.
4. Applies the keyword filter: only reviews whose `reviewContent` (case-insensitive) contains the keyword are kept.
5. Saves matched reviews, increments `reviewCount`, advances `currentPage`.
6. Rate-limits to **1 page per second** (≤ 3 req/s including retries).
7. When `currentPage > totalPages`, marks the process `done`, records `completedAt`, and notifies the popup.
8. Sends `PROCESS_PROGRESS` notifications after each page so the popup can update the progress bar in real time.

#### Push notifications to popup

`notifyPopup(data)` calls `chrome.runtime.sendMessage` fire-and-forget (errors are swallowed — the popup may not be open).

| Event type | Sent when |
|---|---|
| `PROCESS_PROGRESS` | After each successfully scraped page |
| `PROCESS_DONE` | Scraping complete |
| `PROCESS_FAILED` | All fetch retries exhausted |
| `PROCESS_DELETED` | Auto-delete alarm fires |

---

### `offscreen/offscreen.js` — Real-DOM Parser

MV3 service workers don't have access to `DOMParser` or `document`. This offscreen document runs in a real browser context and bridges the gap.

**Flow:**
1. Service worker calls `ensureOffscreen()` to create `offscreen/offscreen.html` if it doesn't exist yet (reason: `DOM_PARSER`).
2. Service worker sends a `FETCH_PAGE` message with a URL.
3. Offscreen document fetches the URL with `Accept: text/html` headers, parses the HTML with `DOMParser`, then runs `parseTotalPages` and `parseReviews` from `scraper.js`.
4. Returns `{ totalPages, reviews }` back to the service worker.

---

### `popup/popup.html` + `popup/popup.js` + `popup/popup.css` — UI

The extension's browser action popup (400 × auto height).

#### Panels

| Element | ID | Behavior |
|---|---|---|
| Settings panel | `settingsPanel` | Toggled by the gear icon. Contains `autoDeleteMinutes` input. Hidden by default. |
| Add scrape panel | `addPanel` | Toggled by the `+` icon. Only active when on a valid Shopify app page. Contains keyword input + Start button. |
| Process list | `processList` | Always visible. Shows all jobs as cards. |

#### Initialization (`init()`)
On popup open, three things run in sequence:

1. **`detectCurrentTab()`** — queries the active tab URL for `apps.shopify.com/<slug>`. If found, reads the JSON-LD `<script>` on the page via `chrome.scripting.executeScript` to get the real app name (falls back to slug-formatted name). Enables the `+` button.
2. **`loadSettings()`** — populates the auto-delete input from `chrome.storage.sync`.
3. **`loadProcesses()`** — fetches and renders all processes.

#### Process cards

Each process renders as a card showing:
- App name + status badge (`Scraping` / `Done` / `Failed`)
- Keyword filter + review count / page progress
- Animated progress bar (only while `in_progress`)
- **Export PDF** button (only when `done`)
- **Delete** button (always)

#### Export flow (`handleExport`)
1. Fetches the process metadata and its reviews.
2. Calls `generatePDF(proc, reviews)`.
3. If `autoDeleteMinutes > 0`, sends `SCHEDULE_DELETE` to the service worker.
4. Refreshes the process list.

#### Live updates
The popup listens for push messages from the service worker (`PROCESS_DONE`, `PROCESS_PROGRESS`, `PROCESS_DELETED`, `PROCESS_FAILED`) and calls `loadProcesses()` on any of them — keeping the UI in sync without polling.

---

### `template/pdf-generator.js` — PDF Export

No external libraries. Generates a self-contained HTML string and opens it in a new Chrome tab, then triggers `window.print()` after 500 ms so the browser's Save as PDF dialog appears.

**`generatePDF(process, reviews)`**
1. Builds HTML via `buildTemplate`.
2. Creates a `Blob` URL and opens it with `chrome.tabs.create`.
3. Injects a print-trigger script into the new tab via `chrome.scripting.executeScript`.
4. Revokes the blob URL after 60 seconds.

**Report sections:**
- **Header** — app name, export date, keyword filter, source URL.
- **Summary bar** — total reviews, pages scraped, average star rating, unique country count.
- **Review cards** — one card per review with avatar initial, reviewer name, country, date, star rating, and review body. If a keyword filter was used, a highlight note is shown on each card.
- **Footer** — branding + export date.

Print CSS (`@page`, `break-inside: avoid`) ensures cards don't split across printed pages.

---

## End-to-End Flow

```
User navigates to apps.shopify.com/<slug>/reviews
        │
        ▼
Popup opens → detectCurrentTab() enables + button
        │
        ▼
User enters keyword → clicks Start
        │
        ▼
popup.js  ──START_SCRAPE──►  service-worker.js
                                │ creates Process record in IndexedDB
                                │ calls runScrapingLoop()
                                │
                                ▼
                    ┌── ensureOffscreen() ────────────────────┐
                    │                                         │
                    │  service-worker  ──FETCH_PAGE──►  offscreen.js
                    │                                    fetch(url)
                    │                                    DOMParser
                    │                                    parseReviews()
                    │                  ◄── { totalPages, reviews } ──
                    │
                    │  keyword filter → saveReviews() → saveProcess()
                    │  notifyPopup(PROCESS_PROGRESS)
                    │
                    └── repeat for each page (1 req/sec)
                                │
                        (all pages done)
                                │
                    notifyPopup(PROCESS_DONE)
                                │
        ◄──────────────────────┘
popup.js re-renders → card shows "Done" + Export PDF button
        │
        ▼
User clicks Export PDF
        │
popup.js  ──GET_REVIEWS──►  service-worker.js ──► IndexedDB
        ◄────────── reviews[] ───────────────────────────────
        │
generatePDF() → Blob URL → new tab → window.print()
        │
SCHEDULE_DELETE alarm set (if autoDeleteMinutes > 0)
        │
alarm fires → deleteProcess() → notifyPopup(PROCESS_DELETED)
```

---

## Settings

| Key | Storage | Default | Description |
|---|---|---|---|
| `autoDeleteMinutes` | `chrome.storage.sync` | `5` | Minutes after export before a process is auto-deleted. `0` disables auto-delete. |
