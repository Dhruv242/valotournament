(function bootstrapTournamentApp() {
  const config = window.APP_CONFIG || {};
  const apiBaseUrl = (config.apiBaseUrl || "").replace(/\/$/, "");
  const adminUsername = (config.adminUsername || "").trim().toLowerCase();
  const storageKey = "valrift-session";

  const state = {
    auth: {
      email: "",
      username: "",
      role: "player",
      token: "",
      isAuthenticated: false,
    },
    team: null,
    roster: [],
    selectedType: "amateur",
    dashboard: null,
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
    authForm: document.getElementById("auth-form"),
    logoutButton: document.getElementById("logout-button"),
    teamForm: document.getElementById("team-form"),
    playerForm: document.getElementById("player-form"),
    paymentForm: document.getElementById("payment-form"),
    lookupForm: document.getElementById("lookup-form"),
    refreshDashboard: document.getElementById("refresh-dashboard"),
    authEmail: document.getElementById("auth-email"),
    authUsername: document.getElementById("auth-username"),
    authPassword: document.getElementById("auth-password"),
    authRole: document.getElementById("auth-role"),
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
  };

  function openAuthDropdown() {
    elements.authDropdown.classList.remove("hidden");
    elements.authEmail.focus();
  }

  function setView(viewName) {
    const targetView = document.querySelector('[data-view="' + viewName + '"]');
    const nextView = targetView ? viewName : "home";
    elements.views.forEach(function toggleView(view) {
      view.classList.toggle("active-view", view.getAttribute("data-view") === nextView);
    });
    window.location.hash = nextView;
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        email: saved.auth && saved.auth.email ? saved.auth.email : "",
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
    openAuthDropdown();
    return false;
  }

  function isConfiguredAdminUsername(username) {
    return Boolean(adminUsername) && username.trim().toLowerCase() === adminUsername;
  }

  function renderAuthState() {
    if (!state.auth.isAuthenticated) {
      elements.authStatusName.textContent = "Guest";
      elements.authStatusRole.textContent = "Gmail login required for protected screens.";
      elements.authEmail.value = "";
      elements.authUsername.value = "";
      elements.authPassword.value = "";
      elements.authRole.value = "player";
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
    if (state.auth.email) {
      elements.authStatusRole.textContent += " " + state.auth.email;
    }
    elements.authEmail.value = state.auth.email || "";
    elements.authUsername.value = state.auth.username;
    elements.authPassword.value = "";
    elements.authRole.value = state.auth.role;

    const capabilities = isAdmin()
      ? [
          "View registration activity and admin-facing session events.",
          "Create teams, add players, launch payments, and inspect tournament dashboards.",
          "Use the same Gmail token flow as players, with expanded UI visibility.",
        ]
      : [
          "Create teams, add players, pay tournament entry, and open the bracket dashboard.",
          "Activity feed is hidden to keep player view limited to team operations.",
          "Your username stays locked to your Gmail account.",
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
        const riotId = [player.valorant_name, player.tag].filter(Boolean).join("#");
        return (
          "<li><span>" +
          escapeHtml((index + 1) + ". " + (player.name || player.valorant_name)) +
          "</span><span>" +
          escapeHtml(riotId) +
          "</span></li>"
        );
      })
      .join("");
  }

  async function login(event) {
    event.preventDefault();

    const username = elements.authUsername.value.trim();
    const email = elements.authEmail.value.trim().toLowerCase();
    const password = elements.authPassword.value;
    const role = elements.authRole.value;

    if (!email || !email.endsWith("@gmail.com")) {
      showToast("Gmail required", "Use a valid @gmail.com address before signing in.");
      return;
    }

    if (!username) {
      showToast("Username required", "Enter a username before signing in.");
      return;
    }

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      showToast("Username unavailable", "Use 3-24 letters, numbers, or underscores.");
      return;
    }

    if (!password || password.length < 8) {
      showToast("Password required", "Use at least 8 characters for your account password.");
      return;
    }

    if (role === "admin" && !isConfiguredAdminUsername(username)) {
      showToast("Admin access denied", "Only the configured owner username can sign in as admin.");
      elements.authRole.value = "player";
      return;
    }

    try {
      const payload = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email, username: username, password: password, role: role }),
      });

      const sameUser =
        state.auth.isAuthenticated &&
        state.auth.email === email &&
        state.auth.username === username &&
        state.auth.role === role;

      state.auth = {
        email: payload.user && payload.user.email ? payload.user.email : email,
        userId: payload.user && payload.user.id ? payload.user.id : null,
        username: username,
        role: payload.user && payload.user.role ? payload.user.role : role,
        token: payload.token || "",
        isAuthenticated: true,
      };

      if (!sameUser) {
        state.team = null;
        state.roster = [];
        state.dashboard = null;
      }

      saveSession();
      renderSession();
      if (!sameUser) {
        initEmptyDashboard();
      }
      elements.authDropdown.classList.add("hidden");
      pushActivity(
        "Admin authenticated",
        username + " is now monitoring the tournament console."
      );
      showToast("Signed in", username + " logged in with Gmail.");
      setView("tiers");
    } catch (error) {
      showToast("Login failed", error.message);
    }
  }

  function logout() {
    const previousName = state.auth.username || "User";
    state.auth = {
      email: "",
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

    try {
      const team = await apiRequest("/teams", {
        method: "POST",
        body: JSON.stringify({ name: name }),
        headers: {
          "X-User-Email": state.auth.email,
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

  async function startPayment(event) {
    event.preventDefault();

    if (!requireAuth()) {
      return;
    }

    if (!state.team) {
      showToast("Create a team first", "Payment requires a team record.");
      return;
    }

    if (!config.razorpayKeyId || config.razorpayKeyId === "RAZORPAY_PUBLIC_KEY_HERE") {
      showToast(
        "Razorpay key missing",
        "Update config.js with your Razorpay public key before launching checkout."
      );
      return;
    }

    state.selectedType = elements.tournamentType.value;
    saveSession();

    try {
      const order = await apiRequest("/payments/create-order", {
        method: "POST",
        body: JSON.stringify({
          team_id: state.team.id,
          type: state.selectedType,
        }),
      });

      const razorpay = new window.Razorpay({
        key: config.razorpayKeyId,
        amount: order.amount,
        currency: order.currency,
        name: config.appName || "VALRIFT Champions",
        description: state.selectedType === "pro" ? "Pro Queue Entry" : "Amateur Queue Entry",
        order_id: order.id,
        theme: {
          color: "#2bd2ff",
        },
        handler: async function onPaymentSuccess(response) {
          try {
            await apiRequest("/payments/verify", {
              method: "POST",
              body: JSON.stringify({
                ...response,
                team_id: state.team.id,
                type: state.selectedType,
              }),
            });
            pushActivity(
              "Payment verified",
              state.team.name + " entered the " + state.selectedType + " tournament queue."
            );
            showToast("Payment verified", "You can now open the team dashboard.");
            await loadDashboard(state.team.id, state.selectedType);
            setView("dashboard");
          } catch (error) {
            showToast("Verification failed", error.message);
          }
        },
        prefill: {
          name: state.team.name,
        },
      });

      razorpay.on("payment.failed", function onPaymentFailed(response) {
        const reason =
          response && response.error && response.error.description
            ? response.error.description
            : "Payment was not completed.";
        showToast("Payment failed", reason);
      });

      razorpay.open();
    } catch (error) {
      showToast("Checkout failed", error.message);
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
    const nextSlot = Math.min(teamCount + 1, 6);
    const userTeam = teams.find(function findCurrent(team) {
      return String(team.id) === String(teamId);
    });

    const summaryBits = [
      { label: "Status", value: tournament ? tournament.status : "waiting" },
      { label: "Teams Filled", value: teamCount + "/6" },
      { label: "Entry Fee", value: "INR " + (tournament ? tournament.entry_fee : type === "pro" ? "500" : "250") },
      { label: "Prize", value: "INR " + (tournament ? tournament.prize : type === "pro" ? "2000" : "1000") },
    ];

    if (!userTeam) {
      summaryBits.push({
        label: "Team Position",
        value: teamCount >= 6 ? "Next bracket likely created" : "Queued for slot " + nextSlot,
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
        teamCount < 6
          ? "Your knockout tree appears once all 6 paid teams join this tournament."
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

    function teamName(id) {
      return id ? teamNames.get(String(id)) || "Winner TBD" : "Winner TBD";
    }

    const rounds = [
      { key: 1, label: "Opening" },
      { key: 2, label: "Semifinals" },
      { key: 3, label: "Final" },
    ];

    elements.bracketMap.className = "bracket-tree";
    elements.bracketMap.innerHTML = rounds
      .map(function mapRound(round) {
        const roundMatches = matches.filter(function byRound(match) {
          return Number(match.bracket_round || 1) === round.key;
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
                '</span><strong>' +
                escapeHtml(teamName(match.team1_id)) +
                '</strong><span class="versus">vs</span><strong>' +
                escapeHtml(teamName(match.team2_id)) +
                '</strong><small>' +
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
    elements.fixtureList.innerHTML = matches
      .map(function mapMatch(match) {
        const status = normalizeStatus(match.match_status || match.status);
        const team1 = teamName(match.team1_id);
        const team2 = teamName(match.team2_id);
        const winner = match.winner_id ? teamName(match.winner_id) : "Pending";
        const scheduledAt = match.scheduled_time
          ? new Date(match.scheduled_time).toLocaleString()
          : "Schedule pending";
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
          '<div class="slot-meta">Winner: ' +
          escapeHtml(winner) +
          "</div>" +
          '<div class="slot-meta">Mail schedule: ' +
          escapeHtml(scheduledAt) +
          "</div></article>"
        );
      })
      .join("");
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

      const teamDashboard = await apiRequest("/tournaments/by-team/" + teamId);
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
    elements.heroSignin.addEventListener("click", openAuthDropdown);
    elements.registerSignin.addEventListener("click", openAuthDropdown);
    elements.navLinks.forEach(function bindNav(link) {
      link.addEventListener("click", function onNavClick(event) {
        event.preventDefault();
        setView(link.getAttribute("data-nav"));
      });
    });
    elements.authToggle.addEventListener("click", function toggleAuthDropdown() {
      elements.authDropdown.classList.toggle("hidden");
    });
    elements.authForm.addEventListener("submit", login);
    elements.logoutButton.addEventListener("click", logout);
    elements.teamForm.addEventListener("submit", createTeam);
    elements.playerForm.addEventListener("submit", addPlayer);
    elements.paymentForm.addEventListener("submit", startPayment);
    elements.lookupForm.addEventListener("submit", handleLookup);
    elements.refreshDashboard.addEventListener("click", function refresh() {
      if (state.dashboard) {
        loadDashboard(state.dashboard.teamId, state.dashboard.type);
        return;
      }

      if (state.team) {
        loadDashboard(state.team.id, state.selectedType);
      }
    });

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

    elements.authUsername.addEventListener("input", function onUsernameInput(event) {
      if (!isConfiguredAdminUsername(event.target.value) && elements.authRole.value === "admin") {
        elements.authRole.value = "player";
      }
    });

    elements.tierPicks.forEach(function bindTierButton(button) {
      button.addEventListener("click", function onClick() {
        const tier = button.getAttribute("data-tier");
        state.selectedType = tier;
        elements.tournamentType.value = tier;
        elements.lookupType.value = tier;
        saveSession();
        if (!state.auth.isAuthenticated) {
          setView("home");
          openAuthDropdown();
          return;
        }
        setView("register");
      });
    });

    document.addEventListener("click", function closeAuthDropdown(event) {
      if (
        !elements.authDropdown.classList.contains("hidden") &&
        !event.target.closest(".auth-menu")
      ) {
        elements.authDropdown.classList.add("hidden");
      }
    });
  }

  function initEmptyDashboard() {
    elements.queueSummary.innerHTML = "";
    elements.bracketMap.className = "bracket-map empty";
    elements.bracketMap.textContent = "Complete payment, then load your team dashboard to reveal the knockout tree.";
    elements.fixtureList.className = "fixture-list empty";
    elements.fixtureList.textContent = "Match mail and opponent data will show here after the bracket fills.";
  }

  loadSession();
  setView((window.location.hash || "#home").replace("#", "") || "home");
  renderSession();
  bindEvents();
  initEmptyDashboard();

  if (state.team && isAdmin()) {
    pushActivity("Session restored", "Continuing from saved team ID #" + state.team.id + ".");
  }
})();
