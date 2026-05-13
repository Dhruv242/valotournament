// Public-only config. NEVER put secret keys here — anything in this file is
// readable in the browser.
window.APP_CONFIG = {
  // Backend is served under /api on the same host (see ingress.yaml).
  // Same-origin requests avoid CORS preflight and make the CSP simpler.
  apiBaseUrl: "/api",
  appName: "VALO Champions",
  adminUsername: "skull_dk_up81",
};
