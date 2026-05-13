(function bootstrapTournamentApp() {
  const config = window.APP_CONFIG || {};
  const apiBaseUrl = (config.apiBaseUrl || "").replace(/\/$/, "");
  const adminUsername = (config.adminUsername || "").trim().toLowerCase();
  const storageKey = "valrift-session";

  const state = {
    auth: {
      userId: null,
      username: "",
      role: "player",
      token: "",
      isAuthenticated: false,
    },
    team: null,
    roster: [],
    selectedType: "amateur",
    dashboard: null,
    agents: {},          // uuid -> { uuid, displayName, displayIcon, displayIconSmall, role }
    selectedAgentId: null,
  };

  const elements = {
    tierPicks: document.querySelectorAll(".tier-pick"),
    views: document.querySelectorAll(".app-view"),
    navLinks: document.querySelectorAll("[data-nav]"),
    heroSignin: document.getElementById("hero-signin"),
    registerSignin: document.getElementById("register-signin"),
    authFirstBanner: document.getElementById("auth-first-banner"),
    registrationGrid: document.getElementById("registration-grid"),
    authToggle: document.getElementById("auth-toggle"),
    authDropdown: document.getElementById("auth-dropdown"),
    authTabs: document.querySelectorAll(".auth-tab"),
    authPanels: document.querySelectorAll(".auth-panel"),
    loginForm: document.getElementById("login-form"),
    registerForm: document.getElementById("register-form"),
    logoutButton: document.getElementById("logout-button"),
    teamForm: document.getElementById("team-form"),
    playerForm: document.getElementById("player-form"),
    paymentForm: document.getElementById("payment-form"),
    lookupForm: document.getElementById("lookup-form"),
    refreshDashboard: document.getElementById("refresh-dashboard"),
    loginUsername: document.getElementById("login-username"),
    loginPassword: document.getElementById("login-password"),
    loginRole: document.getElementById("login-role"),
    registerUsername: document.getElementById("register-username"),
    registerPhone: document.getElementById("register-phone"),
    registerPassword: document.getElementById("register-password"),
    registerRole: document.getElementById("register-role"),
    authStatusName: document.getElementById("auth-status-name"),
    authStatusRole: document.getElementById("auth-status-role"),
    authCapabilities: document.getElementById("auth-capabilities"),
    activityCard: document.getElementById("activity-card"),
    teamName: document.getElementById("team-name"),
    sessionTeamName: document.getElementById("session-team-name"),
    sessionTeamId: document.getElementById("session-team-id"),
    rosterList: document.getElementById("roster-list"),
    activityFeed: document.getElementById("activity-feed"),
    tournamentType: document.getElementById("tournament-type"),
    lookupType: document.getElementById("lookup-type"),
    lookupTeamId: document.getElementById("lookup-team-id"),
    queueTitle: document.getElementById("queue-title"),
    queueSummary: document.getElementById("queue-summary"),
    bracketMap: document.getElementById("bracket-map"),
    fixtureList: document.getElementById("fixture-list"),
    agentPicker: document.getElementById("agent-picker"),
    teamAgentId: document.getElementById("team-agent-id"),
    mySquadsGrid: document.getElementById("my-squads-grid"),
    mySquadsCounter: document.getElementById("my-squads-counter"),
    mySquadsNew: document.getElementById("my-squads-new"),
    mySquadsRefresh: document.getElementById("my-squads-refresh"),
  };

  const MAX_TEAMS_PER_OWNER = 5;

  function openAuthDropdown(tab) {
    elements.authDropdown.classList.remove("hidden");
    switchAuthTab(tab || "login");

    // Add visual pulse to highlight the dropdown location
    elements.authToggle.style.animation = "pulse 0.5s ease-in-out 2";
    setTimeout(() => {
      elements.authToggle.style.animation = "";
    }, 1000);

    showToast("Sign In Form", "Auth form opened in top-right corner ↗️");
  }

  function switchAuthTab(tab) {
    const target = tab === "register" ? "register" : "login";
    elements.authTabs.forEach(function (btn) {
      const isActive = btn.getAttribute("data-auth-tab") === target;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    elements.authPanels.forEach(function (panel) {
      panel.classList.toggle("hidden", panel.getAttribute("data-auth-panel") !== target);
    });
    const focusEl = target === "register" ? elements.registerUsername : elements.loginUsername;
    if (focusEl) {
      try { focusEl.focus(); } catch (e) {}
    }
  }

  function setView(viewName) {
    // Admin access control — toggle body class; the CSS rule does the rest.
    // Wipes any prior inline display:'block' that earlier versions may have set.
    const adminLink = document.querySelector('[data-nav="admin"]');
    if (adminLink) adminLink.style.display = '';
    document.body.classList.toggle('is-authenticated', !!state.auth.isAuthenticated);
    if (state.auth.isAuthenticated && state.auth.role === 'admin') {
      document.body.classList.add('is-admin');
    } else {
      document.body.classList.remove('is-admin');
    }

    // Restrict admin view access
    if (viewName === 'admin') {
      if (!state.auth.isAuthenticated || state.auth.role !== 'admin') {
        showToast('Admin access denied', 'Only administrators can access this section.');
        viewName = 'home';
      }
    }

    const targetView = document.querySelector('[data-view="' + viewName + '"]');
    const nextView = targetView ? viewName : "home";
    elements.views.forEach(function toggleView(view) {
      view.classList.toggle("active-view", view.getAttribute("data-view") === nextView);
    });
    window.location.hash = nextView;
    window.scrollTo({ top: 0, behavior: "smooth" });
    
    // Load admin dashboard when switching to admin view
    if (nextView === 'admin' && state.auth.role === 'admin') {
      loadAdminDashboard();
    }

    // Refresh My Squads whenever we enter that view
    if (nextView === 'my-squads' && state.auth.isAuthenticated) {
      loadMySquads();
    }
  }

  function saveSession() {
    const payload = {
      auth: state.auth,
      team: state.team,
      roster: state.roster,
      selectedType: state.selectedType,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }

  function loadSession() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      if (!saved) return;
      state.auth = {
        userId: saved.auth && saved.auth.userId ? saved.auth.userId : null,
        username: saved.auth && saved.auth.username ? saved.auth.username : "",
        role: saved.auth && saved.auth.role ? saved.auth.role : "player",
        token: saved.auth && saved.auth.token ? saved.auth.token : "",
        isAuthenticated: Boolean(saved.auth && saved.auth.isAuthenticated),
      };
      state.team = saved.team || null;
      state.roster = Array.isArray(saved.roster) ? saved.roster : [];
      state.selectedType = saved.selectedType || "amateur";
    } catch (error) {
      console.warn("Unable to restore session", error);
    }
  }

  function showToast(title, message) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = "<strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(message) + "</span>";
    document.body.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 3600);
  }

  function pushActivity(title, message) {
    if (!isAdmin()) {
      return;
    }
    const item = document.createElement("div");
    item.className = "feed-item";
    item.innerHTML =
      "<strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(message) + "</span>";
    elements.activityFeed.prepend(item);
  }

  function isAdmin() {
    return state.auth.isAuthenticated && state.auth.role === "admin";
  }

  function isPlayer() {
    return state.auth.isAuthenticated && state.auth.role === "player";
  }

  function requireAuth() {
    if (state.auth.isAuthenticated) {
      return true;
    }

    showToast("Login required", "Sign in with Gmail before using tournament actions.");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      openAuthDropdown();
    }, 300);
    return false;
  }

  function isConfiguredAdminUsername(username) {
    return Boolean(adminUsername) && username.trim().toLowerCase() === adminUsername;
  }

  function renderAuthState() {
    if (!state.auth.isAuthenticated) {
      elements.authStatusName.textContent = "Guest";
      elements.authStatusRole.textContent = "Sign in to unlock registration and dashboards.";
      if (elements.loginUsername) elements.loginUsername.value = "";
      if (elements.loginPassword) elements.loginPassword.value = "";
      if (elements.loginRole) elements.loginRole.value = "player";
      if (elements.registerUsername) elements.registerUsername.value = "";
      if (elements.registerPhone) elements.registerPhone.value = "";
      if (elements.registerPassword) elements.registerPassword.value = "";
      if (elements.registerRole) elements.registerRole.value = "player";
      elements.authCapabilities.innerHTML =
        "<li>Guest mode has no registration or dashboard access.</li>";
      elements.activityCard.classList.remove("hidden");
      elements.authToggle.textContent = "Sign In";
      elements.authFirstBanner.classList.remove("hidden");
      elements.registrationGrid.classList.add("locked");
      elements.registrationGrid.classList.remove("unlocked");
      return;
    }

    elements.authStatusName.textContent = state.auth.username;
    elements.authStatusRole.textContent =
      state.auth.role === "admin"
        ? "Admin access enabled. Full operational visibility unlocked."
        : "Player access enabled. Activity feed is hidden from team members.";
    if (elements.loginUsername) elements.loginUsername.value = state.auth.username;
    if (elements.loginPassword) elements.loginPassword.value = "";
    if (elements.loginRole) elements.loginRole.value = state.auth.role;

    const capabilities = isAdmin()
      ? [
          "View registration activity and admin-facing session events.",
          "Create teams, add players, launch payments, and inspect tournament dashboards.",
          "Manage users, payments, and tournament fixtures from the admin console.",
        ]
      : [
          "Create teams, add players, pay tournament entry, and open the bracket dashboard.",
          "Activity feed is hidden to keep player view limited to team operations.",
          "Your username is locked to your account — choose carefully at registration.",
        ];

    elements.authCapabilities.innerHTML = capabilities
      .map(function mapCapability(item) {
        return "<li>" + escapeHtml(item) + "</li>";
      })
      .join("");

    elements.activityCard.classList.toggle("hidden", isPlayer());
    elements.authToggle.textContent = isAdmin()
      ? state.auth.username + " · Admin"
      : state.auth.username + " · Player";
    elements.authFirstBanner.classList.add("hidden");
    elements.registrationGrid.classList.remove("locked");
    elements.registrationGrid.classList.add("unlocked");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderSession() {
    renderAuthState();

    if (!state.team) {
      elements.sessionTeamName.textContent = "No team selected";
      elements.sessionTeamId.textContent = "Create a team to begin.";
      elements.lookupTeamId.value = "";
    } else {
      elements.sessionTeamName.textContent = state.team.name;
      elements.sessionTeamId.textContent = "Team ID #" + state.team.id;
      elements.lookupTeamId.value = String(state.team.id);
    }

    elements.tournamentType.value = state.selectedType;
    elements.lookupType.value = state.selectedType;

    if (!state.roster.length) {
      elements.rosterList.innerHTML = "<li><span>No players added yet.</span><span>0/6</span></li>";
      return;
    }

    elements.rosterList.innerHTML = state.roster
      .map(function mapPlayer(player, index) {
        // Backend rows use full_name / valorant_tag; live add responses may also
        // carry name / tag. Support both so re-logged-in users see their roster.
        const displayName = player.name || player.full_name || player.valorant_name || "Unnamed";
        const tag = player.tag || player.valorant_tag || "";
        const riotId = [player.valorant_name, tag].filter(Boolean).join("#");
        return (
          "<li><span>" +
          escapeHtml((index + 1) + ". " + displayName) +
          "</span><span>" +
          escapeHtml(riotId) +
          "</span></li>"
        );
      })
      .join("");
  }

  // Shared post-auth handler used by both login + register flows.
  async function applyAuthPayload(payload, fallbackRole) {
    const user = (payload && payload.user) || {};
    const username = user.username || "";
    const role = user.role || fallbackRole || "player";

    const sameUser =
      state.auth.isAuthenticated &&
      state.auth.username === username &&
      state.auth.role === role;

    state.auth = {
      userId: user.id || null,
      username: username,
      role: role,
      token: payload && payload.token ? payload.token : "",
      isAuthenticated: true,
    };

    if (!sameUser) {
      state.team = null;
      state.roster = [];
      state.dashboard = null;
    }

    await restoreUserTeam();

    saveSession();
    renderSession();
    if (!sameUser && !state.team) {
      initEmptyDashboard();
    }
    elements.authDropdown.classList.add("hidden");

    if (role === "admin") {
      pushActivity("Admin authenticated", username + " is now monitoring the tournament console.");
      setView("admin");
    } else if (state.team) {
      setView("my-squads");
    } else {
      setView("tiers");
    }
  }

  async function loginUser(event) {
    event.preventDefault();

    const username = elements.loginUsername.value.trim();
    const password = elements.loginPassword.value;
    const role = elements.loginRole.value;

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      showToast("Invalid username", "Use 3-24 letters, numbers, or underscores.");
      return;
    }
    if (!password || password.length < 8) {
      showToast("Password required", "Use at least 8 characters.");
      return;
    }
    if (role === "admin" && !isConfiguredAdminUsername(username)) {
      showToast("Admin access denied", "Only the configured owner username can sign in as admin.");
      elements.loginRole.value = "player";
      return;
    }

    try {
      const payload = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username, password: password, role: role }),
      });
      await applyAuthPayload(payload, role);
      showToast("Signed in", username + " is logged in.");
    } catch (error) {
      showToast("Login failed", error.message);
    }
  }

  async function registerUser(event) {
    event.preventDefault();

    const username = elements.registerUsername.value.trim();
    const phoneRaw = elements.registerPhone.value;
    const password = elements.registerPassword.value;
    const role = elements.registerRole.value;

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      showToast("Invalid username", "Use 3-24 letters, numbers, or underscores.");
      return;
    }
    const phone = normalizeIndianPhone(phoneRaw);
    if (!/^[6-9]\d{9}$/.test(phone)) {
      showToast("Invalid phone", "Enter a 10-digit Indian mobile number (starts with 6-9).");
      return;
    }
    if (!password || password.length < 8) {
      showToast("Password too short", "Use at least 8 characters.");
      return;
    }
    if (role === "admin" && !isConfiguredAdminUsername(username)) {
      showToast("Admin access denied", "Only the configured owner username can register as admin.");
      elements.registerRole.value = "player";
      return;
    }

    try {
      const payload = await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: username, phone: phone, password: password, role: role }),
      });
      await applyAuthPayload(payload, role);
      showToast("Account created", "Welcome, " + username + "!");
    } catch (error) {
      showToast("Registration failed", error.message);
    }
  }

  function normalizeIndianPhone(input) {
    let p = String(input || "").trim().replace(/[^\d+]/g, "");
    if (p.startsWith("+91")) p = p.slice(3);
    else if (p.startsWith("91") && p.length === 12) p = p.slice(2);
    else if (p.startsWith("0") && p.length === 11) p = p.slice(1);
    return p;
  }

  async function restoreUserTeam() {
    if (!state.auth.username) return;
    try {
      const teams = await apiRequest("/teams/mine", {
        method: "GET",
        headers: {
          "X-User-Username": state.auth.username,
          "X-User-Id": state.auth.userId || "",
        },
      });
      if (!Array.isArray(teams) || teams.length === 0) {
        return;
      }
      // Pick the most recent team for this owner
      state.team = teams[0];

      // Restore roster
      try {
        const roster = await apiRequest("/players/" + state.team.id);
        state.roster = Array.isArray(roster) ? roster : [];
      } catch (rosterErr) {
        state.roster = [];
      }

      // If the team is already in a tournament, pre-select that queue
      if (state.team.tournament_id) {
        // We don't know amateur vs pro from the team row alone; loadDashboard
        // will resolve it from the tournament record returned by /tournaments/:id
        state.selectedType = state.selectedType || "amateur";
      }
    } catch (err) {
      // Quietly ignore — user just won't have their team auto-restored
      console.warn("Could not restore user team", err);
    }
  }

  function logout() {
    const previousName = state.auth.username || "User";
    state.auth = {
      userId: null,
      username: "",
      role: "player",
      token: "",
      isAuthenticated: false,
    };
    state.team = null;
    state.roster = [];
    state.dashboard = null;
    saveSession();
    renderSession();
    initEmptyDashboard();
    elements.authDropdown.classList.add("hidden");
    // If the user was on a privileged view, kick them back to home
    setView("home");
    showToast("Signed out", previousName + " has been logged out.");
  }

  async function apiRequest(path, options) {
    const headers = {
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {}),
    };

    if (state.auth.token) {
      headers.Authorization = "Bearer " + state.auth.token;
    }

    const response = await window.fetch(apiBaseUrl + path, {
      ...options,
      headers: headers,
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        (payload && payload.error) ||
        (typeof payload === "string" ? payload : "Request failed");
      throw new Error(message);
    }

    return payload;
  }

  async function createTeam(event) {
    event.preventDefault();

    if (!requireAuth()) {
      return;
    }

    const name = elements.teamName.value.trim();
    if (!name) {
      showToast("Missing team name", "Enter a team name before creating the squad.");
      return;
    }

    if (!state.selectedAgentId) {
      showToast("Pick an agent", "Choose the agent your squad will represent.");
      return;
    }

    try {
      const team = await apiRequest("/teams", {
        method: "POST",
        body: JSON.stringify({ name: name, agent_id: state.selectedAgentId }),
        headers: {
          "X-User-Username": state.auth.username,
          "X-User-Id": state.auth.userId || "",
        },
      });
      state.team = team;
      state.roster = [];
      saveSession();
      renderSession();
      pushActivity("Team created", team.name + " is ready for roster registration.");
      showToast("Team created", "Your backend returned team ID #" + team.id + ".");
      elements.teamForm.reset();
      // Reset the agent selection so the next squad starts fresh
      state.selectedAgentId = null;
      if (elements.teamAgentId) elements.teamAgentId.value = "";
      if (elements.agentPicker) {
        elements.agentPicker.querySelectorAll(".agent-option.selected").forEach(function clear(b) {
          b.classList.remove("selected");
        });
      }
      // Refresh the My Squads list silently (in case user navigates there next)
      loadMySquads();
    } catch (error) {
      showToast("Team creation failed", error.message);
    }
  }

  async function addPlayer(event) {
    event.preventDefault();

    if (!requireAuth()) {
      return;
    }

    if (!state.team) {
      showToast("Create a team first", "Player registration needs an existing team ID.");
      return;
    }

    const payload = {
      team_id: state.team.id,
      name: document.getElementById("player-name").value.trim(),
      valorant_name: document.getElementById("valorant-name").value.trim(),
      tag: document.getElementById("valorant-tag").value.trim(),
    };

    try {
      const player = await apiRequest("/players", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.roster.push(player);
      saveSession();
      renderSession();
      pushActivity("Player added", (player.valorant_name || "Player") + " joined " + state.team.name + ".");
      showToast("Roster updated", "Player saved to the backend.");
      elements.playerForm.reset();
    } catch (error) {
      showToast("Player registration failed", error.message);
    }
  }

  // === UPI QR + UTR verification ===========================================
  let upiState = {
    orderId: null,
    tr: null,
    qrUri: null,
    amount: 0,
    validUntil: null,
    countdownTimer: null,
  };

  function fmtMinSec(ms) {
    if (ms <= 0) return "00:00";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function clearUpiCountdown() {
    if (upiState.countdownTimer) {
      clearInterval(upiState.countdownTimer);
      upiState.countdownTimer = null;
    }
  }

  function renderUpiCountdown() {
    const el = document.getElementById("upi-countdown");
    if (!el || !upiState.validUntil) return;
    const remaining = upiState.validUntil - Date.now();
    el.textContent = fmtMinSec(remaining);
    if (remaining <= 0) {
      clearUpiCountdown();
      el.textContent = "Expired";
      const status = document.getElementById("upi-status");
      if (status) status.textContent = "This QR has expired — generate a new one.";
    }
  }

  async function startPayment(event) {
    event.preventDefault();
    if (!requireAuth()) return;
    if (!state.team) {
      showToast("Create a team first", "Payment requires a team record.");
      return;
    }

    state.selectedType = elements.tournamentType.value;
    saveSession();

    try {
      const order = await apiRequest("/payments/create-order", {
        method: "POST",
        body: JSON.stringify({
          team_id: state.team.id,
          tournament_type: state.selectedType,
        }),
      });

      // [PAYMENTS_DISABLED testing bypass — server short-circuits with `bypassed`]
      if (order && order.bypassed) {
        showToast("Test mode", "Payment skipped — team slotted into tournament.");
        pushActivity("Test bypass", state.team.name + " was slotted without a payment (PAYMENTS_DISABLED).");
        try {
          await loadDashboard(state.team.id, state.selectedType);
          setView("dashboard");
        } catch (e) { /* best-effort */ }
        return;
      }
      // [/PAYMENTS_DISABLED]

      upiState = {
        orderId: order.order_id,
        tr: order.tr,
        qrUri: order.qr_uri,
        amount: order.amount,
        validUntil: new Date(order.valid_until).getTime(),
        countdownTimer: null,
      };

      // QR is generated server-side and shipped as a PNG data URL.
      // No CDN/CSP dependency.
      const img = document.getElementById("upi-qr-image");
      if (img && order.qr_data_url) {
        img.src = order.qr_data_url;
      }

      document.getElementById("upi-pay-to").textContent =
        order.receiver_name + " · " + order.vpa;
      document.getElementById("upi-amount").textContent = String(order.amount);
      document.getElementById("upi-tr").textContent = order.tr;
      const openLink = document.getElementById("upi-open-app");
      if (openLink) openLink.setAttribute("href", order.qr_uri);

      const panel = document.getElementById("upi-payment-panel");
      if (panel) panel.classList.remove("hidden");
      const status = document.getElementById("upi-status");
      if (status) status.textContent = "";

      // Reset UTR form
      const utrInput = document.getElementById("utr-input");
      const ssInput = document.getElementById("utr-screenshot");
      if (utrInput) utrInput.value = "";
      if (ssInput) ssInput.value = "";

      clearUpiCountdown();
      renderUpiCountdown();
      upiState.countdownTimer = setInterval(renderUpiCountdown, 1000);

      showToast("QR ready", "Scan with any UPI app, then paste the UTR below.");
    } catch (error) {
      showToast("Could not create order", error.message);
    }
  }

  // Read a File into a base64 data URL. Returns null if no file.
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("Could not read file")); };
      reader.readAsDataURL(file);
    });
  }

  async function submitUtr(event) {
    event.preventDefault();
    if (!upiState.orderId) {
      showToast("No active order", "Generate a payment QR first.");
      return;
    }
    const utr = document.getElementById("utr-input").value.trim().replace(/\s+/g, "");
    if (!/^[A-Za-z0-9]{10,22}$/.test(utr)) {
      showToast("UTR looks wrong", "Paste the 12-digit reference from your UPI app.");
      return;
    }
    const ssEl = document.getElementById("utr-screenshot");
    const file = ssEl && ssEl.files && ssEl.files[0] ? ssEl.files[0] : null;
    if (file && file.size > 400 * 1024) {
      showToast("Screenshot too big", "Compress it under 400 KB or skip it — UTR is the proof.");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await apiRequest("/payments/submit-utr", {
        method: "POST",
        body: JSON.stringify({
          order_id: upiState.orderId,
          utr: utr,
          screenshot_data_url: dataUrl,
        }),
      });
      clearUpiCountdown();
      const status = document.getElementById("upi-status");

      if (result && result.status === "verified") {
        // Auto-verify mode — team is already slotted.
        if (status) status.textContent = "Verified. Team slotted into the tournament.";
        showToast("Payment verified", "You're in the queue.");
        pushActivity("Payment auto-verified", state.team.name + " entered the " + state.selectedType + " queue.");
        try {
          await loadDashboard(state.team.id, state.selectedType);
          setView("dashboard");
        } catch (e) { /* dashboard load is best-effort */ }
      } else {
        if (status) {
          status.textContent =
            "Submitted. An admin will verify within a few minutes and you'll be slotted in automatically.";
        }
        showToast("UTR submitted", "Waiting for admin verification.");
        pushActivity("Payment submitted", state.team.name + " submitted UTR " + utr);
      }
    } catch (error) {
      showToast("Submission failed", error.message);
    }
  }

  function normalizeStatus(status) {
    const lower = String(status || "pending").toLowerCase();
    if (lower === "completed") return "completed";
    if (lower === "live") return "live";
    return "scheduled";
  }

  function renderDashboard(teamId, type, tournament, teams, matches) {
    state.dashboard = { teamId: teamId, type: type, tournament: tournament, teams: teams, matches: matches };

    elements.queueTitle.textContent = tournament
      ? (type === "pro" ? "Pro Knockout Tournament" : "Amateur Knockout Tournament") + " #" + tournament.id
      : "No active tournament found";

    const teamCount = teams.length;
    const nextSlot = Math.min(teamCount + 1, 8);
    const userTeam = teams.find(function findCurrent(team) {
      return String(team.id) === String(teamId);
    });

    const summaryBits = [
      { label: "Status", value: tournament ? tournament.status : "waiting" },
      { label: "Teams Filled", value: teamCount + "/8" },
      { label: "Entry Fee", value: "INR " + (tournament ? tournament.entry_fee : type === "pro" ? "500" : "250") },
      { label: "Prize", value: "INR " + (tournament ? tournament.prize_pool : type === "pro" ? "2000" : "1000") },
    ];

    if (!userTeam) {
      summaryBits.push({
        label: "Team Position",
        value: teamCount >= 8 ? "Next bracket likely created" : "Queued for slot " + nextSlot,
      });
    } else {
      summaryBits.push({
        label: "Team Position",
        value: "Registered in slot " + (teams.findIndex(function byId(team) {
          return String(team.id) === String(teamId);
        }) + 1),
      });
    }

    elements.queueSummary.innerHTML = summaryBits
      .map(function mapSummary(item) {
        return (
          '<div class="summary-chip"><strong>' +
          escapeHtml(item.value) +
          "</strong><span>" +
          escapeHtml(item.label) +
          "</span></div>"
        );
      })
      .join("");

    if (!matches.length) {
      elements.bracketMap.className = "bracket-map empty";
      elements.bracketMap.textContent =
        teamCount < 8
          ? "Your knockout tree appears once all 8 paid teams join this tournament."
          : "No knockout tree returned by the backend yet.";
      elements.fixtureList.className = "fixture-list empty";
      elements.fixtureList.textContent = "Match email notices will appear after bracket scheduling.";
      return;
    }

    const teamNames = new Map(
      teams.map(function toEntry(team) {
        return [String(team.id), team.name];
      })
    );

    const teamAgents = new Map(
      teams.map(function toAgentEntry(team) {
        return [String(team.id), team.agent_id || null];
      })
    );

    function teamName(id) {
      return id ? teamNames.get(String(id)) || "Winner TBD" : "Winner TBD";
    }

    function teamAvatarUrl(id) {
      const agentId = id ? teamAgents.get(String(id)) : null;
      const agent = agentId ? state.agents[agentId] : null;
      if (agent && (agent.displayIconSmall || agent.displayIcon)) {
        return agent.displayIconSmall || agent.displayIcon;
      }
      // Transparent 1x1 fallback so the circle is still visible via background
      return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>";
    }

    function renderTeamSlot(id) {
      return (
        '<div class="tree-team"><img class="agent-avatar" src="' +
        teamAvatarUrl(id) +
        '" alt="" /><strong>' +
        escapeHtml(teamName(id)) +
        "</strong></div>"
      );
    }

    const rounds = [
      { key: 1, label: "Quarterfinals" },
      { key: 2, label: "Semifinals" },
      { key: 3, label: "Final" },
    ];

    elements.bracketMap.className = "bracket-tree";
    elements.bracketMap.innerHTML = rounds
      .map(function mapRound(round) {
        const roundMatches = matches.filter(function byRound(match) {
          return Number(match.round || 1) === round.key;
        });

        return (
          '<section class="bracket-round"><h5>' +
          escapeHtml(round.label) +
          "</h5>" +
          roundMatches
            .map(function mapTreeMatch(match) {
              const status = normalizeStatus(match.match_status || match.status);
              const isCurrent =
                String(match.team1_id) === String(teamId) || String(match.team2_id) === String(teamId);
              const scheduledAt = match.scheduled_time
                ? new Date(match.scheduled_time).toLocaleString()
                : "Schedule pending";
              return (
                '<article class="tree-match ' +
                (isCurrent ? "current-team " : "") +
                status +
                '"><span class="slot-label">Match #' +
                escapeHtml(match.id) +
                "</span>" +
                renderTeamSlot(match.team1_id) +
                '<span class="versus">vs</span>' +
                renderTeamSlot(match.team2_id) +
                "<small>" +
                escapeHtml(scheduledAt) +
                "</small></article>"
              );
            })
            .join("") +
          "</section>"
        );
      })
      .join("");

    elements.fixtureList.className = "fixture-list";
    const myTeamId = state.team && state.team.id ? Number(state.team.id) : null;
    elements.fixtureList.innerHTML = matches
      .map(function mapMatch(match) {
        const status = normalizeStatus(match.match_status || match.status);
        const team1 = teamName(match.team1_id);
        const team2 = teamName(match.team2_id);
        const winner = match.winner_id ? teamName(match.winner_id) : "Pending";
        const scheduledAt = match.scheduled_time
          ? new Date(match.scheduled_time).toLocaleString()
          : "Schedule pending";
        // [party_id feature — remove this block to revert]
        const inThisMatch =
          myTeamId !== null &&
          (Number(match.team1_id) === myTeamId || Number(match.team2_id) === myTeamId);
        const partyBlock = (inThisMatch && match.party_id)
          ? '<div class="party-badge"><span class="party-label">Lobby Code</span>' +
            '<code class="party-code">' + escapeHtml(match.party_id) + '</code>' +
            '<button type="button" class="button button-secondary small" data-copy-party="' +
            escapeHtml(match.party_id) + '">Copy</button></div>'
          : '';
        // [/party_id feature]
        return (
          '<article class="fixture-card">' +
          '<div class="fixture-card-header"><span>Match #' +
          escapeHtml(match.id) +
          '</span><span class="fixture-status ' +
          status +
          '">' +
          escapeHtml(status) +
          "</span></div>" +
          '<div class="fixture-teams"><span>' +
          escapeHtml(team1) +
          '</span><span>vs</span><span>' +
          escapeHtml(team2) +
          "</span></div>" +
          partyBlock +
          '<div class="slot-meta">Winner: ' +
          escapeHtml(winner) +
          "</div>" +
          '<div class="slot-meta">Mail schedule: ' +
          escapeHtml(scheduledAt) +
          "</div></article>"
        );
      })
      .join("");

    // [party_id feature — copy-to-clipboard wiring; remove to revert]
    elements.fixtureList.querySelectorAll("[data-copy-party]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const code = btn.getAttribute("data-copy-party") || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code)
            .then(function () { showToast("Copied", "Lobby code copied to clipboard."); })
            .catch(function () { showToast("Copy failed", "Select and copy " + code + " manually."); });
        } else {
          showToast("Copy", code);
        }
      });
    });
    // [/party_id feature]
  }

  async function loadDashboard(teamId, type) {
    if (!requireAuth()) {
      return;
    }

    if (!teamId || !type) {
      showToast("Missing lookup details", "Provide a team ID and tournament type.");
      return;
    }

    try {
      let tournament;
      let teams;
      let matches;

      const teamDashboard = await apiRequest("/tournaments/" + teamId);
      if (teamDashboard && teamDashboard.tournament) {
        tournament = teamDashboard.tournament;
        teams = teamDashboard.teams || [];
        matches = teamDashboard.matches || [];
      } else {
        [tournament, teams, matches] = await Promise.all([
          apiRequest("/tournaments/current/" + type),
          apiRequest("/tournaments/teams/" + type),
          apiRequest("/tournaments/matches/" + type),
        ]);
      }

      renderDashboard(teamId, type, tournament, teams, matches);
      pushActivity("Dashboard loaded", "Tournament data refreshed for " + type + " queue.");
    } catch (error) {
      showToast("Dashboard load failed", error.message);
    }
  }

  function handleLookup(event) {
    event.preventDefault();
    state.selectedType = elements.lookupType.value;
    saveSession();
    loadDashboard(elements.lookupTeamId.value.trim(), state.selectedType);
  }

  function bindEvents() {
    // Hero sign-in button - scroll to top and open dropdown
    elements.heroSignin.addEventListener("click", function(event) {
      event.stopPropagation(); // Prevent immediate closing
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => {
        openAuthDropdown();
      }, 300); // Wait for scroll to complete
    });

    // Register page sign-in button
    elements.registerSignin.addEventListener("click", function(event) {
      event.stopPropagation(); // Prevent immediate closing
      openAuthDropdown();
    });

    // Re-query nav links because some live inside the hero (added after initial elements snapshot)
    document.querySelectorAll("[data-nav]").forEach(function bindNav(link) {
      link.addEventListener("click", function onNavClick(event) {
        event.preventDefault();
        const target = link.getAttribute("data-nav");
        setView(target);

        // If they jump to dashboard with a known team, auto-load it
        if (target === "dashboard" && state.team && state.team.id) {
          loadDashboard(state.team.id, state.selectedType);
        }
      });
    });

    // Safety net — any hash change (e.g. back/forward, direct link) routes through setView
    window.addEventListener("hashchange", function onHashChange() {
      const next = (window.location.hash || "#home").replace("#", "") || "home";
      setView(next);
      if (next === "dashboard" && state.team && state.team.id) {
        loadDashboard(state.team.id, state.selectedType);
      }
    });

    // Top-right auth toggle button
    elements.authToggle.addEventListener("click", function toggleAuthDropdown(event) {
      event.stopPropagation(); // Prevent immediate closing
      elements.authDropdown.classList.toggle("hidden");
      if (!elements.authDropdown.classList.contains("hidden")) {
        switchAuthTab("login");
      }
    });

    elements.authTabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchAuthTab(btn.getAttribute("data-auth-tab"));
      });
    });

    elements.loginForm.addEventListener("submit", loginUser);
    elements.registerForm.addEventListener("submit", registerUser);
    elements.logoutButton.addEventListener("click", logout);
    elements.teamForm.addEventListener("submit", createTeam);
    elements.playerForm.addEventListener("submit", addPlayer);
    elements.paymentForm.addEventListener("submit", startPayment);
    const utrForm = document.getElementById("utr-form");
    if (utrForm) utrForm.addEventListener("submit", submitUtr);
    elements.lookupForm.addEventListener("submit", handleLookup);
    
    if (elements.mySquadsNew) {
      elements.mySquadsNew.addEventListener("click", function onNewSquad() {
        if (elements.mySquadsNew.disabled) return;
        // Clear any active team so the register flow creates a fresh one
        state.team = null;
        state.roster = [];
        state.selectedAgentId = null;
        if (elements.teamAgentId) elements.teamAgentId.value = "";
        saveSession();
        renderSession();
        setView("register");
      });
    }

    if (elements.mySquadsRefresh) {
      elements.mySquadsRefresh.addEventListener("click", function onRefreshSquads() {
        loadMySquads();
      });
    }

    elements.refreshDashboard.addEventListener("click", function refresh() {
      if (state.dashboard) {
        loadDashboard(state.dashboard.teamId, state.dashboard.type);
        return;
      }

      if (state.team) {
        loadDashboard(state.team.id, state.selectedType);
      }
    });

    // Admin dashboard refresh button
    const refreshAdmin = document.getElementById('refresh-admin');
    if (refreshAdmin) {
      refreshAdmin.addEventListener("click", function refreshAdminDashboard() {
        loadAdminDashboard();
      });
    }

    const refreshPayments = document.getElementById('refresh-payments');
    if (refreshPayments) {
      refreshPayments.addEventListener("click", function () {
        apiRequest("/admin/payments")
          .then(function (rows) { renderAdminPayments(rows || []); })
          .catch(function (err) { showToast("Payments load failed", err.message); });
      });
    }

    const refreshPending = document.getElementById('refresh-pending-payments');
    if (refreshPending) {
      refreshPending.addEventListener("click", loadPendingPayments);
    }

    // Champion carousel prev/next
    const champPrev = document.getElementById('champion-prev');
    const champNext = document.getElementById('champion-next');
    if (champPrev) {
      champPrev.addEventListener('click', function () {
        if (!championCarousel.list.length) return;
        const total = championCarousel.list.length;
        championCarousel.index = (championCarousel.index - 1 + total) % total;
        renderChampionSlide();
        restartChampionAutoRotate();
      });
    }
    if (champNext) {
      champNext.addEventListener('click', function () {
        if (!championCarousel.list.length) return;
        championCarousel.index =
          (championCarousel.index + 1) % championCarousel.list.length;
        renderChampionSlide();
        restartChampionAutoRotate();
      });
    }

    elements.tournamentType.addEventListener("change", function onTypeChange(event) {
      state.selectedType = event.target.value;
      elements.lookupType.value = state.selectedType;
      saveSession();
    });

    elements.lookupType.addEventListener("change", function onLookupTypeChange(event) {
      state.selectedType = event.target.value;
      elements.tournamentType.value = state.selectedType;
      saveSession();
    });

    function bindAdminGuard(usernameEl, roleEl) {
      if (!usernameEl || !roleEl) return;
      usernameEl.addEventListener("input", function () {
        if (!isConfiguredAdminUsername(usernameEl.value) && roleEl.value === "admin") {
          roleEl.value = "player";
        }
      });
    }
    bindAdminGuard(elements.loginUsername, elements.loginRole);
    bindAdminGuard(elements.registerUsername, elements.registerRole);

    elements.tierPicks.forEach(function bindTierButton(button) {
      button.addEventListener("click", function onClick(event) {
        event.stopPropagation();
        const tier = button.getAttribute("data-tier");
        state.selectedType = tier;
        elements.tournamentType.value = tier;
        elements.lookupType.value = tier;
        saveSession();
        if (!state.auth.isAuthenticated) {
          setView("home");
          window.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(() => {
            openAuthDropdown();
          }, 300);
          return;
        }
        setView("register");
      });
    });

    // Click outside to close - but ignore clicks on hero/register signin buttons
    document.addEventListener("click", function closeAuthDropdown(event) {
      // Check if dropdown is open
      if (elements.authDropdown.classList.contains("hidden")) {
        return;
      }

      // Check if click was inside auth menu or on any signin button
      if (
        event.target.closest(".auth-menu") ||
        event.target.closest("#hero-signin") ||
        event.target.closest("#register-signin")
      ) {
        return;
      }

      // Close the dropdown
      elements.authDropdown.classList.add("hidden");
    });
  }

  function initEmptyDashboard() {
    elements.queueSummary.innerHTML = "";
    elements.bracketMap.className = "bracket-map empty";
    elements.bracketMap.textContent = "Complete payment, then load your team dashboard to reveal the knockout tree.";
    elements.fixtureList.className = "fixture-list empty";
    elements.fixtureList.textContent = "Match mail and opponent data will show here after the bracket fills.";
  }

  // Admin Dashboard Functions
  async function loadAdminDashboard() {
    if (!state.auth.isAuthenticated || state.auth.role !== 'admin') {
      showToast('Admin access required', 'Only administrators can view this section.');
      return;
    }

    try {
      const [stats, tournaments, unassignedTeams, payments, pending] = await Promise.all([
        apiRequest("/admin/stats"),
        apiRequest("/admin/tournaments/overview"),
        apiRequest("/admin/teams/unassigned"),
        apiRequest("/admin/payments").catch(function () { return []; }),
        apiRequest("/admin/payments/pending").catch(function () { return []; }),
      ]);

      renderAdminDashboard(stats, tournaments, unassignedTeams);
      renderAdminPayments(payments);
      renderPendingPayments(pending);
      pushActivity("Admin dashboard loaded", "Overview refreshed successfully.");
    } catch (error) {
      showToast("Admin load failed", error.message);
    }
  }

  async function loadPendingPayments() {
    try {
      const rows = await apiRequest("/admin/payments/pending");
      renderPendingPayments(rows || []);
    } catch (err) {
      showToast("Pending load failed", err.message);
    }
  }

  function renderPendingPayments(rows) {
    const container = document.getElementById("admin-pending-payments");
    if (!container) return;
    if (!Array.isArray(rows) || !rows.length) {
      container.innerHTML = '<p class="muted-text">No payments waiting for verification.</p>';
      return;
    }

    container.innerHTML = rows
      .map(function (p) {
        const submittedAt = p.submitted_at
          ? new Date(p.submitted_at).toLocaleString()
          : "—";
        const screenshot = p.screenshot_data_url
          ? '<a class="pending-ss" href="' + escapeHtml(p.screenshot_data_url) +
            '" target="_blank" rel="noopener"><img src="' +
            escapeHtml(p.screenshot_data_url) + '" alt="payment screenshot" /></a>'
          : '<span class="muted-text">No screenshot</span>';
        return (
          '<div class="pending-row" data-order-id="' + escapeHtml(p.order_id) + '">' +
            '<div class="pending-info">' +
              '<p><strong>' + escapeHtml(p.team_name || ("Team #" + p.team_id)) + '</strong> · ' +
                escapeHtml(p.owner_email || "—") + ' · ' +
                escapeHtml(p.tournament_type || "—") + '</p>' +
              '<p class="muted-text">Ref <code>' + escapeHtml(p.tr || "—") + '</code> · ' +
                'UTR <code>' + escapeHtml(p.submitted_utr || "—") + '</code> · ' +
                'INR ' + escapeHtml(p.amount || 0) + '</p>' +
              '<p class="muted-text">Submitted ' + escapeHtml(submittedAt) + '</p>' +
            '</div>' +
            '<div class="pending-ss-wrap">' + screenshot + '</div>' +
            '<div class="pending-actions">' +
              '<button class="button button-primary small" data-action="verify-payment">Verify</button>' +
              '<button class="button button-secondary small" data-action="reject-payment">Reject</button>' +
            '</div>' +
          '</div>'
        );
      })
      .join("");

    container.querySelectorAll('[data-action="verify-payment"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        const row = btn.closest(".pending-row");
        const orderId = row && row.getAttribute("data-order-id");
        if (!orderId) return;
        if (!confirm("Verify payment for order " + orderId + "?")) return;
        apiRequest("/payments/admin/verify", {
          method: "POST",
          body: JSON.stringify({ order_id: orderId }),
        })
          .then(function () {
            showToast("Verified", "Team slotted into tournament.");
            loadAdminDashboard();
          })
          .catch(function (err) { showToast("Verify failed", err.message); });
      });
    });

    container.querySelectorAll('[data-action="reject-payment"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        const row = btn.closest(".pending-row");
        const orderId = row && row.getAttribute("data-order-id");
        if (!orderId) return;
        const reason = prompt("Reject reason (optional):") || "";
        apiRequest("/payments/admin/reject", {
          method: "POST",
          body: JSON.stringify({ order_id: orderId, reason: reason }),
        })
          .then(function () {
            showToast("Rejected", "Payment marked rejected.");
            loadAdminDashboard();
          })
          .catch(function (err) { showToast("Reject failed", err.message); });
      });
    });
  }

  function renderAdminPayments(payments) {
    const container = document.getElementById('admin-payments-list');
    if (!container) return;

    if (!Array.isArray(payments) || !payments.length) {
      container.innerHTML = '<p class="muted-text">No payments recorded yet.</p>';
      return;
    }

    const totalCompleted = payments
      .filter(function (p) { return String(p.status).toLowerCase() === 'completed'; })
      .reduce(function (acc, p) { return acc + Number(p.amount || 0); }, 0);

    container.innerHTML =
      '<p class="muted-text">' + payments.length + ' transactions · INR ' +
      escapeHtml(totalCompleted) + ' collected</p>' +
      '<div class="payments-table-wrap">' +
      '<table class="payments-table">' +
      '<thead><tr>' +
      '<th>Team</th>' +
      '<th>Owner</th>' +
      '<th>Amount</th>' +
      '<th>Status</th>' +
      '<th>UTR</th>' +
      '<th>Created</th>' +
      '<th></th>' +
      '</tr></thead>' +
      '<tbody>' +
      payments
        .map(function (p) {
          const status = String(p.status || '').toLowerCase();
          const badgeClass =
            (status === 'completed' || status === 'verified') ? 'badge-success' :
            (status === 'failed' || status === 'rejected' || status === 'revoked') ? 'badge-fail' :
            'badge-muted';
          const created = p.created_at
            ? new Date(p.created_at).toLocaleString()
            : '';
          const canRevoke = status === 'verified' || status === 'completed';
          const actions = canRevoke
            ? '<button class="button button-secondary small" data-action="revoke-payment" data-order-id="' +
              escapeHtml(p.order_id || '') + '">Revoke</button>'
            : '';
          return (
            '<tr>' +
            '<td>' + escapeHtml(p.team_name || ('Team #' + (p.team_id || '?'))) + '</td>' +
            '<td>' + escapeHtml(p.owner_email || '—') + '</td>' +
            '<td>INR ' + escapeHtml(p.amount || 0) + '</td>' +
            '<td><span class="badge ' + badgeClass + '">' + escapeHtml(status) + '</span></td>' +
            '<td class="mono">' + escapeHtml(p.submitted_utr || '—') + '</td>' +
            '<td>' + escapeHtml(created) + '</td>' +
            '<td>' + actions + '</td>' +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table>' +
      '</div>';

    container.querySelectorAll('[data-action="revoke-payment"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        const orderId = btn.getAttribute("data-order-id");
        if (!orderId) return;
        const reason = prompt(
          "Revoke this verified payment? The team will be removed from the tournament queue if it hasn't started yet. Reason (optional):"
        );
        if (reason === null) return; // user cancelled
        apiRequest("/payments/admin/revoke", {
          method: "POST",
          body: JSON.stringify({ order_id: orderId, reason: reason || "" }),
        })
          .then(function (res) {
            if (res && res.tournament_locked) {
              showToast("Revoked (bracket locked)",
                "Marked revoked, but tournament has started — team stays in bracket. Handle manually.");
            } else {
              showToast("Revoked", "Team removed from queue.");
            }
            loadAdminDashboard();
          })
          .catch(function (err) { showToast("Revoke failed", err.message); });
      });
    });
  }

  function renderAdminDashboard(stats, tournaments, unassignedTeams) {
    // Update stats
    document.getElementById('stat-tournaments').textContent = stats.total_tournaments || 0;
    document.getElementById('stat-teams').textContent = stats.total_teams || 0;
    document.getElementById('stat-players').textContent = stats.total_players || 0;
    document.getElementById('stat-users').textContent = stats.total_users || 0;

    // Render tournaments list
    const tournamentsContainer = document.getElementById('admin-tournaments-list');
    if (!tournaments.length) {
      tournamentsContainer.innerHTML = '<p class="muted-text">No tournaments yet.</p>';
    } else {
      tournamentsContainer.innerHTML = tournaments
        .map(function(tournament) { return renderAdminTournamentCard(tournament); })
        .join('');

      wireAdminMatchControls();
    }

    // Render unassigned teams
    const unassignedContainer = document.getElementById('admin-unassigned-list');
    if (!unassignedTeams.length) {
      unassignedContainer.innerHTML = '<p class="muted-text">All teams are assigned to tournaments.</p>';
    } else {
      unassignedContainer.innerHTML = unassignedTeams
        .map(function(team) {
          return (
            '<div class="admin-team-card">' +
            '<h6>' + escapeHtml(team.name) + '</h6>' +
            '<p class="muted-text">' + (team.players || []).length + ' players • Awaiting tournament</p>' +
            '<div class="players-list">' +
            (team.players || []).map(function(player) {
              return '<span>' + escapeHtml(player.valorant_name + '#' + player.valorant_tag) + '</span>';
            }).join('') +
            '</div>' +
            '</div>'
          );
        })
        .join('');
    }
  }

  function renderAdminTournamentCard(tournament) {
    const statusClass =
      tournament.status === 'running' ? 'badge-live' :
      tournament.status === 'completed' ? 'badge-success' : 'badge-muted';

    const championTeam = tournament.winner_team_id
      ? (tournament.teams || []).find(function find(t) {
          return String(t.id) === String(tournament.winner_team_id);
        })
      : null;
    const championLine = championTeam
      ? '<p class="champ-line">🏆 Champion: ' + escapeHtml(championTeam.name) + '</p>'
      : (tournament.winner_team_id
          ? '<p class="champ-line">🏆 Champion: Team #' + escapeHtml(tournament.winner_team_id) + '</p>'
          : '');

    // Match progress strip
    const allMatches = tournament.matches || [];
    const completedMatches = allMatches.filter(function (m) {
      return String(m.match_status || m.status).toLowerCase() === 'completed';
    }).length;
    const liveMatches = allMatches.filter(function (m) {
      return String(m.match_status || m.status).toLowerCase() === 'live';
    }).length;

    return (
      '<details class="admin-tournament-card" open>' +
      '<summary class="t-card-summary">' +
        '<div class="t-card-headline">' +
          '<span class="t-card-name">' + escapeHtml(tournament.tournament_type.toUpperCase() + ' #' + tournament.id) + '</span>' +
          '<span class="badge ' + statusClass + '">' + escapeHtml(tournament.status) + '</span>' +
        '</div>' +
        '<div class="t-card-stats">' +
          '<span>' + escapeHtml(tournament.total_teams) + '/8 teams</span>' +
          '<span>' + escapeHtml(completedMatches) + '/' + escapeHtml(allMatches.length) + ' matches done</span>' +
          (liveMatches ? '<span class="hot">' + liveMatches + ' LIVE</span>' : '') +
          (championTeam ? '<span class="gold">🏆 ' + escapeHtml(championTeam.name) + '</span>' : '') +
        '</div>' +
      '</summary>' +
      '<div class="t-card-body">' +
        championLine +
        '<div class="t-tab-bar">' +
          '<button type="button" class="t-tab active" data-tab="matches">Matches</button>' +
          '<button type="button" class="t-tab" data-tab="teams">Teams (' + (tournament.teams || []).length + ')</button>' +
        '</div>' +
        '<div class="t-tab-pane active" data-pane="matches">' +
          renderAdminMatchesBlock(tournament) +
        '</div>' +
        '<div class="t-tab-pane" data-pane="teams">' +
          renderAdminTeamsBlock(tournament) +
        '</div>' +
      '</div>' +
      '</details>'
    );
  }

  function renderAdminTeamsBlock(tournament) {
    const teams = tournament.teams || [];
    if (!teams.length) {
      return '<p class="muted-text">No teams in this tournament yet.</p>';
    }
    return (
      '<div class="teams-grid">' +
      teams
        .map(function (team) {
          const players = team.players || [];
          return (
            '<div class="admin-team-card">' +
            '<h6>' + escapeHtml(team.name) +
            (String(team.id) === String(tournament.winner_team_id) ? ' 🏆' : '') +
            '</h6>' +
            '<p class="muted-text">' + players.length + ' players · ID #' + escapeHtml(team.id) + '</p>' +
            (players.length
              ? '<ol class="players-list">' +
                players
                  .map(function (player, idx) {
                    const name = (player.valorant_name || '').trim();
                    const tag  = (player.valorant_tag  || '').trim();
                    const real = (player.full_name     || '').trim();
                    return (
                      '<li class="player-row">' +
                        '<span class="player-num">' + (idx + 1) + '</span>' +
                        '<span class="player-id">' +
                          '<span class="player-name">' + escapeHtml(name || real || '—') + '</span>' +
                          (tag ? '<span class="player-tag">#' + escapeHtml(tag) + '</span>' : '') +
                        '</span>' +
                        (real && real !== name
                          ? '<span class="player-real">' + escapeHtml(real) + '</span>'
                          : '') +
                      '</li>'
                    );
                  })
                  .join('') +
                '</ol>'
              : '<p class="muted-text">No players registered.</p>') +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderAdminMatchesBlock(tournament) {
    const matches = tournament.matches || [];
    if (!matches.length) {
      return '<p class="muted-text">No matches scheduled yet. Bracket is created once 8 paid teams join.</p>';
    }

    const rounds = [
      { key: 1, label: 'Quarterfinals' },
      { key: 2, label: 'Semifinals' },
      { key: 3, label: 'Final' },
    ];

    return (
      '<div class="admin-matches">' +
      '<h6>Match Controls</h6>' +
      rounds
        .map(function (round) {
          const roundMatches = matches.filter(function (m) {
            return Number(m.round || 1) === round.key;
          });
          if (!roundMatches.length) return '';
          return (
            '<section class="admin-round">' +
            '<p class="round-title">' + escapeHtml(round.label) + '</p>' +
            roundMatches.map(function (m) { return renderAdminMatchRow(m); }).join('') +
            '</section>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderAdminMatchRow(m) {
    const t1 = m.team1_name || (m.team1_id ? 'Team #' + m.team1_id : 'TBD');
    const t2 = m.team2_name || (m.team2_id ? 'Team #' + m.team2_id : 'TBD');
    const status = String(m.match_status || m.status || 'scheduled').toLowerCase();
    const isCompleted = status === 'completed';
    const isLive = status === 'live';

    // Format scheduled_time for datetime-local input (yyyy-MM-ddTHH:mm)
    let scheduledValue = '';
    if (m.scheduled_time) {
      const d = new Date(m.scheduled_time);
      if (!isNaN(d.getTime())) {
        const pad = function (n) { return String(n).padStart(2, '0'); };
        scheduledValue =
          d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
          'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      }
    }

    const canSetWinner = m.team1_id && m.team2_id && !isCompleted;
    const winnerName = m.winner_name || (m.winner_id ? 'Team #' + m.winner_id : '');

    return (
      '<div class="admin-match" data-match-id="' + m.id + '">' +
      '<div class="match-row-head">' +
      '<span class="m-id">Match #' + escapeHtml(m.id) + '</span>' +
      '<span class="m-status badge ' +
      (isCompleted ? 'badge-success' : isLive ? 'badge-live' : 'badge-muted') +
      '">' + escapeHtml(status) + '</span>' +
      '</div>' +
      '<div class="match-row-teams">' +
      '<strong>' + escapeHtml(t1) + '</strong>' +
      '<span class="vs">vs</span>' +
      '<strong>' + escapeHtml(t2) + '</strong>' +
      '</div>' +
      (winnerName ? '<p class="winner-line">Winner: ' + escapeHtml(winnerName) + '</p>' : '') +
      '<div class="match-row-controls">' +
      '<label>Schedule' +
      '<input type="datetime-local" data-act="schedule-input" value="' + escapeHtml(scheduledValue) + '" />' +
      '</label>' +
      '<button type="button" class="button button-secondary small" data-act="schedule">Save Time</button>' +
      // [party_id feature — remove this label+button block to revert]
      '<label>Party ID' +
      '<input type="text" data-act="party-input" maxlength="32" placeholder="lobby code" value="' + escapeHtml(m.party_id || '') + '" />' +
      '</label>' +
      '<button type="button" class="button button-secondary small" data-act="party">Save Party ID</button>' +
      // [/party_id feature]
      (!isCompleted && !isLive && m.team1_id && m.team2_id
        ? '<button type="button" class="button button-primary small" data-act="start">Start</button>'
        : '') +
      (canSetWinner
        ? '<div class="winner-picker">' +
          '<button type="button" class="button button-primary small" data-act="winner" data-winner-id="' + m.team1_id + '">Set ' + escapeHtml(t1) + ' as winner</button>' +
          '<button type="button" class="button button-primary small" data-act="winner" data-winner-id="' + m.team2_id + '">Set ' + escapeHtml(t2) + ' as winner</button>' +
          '</div>'
        : '') +
      '</div>' +
      '</div>'
    );
  }

  function wireAdminMatchControls() {
    // Tab switching inside each tournament card
    document.querySelectorAll('.admin-tournament-card').forEach(function (card) {
      const tabs = card.querySelectorAll('.t-tab');
      const panes = card.querySelectorAll('.t-tab-pane');
      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          const target = tab.getAttribute('data-tab');
          tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
          panes.forEach(function (p) {
            p.classList.toggle('active', p.getAttribute('data-pane') === target);
          });
        });
      });
    });

    document.querySelectorAll('.admin-match').forEach(function (row) {
      const matchId = row.getAttribute('data-match-id');
      const scheduleInput = row.querySelector('[data-act="schedule-input"]');
      const partyInput = row.querySelector('[data-act="party-input"]');

      row.querySelectorAll('[data-act]').forEach(function (el) {
        const act = el.getAttribute('data-act');
        if (act === 'schedule-input' || act === 'party-input') return; // inputs, no click handler

        el.addEventListener('click', async function () {
          try {
            // [party_id feature — remove this `party` branch to revert]
            if (act === 'party') {
              const val = partyInput ? partyInput.value.trim() : '';
              await apiRequest('/admin/match/party-id', {
                method: 'POST',
                body: JSON.stringify({ match_id: Number(matchId), party_id: val }),
              });
              showToast(val ? 'Party ID saved' : 'Party ID cleared',
                val ? ('Players in this match will see: ' + val) : 'No code shown to players.');
              loadAdminDashboard();
              return;
            }
            // [/party_id feature]
            if (act === 'schedule') {
              const val = scheduleInput && scheduleInput.value;
              if (!val) {
                showToast('Pick a time', 'Choose a date and time before saving.');
                return;
              }
              await apiRequest('/admin/match/schedule', {
                method: 'POST',
                body: JSON.stringify({ match_id: Number(matchId), scheduled_time: val }),
              });
              showToast('Match scheduled', 'Time saved.');
              loadAdminDashboard();
            } else if (act === 'start') {
              await apiRequest('/admin/match/start', {
                method: 'POST',
                body: JSON.stringify({ match_id: Number(matchId) }),
              });
              showToast('Match started', 'Status set to live.');
              loadAdminDashboard();
            } else if (act === 'winner') {
              const winnerId = Number(el.getAttribute('data-winner-id'));
              const res = await apiRequest('/admin/match/set-winner', {
                method: 'POST',
                body: JSON.stringify({ match_id: Number(matchId), winner_id: winnerId }),
              });
              if (res && res.tournament_completed) {
                showToast('Tournament finished', 'Champion crowned. Updating home page.');
                loadChampion();
              } else {
                showToast('Winner set', 'Advancing the bracket.');
              }
              loadAdminDashboard();
            }
          } catch (err) {
            showToast('Action failed', err.message);
          }
        });
      });
    });
  }

  async function loadMySquads() {
    if (!elements.mySquadsGrid) return;
    if (!state.auth.isAuthenticated || !state.auth.username) {
      elements.mySquadsGrid.innerHTML =
        '<p class="my-squads-empty">Sign in to see your registered squads.</p>';
      if (elements.mySquadsCounter) elements.mySquadsCounter.textContent = "";
      return;
    }

    try {
      elements.mySquadsGrid.innerHTML =
        '<p class="my-squads-empty">Loading your squads…</p>';
      const teams = await apiRequest("/teams/mine", {
        method: "GET",
        headers: {
          "X-User-Username": state.auth.username,
          "X-User-Id": state.auth.userId || "",
        },
      });

      const list = Array.isArray(teams) ? teams : [];

      // Fetch rosters in parallel
      const rosters = await Promise.all(
        list.map(function fetchRoster(team) {
          return apiRequest("/players/" + team.id)
            .then(function ok(rows) { return Array.isArray(rows) ? rows : []; })
            .catch(function fail() { return []; });
        })
      );

      renderMySquads(list, rosters);
    } catch (err) {
      elements.mySquadsGrid.innerHTML =
        '<p class="my-squads-empty">Could not load your squads: ' +
        escapeHtml(err.message) +
        "</p>";
    }
  }

  function renderMySquads(teams, rosters) {
    if (!elements.mySquadsGrid) return;

    if (elements.mySquadsCounter) {
      elements.mySquadsCounter.textContent =
        teams.length + " of " + MAX_TEAMS_PER_OWNER + " squad slots used.";
    }

    // Disable "new squad" button when at the cap
    if (elements.mySquadsNew) {
      const atCap = teams.length >= MAX_TEAMS_PER_OWNER;
      elements.mySquadsNew.disabled = atCap;
      elements.mySquadsNew.textContent = atCap
        ? "Squad limit reached (" + MAX_TEAMS_PER_OWNER + "/" + MAX_TEAMS_PER_OWNER + ")"
        : "+ Register New Squad";
    }

    if (!teams.length) {
      elements.mySquadsGrid.innerHTML =
        '<p class="my-squads-empty">No teams registered yet. Use Register to create your first squad.</p>';
      return;
    }

    elements.mySquadsGrid.innerHTML = teams
      .map(function mapTeam(team, idx) {
        const roster = rosters[idx] || [];
        const agent = team.agent_id ? state.agents[team.agent_id] : null;
        const agentImg = agent && (agent.displayIconSmall || agent.displayIcon);
        const agentName = agent ? agent.displayName : "No agent selected";
        const isActive = state.team && String(state.team.id) === String(team.id);
        const tournamentStatus = team.tournament_id
          ? "In tournament #" + team.tournament_id
          : "Not in tournament";

        const rosterRows = roster.length
          ? roster
              .map(function mapPlayer(player, i) {
                const dn =
                  player.full_name || player.name || player.valorant_name || "Unnamed";
                const tag = player.valorant_tag || player.tag || "";
                const riot = [player.valorant_name, tag].filter(Boolean).join("#");
                return (
                  "<li><span>" +
                  escapeHtml(i + 1 + ". " + dn) +
                  "</span><span>" +
                  escapeHtml(riot) +
                  "</span></li>"
                );
              })
              .join("")
          : '<li class="empty">No players added yet.</li>';

        const avatar = agentImg
          ? '<img class="squad-agent-avatar" src="' + agentImg + '" alt="' + escapeHtml(agentName) + '"/>'
          : '<div class="squad-agent-avatar" aria-hidden="true"></div>';

        return (
          '<article class="squad-card' +
          (isActive ? " is-active" : "") +
          '" data-team-id="' +
          team.id +
          '">' +
          '<div class="squad-card-head">' +
          avatar +
          '<div><p class="name">' +
          escapeHtml(team.name || "Unnamed Squad") +
          '</p><p class="agent-name">' +
          escapeHtml(agentName) +
          "</p></div></div>" +
          '<div class="squad-meta"><span>ID #' +
          escapeHtml(team.id) +
          "</span><span>" +
          escapeHtml(tournamentStatus) +
          "</span><span>" +
          escapeHtml(roster.length + "/6 players") +
          "</span></div>" +
          '<ul class="squad-roster">' +
          rosterRows +
          "</ul>" +
          '<div class="squad-actions">' +
          '<button type="button" class="button button-secondary" data-squad-action="activate">' +
          (isActive ? "Active Squad" : "Set Active") +
          "</button>" +
          '<button type="button" class="button button-primary" data-squad-action="open">' +
          (team.tournament_id ? "Open Tournament" : "Add Players / Pay") +
          "</button>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    // Wire actions on each card
    elements.mySquadsGrid
      .querySelectorAll(".squad-card")
      .forEach(function bindCard(card) {
        const teamId = card.getAttribute("data-team-id");
        const team = teams.find(function match(t) {
          return String(t.id) === String(teamId);
        });
        const teamRoster = team
          ? rosters[teams.indexOf(team)]
          : [];

        card.querySelectorAll("[data-squad-action]").forEach(function bindBtn(btn) {
          btn.addEventListener("click", function onAction() {
            const action = btn.getAttribute("data-squad-action");
            if (!team) return;

            // Set this team as the active one in state
            state.team = team;
            state.roster = teamRoster || [];
            saveSession();
            renderSession();

            if (action === "open") {
              if (team.tournament_id) {
                setView("dashboard");
                loadDashboard(team.id, state.selectedType);
              } else {
                setView("register");
              }
            } else {
              // re-render to highlight the now-active card
              renderMySquads(teams, rosters);
              showToast("Active squad updated", (team.name || "Squad") + " is now active.");
            }
          });
        });
      });
  }

  const championCarousel = {
    list: [],
    index: 0,
    timer: null,
  };

  function renderChampionSlide() {
    const el = document.getElementById("champion-card");
    const controls = document.getElementById("champion-controls");
    const dots = document.getElementById("champion-dots");
    if (!el) return;

    if (!championCarousel.list.length) {
      el.innerHTML =
        '<p class="champion-placeholder">No champion crowned yet — the next finale decides who lifts the trophy.</p>';
      if (controls) controls.hidden = true;
      return;
    }

    const total = championCarousel.list.length;
    const champ = championCarousel.list[championCarousel.index % total];

    const agent = champ.team.agent_id ? state.agents[champ.team.agent_id] : null;
    const agentImg = agent && (agent.displayIcon || agent.displayIconSmall);
    const agentName = agent ? agent.displayName : "No agent";
    const prize = champ.prize_pool ? "INR " + champ.prize_pool : "Prize TBD";
    const tierLabel = (champ.tournament_type || "amateur").toUpperCase();
    const completed = champ.completed_at
      ? new Date(champ.completed_at).toLocaleDateString()
      : "";

    const players = champ.players || [];
    const rosterRows = players.length
      ? players
          .map(function mapP(p, i) {
            const dn = p.full_name || p.name || p.valorant_name || "Unnamed";
            const tag = p.valorant_tag || p.tag || "";
            const riot = [p.valorant_name, tag].filter(Boolean).join("#");
            return (
              "<li><span>" +
              escapeHtml(i + 1 + ". " + dn) +
              "</span><span>" +
              escapeHtml(riot) +
              "</span></li>"
            );
          })
          .join("")
      : '<li class="champion-no-players">Winning squad had no players registered.</li>';

    el.innerHTML =
      '<div class="champion-slide">' +
      '<div class="champion-head">' +
      (agentImg
        ? '<img src="' + agentImg + '" alt="' + escapeHtml(agentName) + '"/>'
        : '<div class="champion-no-portrait"></div>') +
      '<div><p class="trophy">🏆 Tournament #' + escapeHtml(champ.tournament_id) + '</p>' +
      '<h4 class="team-name">' + escapeHtml(champ.team.name || "Unknown") + '</h4>' +
      '<p class="agent-name">' + escapeHtml(agentName) + '</p></div>' +
      '</div>' +
      '<div class="champion-meta">' +
      '<span>' + escapeHtml(tierLabel) + ' tier</span>' +
      '<span>' + escapeHtml(prize) + '</span>' +
      (completed ? '<span>Crowned ' + escapeHtml(completed) + '</span>' : '') +
      '</div>' +
      '<p class="champion-roster-title">Winning Roster</p>' +
      '<ul class="champion-players">' + rosterRows + '</ul>' +
      '</div>';

    if (controls && dots) {
      controls.hidden = total <= 1;
      dots.innerHTML = championCarousel.list
        .map(function (_, i) {
          return (
            '<button type="button" class="dot' +
            (i === championCarousel.index ? ' active' : '') +
            '" data-idx="' + i + '" aria-label="Champion ' + (i + 1) + '"></button>'
          );
        })
        .join("");
      dots.querySelectorAll(".dot").forEach(function (d) {
        d.addEventListener("click", function () {
          championCarousel.index = Number(d.getAttribute("data-idx"));
          renderChampionSlide();
          restartChampionAutoRotate();
        });
      });
    }
  }

  function restartChampionAutoRotate() {
    if (championCarousel.timer) clearInterval(championCarousel.timer);
    if (championCarousel.list.length <= 1) return;
    championCarousel.timer = setInterval(function () {
      championCarousel.index =
        (championCarousel.index + 1) % championCarousel.list.length;
      renderChampionSlide();
    }, 6500);
  }

  async function loadChampion() {
    const el = document.getElementById("champion-card");
    if (!el) return;
    try {
      const payload = await apiRequest("/tournaments/champions?limit=10");
      championCarousel.list = (payload && payload.champions) || [];
      championCarousel.index = 0;
      renderChampionSlide();
      restartChampionAutoRotate();
    } catch (err) {
      el.innerHTML =
        '<p class="champion-placeholder">Could not load champion data.</p>';
    }
  }

  async function loadAgents() {
    if (!elements.agentPicker) return;
    try {
      const response = await window.fetch(
        "https://valorant-api.com/v1/agents?isPlayableCharacter=true"
      );
      const payload = await response.json();
      const list = (payload && payload.data) || [];
      list.sort(function byName(a, b) {
        return String(a.displayName).localeCompare(String(b.displayName));
      });

      list.forEach(function indexAgent(agent) {
        state.agents[agent.uuid] = {
          uuid: agent.uuid,
          displayName: agent.displayName,
          displayIcon: agent.displayIcon,
          displayIconSmall: agent.displayIconSmall,
          role: agent.role && agent.role.displayName,
        };
      });

      renderAgentPicker(list);

      // If the My Squads view was already rendered without agent data, re-render
      // so squad cards now display the correct agent portrait + name.
      if (state.auth.isAuthenticated && elements.mySquadsGrid &&
          elements.mySquadsGrid.querySelector(".squad-card")) {
        loadMySquads();
      }

      // Once agents are indexed, render the champion card with the agent portrait
      loadChampion();
    } catch (err) {
      elements.agentPicker.innerHTML =
        '<p class="agent-picker-loading">Could not load agents. Check your connection and refresh.</p>';
    }
  }

  function renderAgentPicker(list) {
    if (!elements.agentPicker) return;
    elements.agentPicker.innerHTML = list
      .map(function toCard(agent) {
        const icon = agent.displayIconSmall || agent.displayIcon;
        return (
          '<button type="button" class="agent-option" data-agent-id="' +
          agent.uuid +
          '"><img loading="lazy" src="' +
          icon +
          '" alt="' +
          escapeHtml(agent.displayName) +
          '" /><span>' +
          escapeHtml(agent.displayName) +
          "</span></button>"
        );
      })
      .join("");

    elements.agentPicker.querySelectorAll(".agent-option").forEach(function bind(btn) {
      btn.addEventListener("click", function onPick() {
        const id = btn.getAttribute("data-agent-id");
        selectAgent(id);
      });
    });
  }

  function selectAgent(agentId) {
    state.selectedAgentId = agentId;
    if (elements.teamAgentId) {
      elements.teamAgentId.value = agentId;
    }
    if (!elements.agentPicker) return;
    elements.agentPicker.querySelectorAll(".agent-option").forEach(function mark(btn) {
      btn.classList.toggle(
        "selected",
        btn.getAttribute("data-agent-id") === agentId
      );
    });
  }

  loadSession();
  setView((window.location.hash || "#home").replace("#", "") || "home");
  renderSession();
  bindEvents();
  initEmptyDashboard();
  loadAgents();
  loadChampion();

  // On hard reload, if we have a session but no team (e.g. localStorage cleared
  // partially or stored on another device), try to fetch the team from the backend.
  if (state.auth.isAuthenticated && state.auth.username && !state.team) {
    restoreUserTeam().then(function afterRestore() {
      if (state.team) {
        saveSession();
        renderSession();
      }
    });
  }

  if (state.team && isAdmin()) {
    pushActivity("Session restored", "Continuing from saved team ID #" + state.team.id + ".");
  }
})();