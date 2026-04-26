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
 *   - Industry-neutral suggestions; mode-aware chips come in 011.
 *   - Text messages only; rich types (images, products, carousels) come in 009+.
 *   - No analytics events; chat_started / chat_ended wired in 015.
 *   - Single-line input; no Shift+Enter multi-line, no file/image uploads.
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
  // Defensive fallback only. The Liquid template injects agentName from
  // the app:ai_stylist/chat_config metafield, populated by /app/config and
  // by ensureMerchantConfig on install — so this default should never be
  // observed in practice. Kept so a missing/corrupted metafield doesn't
  // render an empty header.
  var DEFAULT_AGENT_NAME = "AI Assistant";

  // Industry-neutral default chips on welcome state.
  // v1: not mode-aware. Mode-aware chips come in 011.
  var WELCOME_CHIPS = [
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
    ":host { all: initial; --aistylist-primary: " + DEFAULT_PRIMARY_COLOR + "; --aistylist-fg-on-primary: #ffffff; --aistylist-bg: #ffffff; --aistylist-text: #18181b; --aistylist-muted: #71717a; --aistylist-surface: #f4f4f5; --aistylist-border: #e4e4e7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; color: var(--aistylist-text); position: fixed; bottom: 0; right: 0; z-index: 999998; pointer-events: none; }",
    ":host *, :host *::before, :host *::after { box-sizing: border-box; }",
    ".bubble, .panel, .chip, .send, .close, .pill, .new-msg { pointer-events: auto; }",
    // bubble
    ".bubble { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%; background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; transition: transform 150ms ease, opacity 200ms ease, box-shadow 200ms ease; }",
    ".bubble:hover { transform: scale(1.05); box-shadow: 0 6px 22px rgba(0,0,0,0.2); }",
    ".bubble:active { transform: scale(0.95); }",
    ".bubble svg { width: 26px; height: 26px; }",
    ".bubble.hidden { opacity: 0; pointer-events: none; transform: scale(0.9); }",
    ".bubble.pulse { animation: aistylist-pulse 2s ease-in-out 3; }",
    "@keyframes aistylist-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.03); opacity: 0.85; } }",
    // panel
    ".panel { position: fixed; bottom: 96px; right: 24px; width: 380px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 120px); background: var(--aistylist-bg); border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; opacity: 0; transform: scale(0.95) translateY(20px); transition: opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1); pointer-events: none; }",
    ".panel.open { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; transition-duration: 400ms; }",
    // header
    ".header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--aistylist-border); background: var(--aistylist-bg); }",
    ".branding { font-weight: 600; font-size: 15px; }",
    ".close { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; color: var(--aistylist-muted); display: flex; align-items: center; justify-content: center; transition: background-color 150ms ease, color 150ms ease; }",
    ".close:hover { background: var(--aistylist-surface); color: var(--aistylist-text); }",
    ".close svg { width: 18px; height: 18px; }",
    // context pill
    ".context-pill { display: none; align-items: center; gap: 10px; padding: 10px 16px; background: var(--aistylist-surface); border-bottom: 1px solid var(--aistylist-border); font-size: 13px; }",
    ".context-pill.visible { display: flex; }",
    ".context-pill img { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }",
    ".context-pill__label { color: var(--aistylist-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }",
    ".context-pill__title { font-weight: 500; color: var(--aistylist-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".context-pill__text { min-width: 0; flex: 1; }",
    // messages
    ".messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; position: relative; }",
    ".message { max-width: 80%; padding: 10px 14px; line-height: 1.4; font-size: 14px; word-wrap: break-word; animation: aistylist-msg-in 250ms ease-out; }",
    "@keyframes aistylist-msg-in { from { opacity: 0; transform: scale(0.9) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }",
    ".message.assistant { align-self: flex-start; background: var(--aistylist-surface); color: var(--aistylist-text); border-radius: 16px 16px 16px 4px; }",
    ".message.user { align-self: flex-end; background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border-radius: 16px 16px 4px 16px; }",
    // typing
    ".typing { align-self: flex-start; padding: 12px 14px; background: var(--aistylist-surface); border-radius: 16px 16px 16px 4px; display: flex; gap: 4px; }",
    ".typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--aistylist-muted); display: inline-block; opacity: 0.4; animation: aistylist-bounce 0.6s infinite; }",
    ".typing span:nth-child(2) { animation-delay: 0.2s; }",
    ".typing span:nth-child(3) { animation-delay: 0.4s; }",
    "@keyframes aistylist-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-4px); opacity: 1; } }",
    // product cards (008 Phase 2)
    // Mobile: horizontal scroll with snap; desktop: wrap to grid via media query.
    ".cards { display: flex; gap: 8px; padding: 4px 0 8px; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; align-self: stretch; }",
    ".cards::-webkit-scrollbar { height: 4px; }",
    ".cards::-webkit-scrollbar-thumb { background: var(--aistylist-border); border-radius: 2px; }",
    ".card { width: 200px; flex: 0 0 200px; scroll-snap-align: start; background: var(--aistylist-bg); border: 1px solid var(--aistylist-border); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }",
    ".card__image { width: 100%; aspect-ratio: 1 / 1; background: var(--aistylist-surface); display: block; }",
    ".card__image img { width: 100%; height: 100%; object-fit: cover; display: block; }",
    ".card__image.empty { display: flex; align-items: center; justify-content: center; color: var(--aistylist-muted); font-size: 12px; text-align: center; padding: 8px; }",
    ".card__info { padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; flex: 1; }",
    ".card__title { font-size: 13px; font-weight: 500; line-height: 1.3; color: var(--aistylist-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; min-height: 2.6em; }",
    ".card__price-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }",
    ".card__price { font-size: 14px; font-weight: 600; color: var(--aistylist-text); }",
    ".card__compare { font-size: 12px; color: var(--aistylist-muted); text-decoration: line-through; }",
    ".card__actions { display: flex; gap: 6px; padding: 0 10px 10px; }",
    ".card__btn { flex: 1; font-family: inherit; font-size: 12px; font-weight: 500; padding: 7px 8px; border-radius: 8px; cursor: pointer; transition: opacity 150ms ease, transform 150ms ease, background-color 150ms ease; }",
    ".card__btn:active { transform: scale(0.97); }",
    ".card__btn.view { background: var(--aistylist-bg); border: 1px solid var(--aistylist-border); color: var(--aistylist-text); }",
    ".card__btn.view:hover { background: var(--aistylist-surface); }",
    ".card__btn.add { background: var(--aistylist-primary); border: 1px solid var(--aistylist-primary); color: var(--aistylist-fg-on-primary); }",
    ".card__btn.add[aria-disabled='true'] { opacity: 0.5; cursor: not-allowed; }",
    ".card__btn.add[aria-busy='true'] { opacity: 0.7; cursor: wait; }",
    "@media (min-width: 641px) { .cards { flex-wrap: wrap; overflow-x: visible; } .card { flex: 0 0 calc(50% - 4px); width: auto; } }",
    // toast (cart confirmation)
    ".toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 500; box-shadow: 0 6px 20px rgba(0,0,0,0.2); opacity: 0; pointer-events: none; transition: opacity 200ms ease, transform 200ms ease; z-index: 999999; max-width: calc(100vw - 32px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".toast.show { opacity: 1; transform: translate(-50%, 0); }",
    // suggestions
    ".suggestions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 8px; }",
    ".suggestions:empty { display: none; }",
    ".chip { background: var(--aistylist-bg); border: 1px solid var(--aistylist-border); border-radius: 999px; padding: 6px 12px; font-size: 13px; color: var(--aistylist-text); cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease; font-family: inherit; }",
    ".chip:hover { background: var(--aistylist-surface); border-color: var(--aistylist-muted); }",
    ".chip:active { transform: scale(0.97); }",
    ".chip:focus-visible { outline: 2px solid var(--aistylist-primary); outline-offset: 2px; }",
    // footer / input
    ".footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--aistylist-border); background: var(--aistylist-bg); }",
    ".input { flex: 1; border: 1px solid var(--aistylist-border); border-radius: 999px; padding: 10px 14px; font-size: 14px; outline: none; font-family: inherit; color: var(--aistylist-text); background: var(--aistylist-bg); transition: border-color 150ms ease, box-shadow 150ms ease; }",
    ".input:focus { border-color: var(--aistylist-primary); box-shadow: 0 0 0 3px rgba(0,0,0,0.06); }",
    ".send { background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 150ms ease, transform 150ms ease; }",
    ".send:hover:not([aria-disabled='true']) { transform: scale(1.05); }",
    ".send:active:not([aria-disabled='true']) { transform: scale(0.95); }",
    ".send[aria-disabled='true'] { opacity: 0.4; cursor: not-allowed; }",
    ".send svg { width: 16px; height: 16px; }",
    // new-message pill
    ".new-msg { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); background: var(--aistylist-primary); color: var(--aistylist-fg-on-primary); border: none; border-radius: 999px; padding: 6px 14px; font-size: 12px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; pointer-events: none; transition: opacity 200ms ease; font-family: inherit; }",
    ".new-msg.visible { opacity: 1; pointer-events: auto; }",
    // mobile
    "@media (max-width: 640px) {",
    "  .bubble { width: 48px; height: 48px; bottom: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); }",
    "  .bubble svg { width: 22px; height: 22px; }",
    "  .panel { width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; bottom: 0; right: 0; border-radius: 0; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }",
    "  @supports (height: 100dvh) { .panel { height: 100dvh; max-height: 100dvh; } }",
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
  var ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
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
      this._config = {
        shopDomain: config.shopDomain || (window.Shopify && window.Shopify.shop) || "",
        primaryColor: config.primaryColor || DEFAULT_PRIMARY_COLOR,
        welcomeMessage: config.welcomeMessage || DEFAULT_WELCOME,
        agentName: rawAgentName || DEFAULT_AGENT_NAME,
        chatEndpoint: config.chatEndpoint || "/api/chat/message",
      };

      this._state = {
        open: false,
        messages: [],
        typing: false,
        context: null,
        inputValue: "",
        newMsgPillVisible: false,
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
      '  <div class="branding" data-role="branding"></div>' +
      '  <button class="close" aria-label="Close chat">' + ICON_CLOSE + "</button>" +
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
      '<div class="suggestions" data-role="suggestions"></div>' +
      '<div class="footer">' +
      '  <input class="input" data-role="input" type="text" placeholder="Type a message..." aria-label="Message" autocomplete="off">' +
      '  <button class="send" data-role="send" aria-label="Send message" aria-disabled="true">' + ICON_SEND + "</button>" +
      "</div>";
    root.appendChild(panel);
    this._panel = panel;
    this._messagesEl = panel.querySelector('[data-role="messages"]');
    this._suggestionsEl = panel.querySelector('[data-role="suggestions"]');
    this._inputEl = panel.querySelector('[data-role="input"]');
    this._sendEl = panel.querySelector('[data-role="send"]');
    this._closeEl = panel.querySelector(".close");
    this._contextPill = panel.querySelector('[data-role="context-pill"]');
    this._contextImg = panel.querySelector('[data-role="context-image"]');
    this._contextTitle = panel.querySelector('[data-role="context-title"]');
    this._newMsgPill = panel.querySelector('[data-role="new-msg"]');
    var brandingEl = panel.querySelector('[data-role="branding"]');
    if (brandingEl) brandingEl.textContent = agentName;

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
        suggestions: WELCOME_CHIPS,
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

      // 008 Phase 2: rich product cards inline below assistant bubble.
      if (msg.role === "assistant" && Array.isArray(msg.products) && msg.products.length > 0) {
        this._renderProductCards(msg.products);
      }

      this._renderSuggestions(msg.suggestions || []);

      if (nearBottom) {
        this._scrollToBottom(true);
      } else if (msg.role === "assistant") {
        this._showNewMsgPill();
      }
    }

    // ────────── product cards (008 Phase 2) ──────────
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

      // image area (or empty placeholder when no featured image)
      var imageWrap = document.createElement("div");
      imageWrap.className = "card__image";
      if (product.imageUrl) {
        var img = document.createElement("img");
        img.src = product.imageUrl;
        img.alt = product.title || "";
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        imageWrap.appendChild(img);
      } else {
        imageWrap.classList.add("empty");
        imageWrap.textContent = "No image";
      }
      // image and title both navigate to the product page (same tab).
      imageWrap.addEventListener("click", function () { self._openProduct(product); });
      imageWrap.style.cursor = "pointer";
      card.appendChild(imageWrap);

      // info: title + price row
      var info = document.createElement("div");
      info.className = "card__info";

      var titleEl = document.createElement("div");
      titleEl.className = "card__title";
      titleEl.textContent = product.title || "";
      titleEl.setAttribute("title", product.title || "");
      titleEl.style.cursor = "pointer";
      titleEl.addEventListener("click", function () { self._openProduct(product); });
      info.appendChild(titleEl);

      var priceRow = document.createElement("div");
      priceRow.className = "card__price-row";
      var priceEl = document.createElement("span");
      priceEl.className = "card__price";
      priceEl.textContent = self._formatPrice(product.price, product.currency);
      priceRow.appendChild(priceEl);
      // server has already null'd compareAtPrice when it isn't strictly
      // greater than price, so any non-null value here means "show strikethrough".
      if (product.compareAtPrice != null) {
        var compareEl = document.createElement("span");
        compareEl.className = "card__compare";
        compareEl.textContent = self._formatPrice(product.compareAtPrice, product.currency);
        priceRow.appendChild(compareEl);
      }
      info.appendChild(priceRow);
      card.appendChild(info);

      // actions
      var actions = document.createElement("div");
      actions.className = "card__actions";

      var viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "card__btn view";
      viewBtn.textContent = "View";
      viewBtn.addEventListener("click", function () { self._openProduct(product); });
      actions.appendChild(viewBtn);

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "card__btn add";
      addBtn.textContent = "Add to cart";
      // Numeric variantId is required by /cart/add.js. The server already
      // extracted it from the GID; if it's missing or the variant isn't
      // available, disable the button.
      if (!product.variantId || product.available === false) {
        addBtn.setAttribute("aria-disabled", "true");
        addBtn.disabled = true;
      } else {
        addBtn.addEventListener("click", function () {
          self._handleAddToCart(product, addBtn);
        });
      }
      actions.appendChild(addBtn);
      card.appendChild(actions);

      return card;
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

      var prevLabel = btn.textContent;
      btn.setAttribute("aria-busy", "true");
      btn.disabled = true;
      btn.textContent = "Adding…";

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
          btn.textContent = prevLabel;
        });
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

    _renderSuggestions(chips) {
      this._suggestionsEl.innerHTML = "";
      if (!chips || chips.length === 0) return;
      var self = this;
      chips.forEach(function (text) {
        var btn = document.createElement("button");
        btn.className = "chip";
        btn.type = "button";
        btn.textContent = text;
        btn.addEventListener("click", function () {
          self._suggestionsEl.innerHTML = "";
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
      var userMsg = {
        id: "u-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      this._appendMessage(userMsg);
      this._suggestionsEl.innerHTML = ""; // clear chips after send
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

      fetch(this._config.chatEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
      })
        .then(function (res) {
          if (!res.ok) throw new Error("chat_error_" + res.status);
          return res.json();
        })
        .then(function (data) {
          self._hideTyping();
          if (data && data.message) {
            self._appendMessage({
              id: data.message.id,
              role: "assistant",
              content: data.message.content,
              timestamp: data.message.timestamp || Date.now(),
              suggestions: data.message.suggestions || [],
              products: Array.isArray(data.message.products) ? data.message.products : [],
            });
          }
        })
        .catch(function () {
          self._hideTyping();
          self._appendMessage({
            id: "err-" + Date.now(),
            role: "assistant",
            content: "Sorry, I couldn't reach the server. Please try again.",
            timestamp: Date.now(),
            suggestions: [],
          });
        });
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
