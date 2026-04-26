/* eslint-env browser */
/* eslint-disable no-var */
/*
 * AI Stylist — Storefront Chat Widget (vanilla web component, Shadow DOM).
 *
 * Single class extends HTMLElement. All CSS lives in an inline <style> tag
 * inside the shadow root for theme-proof isolation. No framework, no build
 * step — Shopify serves this file as-is from extensions/.../assets/.
 *
 * v1 INTENTIONAL LIMITATIONS (documented inline where they apply):
 *   - No persistent chat history across sessions (cookie UUID only).
 *   - Anonymous users only; customer account linking comes in 011.
 *   - Text + product cards only; rich types (carousels, images) come in 009+.
 *   - No analytics events; chat_started / chat_ended wired in 015.
 *   - Image upload icon and mic icon are decorative — clicks fire a "coming
 *     soon" toast (image input lands in 018; voice is its own scope).
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof HTMLElement === "undefined") return;
  if (window.customElements && window.customElements.get("aistylist-widget")) return;

  // ────────── constants ──────────
  var COOKIE_NAME = "aistylist_session_id";
  var COOKIE_MAX_AGE_DAYS = 30;
  var PULSE_FLAG_KEY = "aistylist_pulsed";
  var HISTORY_LIMIT = 10; // last N messages sent with each request
  var SCROLL_THRESHOLD_PX = 100;
  var DEFAULT_PRIMARY_COLOR = "#000000";
  var DEFAULT_WELCOME =
    "Hi! I'm your shopping assistant. How can I help you today?";
  // Defensive fallbacks only. The Liquid template injects agentName + shopName
  // from the app:ai_stylist/chat_config metafield, populated by /app/config
  // and by ensureMerchantConfig on install. These defaults exist so a
  // missing/corrupted metafield doesn't render an empty header.
  var DEFAULT_AGENT_NAME = "AI Assistant";
  var DEFAULT_SHOP_NAME = "this store";
  var DEFAULT_AGENT_SUBTITLE = "Your shopping assistant";

  // Welcome chips fallback if metafield is missing welcomeChips array
  // (pre-version-2 metafield). Mode-aware chips arrive via metafield from
  // version 2 onward — populated by getWelcomeChips on the server.
  var FALLBACK_WELCOME_CHIPS = [
    "Show me what's new",
    "Help me find a gift",
    "What's trending?",
    "I'm just browsing",
  ];

  // ────────── session helpers ──────────
  // Module-level cache so concurrent calls return the same UUID even before
  // the cookie write has flushed (see risk #6 in execution plan).
  var cachedSessionId = null;

  function readCookie(name) {
    var prefix = name + "=";
    var parts = (document.cookie || "").split("; ");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(prefix) === 0) return decodeURIComponent(parts[i].slice(prefix.length));
    }
    return null;
  }

  function writeCookie(name, value, days) {
    var maxAge = days * 24 * 60 * 60;
    document.cookie =
      name + "=" + encodeURIComponent(value) +
      "; path=/; max-age=" + maxAge + "; SameSite=Lax";
  }

  function generateUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    // Fallback for older browsers (RFC4122 v4-ish, not crypto-strong).
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getOrCreateSessionId() {
    if (cachedSessionId) return cachedSessionId;
    var existing = readCookie(COOKIE_NAME);
    if (existing) { cachedSessionId = existing; return existing; }
    var id = generateUuid();
    writeCookie(COOKIE_NAME, id, COOKIE_MAX_AGE_DAYS); // synchronous, before any fetch
    cachedSessionId = id;
    return id;
  }

  // ────────── styles (inline so they live inside shadow DOM) ──────────
  var STYLES = [
    ":host { all: initial; --aistylist-primary: " + DEFAULT_PRIMARY_COLOR + "; --aistylist-fg-on-primary: #ffffff; --aistylist-bg: #ffffff; --aistylist-text: #18181b; --aistylist-muted: #71717a; --aistylist-faint: #999999; --aistylist-surface: #f4f4f5; --aistylist-border: #e4e4e7; --aistylist-online: #22c55e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; color: var(--aistylist-text); position: fixed; bottom: 0; right: 0; z-index: 999998; pointer-events: none; }",
    ":host *, :host *::before, :host *::after { box-sizing: border-box; }",
    ".bubble, .panel, .chip, .send, .close, .min, .icon-btn, .pill, .new-msg, .empty-cta, .retry, .seeall { pointer-events: auto; }",
    // bubble
    ".bubble { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%; background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; transition: transform 150ms ease, opacity 200ms ease, box-shadow 200ms ease; }",
    ".bubble:hover { transform: scale(1.05); box-shadow: 0 6px 22px rgba(0,0,0,0.2); }",
    ".bubble:active { transform: scale(0.95); }",
    ".bubble svg { width: 26px; height: 26px; }",
    ".bubble.hidden { opacity: 0; pointer-events: none; transform: scale(0.9); }",
    ".bubble.pulse { animation: aistylist-pulse 2s ease-in-out 3; }",
    "@keyframes aistylist-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.03); opacity: 0.85; } }",
    // panel
    ".panel { position: fixed; bottom: 96px; right: 24px; width: 400px; max-width: calc(100vw - 32px); height: 620px; max-height: calc(100vh - 120px); background: var(--aistylist-bg); border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; opacity: 0; transform: scale(0.95) translateY(20px); transition: opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1); pointer-events: none; }",
    ".panel.open { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; transition-duration: 400ms; }",
    // header (008 Phase 3 redesign — avatar + status dot + two-line layout)
    ".header { display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid rgba(0,0,0,0.08); background: var(--aistylist-bg); }",
    ".avatar { position: relative; flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); display: flex; align-items: center; justify-content: center; }",
    ".avatar svg { width: 20px; height: 20px; }",
    ".avatar::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%; background: var(--aistylist-online); border: 2px solid var(--aistylist-bg); }",
    ".header__text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }",
    ".header__name { font-weight: 600; font-size: 16px; color: var(--aistylist-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".header__subtitle { font-size: 13px; color: var(--aistylist-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }",
    ".header__actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }",
    ".min, .close { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; color: var(--aistylist-muted); display: flex; align-items: center; justify-content: center; transition: background-color 150ms ease, color 150ms ease; }",
    ".min:hover, .close:hover { background: var(--aistylist-surface); color: var(--aistylist-text); }",
    ".min svg, .close svg { width: 16px; height: 16px; }",
    // context pill
    ".context-pill { display: none; align-items: center; gap: 10px; padding: 10px 16px; background: var(--aistylist-surface); border-bottom: 1px solid var(--aistylist-border); font-size: 13px; }",
    ".context-pill.visible { display: flex; }",
    ".context-pill img { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }",
    ".context-pill__label { color: var(--aistylist-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }",
    ".context-pill__title { font-weight: 500; color: var(--aistylist-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".context-pill__text { min-width: 0; flex: 1; }",
    // messages
    ".messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; position: relative; }",
    ".message { max-width: 85%; padding: 10px 14px; line-height: 1.4; font-size: 14px; word-wrap: break-word; animation: aistylist-msg-in 250ms ease-out; }",
    "@keyframes aistylist-msg-in { from { opacity: 0; transform: scale(0.9) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }",
    ".message.assistant { align-self: flex-start; background: var(--aistylist-surface); color: var(--aistylist-text); border-radius: 16px 16px 16px 4px; }",
    ".message.user { align-self: flex-end; background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border-radius: 16px 16px 4px 16px; }",
    // suggested label (008 Phase 3) — sits above welcome chips
    ".suggested-label { font-size: 11px; font-weight: 600; color: var(--aistylist-faint); text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 16px 6px; }",
    ".suggested-label:empty { display: none; }",
    // typing
    ".typing { align-self: flex-start; padding: 12px 14px; background: var(--aistylist-surface); border-radius: 16px 16px 16px 4px; display: flex; gap: 4px; }",
    ".typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--aistylist-muted); display: inline-block; opacity: 0.4; animation: aistylist-bounce 0.6s infinite; }",
    ".typing span:nth-child(2) { animation-delay: 0.2s; }",
    ".typing span:nth-child(3) { animation-delay: 0.4s; }",
    "@keyframes aistylist-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-4px); opacity: 1; } }",
    // cards header (008 Phase 3) — "X MATCHES" + "See all →"
    ".cards-header { display: flex; align-items: baseline; justify-content: space-between; padding: 12px 0 6px; }",
    ".cards-header__count { font-size: 12px; font-weight: 600; color: var(--aistylist-text); text-transform: uppercase; letter-spacing: 0.4px; }",
    ".seeall { font-size: 12px; color: var(--aistylist-muted); text-decoration: none; font-family: inherit; background: none; border: none; padding: 0; cursor: pointer; }",
    ".seeall:hover { color: var(--aistylist-text); }",
    // product cards (008 Phase 3 redesign — AI Pick badge, larger images, stacked pill buttons)
    ".cards { display: flex; gap: 10px; padding: 4px 0 8px; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; align-self: stretch; }",
    ".cards::-webkit-scrollbar { height: 4px; }",
    ".cards::-webkit-scrollbar-thumb { background: var(--aistylist-border); border-radius: 2px; }",
    ".card { width: 240px; flex: 0 0 240px; scroll-snap-align: start; background: var(--aistylist-bg); border: 1px solid var(--aistylist-border); border-radius: 16px; overflow: hidden; padding: 12px; display: flex; flex-direction: column; gap: 10px; transition: box-shadow 200ms ease, transform 150ms ease; }",
    "@media (hover: hover) { .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); } }",
    ".card__media { position: relative; width: 100%; aspect-ratio: 1 / 1; background: var(--aistylist-surface); border-radius: 12px; overflow: hidden; cursor: pointer; }",
    ".card__media img { width: 100%; height: 100%; object-fit: cover; display: block; }",
    ".card__media.empty { display: flex; align-items: center; justify-content: center; color: var(--aistylist-muted); }",
    ".card__media.empty svg { width: 32px; height: 32px; opacity: 0.5; }",
    ".card__badge { position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 4px; background: var(--aistylist-bg); color: var(--aistylist-text); font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 999px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); pointer-events: none; }",
    ".card__badge svg { width: 11px; height: 11px; }",
    ".card__info { display: flex; flex-direction: column; gap: 4px; }",
    ".card__title { font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--aistylist-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; min-height: 2.6em; cursor: pointer; }",
    ".card__price-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }",
    ".card__price { font-size: 16px; font-weight: 700; color: var(--aistylist-text); }",
    ".card__price.muted { font-weight: 500; color: var(--aistylist-muted); font-size: 13px; }",
    ".card__compare { font-size: 13px; color: var(--aistylist-faint); text-decoration: line-through; }",
    ".card__actions { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }",
    ".card__btn { display: flex; align-items: center; justify-content: center; gap: 6px; font-family: inherit; font-size: 13px; font-weight: 600; padding: 10px 12px; border-radius: 999px; cursor: pointer; transition: opacity 150ms ease, transform 150ms ease, background-color 150ms ease; }",
    ".card__btn:active { transform: scale(0.98); }",
    ".card__btn svg { width: 14px; height: 14px; }",
    ".card__btn.add { background: var(--aistylist-primary); border: 1px solid var(--aistylist-primary); color: var(--aistylist-fg-on-primary); }",
    ".card__btn.add[aria-disabled='true'] { background: var(--aistylist-surface); border-color: var(--aistylist-border); color: var(--aistylist-muted); cursor: not-allowed; opacity: 1; }",
    ".card__btn.add[aria-busy='true'] { opacity: 0.7; cursor: wait; }",
    ".card__btn.view { background: var(--aistylist-bg); border: 1px solid var(--aistylist-border); color: var(--aistylist-text); }",
    ".card__btn.view:hover { background: var(--aistylist-surface); }",
    "@media (min-width: 641px) { .cards { flex-wrap: wrap; overflow-x: visible; } .card { flex: 0 0 calc(50% - 5px); width: auto; } }",
    // empty state (008 Phase 3 §3.9)
    ".empty-state { align-self: stretch; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }",
    ".empty-state__icon { color: var(--aistylist-muted); }",
    ".empty-state__icon svg { width: 36px; height: 36px; opacity: 0.5; }",
    ".empty-state__text { color: var(--aistylist-muted); font-size: 13px; }",
    ".empty-cta { display: inline-block; background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border: none; border-radius: 999px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; font-family: inherit; }",
    ".empty-cta:hover { opacity: 0.9; }",
    // error badge (008 Phase 3 §3.10)
    ".error-badge { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; background: rgba(239,68,68,0.08); color: #b91c1c; font-size: 11px; font-weight: 500; padding: 4px 10px; border-radius: 999px; margin-top: 4px; }",
    ".error-badge svg { width: 12px; height: 12px; }",
    ".error-badge .retry { background: none; border: none; color: inherit; cursor: pointer; font: inherit; padding: 0 0 0 4px; text-decoration: underline; }",
    // toast (cart confirmation)
    ".toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 500; box-shadow: 0 6px 20px rgba(0,0,0,0.2); opacity: 0; pointer-events: none; transition: opacity 200ms ease, transform 200ms ease; z-index: 999999; max-width: calc(100vw - 32px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".toast.show { opacity: 1; transform: translate(-50%, 0); }",
    // suggestions
    ".suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 10px; }",
    ".suggestions:empty { display: none; }",
    ".chip { background: var(--aistylist-bg); border: 1px solid var(--aistylist-border); border-radius: 999px; padding: 8px 14px; font-size: 13px; color: var(--aistylist-text); cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease; font-family: inherit; }",
    ".chip:hover { background: var(--aistylist-surface); border-color: var(--aistylist-muted); }",
    ".chip:active { transform: scale(0.97); }",
    ".chip:focus-visible { outline: 2px solid var(--aistylist-primary); outline-offset: 2px; }",
    "@media (min-width: 641px) { .suggestions.welcome { display: grid; grid-template-columns: repeat(2, 1fr); } .suggestions.welcome .chip { text-align: left; } }",
    "@media (max-width: 380px) { .suggestions.welcome { display: grid; grid-template-columns: 1fr; } }",
    // input bar (008 Phase 3 redesign — pill bg, image icon, mic icon, up-arrow send)
    ".input-wrap { padding: 10px 12px 4px; background: var(--aistylist-bg); }",
    ".input-bar { display: flex; align-items: center; gap: 6px; background: var(--aistylist-surface); border-radius: 999px; padding: 4px 4px 4px 8px; }",
    ".icon-btn { background: none; border: none; cursor: pointer; padding: 8px; border-radius: 50%; color: var(--aistylist-muted); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background-color 150ms ease, color 150ms ease; }",
    ".icon-btn:hover { background: rgba(0,0,0,0.04); color: var(--aistylist-text); }",
    ".icon-btn svg { width: 18px; height: 18px; }",
    ".input { flex: 1; min-width: 0; border: none; background: transparent; padding: 8px 6px; font-size: 14px; outline: none; font-family: inherit; color: var(--aistylist-text); }",
    ".input::placeholder { color: var(--aistylist-muted); }",
    ".send { background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 150ms ease, transform 150ms ease; }",
    ".send:hover:not([aria-disabled='true']) { transform: scale(1.05); }",
    ".send:active:not([aria-disabled='true']) { transform: scale(0.95); }",
    ".send[aria-disabled='true'] { opacity: 0.4; cursor: not-allowed; }",
    ".send svg { width: 16px; height: 16px; }",
    // disclaimer footer (008 Phase 3 §3.5)
    ".disclaimer { font-size: 11px; color: var(--aistylist-faint); text-align: center; padding: 6px 16px 12px; }",
    // new-message pill
    ".new-msg { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border: none; border-radius: 999px; padding: 6px 14px; font-size: 12px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; pointer-events: none; transition: opacity 200ms ease; font-family: inherit; }",
    ".new-msg.visible { opacity: 1; pointer-events: auto; }",
    // mobile
    "@media (max-width: 640px) {",
    "  .bubble { width: 48px; height: 48px; bottom: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); }",
    "  .bubble svg { width: 22px; height: 22px; }",
    "  .panel { width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; bottom: 0; right: 0; border-radius: 0; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }",
    "  @supports (height: 100dvh) { .panel { height: 100dvh; max-height: 100dvh; } }",
    "  .header { padding: 12px 14px; }",
    "  .card { width: 80%; flex: 0 0 80%; }",
    "}",
    "@media (prefers-reduced-motion: reduce) {",
    "  .bubble.pulse { animation: none; }",
    "  .typing span { animation-duration: 1.2s; }",
    "  .panel { transition-duration: 100ms; }",
    "  .message { animation: none; }",
    "}",
  ].join("\n");

  // ────────── icons ──────────
  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M9 11h.01M12 11h.01M15 11h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";
  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";
  var ICON_MIN =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";
  // Sparkle / star burst — used for avatar, AI Pick badge, PDP CTA.
  var ICON_SPARKLE =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2.5l1.7 5.1 5.1 1.7-5.1 1.7L12 16l-1.7-5.1-5.1-1.7 5.1-1.7L12 2.5zM18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6zM5 16l.7 1.9 1.9.7-1.9.7L5 21.3l-.7-1.9-1.9-.7 1.9-.7L5 16z"/>' +
    "</svg>";
  var ICON_STAR =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2l2.9 6.5 7.1.7-5.4 4.7 1.7 6.9L12 17.3 5.7 20.8l1.7-6.9L2 9.2l7.1-.7L12 2z"/>' +
    "</svg>";
  var ICON_CART =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M3 4h2l2.5 11h11l2-7H6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="9" cy="19" r="1.5" fill="currentColor"/>' +
    '<circle cx="17" cy="19" r="1.5" fill="currentColor"/>' +
    "</svg>";
  // Diagonal arrow (↗) for View Details and See all.
  var ICON_ARROW_NE =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M7 17L17 7M9 7h8v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";
  // Up arrow (↑) for the send button — replaces the paper plane.
  var ICON_ARROW_UP =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";
  var ICON_CAMERA =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="13" r="3.2" stroke="currentColor" stroke-width="1.7"/>' +
    "</svg>";
  var ICON_MIC =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    "</svg>";
  var ICON_SEARCH =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M20 20l-4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    "</svg>";
  var ICON_WARN =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M12 3l10 18H2L12 3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M12 10v4M12 17v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";

  // ────────── component ──────────
  class AIStylistWidget extends HTMLElement {
    constructor() {
      super();
      this._mounted = false;
    }

    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;

      var config = window.__AISTYLIST_CONFIG__ || {};
      var rawAgentName = typeof config.agentName === "string" ? config.agentName.trim() : "";
      var rawShopName = typeof config.shopName === "string" ? config.shopName.trim() : "";
      var welcomeChips = Array.isArray(config.welcomeChips) && config.welcomeChips.length > 0
        ? config.welcomeChips.slice(0)
        : FALLBACK_WELCOME_CHIPS.slice(0);
      this._config = {
        shopDomain: config.shopDomain || (window.Shopify && window.Shopify.shop) || "",
        primaryColor: config.primaryColor || DEFAULT_PRIMARY_COLOR,
        welcomeMessage: config.welcomeMessage || DEFAULT_WELCOME,
        agentName: rawAgentName || DEFAULT_AGENT_NAME,
        shopName: rawShopName || DEFAULT_SHOP_NAME,
        agentSubtitle: DEFAULT_AGENT_SUBTITLE,
        welcomeChips: welcomeChips,
        chatEndpoint: config.chatEndpoint || "/api/chat/message",
      };

      this._state = {
        open: false,
        messages: [],
        typing: false,
        context: null,
        inputValue: "",
        newMsgPillVisible: false,
        lastUserQuery: "",
      };

      this._previouslyFocused = null;
      this._sessionId = getOrCreateSessionId();

      this._render();
      this._installPublicApi();
    }

    _render() {
      var root = this.attachShadow({ mode: "open" });
      var style = document.createElement("style");
      style.textContent = STYLES;
      root.appendChild(style);

      // host-level CSS variable for merchant primary color (cascades into all
      // selectors that reference --aistylist-primary).
      this.style.setProperty("--aistylist-primary", this._config.primaryColor);
      var hostStyle = document.createElement("style");
      hostStyle.textContent =
        ":host { --aistylist-primary: " + this._config.primaryColor + "; }";
      root.appendChild(hostStyle);

      var agentName = this._config.agentName;

      // bubble
      var bubble = document.createElement("button");
      bubble.className = "bubble";
      bubble.setAttribute("aria-label", "Open chat with " + agentName);
      bubble.innerHTML = ICON_CHAT;
      bubble.addEventListener("click", this._handleOpen.bind(this));
      root.appendChild(bubble);
      this._bubble = bubble;

      // panel
      var panel = document.createElement("div");
      panel.className = "panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "Chat with " + agentName);
      panel.innerHTML =
        '<div class="header">' +
        '  <div class="avatar" aria-hidden="true">' + ICON_SPARKLE + '</div>' +
        '  <div class="header__text">' +
        '    <div class="header__name" data-role="agent-name"></div>' +
        '    <div class="header__subtitle" data-role="agent-subtitle"></div>' +
        '  </div>' +
        '  <div class="header__actions">' +
        '    <button class="min" aria-label="Minimize chat">' + ICON_MIN + "</button>" +
        '    <button class="close" aria-label="Close chat">' + ICON_CLOSE + "</button>" +
        "  </div>" +
        "</div>" +
        '<div class="context-pill" data-role="context-pill">' +
        '  <img alt="" data-role="context-image">' +
        '  <div class="context-pill__text">' +
        '    <div class="context-pill__label">Asking about</div>' +
        '    <div class="context-pill__title" data-role="context-title"></div>' +
        "  </div>" +
        "</div>" +
        '<div class="messages" aria-live="polite" data-role="messages"></div>' +
        '<button class="new-msg" data-role="new-msg" aria-label="Scroll to newest message">New message ↓</button>' +
        '<div class="suggested-label" data-role="suggested-label"></div>' +
        '<div class="suggestions" data-role="suggestions"></div>' +
        '<div class="input-wrap">' +
        '  <div class="input-bar">' +
        '    <button type="button" class="icon-btn" data-role="image-btn" aria-label="Upload an image">' + ICON_CAMERA + "</button>" +
        '    <input class="input" data-role="input" type="text" placeholder="Ask anything..." aria-label="Message" autocomplete="off">' +
        '    <button type="button" class="icon-btn" data-role="mic-btn" aria-label="Voice input">' + ICON_MIC + "</button>" +
        '    <button class="send" data-role="send" aria-label="Send message" aria-disabled="true">' + ICON_ARROW_UP + "</button>" +
        "  </div>" +
        "</div>" +
        '<div class="disclaimer">AI may make mistakes. Verify important details.</div>';
      root.appendChild(panel);
      this._panel = panel;
      this._messagesEl = panel.querySelector('[data-role="messages"]');
      this._suggestionsEl = panel.querySelector('[data-role="suggestions"]');
      this._suggestedLabelEl = panel.querySelector('[data-role="suggested-label"]');
      this._inputEl = panel.querySelector('[data-role="input"]');
      this._sendEl = panel.querySelector('[data-role="send"]');
      this._closeEl = panel.querySelector(".close");
      this._minEl = panel.querySelector(".min");
      this._imageBtn = panel.querySelector('[data-role="image-btn"]');
      this._micBtn = panel.querySelector('[data-role="mic-btn"]');
      this._contextPill = panel.querySelector('[data-role="context-pill"]');
      this._contextImg = panel.querySelector('[data-role="context-image"]');
      this._contextTitle = panel.querySelector('[data-role="context-title"]');
      this._newMsgPill = panel.querySelector('[data-role="new-msg"]');
      var nameEl = panel.querySelector('[data-role="agent-name"]');
      if (nameEl) nameEl.textContent = agentName;
      var subtitleEl = panel.querySelector('[data-role="agent-subtitle"]');
      if (subtitleEl) subtitleEl.textContent = this._config.agentSubtitle;

      // Toast lives at the shadow-root level (not inside .panel) so it's
      // visible after cart actions even if the panel scrolls or layout shifts.
      var toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      root.appendChild(toast);
      this._toastEl = toast;
      this._toastTimer = null;

      // event wiring
      this._closeEl.addEventListener("click", this._handleClose.bind(this));
      // Minimize button: same behavior as close in v1 (panel collapses, bubble
      // returns). State (messages, scroll position) is preserved across reopen.
      this._minEl.addEventListener("click", this._handleClose.bind(this));
      this._imageBtn.addEventListener("click", this._handleImageClick.bind(this));
      this._micBtn.addEventListener("click", this._handleMicClick.bind(this));
      this._inputEl.addEventListener("input", this._handleInput.bind(this));
      this._inputEl.addEventListener("keydown", this._handleKeyDown.bind(this));
      this._sendEl.addEventListener("click", this._handleSend.bind(this));
      this._messagesEl.addEventListener("scroll", this._handleScroll.bind(this));
      this._newMsgPill.addEventListener("click", this._handleNewMsgClick.bind(this));
      this._panel.addEventListener("keydown", this._handlePanelKeyDown.bind(this));

      this._maybePulse();
    }

    _installPublicApi() {
      var self = this;
      window.__aistylist = window.__aistylist || {};
      window.__aistylist.open = function () { self._handleOpen(); };
      window.__aistylist.close = function () { self._handleClose(); };
      window.__aistylist.openWithContext = function (payload) {
        var product = (payload && payload.product) || null;
        self._state.context = product;
        self._renderContextPill();
        self._handleOpen();
      };
    }

    // ────────── pulse-once gating ──────────
    _maybePulse() {
      try {
        if (window.sessionStorage.getItem(PULSE_FLAG_KEY)) return;
        this._bubble.classList.add("pulse");
        window.sessionStorage.setItem(PULSE_FLAG_KEY, "1");
        var self = this;
        window.setTimeout(function () { self._bubble.classList.remove("pulse"); }, 6000);
      } catch (e) { /* sessionStorage blocked — skip pulse */ }
    }

    // ────────── open / close ──────────
    _handleOpen() {
      if (this._state.open) return;
      this._state.open = true;
      this._previouslyFocused = document.activeElement;
      this._bubble.classList.add("hidden");
      this._panel.classList.add("open");

      if (this._state.messages.length === 0) this._showWelcome();

      var self = this;
      window.setTimeout(function () {
        var first = self._firstFocusable();
        if (first) first.focus();
      }, 50);
    }

    _handleClose() {
      if (!this._state.open) return;
      this._state.open = false;
      this._panel.classList.remove("open");
      this._bubble.classList.remove("hidden");
      var prev = this._previouslyFocused;
      if (prev && typeof prev.focus === "function") {
        try { prev.focus(); } catch (e) { this._bubble.focus(); }
      } else {
        this._bubble.focus();
      }
    }

    // ────────── focus trap ──────────
    _focusables() {
      return Array.prototype.slice.call(
        this._panel.querySelectorAll(
          'button:not([disabled]):not([aria-disabled="true"]), [href], input, [tabindex]:not([tabindex="-1"])'
        )
      );
    }
    _firstFocusable() {
      var list = this._focusables();
      return list.length ? list[0] : null;
    }

    _handlePanelKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        this._handleClose();
        return;
      }
      if (e.key !== "Tab") return;
      var nodes = this._focusables();
      if (nodes.length === 0) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      var active = this.shadowRoot.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // ────────── welcome state ──────────
    _showWelcome() {
      this._appendMessage({
        id: "welcome",
        role: "assistant",
        content: this._config.welcomeMessage,
        timestamp: Date.now(),
        suggestions: this._config.welcomeChips,
        isWelcome: true,
      });
    }

    // ────────── context pill ──────────
    _renderContextPill() {
      var ctx = this._state.context;
      if (!ctx) {
        this._contextPill.classList.remove("visible");
        return;
      }
      if (ctx.imageUrl) {
        this._contextImg.src = ctx.imageUrl;
        this._contextImg.style.display = "";
      } else {
        this._contextImg.style.display = "none";
      }
      this._contextTitle.textContent = ctx.title || ctx.handle || "";
      this._contextPill.classList.add("visible");
    }

    // ────────── messages ──────────
    _appendMessage(msg) {
      var nearBottom = this._isNearBottom();

      this._state.messages.push(msg);

      var node = document.createElement("div");
      node.className = "message " + msg.role;
      node.textContent = msg.content;
      this._messagesEl.appendChild(node);

      // 008 Phase 2 + 3: rich product cards inline below assistant bubble.
      // hadProducts (Claude searched) but products empty → show empty state.
      if (msg.role === "assistant") {
        if (Array.isArray(msg.products) && msg.products.length > 0) {
          this._renderCardsHeader(msg.products.length);
          this._renderProductCards(msg.products);
        } else if (msg.searched === true) {
          this._renderEmptyState();
        }
      }

      this._renderSuggestions(msg.suggestions || [], !!msg.isWelcome);

      if (nearBottom) {
        this._scrollToBottom(true);
      } else if (msg.role === "assistant") {
        this._showNewMsgPill();
      }
    }

    // ────────── product cards (008 Phase 2 + Phase 3 redesign) ──────────
    _renderCardsHeader(count) {
      var header = document.createElement("div");
      header.className = "cards-header";
      var label = document.createElement("span");
      label.className = "cards-header__count";
      label.textContent = count + (count === 1 ? " MATCH" : " MATCHES");
      header.appendChild(label);

      // "See all" links to Shopify's standard /search?q= page using the last
      // user query as the search term. Falls back to /collections/all when
      // there's no query (rare — only if cards arrive before any user turn).
      var query = (this._state.lastUserQuery || "").trim();
      var seeAll = document.createElement("a");
      seeAll.className = "seeall";
      seeAll.href = query
        ? "/search?q=" + encodeURIComponent(query)
        : "/collections/all";
      seeAll.innerHTML = "See all " + ICON_ARROW_NE;
      header.appendChild(seeAll);

      this._messagesEl.appendChild(header);
    }

    _renderProductCards(products) {
      var self = this;
      var row = document.createElement("div");
      row.className = "cards";
      row.setAttribute("role", "list");

      products.forEach(function (p) {
        row.appendChild(self._buildCard(p));
      });

      this._messagesEl.appendChild(row);
    }

    _buildCard(product) {
      var self = this;
      var card = document.createElement("div");
      card.className = "card";
      card.setAttribute("role", "listitem");

      // media (image + AI Pick badge overlay)
      var media = document.createElement("div");
      media.className = "card__media";
      if (product.imageUrl) {
        var img = document.createElement("img");
        img.src = product.imageUrl;
        img.alt = product.title || "";
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        media.appendChild(img);
      } else {
        media.classList.add("empty");
        media.innerHTML = ICON_SEARCH;
      }
      var badge = document.createElement("div");
      badge.className = "card__badge";
      badge.innerHTML = ICON_STAR + "<span>AI Pick</span>";
      media.appendChild(badge);
      media.addEventListener("click", function () { self._openProduct(product); });
      card.appendChild(media);

      // info: title + price row
      var info = document.createElement("div");
      info.className = "card__info";

      var titleEl = document.createElement("div");
      titleEl.className = "card__title";
      titleEl.textContent = product.title || "";
      titleEl.setAttribute("title", product.title || "");
      titleEl.addEventListener("click", function () { self._openProduct(product); });
      info.appendChild(titleEl);

      var priceRow = document.createElement("div");
      priceRow.className = "card__price-row";
      var numericPrice = typeof product.price === "number" ? product.price : Number(product.price);
      var priceEl = document.createElement("span");
      priceEl.className = "card__price";
      if (!isFinite(numericPrice) || numericPrice <= 0) {
        priceEl.classList.add("muted");
        priceEl.textContent = "Price on request";
      } else {
        priceEl.textContent = self._formatPrice(numericPrice, product.currency);
      }
      priceRow.appendChild(priceEl);
      // server has already null'd compareAtPrice when it isn't strictly
      // greater than price, so any non-null value here means "show strikethrough".
      if (product.compareAtPrice != null && isFinite(numericPrice) && numericPrice > 0) {
        var compareEl = document.createElement("span");
        compareEl.className = "card__compare";
        compareEl.textContent = self._formatPrice(product.compareAtPrice, product.currency);
        priceRow.appendChild(compareEl);
      }
      info.appendChild(priceRow);
      card.appendChild(info);

      // actions (stacked: Add to Cart on top, View Details below)
      var actions = document.createElement("div");
      actions.className = "card__actions";

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "card__btn add";
      var oos = !product.variantId || product.available === false;
      // Numeric variantId is required by /cart/add.js. The server already
      // extracted it from the GID; if it's missing or the variant isn't
      // available, disable the button and show "Out of Stock" copy.
      if (oos) {
        addBtn.innerHTML = "<span>Out of Stock</span>";
        addBtn.setAttribute("aria-disabled", "true");
        addBtn.disabled = true;
      } else {
        addBtn.innerHTML = ICON_CART + "<span>Add to Cart</span>";
        addBtn.addEventListener("click", function () {
          self._handleAddToCart(product, addBtn);
        });
      }
      actions.appendChild(addBtn);

      var viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "card__btn view";
      viewBtn.innerHTML = "<span>View Details</span>" + ICON_ARROW_NE;
      viewBtn.addEventListener("click", function () { self._openProduct(product); });
      actions.appendChild(viewBtn);

      card.appendChild(actions);

      return card;
    }

    // ────────── empty state (008 Phase 3 §3.9) ──────────
    _renderEmptyState() {
      var wrap = document.createElement("div");
      wrap.className = "empty-state";
      var icon = document.createElement("div");
      icon.className = "empty-state__icon";
      icon.innerHTML = ICON_SEARCH;
      wrap.appendChild(icon);
      var text = document.createElement("div");
      text.className = "empty-state__text";
      text.textContent = "No matching products found";
      wrap.appendChild(text);
      var cta = document.createElement("a");
      cta.className = "empty-cta";
      cta.href = "/collections/all";
      cta.textContent = "Browse all products";
      wrap.appendChild(cta);
      this._messagesEl.appendChild(wrap);
    }

    _openProduct(product) {
      if (!product || !product.productUrl) return;
      window.location.href = product.productUrl;
    }

    _handleAddToCart(product, btn) {
      var self = this;
      var variantId = product && product.variantId;
      // Defensive: only digits accepted. Phase 1 server already validates
      // by extracting the GID tail, but we double-check on the client to
      // avoid sending garbage to /cart/add.js.
      if (!variantId || !/^\d+$/.test(String(variantId))) {
        self._showToast("Couldn't add — check the product page", 3000);
        return;
      }
      if (btn.getAttribute("aria-busy") === "true") return;

      var prevHtml = btn.innerHTML;
      btn.setAttribute("aria-busy", "true");
      btn.disabled = true;
      btn.innerHTML = "<span>Adding…</span>";

      // Same-origin: widget runs on *.myshopify.com so /cart/add.js is
      // reachable without CORS. credentials default ('same-origin') ensures
      // the cart cookie is sent.
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ id: Number(variantId), quantity: 1 }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("cart_add_" + res.status);
          return res.json();
        })
        .then(function () {
          self._showToast("Added to cart", 2000);
          // Some themes listen for this to refresh a header cart badge. If
          // the theme doesn't listen, the badge updates on next nav — accepted
          // degradation per spec §5.4.3.
          try {
            document.dispatchEvent(new CustomEvent("cart:refresh", {
              detail: { variantId: String(variantId) },
            }));
          } catch (e) { /* IE-style CustomEvent not constructable — ignore */ }
        })
        .catch(function () {
          self._showToast("Couldn't add — check the product page", 3000);
        })
        .then(function () {
          btn.removeAttribute("aria-busy");
          btn.disabled = false;
          btn.innerHTML = prevHtml;
        });
    }

    // ────────── decorative icon handlers (008 Phase 3 §3.6) ──────────
    _handleImageClick() {
      this._showToast("Image upload coming soon", 2000);
    }

    _handleMicClick() {
      this._showToast("Voice input coming soon", 2000);
    }

    _showToast(text, durationMs) {
      if (!this._toastEl) return;
      this._toastEl.textContent = text;
      this._toastEl.classList.add("show");
      if (this._toastTimer) {
        window.clearTimeout(this._toastTimer);
      }
      var self = this;
      this._toastTimer = window.setTimeout(function () {
        self._toastEl.classList.remove("show");
        self._toastTimer = null;
      }, durationMs || 2000);
    }

    _formatPrice(amount, currency) {
      var ccy = currency || "INR";
      var value = typeof amount === "number" ? amount : Number(amount);
      if (!isFinite(value)) value = 0;
      // INR has no fractional part by convention in Indian retail; everything
      // else uses the locale default. Browsers without Intl fallback to a
      // plain numeric string.
      try {
        var fractionDigits = ccy === "INR" ? 0 : 2;
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: ccy,
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }).format(value);
      } catch (e) {
        return ccy + " " + value.toFixed(ccy === "INR" ? 0 : 2);
      }
    }

    _renderSuggestions(chips, isWelcome) {
      this._suggestionsEl.innerHTML = "";
      this._suggestionsEl.classList.toggle("welcome", !!isWelcome);
      if (this._suggestedLabelEl) {
        this._suggestedLabelEl.textContent = (isWelcome && chips && chips.length > 0)
          ? "SUGGESTED"
          : "";
      }
      if (!chips || chips.length === 0) return;
      var self = this;
      chips.forEach(function (text) {
        var btn = document.createElement("button");
        btn.className = "chip";
        btn.type = "button";
        btn.textContent = text;
        btn.addEventListener("click", function () {
          self._suggestionsEl.innerHTML = "";
          if (self._suggestedLabelEl) self._suggestedLabelEl.textContent = "";
          self._sendUserMessage(text);
        });
        self._suggestionsEl.appendChild(btn);
      });
    }

    // ────────── send flow ──────────
    _handleInput() {
      this._state.inputValue = this._inputEl.value;
      var disabled = this._state.inputValue.trim().length === 0;
      this._sendEl.setAttribute("aria-disabled", disabled ? "true" : "false");
    }

    _handleKeyDown(e) {
      // v1: single-line input only. Shift+Enter multi-line and rich types
      // (images, products, carousels) deferred to 009+.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._handleSend();
      }
    }

    _handleSend() {
      var text = this._state.inputValue.trim();
      if (!text || this._state.typing) return;
      this._inputEl.value = "";
      this._state.inputValue = "";
      this._sendEl.setAttribute("aria-disabled", "true");
      this._sendUserMessage(text);
    }

    _sendUserMessage(text) {
      this._state.lastUserQuery = text;
      var userMsg = {
        id: "u-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      this._appendMessage(userMsg);
      this._suggestionsEl.innerHTML = ""; // clear chips after send
      if (this._suggestedLabelEl) this._suggestedLabelEl.textContent = "";
      this._showTyping();

      var self = this;
      var history = this._state.messages.slice(-HISTORY_LIMIT).map(function (m) {
        return { role: m.role, content: m.content };
      });

      // v1: no analytics events fired here. chat_message_sent / chat_started
      // wire in 015. v1: no customer account linking (anonymous sessionId only).
      var payload = {
        sessionId: this._sessionId,
        shopDomain: this._config.shopDomain,
        text: text,
        context: this._state.context,
        history: history,
      };

      var attempt = function () {
        return fetch(self._config.chatEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "omit",
        });
      };

      attempt()
        .then(function (res) {
          if (!res.ok) throw new Error("chat_error_" + res.status);
          return res.json();
        })
        .then(function (data) {
          self._hideTyping();
          if (data && data.message) {
            var hadProducts = Array.isArray(data.message.products);
            self._appendMessage({
              id: data.message.id,
              role: "assistant",
              content: data.message.content,
              timestamp: data.message.timestamp || Date.now(),
              suggestions: data.message.suggestions || [],
              products: hadProducts ? data.message.products : [],
              // 008 Phase 3: server flag tells us whether the search tool
              // ran. Drives the empty-state UI when it ran but returned 0.
              // Older servers (pre-Phase-3) won't set this field; in that
              // case we fall back to "no empty state" rather than guessing.
              searched: data.message.searched === true
                && hadProducts
                && data.message.products.length === 0,
            });
          }
        })
        .catch(function () {
          self._hideTyping();
          // Network / server failure — append assistant message with an
          // error badge attached, plus a top-level toast.
          self._showToast("Connection issue — please check your connection", 3000);
          self._appendErrorMessage(text);
        });
    }

    _appendErrorMessage(retryText) {
      var msgNode = document.createElement("div");
      msgNode.className = "message assistant";
      msgNode.textContent = "Sorry, I couldn't reach the server.";
      this._messagesEl.appendChild(msgNode);
      this._state.messages.push({
        id: "err-" + Date.now(),
        role: "assistant",
        content: "Sorry, I couldn't reach the server.",
        timestamp: Date.now(),
      });

      // Inline retry badge — clicking re-sends the original user text.
      var badge = document.createElement("div");
      badge.className = "error-badge";
      badge.innerHTML = ICON_WARN + "<span>AI offline</span>";
      var retry = document.createElement("button");
      retry.type = "button";
      retry.className = "retry";
      retry.textContent = "Retry";
      var self = this;
      retry.addEventListener("click", function () {
        // Single-shot retry — remove this badge, then re-run the send flow.
        if (badge.parentNode) badge.parentNode.removeChild(badge);
        self._sendUserMessage(retryText);
      });
      badge.appendChild(retry);
      this._messagesEl.appendChild(badge);

      this._renderSuggestions([], false);
      if (this._isNearBottom()) this._scrollToBottom(true);
    }

    // ────────── typing indicator ──────────
    _showTyping() {
      if (this._state.typing) return;
      this._state.typing = true;
      var node = document.createElement("div");
      node.className = "typing";
      node.setAttribute("aria-label", this._config.agentName + " is typing");
      node.innerHTML = "<span></span><span></span><span></span>";
      this._typingNode = node;
      this._messagesEl.appendChild(node);
      if (this._isNearBottom()) this._scrollToBottom(true);
    }

    _hideTyping() {
      this._state.typing = false;
      if (this._typingNode && this._typingNode.parentNode) {
        this._typingNode.parentNode.removeChild(this._typingNode);
      }
      this._typingNode = null;
    }

    // ────────── scroll behavior ──────────
    _isNearBottom() {
      var el = this._messagesEl;
      return el.scrollHeight - (el.scrollTop + el.clientHeight) < SCROLL_THRESHOLD_PX;
    }

    _scrollToBottom(smooth) {
      var el = this._messagesEl;
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      this._hideNewMsgPill();
    }

    _showNewMsgPill() {
      this._state.newMsgPillVisible = true;
      this._newMsgPill.classList.add("visible");
    }
    _hideNewMsgPill() {
      this._state.newMsgPillVisible = false;
      this._newMsgPill.classList.remove("visible");
    }

    _handleScroll() {
      if (this._state.newMsgPillVisible && this._isNearBottom()) this._hideNewMsgPill();
    }

    _handleNewMsgClick() {
      this._scrollToBottom(true);
    }
  }

  if (!window.customElements.get("aistylist-widget")) {
    window.customElements.define("aistylist-widget", AIStylistWidget);
  }
})();
