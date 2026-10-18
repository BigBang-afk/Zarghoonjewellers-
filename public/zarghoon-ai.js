/*!
 * Zarghoon AI — embeddable chat loader.
 *
 * Add ONE line to any existing website (Shopify, WordPress/WooCommerce, Wix,
 * Squarespace, custom…), just before </body>:
 *
 *   <script src="https://YOUR-ZARGHOON-AI-HOST/zarghoon-ai.js" defer></script>
 *
 * Optional: data-position="left" to show the button bottom-left.
 * Optional JS API: window.ZarghoonAI.open() / window.ZarghoonAI.close()
 *
 * What it does: draws a launcher button and, when clicked, opens the chat in
 * an iframe served by the Zarghoon AI host. It does not read the page, its
 * cookies or its forms, and stores nothing on this website. Everything lives
 * in a Shadow DOM so the store's styles and the widget never interfere.
 */
(function () {
  "use strict";
  if (window.ZarghoonAI) return; // already loaded

  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;
  var left = script.getAttribute("data-position") === "left";

  var host = document.createElement("div");
  host.id = "zarghoon-ai-widget";
  host.setAttribute("data-testid", "zarghoon-ai-host");
  var root = host.attachShadow({ mode: "open" });

  var side = left ? "left" : "right";
  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    ".zj-btn{position:fixed;bottom:20px;" + side + ":20px;z-index:2147483646;width:64px;height:64px;border-radius:9999px;" +
    "border:1px solid rgba(184,145,47,.45);background:#1c1712;color:#b8912f;cursor:pointer;display:flex;align-items:center;justify-content:center;" +
    "box-shadow:0 10px 30px -5px rgba(28,23,18,.45);transition:transform .15s ease,border-color .15s ease;padding:0}" +
    ".zj-btn:hover{transform:scale(1.05);border-color:#b8912f}" +
    ".zj-btn:focus-visible{outline:3px solid rgba(184,145,47,.6);outline-offset:3px}" +
    ".zj-btn[hidden],.zj-frame[hidden]{display:none}" +
    ".zj-frame{position:fixed;bottom:24px;" + side + ":24px;z-index:2147483647;width:400px;height:min(680px,calc(100vh - 48px));" +
    "border:1px solid rgba(184,145,47,.25);border-radius:24px;overflow:hidden;background:#faf7f2;box-shadow:0 25px 50px -12px rgba(0,0,0,.35)}" +
    ".zj-frame iframe{width:100%;height:100%;border:0;display:block}" +
    "@media (max-width:639px){.zj-frame{inset:0;width:100%;height:100%;border-radius:0;border:0}}" +
    "</style>" +
    '<button class="zj-btn" type="button" aria-label="Open Zarghoon AI chat" data-testid="zarghoon-ai-launcher">' +
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 4h10l4 5-9 11L3 9z M3 9h18 M9 4 7 9l5 11 5-11-2-5"/></svg></button>' +
    '<div class="zj-frame" hidden data-testid="zarghoon-ai-frame"></div>';

  var button = root.querySelector(".zj-btn");
  var frame = root.querySelector(".zj-frame");
  var iframe = null;

  function open() {
    if (!iframe) {
      // Created on first open, then kept so the conversation stays on screen.
      iframe = document.createElement("iframe");
      iframe.src = origin + "/embed/chat";
      iframe.title = "Zarghoon AI chat";
      iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation",
      );
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      frame.appendChild(iframe);
    }
    frame.hidden = false;
    button.hidden = true;
    if (iframe.contentWindow) iframe.focus();
  }

  function close() {
    frame.hidden = true;
    button.hidden = false;
    button.focus();
  }

  button.addEventListener("click", open);

  // Only UI events, and only from the Zarghoon AI origin, are accepted.
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || !iframe || event.source !== iframe.contentWindow) return;
    if (event.data && event.data.type === "zarghoon-ai:close") close();
  });

  function mount() {
    document.body.appendChild(host);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  window.ZarghoonAI = { open: open, close: close };
})();
