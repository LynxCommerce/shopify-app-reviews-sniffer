/**
 * Builds the HTML report string for a process and its reviews.
 * Can be used to trigger a direct file download.
 */
export function buildHTMLReport(process, reviews) {
  return buildTemplate(process, reviews);
}

function starSVG(count) {
  const filled = '#f59e0b';
  const empty = '#d1d5db';
  return Array.from({ length: 5 }, (_, i) => `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="${i < count ? filled : empty}">
      <path d="M8 1l1.85 3.75L14 5.5l-3 2.92.7 4.1L8 10.35 4.3 12.52l.7-4.1L2 5.5l4.15-.75z"/>
    </svg>`).join("");
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTemplate(proc, reviews) {
  const exportDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const keyword = proc.keyword || "None";

  const reviewCards = reviews.length
    ? reviews.map((r, i) => `
        <div class="review-card" style="page-break-inside: avoid;">
          <div class="review-header">
            <div class="reviewer-info">
              <div class="avatar">${escHtml(r.reviewerName?.charAt(0)?.toUpperCase() || "?")}</div>
              <div>
                <div class="reviewer-name">${escHtml(r.reviewerName)}</div>
                <div class="reviewer-meta">${escHtml(r.country)}${r.country && r.date ? " · " : ""}${escHtml(r.date)}</div>
              </div>
            </div>
            <div class="stars">${starSVG(r.stars)}</div>
          </div>
          <div class="review-body">${escHtml(r.reviewContent)}</div>
          ${proc.keyword ? `<div class="keyword-highlight-note">Contains: "${escHtml(proc.keyword)}"</div>` : ""}
        </div>`).join("")
    : `<div class="no-results">No reviews matched the keyword filter.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escHtml(proc.appName)} — Review Report</title>
  <style>
    @page { margin: 20mm 16mm; }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #1a1a2e;
      background: #fff;
      padding: 24px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* ── Cover header ── */
    .report-header {
      border-bottom: 2px solid #008060;
      padding-bottom: 20px;
      margin-bottom: 24px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .report-title {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .app-name {
      font-size: 22px;
      font-weight: 700;
      color: #008060;
      line-height: 1.2;
    }

    .report-subtitle {
      font-size: 13px;
      color: #6b7280;
    }

    .report-meta {
      text-align: right;
      font-size: 11px;
      color: #6b7280;
      line-height: 1.8;
      flex-shrink: 0;
    }

    /* ── Summary bar ── */
    .summary-bar {
      display: flex;
      gap: 16px;
      background: #f6f6f7;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
    }

    .summary-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .summary-value {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a2e;
    }

    .summary-label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .divider {
      width: 1px;
      background: #e5e7eb;
      align-self: stretch;
    }

    /* ── Review cards ── */
    .reviews-section-title {
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 12px;
    }

    .review-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 12px;
      break-inside: avoid;
    }

    .review-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 10px;
      gap: 12px;
    }

    .reviewer-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #008060;
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .reviewer-name {
      font-weight: 600;
      font-size: 13px;
      color: #1a1a2e;
    }

    .reviewer-meta {
      font-size: 11px;
      color: #6b7280;
      margin-top: 2px;
    }

    .stars {
      display: flex;
      gap: 2px;
      align-items: center;
      flex-shrink: 0;
    }

    .review-body {
      font-size: 13px;
      line-height: 1.6;
      color: #374151;
      white-space: pre-line;
    }

    .keyword-highlight-note {
      margin-top: 8px;
      font-size: 11px;
      color: #92400e;
      background: #fef3c7;
      border-radius: 4px;
      padding: 3px 8px;
      display: inline-block;
    }

    .no-results {
      text-align: center;
      color: #9ca3af;
      padding: 32px;
      border: 1px dashed #e5e7eb;
      border-radius: 8px;
    }

    /* ── Footer ── */
    .report-footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
      color: #9ca3af;
      text-align: center;
    }

    @media print {
      body { padding: 0; }
      .report-footer { position: fixed; bottom: 0; left: 0; right: 0; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">
      <div class="app-name">${escHtml(proc.appName)}</div>
      <div class="report-subtitle">Shopify App Review Report</div>
    </div>
    <div class="report-meta">
      <div>Generated: ${exportDate}</div>
      <div>Keyword filter: <strong>${escHtml(keyword)}</strong></div>
      <div>Source: apps.shopify.com/${escHtml(proc.appSlug)}</div>
    </div>
  </div>

  <div class="summary-bar">
    <div class="summary-item">
      <div class="summary-value">${reviews.length}</div>
      <div class="summary-label">Reviews</div>
    </div>
    <div class="divider"></div>
    <div class="summary-item">
      <div class="summary-value">${proc.totalPages || "—"}</div>
      <div class="summary-label">Pages Scraped</div>
    </div>
    <div class="divider"></div>
    <div class="summary-item">
      <div class="summary-value">${averageStars(reviews)}</div>
      <div class="summary-label">Avg. Stars</div>
    </div>
    <div class="divider"></div>
    <div class="summary-item">
      <div class="summary-value">${uniqueCountries(reviews)}</div>
      <div class="summary-label">Countries</div>
    </div>
  </div>

  <div class="reviews-section-title">Filtered Reviews</div>
  ${reviewCards}

  <div class="report-footer">
    Shopify App Review Sniffer · ${exportDate}
  </div>
</body>
</html>`;
}

function averageStars(reviews) {
  if (!reviews.length) return "—";
  const avg = reviews.reduce((sum, r) => sum + (r.stars || 0), 0) / reviews.length;
  return avg.toFixed(1) + " ★";
}

function uniqueCountries(reviews) {
  const countries = new Set(reviews.map((r) => r.country).filter(Boolean));
  return countries.size || "—";
}
