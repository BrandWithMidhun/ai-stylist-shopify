/* eslint-env browser */
/* AI Stylist — product CTA click handler.
 *
 * Wires every [data-aistylist-cta] button on the page to the chat widget.
 * Reads product context from data attributes (rendered server-side by Liquid),
 * applies the runtime variant override, and calls window.__aistylist.openWithContext().
 *
 * The widget itself is provided by the storefront-widget App Embed; if the
 * embed is disabled, window.__aistylist will be undefined and the CTA does
 * nothing rather than crashing.
 */
(function () {
  "use strict";

  var WIDGET_READY_TIMEOUT_MS = 3000;

  function readContext(button) {
    var liquidVariantId = button.getAttribute("data-variant-id") || null;
    var runtimeVariantId =
      (window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.selectedVariantId) ||
      null;
    return {
      handle: button.getAttribute("data-product-handle") || "",
      title: button.getAttribute("data-product-title") || "",
      imageUrl: button.getAttribute("data-product-image") || "",
      variantId: String(runtimeVariantId || liquidVariantId || ""),
    };
  }

  function openWithContext(product) {
    if (window.__aistylist && typeof window.__aistylist.openWithContext === "function") {
      window.__aistylist.openWithContext({ product: product });
      return true;
    }
    return false;
  }

  function waitForWidgetThenOpen(product) {
    var start = Date.now();
    var attempt = function () {
      if (openWithContext(product)) return;
      if (Date.now() - start > WIDGET_READY_TIMEOUT_MS) return;
      window.setTimeout(attempt, 50);
    };
    attempt();
  }

  function handleClick(event) {
    var button = event.currentTarget;
    if (button.dataset.aistylistFiring === "1") return; // dedupe rapid double-tap
    button.dataset.aistylistFiring = "1";
    window.setTimeout(function () { delete button.dataset.aistylistFiring; }, 400);

    var product = readContext(button);
    if (!openWithContext(product)) waitForWidgetThenOpen(product);
  }

  function init() {
    var buttons = document.querySelectorAll("[data-aistylist-cta]");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.dataset.aistylistBound === "1") continue;
      btn.addEventListener("click", handleClick);
      btn.dataset.aistylistBound = "1";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
