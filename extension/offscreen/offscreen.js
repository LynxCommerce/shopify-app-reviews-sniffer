import { parseTotalPages, parseReviews } from "../background/scraper.js";

/**
 * Offscreen document — runs in a real browser context so DOMParser and
 * querySelectorAll work correctly. Handles FETCH_PAGE requests from the
 * service worker, fetches the URL, parses HTML, and sends the result back.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "FETCH_PAGE") return false;

  fetchAndParse(message.url)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));

  return true; // keep the message port open for the async response
});

/**
 * Fetches a URL and parses the HTML response using a real browser context.
 * Returns an object with two properties: totalPages and reviews.
 *
 * @param {string} url - The URL to fetch and parse.
 * @returns {Promise<Object>} An object with totalPages and reviews properties.
 * @throws {Error} If the fetch request fails or the HTML parsing fails.
 */
async function fetchAndParse(url) {
  const resp = await fetch(url, {
    headers: {
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  return {
    totalPages: parseTotalPages(doc),
    reviews: parseReviews(doc),
  };
}
