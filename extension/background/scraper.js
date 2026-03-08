const FILLED_STAR_D =
  "M8 0.75C8.14001 0.74991 8.27725 0.789014 8.39619 0.862887C8.51513 0.93676 8.61102 1.04245 8.673 1.168L10.555 4.983L14.765 5.595C14.9035 5.61511 15.0335 5.67355 15.1405 5.76372C15.2475 5.85388 15.3271 5.97218 15.3704 6.10523C15.4137 6.23829 15.4189 6.3808 15.3854 6.51665C15.3519 6.6525 15.2811 6.77628 15.181 6.874L12.135 9.844L12.854 14.036C12.8777 14.1739 12.8624 14.3157 12.8097 14.4454C12.757 14.5751 12.6691 14.6874 12.5559 14.7697C12.4427 14.852 12.3087 14.901 12.1691 14.9111C12.0295 14.9212 11.8899 14.8921 11.766 14.827L8 12.847L4.234 14.827C4.11018 14.892 3.97066 14.9211 3.83119 14.911C3.69171 14.9009 3.55784 14.852 3.44468 14.7699C3.33152 14.6877 3.24359 14.5755 3.19081 14.446C3.13803 14.3165 3.12251 14.1749 3.146 14.037L3.866 9.843L0.817997 6.874C0.717563 6.77632 0.646496 6.65247 0.612848 6.51647C0.579201 6.38047 0.584318 6.23777 0.627621 6.10453C0.670924 5.97129 0.75068 5.85284 0.857852 5.76261C0.965025 5.67238 1.09533 5.61397 1.234 5.594L5.444 4.983L7.327 1.168C7.38898 1.04245 7.48486 0.93676 7.6038 0.862887C7.72274 0.789014 7.85998 0.74991 8 0.75Z";

const PAGINATION_BTN_CLASS =
  "tw-border tw-rounded-xl tw-inline-block hover:tw-bg-button-canvas-secondary-hover";

/**
 * Parse the pagination buttons on a Shopify app page and return the total number of pages.
 * @param {Document} doc - The HTML document to parse.
 * @returns {number} The total number of pages.
 */
export function parseTotalPages(doc) {
  const buttons = doc.querySelectorAll(`a[class*="${PAGINATION_BTN_CLASS}"]`);
  if (!buttons.length) return 1;
  const last = buttons[buttons.length - 1];
  const num = parseInt(last.textContent.trim(), 10);
  return isNaN(num) ? 1 : num;
}


/**
 * Parse review elements from a Shopify app page and extract relevant information.
 * @param {Document} doc - The HTML document to parse.
 * @returns {Array<Object>} An array of objects containing the following properties:
 *   - reviewerName: The name of the reviewer.
 *   - reviewContent: The content of the review.
 *   - country: The country of the reviewer.
 *   - date: The date the review was written.
 *   - stars: The number of stars given in the review.
 */
export function parseReviews(doc) {
  const reviewEls = doc.querySelectorAll('div[data-merchant-review]');
  const reviews = [];

  reviewEls.forEach((el) => {
    try {
      const nameEl = el.querySelector(
        'span[class*="tw-overflow-hidden"][class*="tw-text-ellipsis"]'
      );
      const contentEl = el.querySelector("p.tw-break-words");
      if (!nameEl || !contentEl) return;

      const dateEl = el.querySelector(
        'div[class*="tw-text-body-xs"][class*="tw-text-fg-tertiary"]'
      );
      const starPaths = el.querySelectorAll(`path[d="${FILLED_STAR_D}"]`);

      let country = "";
      const sidebarEl = el.querySelector(
        'div[class*="tw-text-fg-tertiary"][class*="tw-space-y"]'
      );
      if (sidebarEl) {
        const children = [...sidebarEl.children];
        // children[0] = name+copy-button div, children[1] = country, children[2] = duration
        country = children[1] ? children[1].textContent.trim() : "";
      }

      reviews.push({
        reviewerName: nameEl.textContent.trim(),
        reviewContent: contentEl.textContent.trim(),
        country,
        date: dateEl ? dateEl.textContent.trim() : "",
        stars: starPaths.length,
      });
    } catch {}
  });

  return reviews;
}
