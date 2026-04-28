// ADSCR Control Panel – Frontend Logic v1.1 (Merged & Clean)
// Supports:
// - Competitions from PortalBilhar
// - Teams per competition
// - Portal, Local Presets, Manual modes
// - Queue + Drag & Drop
// - Timers, scoring, history editing
// - Broadcast sharing

const $ = id => document.getElementById(id);
const LOGO_HOME = "logo.png";
const LOGO_AWAY = "ball8.svg";
const DEFAULT_TEAM_ACCENTS = {
  home: "#f2f2f2",
  away: "#d3a11d"
};
const YOUTUBE_LIVE_URL_KEY = "youtubeLiveUrl";
const OPEN_COMPETITION_KEY = "openCompetitionName";

// STATE (loaded from server)
let state = null;

// TIMERS
const timers = {
  1: { time: 0, interval: null },
  2: { time: 0, interval: null }
};

let viewMode = "teams";     // "teams" | "open"
let openPlayers = [];       // lista de jogadores para o modo Open
let openCompetitions = [];


// TOAST
let toast;
let wasMatchEnded = false;
let reopenBannerTimer = null;
let endLockTimer = null;
function showToast(msg, color = "primary") {
  const element = $("appToast");
  element.className = `toast text-bg-${color} border-0`;
  $("toastBody").textContent = msg;
  toast ??= new bootstrap.Toast(element);
  toast.show();
}

function showReopenBanner() {
  const banner = $("reopenBanner");
  if (!banner) return;
  banner.classList.remove("d-none");
  clearTimeout(reopenBannerTimer);
  reopenBannerTimer = setTimeout(() => {
    banner.classList.add("d-none");
  }, 6000);
}

function setupBroadcastControls() {
  const youtubeInput = $("youtubeLiveUrl");
  const shareBtn = $("shareFacebookBtn");

  if (youtubeInput) {
    youtubeInput.value = localStorage.getItem(YOUTUBE_LIVE_URL_KEY) || "";
    youtubeInput.addEventListener("input", () => {
      localStorage.setItem(YOUTUBE_LIVE_URL_KEY, youtubeInput.value.trim());
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const url = youtubeInput?.value?.trim() || "";
      if (!/^https?:\/\//i.test(url)) {
        showToast("Introduz um URL válido da live no YouTube.", "warning");
        youtubeInput?.focus();
        return;
      }

      const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
      window.open(shareUrl, "_blank", "noopener,noreferrer,width=900,height=700");
    });
  }
}

// -----------------------------------------------------------------------------
// INITIAL LOAD
// -----------------------------------------------------------------------------
window.addEventListener("load", async () => {
  await loadCompetitions();
  await loadOpenCompetitions();
  setupModeHandlers();
  setupResetButton();
  setupTeamNameMirroring(); 
  setupViewModeToggle();
  setupBroadcastControls();
  setupScoreSync();
  setupQuadroHandlers();
  setupQuadroDragDrop();
  await loadState();
  syncHistoryHeight();
});

window.addEventListener("resize", () => {
  syncHistoryHeight();
});

// -----------------------------------------------------------------------------
// LOAD FULL APPLICATION STATE
// -----------------------------------------------------------------------------
function applyState(newState) {
  state = newState;
  state.teams.home.accentColor ||= DEFAULT_TEAM_ACCENTS.home;
  state.teams.away.accentColor ||= DEFAULT_TEAM_ACCENTS.away;
  viewMode = state.viewMode === "open" ? "open" : "teams";
  const toggle = $("modeToggle");
  toggle.checked = viewMode === "open";
  localStorage.setItem("viewMode", viewMode);
  applyViewMode();

  $("homeTeamName").textContent = state.teams.home.name || "Locais";
  $("awayTeamName").textContent = state.teams.away.name || "Visitantes";
  $("homeScore").textContent = state.teams.home.score || 0;
  $("awayScore").textContent = state.teams.away.score || 0;
  updateQuadroTeamHeader();

  renderPlayers();
  populatePlayerDropdowns();
  renderQuadroSelectors();
  updateTeamLogos();
  renderAccentColorInputs();
  renderQueue();
  renderTables();
  renderHistory();
  wasMatchEnded = isMatchEnded();
  const mode = getTeamsMode();
  const portal = $("teamsModePortal");
  const manual = $("teamsModeManual");
  if (portal && manual) {
    portal.checked = mode === "portal";
    manual.checked = mode === "manual";
  }
  applyTeamsMode(mode);
  updateCompetitionVisibility();
  updateGuidance();
  if (isMatchEnded()) {
    lockEditingOnMatchEnd();
    scheduleEndLock();
  }
}

async function loadState() {
  const res = await fetch("/api/state");
  const data = await res.json();
  applyState(data);

  if (data.competitionId) {
    const sel = $("competitionSelect");
    const search = $("competitionSearch");
    sel.value = data.competitionId;
    const selectedName = sel.options[sel.selectedIndex]?.text?.trim() || "";
    if (search) search.value = selectedName;

    await loadTeamsFromPortal("home", data.competitionId, data.teams.home.id, data.teams.home.name);
    await loadTeamsFromPortal("away", data.competitionId, data.teams.away.id, data.teams.away.name);
  } else {
    const sel = $("competitionSelect");
    const search = $("competitionSearch");
    if (sel) sel.value = "";
    if (search) search.value = "";
    const homeSel = $("homeTeamSelect");
    const awaySel = $("awayTeamSelect");
    if (homeSel) homeSel.innerHTML = '<option value="">— escolher equipa —</option>';
    if (awaySel) awaySel.innerHTML = '<option value="">— escolher equipa —</option>';
  }

  if (data.activeQuadroIndex) {
    state.activeQuadroIndex = data.activeQuadroIndex;
  }
  if (data.quadroBases) {
    state.quadroBases = data.quadroBases;
  }
  if (data.substitutions) {
    state.substitutions = data.substitutions;
  }
  if (data.locks) {
    state.locks = data.locks;
  }

  applyQuadroSelections();
  updateQuadroDuplicates();
  updateQuadroButtonsStatus();
}

function setupTeamNameMirroring() {
  // Locais
  $("homeTeamSelect").addEventListener("change", () => {
    const sel = $("homeTeamSelect");
    if (!sel || sel.selectedIndex < 0) return;

    const teamName = sel.options[sel.selectedIndex].text.trim();
    $("homeTeamName").textContent = teamName;
    updateQuadroTeamHeader();

    updateTeamLogos();

    syncTeamsToServer();
  });

  // Visitantes
  $("awayTeamSelect").addEventListener("change", () => {
    const sel = $("awayTeamSelect");
    if (!sel || sel.selectedIndex < 0) return;

    const teamName = sel.options[sel.selectedIndex].text.trim();
    $("awayTeamName").textContent = teamName;
    updateQuadroTeamHeader();

    updateTeamLogos();

    syncTeamsToServer();
  });
}


// -----------------------------------------------------------------------------
// MODO OPEN
// -----------------------------------------------------------------------------
function setupViewModeToggle() {
  const toggle = $("modeToggle");
  const openCompetitionSearch = $("openCompetitionSearch");

  // carregar jogadores Open do localStorage
  const savedOpen = localStorage.getItem("openPlayers");
  if (savedOpen) {
    try {
      openPlayers = JSON.parse(savedOpen);
    } catch {
      openPlayers = [];
    }
  }

  if (openCompetitionSearch) {
    openCompetitionSearch.value = localStorage.getItem(OPEN_COMPETITION_KEY) || "";
  }

  toggle.addEventListener("change", () => {
    viewMode = toggle.checked ? "open" : "teams";
    localStorage.setItem("viewMode", viewMode);
    applyViewMode();
    syncViewModeToServer();
    populatePlayerDropdowns();
  });

  renderOpenPlayers();
  setupOpenModeCollapse();
  setupOpenPortalImport();
}

function applyViewMode() {
  const isOpen = viewMode === "open";

  $("teamsCard").classList.toggle("d-none", isOpen);
  $("competitionBlock").classList.toggle("d-none", isOpen);
  const teamsForm = $("teamsForm");
  if (teamsForm) teamsForm.classList.toggle("d-none", isOpen);
  $("openModeCard").classList.toggle("d-none", !isOpen);
  $("quadrosCard").classList.toggle("d-none", isOpen);
  const queueCard = $("queueCard");
  if (queueCard) queueCard.classList.toggle("d-none", !isOpen);
  const scoreboard = $("scoreboardCard");
  if (scoreboard) scoreboard.classList.toggle("d-none", isOpen);
  $("queueAddRow").classList.toggle("d-none", !isOpen);
  const btnQueue = $("addQuadroBtnQueue");
  if (btnQueue) btnQueue.classList.add("d-none");

  $("table1Controls").classList.toggle("d-none", !isOpen);
  $("table2Controls").classList.toggle("d-none", !isOpen);
  $("timer1").classList.toggle("d-none", !isOpen);
  $("timer2").classList.toggle("d-none", !isOpen);

  document.querySelectorAll(".table-drop").forEach(el => {
    el.classList.toggle("d-none", !isOpen);
  });

  $("table1ScoreControls").classList.toggle("d-none", !isOpen);
  $("table2ScoreControls").classList.toggle("d-none", !isOpen);
  $("table1Finish").classList.remove("d-none");
  $("table2Finish").classList.remove("d-none");

  if (!isOpen) {
    $("homePlayersPanel")?.classList.add("players-collapsed");
    $("awayPlayersPanel")?.classList.add("players-collapsed");
  }

  updateCompetitionVisibility();
  syncHistoryHeight();
}

function syncHistoryHeight() {
  const quadros = $("quadrosCard");
  const tables = $("tablesRow");
  const queueCard = $("queueCard");
  const historyCard = document.querySelector(".history-card");
  if (!historyCard) return;
  if (viewMode === "open") {
    const h = (tables?.offsetHeight || 0) + (queueCard?.offsetHeight || 0) + 16;
    historyCard.style.minHeight = h > 0 ? `${h}px` : "";
    return;
  }
  if (!quadros) return;
  const h = quadros.offsetHeight + (tables?.offsetHeight || 0) + 16;
  if (h > 0) historyCard.style.minHeight = `${h}px`;
}

function saveOpenPlayers() {
  const text = $("openPlayersInput").value || "";
  openPlayers = text
    .split("\n")
    .map(p => p.trim())
    .filter(p => p.length > 0);

  localStorage.setItem("openPlayers", JSON.stringify(openPlayers));
  renderOpenPlayers();
  populatePlayerDropdowns();
}

function renderOpenPlayers() {
  const ul = $("openPlayersList");
  if (!ul) return;

  ul.innerHTML = "";
  openPlayers.forEach(p => {
    const li = document.createElement("li");
    li.className = "list-group-item py-1";
    li.textContent = p;
    ul.appendChild(li);
  });

  // manter textarea em sync
  $("openPlayersInput").value = openPlayers.join("\n");
}

async function loadOpenCompetitions() {
  const search = $("openCompetitionSearch");
  const datalist = $("openCompetitionDatalist");
  if (!search || !datalist) return;

  try {
    const res = await fetch("/api/portal/open-competitions");
    const data = await res.json();
    if (data?.error) throw new Error(data.error);
    openCompetitions = Array.isArray(data) ? data : [];
  } catch {
    openCompetitions = [];
    datalist.innerHTML = "";
    return;
  }

  datalist.innerHTML = "";
  openCompetitions.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.dataset.id = c.id;
    datalist.appendChild(opt);
  });
}

function resolveOpenCompetitionSelection() {
  const search = $("openCompetitionSearch");
  const value = search?.value?.trim() || "";
  if (!value) return null;
  return openCompetitions.find(c => c.name === value) || null;
}

function setupOpenPortalImport() {
  const search = $("openCompetitionSearch");
  const button = $("loadOpenPortalBtn");
  if (!search || !button) return;
  if (!search.dataset.listenerAttached) {
    search.addEventListener("change", () => {
      localStorage.setItem(OPEN_COMPETITION_KEY, search.value.trim());
    });
    search.addEventListener("input", () => {
      localStorage.setItem(OPEN_COMPETITION_KEY, search.value.trim());
    });
    search.dataset.listenerAttached = "1";
  }
  if (!button.dataset.listenerAttached) {
    button.addEventListener("click", importOpenCompetitionFromPortal);
    button.dataset.listenerAttached = "1";
  }
}

async function importOpenCompetitionFromPortal() {
  const selected = resolveOpenCompetitionSelection();
  if (!selected) {
    showToast("Escolhe uma competição válida da lista do PortalBilhar.", "warning");
    return;
  }

  const button = $("loadOpenPortalBtn");
  const originalLabel = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "A carregar...";
  }

  try {
    const res = await fetch(`/api/portal/open-board?comp=${encodeURIComponent(selected.id)}`);
    const data = await res.json();
    if (!res.ok || data?.error) throw new Error(data?.error || "Falha ao importar quadro.");

    const importedPlayers = Array.isArray(data.players) ? data.players.filter(Boolean) : [];
    const importedMatches = Array.isArray(data.matches) ? data.matches : [];

    openPlayers = importedPlayers;
    localStorage.setItem("openPlayers", JSON.stringify(openPlayers));
    localStorage.setItem(OPEN_COMPETITION_KEY, data?.competition?.name || selected.name);

    state.queue = importedMatches.map((match, index) => ({
      id: state.nextGameId + index,
      gameNumber: Number.isFinite(match.gameNumber) ? match.gameNumber : index + 1,
      playerHome: match.playerHome,
      playerAway: match.playerAway
    }));
    state.nextGameId += importedMatches.length;

    renderOpenPlayers();
    populatePlayerDropdowns();
    renderQueue();
    await saveQueue();

    const search = $("openCompetitionSearch");
    if (search) search.value = data?.competition?.name || selected.name;

    showToast(`Quadro Open importado: ${importedMatches.length} jogos e ${importedPlayers.length} jogadores.`, "success");
  } catch (err) {
    showToast("Não foi possível importar do PortalBilhar. O preenchimento manual continua disponível.", "warning");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function setupOpenModeCollapse() {
  const card = $("openModeCard");
  const btn = $("openModeToggle");
  if (!card || !btn) return;

  const saved = localStorage.getItem("openModeCollapsed") === "1";
  card.classList.toggle("open-collapsed", saved);
  btn.textContent = saved ? "Expandir" : "Minimizar";

  btn.addEventListener("click", () => {
    card.classList.toggle("open-collapsed");
    const collapsed = card.classList.contains("open-collapsed");
    localStorage.setItem("openModeCollapsed", collapsed ? "1" : "0");
    btn.textContent = collapsed ? "Expandir" : "Minimizar";
    syncHistoryHeight();
  });
}




// -----------------------------------------------------------------------------
// COMPETITIONS (PortalBilhar)
// -----------------------------------------------------------------------------
async function loadCompetitions() {
  let competitions = [];
  try {
    const res = await fetch("/api/portal/competitions");
    const data = await res.json();
    if (data?.error) throw new Error(data.error);
    competitions = data;
  } catch (err) {
    handlePortalFailure();
    return;
  }

  const sel = $("competitionSelect");
  const search = $("competitionSearch");
  const datalist = $("competitionDatalist");

  sel.innerHTML = '<option value="">— escolher competição —</option>';
  datalist.innerHTML = "";

  competitions.forEach(c => {
    console.log(c.name);
    sel.add(new Option(c.name, c.id));
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.dataset.id = c.id;
    datalist.appendChild(opt);
  });

  async function applyCompetitionById(compId) {
    if (!compId) return;
    sel.value = compId;
    const selectedName = sel.options[sel.selectedIndex]?.text?.trim() || "";
    if (search) search.value = selectedName;

    // Sempre que se escolhe competição, carregamos as equipas
    await saveCompetition(compId);
    loadTeamsFromPortal("home", compId);
    loadTeamsFromPortal("away", compId);
  }

  sel.addEventListener("change", () => applyCompetitionById(sel.value));

  if (search) {
    const applyFromSearch = () => {
      const value = search.value.trim();
      if (!value) return;
      const match = [...datalist.options].find(o => o.value === value);
      const compId = match?.dataset?.id;
      if (compId) applyCompetitionById(compId);
    };
    search.addEventListener("change", applyFromSearch);
    search.addEventListener("input", applyFromSearch);
  }
}


// -----------------------------------------------------------------------------
// LOAD TEAMS FROM PORTALBILHAR FOR ONE SIDE
// -----------------------------------------------------------------------------
async function loadTeamsFromPortal(side, competitionId = null, selectedId = null, selectedName = null) {
  const comp = competitionId || $("competitionSelect").value;
  if (!comp) return;

  let teamsRaw = [];
  try {
    const res = await fetch(`/api/portal/teams?comp=${encodeURIComponent(comp)}`);
    const data = await res.json();
    if (data?.error) throw new Error(data.error);
    teamsRaw = data;
  } catch (err) {
    handlePortalFailure();
    return;
  }
  const teams = [];
  const seen = new Set();
  teamsRaw.forEach(t => {
    const key = `${t.id}::${t.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    teams.push(t);
  });

  const sel = side === "home" ? $("homeTeamSelect") : $("awayTeamSelect");
  sel.innerHTML = '<option value="">— escolher equipa —</option>';

  teams.forEach(t => {
    sel.add(new Option(t.name, t.id));
  });

  if (selectedId) {
    sel.value = selectedId;
  }
  if (selectedName) {
    // no-op (search removed)
  }

  function applyTeamById(teamId) {
    if (!teamId) return;
    sel.value = teamId;
    selectPortalTeam(side);
  }

  sel.onchange = () => applyTeamById(sel.value);
}

async function saveCompetition(competitionId) {
  await fetch("/api/competition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ competitionId })
  });
}


// -----------------------------------------------------------------------------
// SELECT TEAM FROM PORTALBILHAR
// -----------------------------------------------------------------------------
async function selectPortalTeam(side) {
  const sel = side === "home" ? $("homeTeamSelect") : $("awayTeamSelect");
  const id = sel.value;
  if (!id) return;

  let data;
  try {
    const res = await fetch(`/api/portal/team?eqp=${encodeURIComponent(id)}`);
    data = await res.json();
    if (data?.error) throw new Error(data.error);
  } catch (err) {
    handlePortalFailure();
    return;
  }

    // Nome da equipa vem SEMPRE do dropdown
  const teamName = sel.options[sel.selectedIndex].text.trim();

  // Set team name directly into UI input
  if (side === "home") {
    $("homeTeamName").textContent = teamName;
  } else {
    $("awayTeamName").textContent = teamName;
  }
  updateQuadroTeamHeader();

  // Update state
  state.teams[side].id = data.id;
  state.teams[side].name = teamName;
  state.teams[side].players = data.players;
  state.teams[side].logoUrl = data.logoUrl || null;
  state.teams[side].accentColor = normalizeAccentColor(state.teams[side].accentColor, side);

  // Update all dependent UI
  renderPlayers();
  populatePlayerDropdowns(); // THIS WILL NOW WORK

  updateTeamLogos();
  renderAccentColorInputs();

  syncTeamsToServer();
  updateGuidance();
}

// -----------------------------------------------------------------------------
// MODE HANDLING (portal / local / manual)
// -----------------------------------------------------------------------------
function setupModeHandlers() {
  ["teamsModePortal", "teamsModeManual"].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const mode = getTeamsMode();
      localStorage.setItem("teamsMode", mode);
      applyTeamsMode(mode);
    });
  });
  $("homeManualName").addEventListener("input", () => applyManualSide("home"));
  $("homeManualPlayers").addEventListener("input", () => applyManualSide("home"));
  $("awayManualName").addEventListener("input", () => applyManualSide("away"));
  $("awayManualPlayers").addEventListener("input", () => applyManualSide("away"));
  document.querySelectorAll(".accent-option").forEach(button => {
    button.addEventListener("click", () => {
      applyAccentColor(button.dataset.side, button.dataset.color);
    });
  });
}

function normalizeAccentColor(value, side) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_TEAM_ACCENTS[side];
}

function renderAccentColorInputs() {
  const homeColor = normalizeAccentColor(state?.teams?.home?.accentColor, "home");
  const awayColor = normalizeAccentColor(state?.teams?.away?.accentColor, "away");

  [
    $("homeAccentSwatch"),
    $("homeHeaderAccentSwatch")
  ].filter(Boolean).forEach(el => {
    el.style.backgroundColor = homeColor;
  });

  [
    $("awayAccentSwatch"),
    $("awayHeaderAccentSwatch")
  ].filter(Boolean).forEach(el => {
    el.style.backgroundColor = awayColor;
  });

  document.querySelectorAll('.accent-option[data-side="home"]').forEach(button => {
    button.classList.toggle("is-active", button.dataset.color === homeColor);
  });
  document.querySelectorAll('.accent-option[data-side="away"]').forEach(button => {
    button.classList.toggle("is-active", button.dataset.color === awayColor);
  });
}

function applyAccentColor(side, color) {
  if (!state?.teams?.[side]) return;
  state.teams[side].accentColor = normalizeAccentColor(color, side);
  renderAccentColorInputs();
  syncTeamsToServer();
}

function getTeamsMode() {
  const checked = document.querySelector('input[name="teamsMode"]:checked');
  return checked?.value || localStorage.getItem("teamsMode") || "portal";
}

function applyTeamsMode(mode) {
  toggleModeUI("home", mode);
  toggleModeUI("away", mode);

  if (mode === "portal" && portalUnavailableUntil && Date.now() < portalUnavailableUntil) {
    showToast("PortalBilhar temporariamente indisponível. Tenta novamente em alguns minutos.", "warning");
    forceManualMode();
    return;
  }
  if (portalUnavailableUntil && Date.now() >= portalUnavailableUntil) {
    portalUnavailableUntil = 0;
  }

  if (mode === "portal") {
    const savedHomeId = state?.teams?.home?.id || null;
    const savedHomeName = state?.teams?.home?.name || null;
    const savedAwayId = state?.teams?.away?.id || null;
    const savedAwayName = state?.teams?.away?.name || null;
    loadTeamsFromPortal("home", null, savedHomeId, savedHomeName);
    loadTeamsFromPortal("away", null, savedAwayId, savedAwayName);
  }
  if (mode === "manual") {
    applyManualSide("home");
    applyManualSide("away");
  }
  updateCompetitionVisibility();
}

function toggleModeUI(side, mode) {
  const teamSelect = $(`${side}TeamSelect`);
  const manualName = $(`${side}ManualName`);
  const manualPlayers = $(`${side}ManualPlayers`);
  if (teamSelect) teamSelect.classList.toggle("d-none", mode !== "portal");
  if (manualName) manualName.classList.toggle("d-none", mode !== "manual");
  if (manualPlayers) manualPlayers.classList.toggle("d-none", mode !== "manual");

  if (mode !== "portal") {
    // no search input to clear
  }
}

function applyManualSide(side) {
  const nameInput = side === "home" ? $("homeManualName") : $("awayManualName");
  const playersInput = side === "home" ? $("homeManualPlayers") : $("awayManualPlayers");

  const name = nameInput.value.trim() || (side === "home" ? "Locais" : "Visitantes");
  const players = playersInput.value.split("\n").map(l => l.trim()).filter(p => p);

  state.teams[side] = {
    id: null,
    name,
    players,
    score: state.teams[side].score,
    logoUrl: side === "home" ? "__logo__" : "__ball8__",
    accentColor: normalizeAccentColor(state.teams[side].accentColor, side)
  };

  if (side === "home") $("homeTeamName").textContent = name;
  else $("awayTeamName").textContent = name;
  updateQuadroTeamHeader();

  renderPlayers();
  populatePlayerDropdowns();
  updateTeamLogos();
  renderAccentColorInputs();
  syncTeamsToServer();
  updateGuidance();
}

function updateTeamLogos() {
  const homeLogo = $("homeTeamLogo");
  const awayLogo = $("awayTeamLogo");
  const homeScoreLogo = $("homeScoreLogo");
  const awayScoreLogo = $("awayScoreLogo");
  const homeUrl = state?.teams?.home?.logoUrl;
  const awayUrl = state?.teams?.away?.logoUrl;
  const homeSrc = homeUrl === "__logo__" ? LOGO_HOME : (homeUrl === "__ball8__" ? LOGO_AWAY : (homeUrl || LOGO_HOME));
  const awaySrc = awayUrl === "__logo__" ? LOGO_HOME : (awayUrl === "__ball8__" ? LOGO_AWAY : (awayUrl || LOGO_HOME));
  if (homeLogo) homeLogo.src = homeSrc;
  if (awayLogo) awayLogo.src = awaySrc;
  if (homeScoreLogo) homeScoreLogo.src = homeSrc;
  if (awayScoreLogo) awayScoreLogo.src = awaySrc;
}

const PORTAL_RETRY_MS = 3 * 60 * 1000;
let portalUnavailableUntil = 0;
function handlePortalFailure() {
  const now = Date.now();
  if (portalUnavailableUntil && now < portalUnavailableUntil) return;
  portalUnavailableUntil = now + PORTAL_RETRY_MS;
  showToast("Não é possível ir buscar os dados, adicione manualmente. Tenta novamente em alguns minutos.", "danger");
  forceManualMode();
}

function forceManualMode() {
  const portal = $("teamsModePortal");
  const manual = $("teamsModeManual");
  if (manual) manual.checked = true;
  localStorage.setItem("teamsMode", "manual");
  applyTeamsMode("manual");
}

// -----------------------------------------------------------------------------
// TEAMS PANEL RENDERING
// -----------------------------------------------------------------------------
function renderPlayers() {
  const homeList = $("homePlayersList");
  const awayList = $("awayPlayersList");
  const homeCount = $("homePlayersCount");
  const awayCount = $("awayPlayersCount");

  homeList.innerHTML = "";
  awayList.innerHTML = "";

  (state.teams.home.players || []).forEach(p => {
    const li = document.createElement("li");
    li.className = "list-group-item py-1";
    li.textContent = p;
    homeList.appendChild(li);
  });

  (state.teams.away.players || []).forEach(p => {
    const li = document.createElement("li");
    li.className = "list-group-item py-1";
    li.textContent = p;
    awayList.appendChild(li);
  });

  if (homeCount) homeCount.textContent = `(${state.teams.home.players?.length || 0})`;
  if (awayCount) awayCount.textContent = `(${state.teams.away.players?.length || 0})`;
}

// -----------------------------------------------------------------------------
// Global, for open and championship
// -----------------------------------------------------------------------------
function populatePlayerDropdowns() {
  const homeSel = $("queueHomePlayer");
  const awaySel = $("queueAwayPlayer");

  if (!homeSel || !awaySel) return;

  homeSel.innerHTML = "";
  awaySel.innerHTML = "";

  if (viewMode === "open") {
    // Modo Open: mesma lista para ambos os lados
    openPlayers.forEach(p => {
      homeSel.add(new Option(p, p));
      awaySel.add(new Option(p, p));
    });
  } else {
    // Modo equipas: Locais só com jogadores da casa, Visitantes com jogadores de fora
    (state.teams.home.players || []).forEach(p => {
      homeSel.add(new Option(p, p));
    });
    (state.teams.away.players || []).forEach(p => {
      awaySel.add(new Option(p, p));
    });
  }

  renderQuadroSelectors();
}

function getPlayersForSide(side) {
  if (viewMode === "open") return [...openPlayers];
  return side === "home"
    ? [...(state.teams.home.players || [])]
    : [...(state.teams.away.players || [])];
}

function renderQuadroSelectors() {
  if (viewMode === "open") return;
  const homePlayers = getPlayersForSide("home");
  const awayPlayers = getPlayersForSide("away");

  const homeIds = ["quadroHome1", "quadroHome2", "quadroHome3", "quadroHome4"];
  const awayIds = ["quadroAway1", "quadroAway2", "quadroAway3", "quadroAway4"];

  homeIds.forEach(id => {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">— escolher —</option>';
    homePlayers.forEach(p => sel.add(new Option(p, p)));
  });

  awayIds.forEach(id => {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">— escolher —</option>';
    awayPlayers.forEach(p => sel.add(new Option(p, p)));
  });

  setupQuadroSelectListeners();
  applyQuadroSelections();
  renderSubstitutionSelectors();
  updateLockButtons();
  updateQuadroDuplicates();
  updateQuadroLockState();
}

function setupQuadroHandlers() {
  const btn = $("addQuadroBtn");
  const btnQueue = $("addQuadroBtnQueue");
  if (btn) btn.addEventListener("click", addQuadroToQueue);
  if (btnQueue) btnQueue.addEventListener("click", addQuadroToQueue);

  const lockQ1 = $("lockQuadro1Btn");
  if (lockQ1) {
    lockQ1.classList.add("d-none");
  }

  document.querySelectorAll(".quadro-btn").forEach(b => {
    b.addEventListener("click", () => {
      const idx = parseInt(b.dataset.quadro, 10);
      if (Number.isNaN(idx)) return;
      setActiveQuadro(idx);
    });
  });
}

function setupQuadroSelectListeners() {
  const ids = [
    "quadroHome1","quadroHome2","quadroHome3","quadroHome4",
    "quadroAway1","quadroAway2","quadroAway3","quadroAway4"
  ];
  ids.forEach(id => {
    const sel = $(id);
    if (!sel || sel.dataset.listenerAttached) return;
    sel.addEventListener("change", () => {
      updateQuadroDuplicates();
      saveQuadroSelections();
      updateLockButtons();
      updateQuadroButtonsStatus();
    });
    sel.dataset.listenerAttached = "1";
  });

  const subIds = [
    "homeSubOut1","homeSubIn1","homeSubOut2","homeSubIn2",
    "awaySubOut1","awaySubIn1","awaySubOut2","awaySubIn2"
  ];
  subIds.forEach(id => {
    const sel = $(id);
    if (!sel || sel.dataset.listenerAttached) return;
    sel.addEventListener("change", () => {
      syncSubstitutionDraft();
      updateSubstitutionButtons();
      updateQuadroButtonsStatus();
    });
    sel.dataset.listenerAttached = "1";
  });

  const confirmButtons = [
    { id: "homeSubConfirm1", side: "home", idx: 0 },
    { id: "homeSubConfirm2", side: "home", idx: 1 },
    { id: "awaySubConfirm1", side: "away", idx: 0 },
    { id: "awaySubConfirm2", side: "away", idx: 1 }
  ];
  confirmButtons.forEach(btn => {
    const el = $(btn.id);
    if (!el || el.dataset.listenerAttached) return;
    el.addEventListener("click", () => confirmSubstitution(btn.side, btn.idx));
    el.dataset.listenerAttached = "1";
  });

  const revertButtons = [
    { id: "homeSubRevert1", side: "home", idx: 0 },
    { id: "homeSubRevert2", side: "home", idx: 1 },
    { id: "awaySubRevert1", side: "away", idx: 0 },
    { id: "awaySubRevert2", side: "away", idx: 1 }
  ];
  revertButtons.forEach(btn => {
    const el = $(btn.id);
    if (!el || el.dataset.listenerAttached) return;
    el.addEventListener("click", () => revertSubstitution(btn.side, btn.idx));
    el.dataset.listenerAttached = "1";
  });
}

function updateQuadroDuplicates() {
  const sides = [
    { side: "home", ids: ["quadroHome1","quadroHome2","quadroHome3","quadroHome4"] },
    { side: "away", ids: ["quadroAway1","quadroAway2","quadroAway3","quadroAway4"] }
  ];

  sides.forEach(group => {
    const values = group.ids.map(id => ($(id)?.value || "").trim());
    const counts = values.reduce((acc, v) => {
      if (!v) return acc;
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});

    group.ids.forEach((id, idx) => {
      const sel = $(id);
      const wrapper = sel?.closest(".quadro-item");
      if (!wrapper) return;
      const val = values[idx];
      if (val && counts[val] > 1) wrapper.classList.add("quadro-duplicate");
      else wrapper.classList.remove("quadro-duplicate");
    });
  });
}

function updateQuadroLockState() {
  const lockedQ1 = !!state?.locks?.quadro1Locked;
  const started = isQuadro1Started();
  [
    { id: "quadroHome1", label: "quadroHome1Label" },
    { id: "quadroHome2", label: "quadroHome2Label" },
    { id: "quadroHome3", label: "quadroHome3Label" },
    { id: "quadroHome4", label: "quadroHome4Label" },
    { id: "quadroAway1", label: "quadroAway1Label" },
    { id: "quadroAway2", label: "quadroAway2Label" },
    { id: "quadroAway3", label: "quadroAway3Label" },
    { id: "quadroAway4", label: "quadroAway4Label" }
  ].forEach(({ id, label }) => {
    const sel = $(id);
    const text = $(label);
    if (sel) {
      sel.disabled = lockedQ1 || started;
    }
    if (text) text.classList.add("d-none");
  });
  updateGuidance();
}

function canApplySubstitutions() {
  if (viewMode === "open") return false;
  const completedQ1 = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta && g.quadroId === 1).length;
  const active = state.activeQuadroIndex || 1;
  return completedQ1 >= 4 && active >= 2;
}

function renderSubstitutionSelectors() {
  const completedQ1 = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta && g.quadroId === 1).length;
  const active = state.activeQuadroIndex || 1;
  const available = completedQ1 >= 4 && active >= 2;
  const enabled = available;

  const homeBase = getBaseForQuadro("home", active);
  const awayBase = getBaseForQuadro("away", active);

  const homeAll = getPlayersForSide("home");
  const awayAll = getPlayersForSide("away");

  const homeOutIds = ["homeSubOut1","homeSubOut2"];
  const homeInIds = ["homeSubIn1","homeSubIn2"];
  const awayOutIds = ["awaySubOut1","awaySubOut2"];
  const awayInIds = ["awaySubIn1","awaySubIn2"];
  const subs = getSubstitutionState();
  const homeNote = $("homeSubNote");
  const awayNote = $("awaySubNote");
  const showNote = available && active === 2;
  if (homeNote) homeNote.classList.toggle("d-none", !showNote);
  if (awayNote) awayNote.classList.toggle("d-none", !showNote);

  function fillSelect(id, options, placeholder, selectedValue = "") {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    options.forEach(p => sel.add(new Option(p, p)));
    if (selectedValue && !options.includes(selectedValue)) {
      sel.add(new Option(selectedValue, selectedValue));
    }
    sel.disabled = !enabled;
  }

  homeOutIds.forEach((id, i) => fillSelect(id, homeBase, "Sai", subs.home?.[i]?.out || ""));
  awayOutIds.forEach((id, i) => fillSelect(id, awayBase, "Sai", subs.away?.[i]?.out || ""));

  const homeInOptions = homeAll.filter(p => !homeBase.includes(p));
  const awayInOptions = awayAll.filter(p => !awayBase.includes(p));
  homeInIds.forEach((id, i) => fillSelect(id, homeInOptions, "Entra", subs.home?.[i]?.in || ""));
  awayInIds.forEach((id, i) => fillSelect(id, awayInOptions, "Entra", subs.away?.[i]?.in || ""));

  subs.home.forEach((s, i) => {
    if (homeOutIds[i]) $(homeOutIds[i]).value = s.out || $(homeOutIds[i]).value || "";
    if (homeInIds[i]) $(homeInIds[i]).value = s.in || $(homeInIds[i]).value || "";
  });
  subs.away.forEach((s, i) => {
    if (awayOutIds[i]) $(awayOutIds[i]).value = s.out || $(awayOutIds[i]).value || "";
    if (awayInIds[i]) $(awayInIds[i]).value = s.in || $(awayInIds[i]).value || "";
  });

  const homeBlock = $("homeSubOut1")?.closest(".substitution-block");
  const awayBlock = $("awaySubOut1")?.closest(".substitution-block");
  if (homeBlock) homeBlock.classList.remove("sub-hidden");
  if (awayBlock) awayBlock.classList.remove("sub-hidden");
  if (homeBlock) homeBlock.classList.toggle("sub-disabled", !available);
  if (awayBlock) awayBlock.classList.toggle("sub-disabled", !available);

  updateSubstitutionButtons();
  updateSubstitutionWarning();
  updateGuidance();
}

function getSubstitutionState() {
  const base = {
    home: [
      { out: "", in: "", confirmed: false, confirmedAt: null, reverted: false },
      { out: "", in: "", confirmed: false, confirmedAt: null, reverted: false }
    ],
    away: [
      { out: "", in: "", confirmed: false, confirmedAt: null, reverted: false },
      { out: "", in: "", confirmed: false, confirmedAt: null, reverted: false }
    ]
  };
  if (!state.substitutions) return base;
  return {
    home: [0, 1].map(i => ({ ...base.home[i], ...(state.substitutions.home?.[i] || {}) })),
    away: [0, 1].map(i => ({ ...base.away[i], ...(state.substitutions.away?.[i] || {}) }))
  };
}

function getSubRowIds(side, idx) {
  const prefix = side === "home" ? "home" : "away";
  const num = idx + 1;
  return {
    rowId: `${prefix}SubRow${num}`,
    outId: `${prefix}SubOut${num}`,
    inId: `${prefix}SubIn${num}`,
    confirmId: `${prefix}SubConfirm${num}`,
    revertId: `${prefix}SubRevert${num}`
  };
}

async function saveSubstitutionsState() {
  await fetch("/api/substitutions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.substitutions || { home: [], away: [] })
  });
}

function syncSubstitutionDraft() {
  const subs = getSubstitutionState();
  ["home", "away"].forEach(side => {
    [0, 1].forEach(idx => {
      const { outId, inId } = getSubRowIds(side, idx);
      const out = $(outId)?.value || "";
      const inbound = $(inId)?.value || "";
      const current = subs[side][idx];
      if (!current.confirmed) {
        subs[side][idx] = { out, in: inbound, confirmed: false };
      }
    });
  });
  state.substitutions = subs;
  saveSubstitutionsState();
}

function applyConfirmedSubstitutions() {
  recomputeQuadroBasesFromSubs();
}

function recomputeQuadroBasesFromSubs() {
  const subs = getSubstitutionState();
  const baseHome = (state.quadroBases?.home?.[0]?.length === 4)
    ? state.quadroBases.home[0].slice()
    : getBaseForQuadro("home", 2);
  const baseAway = (state.quadroBases?.away?.[0]?.length === 4)
    ? state.quadroBases.away[0].slice()
    : getBaseForQuadro("away", 2);

  const activeSubsHome = subs.home.filter(s => s.confirmed && !s.reverted && s.out && s.in);
  const activeSubsAway = subs.away.filter(s => s.confirmed && !s.reverted && s.out && s.in);

  const buildForQuadro = (targetQuadro, sideSubs, base, side) => {
    const applicable = sideSubs.filter(s => (s.confirmedAt ?? 0) <= targetQuadro);
    let arr = base.slice();
    if (side === "away") {
      arr = rotateLeft(arr, targetQuadro - 1);
    }
    applicable.forEach(s => {
      const idx = arr.indexOf(s.out);
      if (idx >= 0) arr[idx] = s.in;
    });
    if (side === "away") {
      arr = rotateRight(arr, targetQuadro - 1);
    }
    return arr;
  };

  state.quadroBases ??= { home: [[], [], [], []], away: [[], [], [], []] };
  state.quadroBases.home[1] = buildForQuadro(2, activeSubsHome, baseHome, "home");
  state.quadroBases.home[2] = buildForQuadro(3, activeSubsHome, baseHome, "home");
  state.quadroBases.home[3] = buildForQuadro(4, activeSubsHome, baseHome, "home");
  state.quadroBases.away[1] = buildForQuadro(2, activeSubsAway, baseAway, "away");
  state.quadroBases.away[2] = buildForQuadro(3, activeSubsAway, baseAway, "away");
  state.quadroBases.away[3] = buildForQuadro(4, activeSubsAway, baseAway, "away");
}

async function confirmSubstitution(side, idx) {
  if (!canApplySubstitutions()) {
    showToast("Substituições só podem ser feitas após terminar o Quadro 1.", "warning");
    return;
  }
  const activeQuadro = state.activeQuadroIndex || 1;
  if (isQuadroStartedById(activeQuadro)) {
    showToast("Não podes substituir depois do quadro começar.", "warning");
    return;
  }

  const { outId, inId } = getSubRowIds(side, idx);
  const out = $(outId)?.value || "";
  const inbound = $(inId)?.value || "";
  if (!out || !inbound) {
    showToast("Seleciona quem sai e quem entra antes de confirmar.", "warning");
    return;
  }
  if (out === inbound) {
    showToast("Jogador de saída e entrada não podem ser o mesmo.", "warning");
    return;
  }

  const subs = getSubstitutionState();
  const otherIdx = idx === 0 ? 1 : 0;
  const other = subs[side][otherIdx];
  const otherOut = other.out || $(getSubRowIds(side, otherIdx).outId)?.value || "";
  const otherIn = other.in || $(getSubRowIds(side, otherIdx).inId)?.value || "";
  if (otherOut && otherOut === out) {
    showToast("Não podes repetir o mesmo jogador a sair.", "warning");
    return;
  }
  if (otherIn && otherIn === inbound) {
    showToast("Não podes repetir o mesmo jogador a entrar.", "warning");
    return;
  }

  subs[side][idx] = { out, in: inbound, confirmed: true };
  subs[side][idx].confirmedAt = state.activeQuadroIndex || 1;
  subs[side][idx].reverted = false;
  state.substitutions = subs;
  applyConfirmedSubstitutions();

  await fetch("/api/quadro-selections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      home: state.quadroSelections.home,
      away: state.quadroSelections.away,
      basesHome: state.quadroBases.home,
      basesAway: state.quadroBases.away,
      activeQuadroIndex: state.activeQuadroIndex || 1
    })
  });
  await saveSubstitutionsState();

  applyQuadroSelections();
  renderSubstitutionSelectors();
  updateQuadroDuplicates();
  updateQuadroButtonsStatus();
}

function canRevertSubstitution(sub) {
  if (!sub.confirmed || sub.reverted) return false;
  const active = state.activeQuadroIndex || 1;
  const minQuadro = (sub.confirmedAt ?? 0) + 1;
  if (active < minQuadro) return false;
  return !isQuadroStartedById(active);
}

async function revertSubstitution(side, idx) {
  const subs = getSubstitutionState();
  const sub = subs[side][idx];
  if (!canRevertSubstitution(sub)) {
    showToast("Só podes reverter no quadro seguinte antes de iniciar.", "warning");
    return;
  }
  subs[side][idx] = { ...sub, reverted: true, revertedAt: state.activeQuadroIndex || 1 };
  state.substitutions = subs;
  recomputeQuadroBasesFromSubs();

  await fetch("/api/quadro-selections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      home: state.quadroSelections.home,
      away: state.quadroSelections.away,
      basesHome: state.quadroBases.home,
      basesAway: state.quadroBases.away,
      activeQuadroIndex: state.activeQuadroIndex || 1
    })
  });
  await saveSubstitutionsState();

  applyQuadroSelections();
  updateQuadroDuplicates();
  updateSubstitutionButtons();
  updateQuadroButtonsStatus();
}

// substitution history logging removed

function hasPendingSubstitutions() {
  if (!canApplySubstitutions()) return false;
  const subs = getSubstitutionState();
  return ["home", "away"].some(side => {
    return subs[side].some((s, idx) => {
      const { outId, inId } = getSubRowIds(side, idx);
      const out = $(outId)?.value || s.out || "";
      const inbound = $(inId)?.value || s.in || "";
      const hasAny = !!out || !!inbound;
      if (!hasAny) return false;
      if (s.confirmed) return false;
      return true;
    });
  });
}

function updateSubstitutionButtons() {
  const available = canApplySubstitutions();
  const subs = getSubstitutionState();
  ["home", "away"].forEach(side => {
    [0, 1].forEach(idx => {
      const { rowId, outId, inId, confirmId, revertId } = getSubRowIds(side, idx);
      const out = $(outId)?.value || subs[side][idx].out || "";
      const inbound = $(inId)?.value || subs[side][idx].in || "";
      const confirmed = !!subs[side][idx].confirmed;
      const reverted = !!subs[side][idx].reverted;
      const revertedAt = subs[side][idx].revertedAt ?? null;
      const activeQuadro = state.activeQuadroIndex || 1;
      const showReverted = reverted && revertedAt != null && activeQuadro >= revertedAt;
      const row = $(rowId);
      const btn = $(confirmId);
      const revertBtn = $(revertId);
      const outSel = $(outId);
      const inSel = $(inId);
      if (outSel) outSel.disabled = !available || confirmed;
      if (inSel) inSel.disabled = !available || confirmed;
      if (row) {
        const hasAny = !!out || !!inbound;
        row.classList.toggle("sub-pending", hasAny && !confirmed);
        row.classList.toggle("sub-confirmed", confirmed && !showReverted);
        row.classList.toggle("sub-reverted", showReverted);
      }
      if (!btn) return;
      btn.textContent = confirmed ? "Confirmado" : "Confirmar";
      btn.classList.toggle("btn-success", confirmed);
      btn.classList.toggle("btn-outline-success", !confirmed);
      btn.disabled = !available || confirmed || !out || !inbound;
      if (revertBtn) {
        const canRevert = canRevertSubstitution(subs[side][idx]);
        revertBtn.disabled = !canRevert;
        revertBtn.textContent = showReverted ? "Revertido" : "Reverter";
        revertBtn.classList.toggle("btn-outline-secondary", !reverted);
        revertBtn.classList.toggle("btn-secondary", reverted);
      }
    });
  });
  updateSubstitutionWarning();
}

function updateSubstitutionWarning() {
  const warning = $("subsWarning");
  if (!warning) return;
  const show = hasPendingSubstitutions();
  warning.classList.toggle("d-none", !show);
}

function getPlayersInPlayForQuadro(quadroId) {
  const players = new Set();
  if (!quadroId) return players;
  const range = getQuadroGameRange(quadroId);
  Object.values(state.tables || {}).forEach(t => {
    const num = Number.isFinite(t?.gameNumber) ? t.gameNumber : null;
    const matchByRange = range && num != null && num >= range.start && num <= range.end;
    if (t?.gameId && (t.quadroId === quadroId || matchByRange)) {
      if (t.playerHome) players.add(t.playerHome);
      if (t.playerAway) players.add(t.playerAway);
    }
  });
  return players;
}

function hasPendingSubsInvolvingPlayers(playersSet) {
  if (!playersSet || playersSet.size === 0) return false;
  if (!canApplySubstitutions()) return false;
  const subs = getSubstitutionState();
  return ["home", "away"].some(side => {
    return subs[side].some((s, idx) => {
      const { outId, inId } = getSubRowIds(side, idx);
      const out = $(outId)?.value || s.out || "";
      const inbound = $(inId)?.value || s.in || "";
      const hasAny = !!out || !!inbound;
      if (!hasAny) return false;
      if (s.confirmed) return false;
      return playersSet.has(out) || playersSet.has(inbound);
    });
  });
}

function getQuadroIdFromGameNumber(num) {
  if (!Number.isFinite(num)) return null;
  return Math.ceil(num / 4);
}

function getQuadroGameRange(quadroId) {
  if (!quadroId) return null;
  const start = (quadroId - 1) * 4 + 1;
  return { start, end: start + 3 };
}

function getQuadroProgress(quadroId) {
  if (!quadroId) return { completed: 0, inProgress: 0 };
  const range = getQuadroGameRange(quadroId);
  const completed = (state.history || []).filter(g => {
    if (g.isAdjustment || g.isMeta) return false;
    if (g.quadroId === quadroId) return true;
    if (!range) return false;
    const num = Number.isFinite(g.gameNumber) ? g.gameNumber : g.id;
    return Number.isFinite(num) && num >= range.start && num <= range.end;
  }).length;

  const inProgress = Object.values(state.tables || {}).filter(t => {
    if (!t?.gameId) return false;
    if (t.quadroId === quadroId) return true;
    if (!range) return false;
    const num = Number.isFinite(t.gameNumber) ? t.gameNumber : null;
    return num != null && num >= range.start && num <= range.end;
  }).length;

  return { completed, inProgress };
}

function isQuadroSelectionComplete() {
  const home = ["quadroHome1","quadroHome2","quadroHome3","quadroHome4"].map(id => ($(id)?.value || "").trim());
  const away = ["quadroAway1","quadroAway2","quadroAway3","quadroAway4"].map(id => ($(id)?.value || "").trim());
  if (home.some(v => !v) || away.some(v => !v)) return false;
  if (new Set(home).size !== 4) return false;
  if (new Set(away).size !== 4) return false;
  return true;
}

async function saveLocks() {
  await fetch("/api/locks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.locks)
  });
}

function updateLockButtons() {
  const lockQ1 = $("lockQuadro1Btn");
  const badge = $("quadroLockBadge");
  const locked1 = !!state?.locks?.quadro1Locked;
  const ready = isQuadroSelectionComplete();

  if (lockQ1) {
    lockQ1.classList.toggle("btn-outline-warning", !locked1 && !ready);
    lockQ1.classList.toggle("btn-outline-success", !locked1 && ready);
    lockQ1.classList.toggle("btn-success", locked1);
    lockQ1.textContent = locked1 ? "Quadros Confirmados" : "Confirmar Quadros";
    lockQ1.disabled = locked1 ? isQuadro1Started() : (isQuadro1Started() || !ready);
    lockQ1.classList.toggle("d-none", (state.activeQuadroIndex || 1) > 1);
  }
  if (badge) {
    badge.classList.toggle("text-bg-success", locked1);
    badge.classList.toggle("text-bg-secondary", !locked1);
    badge.textContent = locked1 ? "Bloqueado" : "Em edição";
  }

  updateQuadroButtonsStatus();
  updateGuidance();
}

function isQuadro1Started() {
  const inHistory = (state.history || []).some(g => !g.isAdjustment && !g.isMeta && g.quadroId === 1);
  const inTable = Object.values(state.tables || {}).some(t => t?.quadroId === 1);
  return inHistory || inTable;
}

function isQuadro3Started() {
  const inHistory = (state.history || []).some(g => !g.isAdjustment && !g.isMeta && g.quadroId >= 3);
  const inTable = Object.values(state.tables || {}).some(t => t?.quadroId >= 3);
  return inHistory || inTable;
}

function isQuadroStartedById(quadroId) {
  const inHistory = (state.history || []).some(g => !g.isAdjustment && !g.isMeta && g.quadroId === quadroId);
  const inTable = Object.values(state.tables || {}).some(t => t?.quadroId === quadroId);
  return inHistory || inTable;
}

function rotateLeft(arr, n) {
  const a = arr.slice();
  const k = ((n % a.length) + a.length) % a.length;
  return a.slice(k).concat(a.slice(0, k));
}

function rotateRight(arr, n) {
  const a = arr.slice();
  const k = ((n % a.length) + a.length) % a.length;
  return a.slice(-k).concat(a.slice(0, -k));
}

function getBaseForQuadro(side, idx) {
  const bases = state?.quadroBases?.[side] || [[], [], [], []];
  const base = bases[idx - 1];
  if (base && base.length === 4) return base;
  // fallback to quadroSelections (legacy)
  const legacy = state?.quadroSelections?.[side] || ["", "", "", ""];
  return legacy.length === 4 ? legacy : ["", "", "", ""];
}

function applyQuadroSelections() {
  const idx = state.activeQuadroIndex || 1;
  const baseHome = getBaseForQuadro("home", idx);
  const baseAway = getBaseForQuadro("away", idx);

  const home = baseHome;
  const away = rotateLeft(baseAway, idx - 1);

  ["quadroHome1","quadroHome2","quadroHome3","quadroHome4"].forEach((id, i) => {
    const sel = $(id);
    if (sel) sel.value = home[i] || "";
    const label = $(`${id}Label`);
    if (label) label.textContent = home[i] || "—";
  });
  ["quadroAway1","quadroAway2","quadroAway3","quadroAway4"].forEach((id, i) => {
    const sel = $(id);
    if (sel) sel.value = away[i] || "";
    const label = $(`${id}Label`);
    if (label) label.textContent = away[i] || "—";
  });

  for (let i = 1; i <= 4; i++) {
    const num = (idx - 1) * 4 + i;
    const hb = $(`quadroHomeBadge${i}`);
    const ab = $(`quadroAwayBadge${i}`);
    if (hb) hb.textContent = String(num);
    if (ab) ab.textContent = String(num);
  }

  markSubstitutions();
  updateQuadroButtonsStatus();
  updateQuadroLockState();
  updateQuadroRowActions();
}

function updateQuadroRowActions() {
  if (viewMode === "open") return;
  const activeQuadro = state.activeQuadroIndex || 1;
  const playable = state.locks?.quadroPlayableId === activeQuadro;
  const historyGames = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta && g.quadroId === activeQuadro);
  const tableGames = Object.values(state.tables || {});
  for (let i = 1; i <= 4; i++) {
    const inHistory = historyGames.some(g => g.quadroIndex === i);
    const inTable = tableGames.some(t => t?.quadroId === activeQuadro && t?.quadroIndex === i);
    const disabled = !playable || inHistory || inTable || isMatchEnded();
    const b1 = $(`quadroM1_${i}`);
    const b2 = $(`quadroM2_${i}`);
    if (b1) b1.disabled = disabled;
    if (b2) b2.disabled = disabled;
  }
}

function sendQuadroRowToTable(rowNumber, tableId) {
  if (viewMode === "open") return;
  const activeQuadro = state.activeQuadroIndex || 1;
  if (state.locks?.quadroPlayableId !== activeQuadro) {
    showToast("Carrega em Jogar quadro primeiro.", "warning");
    return;
  }
  const current = state.tables[tableId];
  if (current?.gameId && (current.scoreHome ?? 0) === 0 && (current.scoreAway ?? 0) === 0) {
    showToast("Termina o jogo atual antes de substituir a mesa.", "warning");
    return;
  }
  const completed = (state.history || []).some(g => !g.isAdjustment && !g.isMeta && g.quadroId === activeQuadro && g.quadroIndex === rowNumber);
  if (completed) {
    showToast("Este jogo já foi concluído.", "warning");
    return;
  }
  const inTable = Object.values(state.tables || {}).some(t => t?.quadroId === activeQuadro && t?.quadroIndex === rowNumber);
  if (inTable) {
    showToast("Este jogo já está numa mesa.", "warning");
    return;
  }

  const home = getBaseForQuadro("home", activeQuadro);
  const away = rotateLeft(getBaseForQuadro("away", activeQuadro), activeQuadro - 1);
  const h = home[rowNumber - 1] || "";
  const a = away[rowNumber - 1] || "";
  if (!h || !a) {
    showToast("Seleciona os 4 jogadores antes de jogar.", "warning");
    return;
  }

  state.tables[tableId] = {
    gameId: state.nextGameId++,
    gameNumber: (activeQuadro - 1) * 4 + rowNumber,
    playerHome: h,
    playerAway: a,
    quadroId: activeQuadro,
    quadroIndex: rowNumber,
    scoreHome: 0,
    scoreAway: 0,
    history: []
  };

  updateTableUI(tableId);
  saveTable(tableId);
  updateQuadroRowActions();
}

function markSubstitutions() {
  const subs = getSubstitutionState();
  const active = state.activeQuadroIndex || 1;
  const resolveMarks = list => {
    const inSet = new Set();
    const outSet = new Set();
    list.forEach(s => {
      if (!s.confirmed) return;
      const confirmedAt = s.confirmedAt ?? 0;
      const revertedAt = s.revertedAt ?? null;
      if (active < confirmedAt) return;
      if (s.reverted && revertedAt != null && active >= revertedAt) {
        // After revert, show the original player as "entered" for this quadro view.
        if (s.out) inSet.add(s.out);
        if (s.in) outSet.add(s.in);
      } else {
        if (s.in) inSet.add(s.in);
        if (s.out) outSet.add(s.out);
      }
    });
    return { inSet, outSet };
  };

  const homeMarks = resolveMarks(subs.home || []);
  const awayMarks = resolveMarks(subs.away || []);

  ["quadroHome1","quadroHome2","quadroHome3","quadroHome4"].forEach(id => {
    const sel = $(id);
    const wrapper = sel?.closest(".quadro-item");
    if (!wrapper) return;
    wrapper.classList.toggle("quadro-sub-in", homeMarks.inSet.has(sel.value));
    wrapper.classList.toggle("quadro-sub-out", homeMarks.outSet.has(sel.value));
  });

  ["quadroAway1","quadroAway2","quadroAway3","quadroAway4"].forEach(id => {
    const sel = $(id);
    const wrapper = sel?.closest(".quadro-item");
    if (!wrapper) return;
    wrapper.classList.toggle("quadro-sub-in", awayMarks.inSet.has(sel.value));
    wrapper.classList.toggle("quadro-sub-out", awayMarks.outSet.has(sel.value));
  });
}

async function saveQuadroSelections() {
  const idx = state.activeQuadroIndex || 1;
  const home = [
    $("quadroHome1").value,
    $("quadroHome2").value,
    $("quadroHome3").value,
    $("quadroHome4").value
  ];
  const away = [
    $("quadroAway1").value,
    $("quadroAway2").value,
    $("quadroAway3").value,
    $("quadroAway4").value
  ];

  const baseAway = rotateRight(away, idx - 1);

  state.quadroSelections = { home, away };
  state.quadroBases ??= { home: [[],[],[],[]], away: [[],[],[],[]] };
  for (let i = idx - 1; i < 4; i++) {
    state.quadroBases.home[i] = home.slice();
    state.quadroBases.away[i] = baseAway.slice();
  }
  recomputeQuadroBasesFromSubs();
  await fetch("/api/quadro-selections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      home,
      away,
      basesHome: state.quadroBases.home,
      basesAway: state.quadroBases.away,
      activeQuadroIndex: idx
    })
  });
}

function setActiveQuadro(idx) {
  for (let i = 1; i < idx; i++) {
    const progress = getQuadroProgress(i);
    const playersInPlay = getPlayersInPlayForQuadro(i);
    const pendingSubsConflict = hasPendingSubsInvolvingPlayers(playersInPlay);
    const canAdvanceEarly =
      (progress.completed + progress.inProgress === 4) &&
      (progress.inProgress === 1) &&
      !pendingSubsConflict;
    if (progress.completed < 4 && !canAdvanceEarly) {
      showToast("Não podes avançar para o quadro seguinte sem concluir o anterior.", "warning");
      return;
    }
  }

  state.activeQuadroIndex = idx;
  applyQuadroSelections();
  updateQuadroDuplicates();
  updateQuadroButtonsStatus();
  renderSubstitutionSelectors();
  updateQuadroLockState();
  saveQuadroSelections();
}

function updateQuadroButtonsStatus() {
  const completed = {};
  const inProgress = {};
  [1,2,3,4].forEach(i => {
    const progress = getQuadroProgress(i);
    completed[i] = progress.completed;
    inProgress[i] = progress.inProgress;
  });

  [1,2,3,4].forEach(i => {
    const btn = $(`quadroBtn${i}`);
    if (!btn) return;
    btn.classList.remove("btn-success", "btn-primary", "btn-outline-secondary");
    if ((completed[i] || 0) >= 4) {
      btn.classList.add("btn-success");
    } else if ((state.activeQuadroIndex || 1) === i) {
      btn.classList.add("btn-primary");
    } else {
      btn.classList.add("btn-outline-secondary");
    }
    const prevCount = completed[i - 1] || 0;
    const prevInProgress = inProgress[i - 1] || 0;
    const playersInPlay = getPlayersInPlayForQuadro(i - 1);
    const pendingSubsConflict = hasPendingSubsInvolvingPlayers(playersInPlay);
    const canAdvanceEarly =
      (prevCount + prevInProgress === 4) &&
      (prevInProgress === 1) &&
      !pendingSubsConflict;
    btn.disabled = i > 1 && !(prevCount >= 4 || canAdvanceEarly);
  });

  const addBtn = $("addQuadroBtn");
  if (addBtn) {
    const lockedQ1 = !!state.locks?.quadro1Locked;
    const activeQuadro = state.activeQuadroIndex || 1;
    const pendingSubsConflictActive = hasPendingSubsInvolvingPlayers(getPlayersInPlayForQuadro(activeQuadro));
    const canPlay = (lockedQ1 || isQuadroSelectionComplete()) && !pendingSubsConflictActive;
    const alreadyPlayable = state.locks?.quadroPlayableId === activeQuadro;
    const alreadyCompleted = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta && g.quadroId === activeQuadro).length >= 4;
    addBtn.disabled = !canPlay || alreadyPlayable || alreadyCompleted;
  }
  updateGuidance();
}

function setupQuadroDragDrop() {
  // Drag & drop removed
}

function addQuadroToQueue() {
  if (viewMode === "open") {
    showToast("Quadros só estão disponíveis no modo competição.", "warning");
    return;
  }
  // Ensure confirmed substitutions are applied to the current quadro before reading selections.
  if (state.substitutions) {
    recomputeQuadroBasesFromSubs();
    applyQuadroSelections();
  }
  const q1Done = (getQuadroProgress(1).completed || 0) >= 4;
  const lockedQ1 = !!state.locks?.quadro1Locked;
  if (!lockedQ1) {
    if (!isQuadroSelectionComplete()) {
      showToast("Seleciona 4 jogadores de cada equipa antes de jogar.", "warning");
      return;
    }
    state.locks ??= { quadro1Locked: false };
    state.locks.quadro1Locked = true;
    saveLocks();
    updateLockButtons();
    updateQuadroLockState();
  }
  if (hasPendingSubstitutions()) {
    showToast("Confirma as substituições antes de jogar o quadro.", "warning");
    return;
  }
  const finished = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta);
  if (finished.length) {
    const lastQuadro = Math.max(...finished.map(g => g.quadroId ?? getQuadroIdFromGameNumber(g.gameNumber ?? g.id)).filter(Boolean));
    const progress = getQuadroProgress(lastQuadro);
    const playersInPlay = getPlayersInPlayForQuadro(lastQuadro);
    const pendingSubsConflict = hasPendingSubsInvolvingPlayers(playersInPlay);
    const canAdvanceEarly =
      (progress.completed + progress.inProgress === 4) &&
      (progress.inProgress === 1) &&
      !pendingSubsConflict;
    if (progress.completed < 4 && !canAdvanceEarly) {
      showToast("Ainda existem jogos por concluir do quadro atual.", "warning");
      return;
    }
  }

  const activeQuadro = state.activeQuadroIndex || 1;
  const alreadyCompleted = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta && g.quadroId === activeQuadro).length >= 4;
  if (alreadyCompleted) {
    showToast("Este quadro já foi concluído.", "warning");
    return;
  }

  const homePlayers = getPlayersForSide("home");
  const awayPlayers = getPlayersForSide("away");
  if (homePlayers.length < 4 || awayPlayers.length < 4) {
    showToast("Cada equipa precisa de pelo menos 4 jogadores.", "warning");
    return;
  }

  state.locks ??= { quadro1Locked: false };
  state.locks.quadroPlayableId = activeQuadro;
  saveLocks();
  saveQuadroSelections();
  showToast("Quadro pronto para enviar às mesas.", "success");
  updateQuadroButtonsStatus();
  updateQuadroRowActions();
  updateGuidance();
}



async function syncTeamsToServer() {
  await fetch("/api/set-teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ home: state.teams.home, away: state.teams.away })
  });
}

async function syncViewModeToServer() {
  state.viewMode = viewMode;
  await fetch("/api/view-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewMode })
  });
}

// -----------------------------------------------------------------------------
// TEAM SCORES
// -----------------------------------------------------------------------------
function adjustTeamScore(side, delta) {
  const input = side === "home" ? $("homeScore") : $("awayScore");
  let val = parseInt(input.textContent || 0) + delta;
  if (val < 0) val = 0;
  input.textContent = val;

  saveTeamScores();
}

function setupScoreSync() {
  // manual editing disabled
}

async function saveTeamScores() {
  const homeScore = parseInt($("homeScore").textContent) || 0;
  const awayScore = parseInt($("awayScore").textContent) || 0;

  state.teams.home.score = homeScore;
  state.teams.away.score = awayScore;

  const res = await fetch("/api/set-team-scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ homeScore, awayScore })
  });
  const data = await res.json();
  if (data?.teams) {
    state.teams = data.teams;
  }
  if (data?.history) {
    state.history = data.history;
    renderHistory();
  }
  $("homeScore").textContent = state.teams.home.score || 0;
  $("awayScore").textContent = state.teams.away.score || 0;
  if (data?.warning) showToast(data.warning, "warning");
}

// -----------------------------------------------------------------------------
// GAME QUEUE
// -----------------------------------------------------------------------------
function addGameToQueue() {
  const pHome = $("queueHomePlayer").value;
  const pAway = $("queueAwayPlayer").value;
  if (!pHome || !pAway) return;

  const game = {
    id: state.nextGameId++,
    gameNumber: getNextGameNumber(),
    playerHome: pHome,
    playerAway: pAway
  };

  state.queue.push(game);
  renumberQueue();
  renderQueue();
  saveQueue();
}

function renderQueue() {
  const q = $("queue");
  q.innerHTML = "";

  state.queue.forEach((g, idx) => {
    const div = document.createElement("div");
    div.className = "queue-item d-flex justify-content-between align-items-center border rounded px-2 py-1 mb-1 bg-white";
    div.draggable = viewMode === "open";
    if (viewMode === "open") div.classList.add("draggable");
    div.dataset.index = idx;

    if (viewMode === "open") {
      div.ondragstart = e => {
        e.dataTransfer.setData("queueIndex", idx);
        div.classList.add("dragging");
      };
      div.ondragend = () => div.classList.remove("dragging");
    } else {
      div.ondragstart = null;
      div.ondragend = null;
    }

    const label = `Jogo ${g.gameNumber ?? g.id}`;

    const deleteBtn = viewMode === "open"
      ? `<button class="btn btn-sm btn-outline-danger" onclick="removeFromQueue(${idx})">❌</button>`
      : "";

    div.innerHTML = `
      <span><strong>${label}</strong> — ${g.playerHome} vs ${g.playerAway}</span>
      <div class="d-flex gap-1">
        <button class="btn btn-sm btn-outline-primary" onclick="sendGameToTable(${idx}, 1, true)">Mesa 1</button>
        <button class="btn btn-sm btn-outline-primary" onclick="sendGameToTable(${idx}, 2, true)">Mesa 2</button>
        ${deleteBtn}
      </div>
    `;

    q.appendChild(div);
  });

  if (viewMode === "open") {
    syncHistoryHeight();
  }
}

function removeFromQueue(idx) {
  state.queue.splice(idx, 1);
  renumberQueue();
  renderQueue();
  saveQueue();
  updateQuadroButtonsStatus();
}

async function saveQueue() {
  await fetch("/api/queue/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queue: state.queue,
      nextGameId: state.nextGameId,
      nextQuadroId: state.nextQuadroId
    })
  });
}

// -----------------------------------------------------------------------------
// DRAG & DROP TO TABLES
// -----------------------------------------------------------------------------
function allowDrop(ev) {
  if (viewMode !== "open") return;
  const target = ev.currentTarget;
  if (target?.classList) target.classList.add("drag-over");
  ev.preventDefault();
}

function dropGameOnTable(ev, tableId) {
  ev.preventDefault();
  if (viewMode !== "open") return;
  const target = ev.currentTarget;
  if (target?.classList) target.classList.remove("drag-over");
  const idx = ev.dataTransfer.getData("queueIndex");
  if (idx === "") return;

  sendGameToTable(parseInt(idx, 10), tableId, true);
}

function sendGameToTable(idx, tableId, manual = true) {
  if (Number.isNaN(idx)) return;
  const current = state.tables[tableId];
  if (current?.gameId && (current.scoreHome ?? 0) === 0 && (current.scoreAway ?? 0) === 0) {
    showToast("Termina o jogo atual antes de substituir a mesa.", "warning");
    return;
  }

  const game = state.queue.splice(idx, 1)[0];
  if (!game) return;

  if (game.quadroId != null) {
    const hasOlderQuadro = state.queue.some(g => g.quadroId != null && g.quadroId < game.quadroId);
    if (hasOlderQuadro) {
      showToast("Ainda existem jogos do quadro atual por adicionar.", "warning");
      state.queue.splice(idx, 0, game);
      renderQueue();
      return;
    }
  }

  renderQueue();
  saveQueue();
  updateQuadroButtonsStatus();

  state.tables[tableId] = {
    gameId: game.id,
    gameNumber: game.gameNumber ?? null,
    playerHome: game.playerHome,
    playerAway: game.playerAway,
    quadroId: game.quadroId ?? null,
    quadroIndex: game.quadroIndex ?? null,
    scoreHome: 0,
    scoreAway: 0,
    history: []
  };

  updateTableUI(tableId);
  saveTable(tableId);
}

// -----------------------------------------------------------------------------
// TABLE RENDERING
// -----------------------------------------------------------------------------
function renderTables() {
  updateTableUI(1);
  updateTableUI(2);
}

function updateTableUI(tableId) {
  const t = state.tables[tableId];
  const gameDiv = $(`table${tableId}Game`);
  const scoreDiv = $(`table${tableId}Score`);

  if (!t || !t.gameId) {
    gameDiv.textContent = "Sem jogo";
    gameDiv.classList.add("text-muted");
    scoreDiv.textContent = "0 - 0";
  } else {
    gameDiv.textContent = `${t.playerHome} vs ${t.playerAway}`;
    gameDiv.classList.remove("text-muted");
    scoreDiv.textContent = `${t.scoreHome} - ${t.scoreAway}`;
  }
  updateQuadroRowActions();
  updateQuadroButtonsStatus();
}

async function saveTable(tableId) {
  await fetch("/api/table/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId,
      game: state.tables[tableId]
    })
  });
}

// -----------------------------------------------------------------------------
// TIMERS
// -----------------------------------------------------------------------------
function startTimer(tableId) {
  const t = timers[tableId];
  clearInterval(t.interval);
  t.time = 0;

  t.interval = setInterval(() => {
    t.time++;
    const m = String(Math.floor(t.time / 60)).padStart(2, "0");
    const s = String(t.time % 60).padStart(2, "0");
    $(`timer${tableId}`).textContent = `⏱ ${m}:${s}`;
  }, 1000);
}

function clearTable(tableId, force = false) {
  const t = timers[tableId];
  clearInterval(t.interval);
  t.time = 0;
  $(`timer${tableId}`).textContent = "⏱ 00:00";

  const current = state.tables[tableId];
  if (!force && current?.gameId && (current.scoreHome ?? 0) === 0 && (current.scoreAway ?? 0) === 0) {
    showToast("Não podes remover o jogo sem resultado.", "warning");
    return;
  }

  state.tables[tableId] = {
    gameId: null,
    playerHome: "",
    playerAway: "",
    scoreHome: 0,
    scoreAway: 0,
    history: []
  };

  updateTableUI(tableId);

  fetch("/api/table/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tableId })
  });
}

// -----------------------------------------------------------------------------
// TABLE SCORING
// -----------------------------------------------------------------------------
function addPoint(tableId, side) {
  const t = state.tables[tableId];
  if (!t || !t.gameId) return;

  if (viewMode !== "open") {
    t.scoreHome = side === "home" ? 1 : 0;
    t.scoreAway = side === "away" ? 1 : 0;
  } else {
    t.history.push({ scoreHome: t.scoreHome, scoreAway: t.scoreAway });
    if (side === "home") t.scoreHome++;
    else t.scoreAway++;
  }

  updateTableUI(tableId);

  fetch("/api/table/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId,
      scoreHome: t.scoreHome,
      scoreAway: t.scoreAway
    })
  });
}

function undoPoint(tableId) {
  const t = state.tables[tableId];
  if (!t.gameId) return;
  if (viewMode !== "open") {
    t.scoreHome = 0;
    t.scoreAway = 0;
  } else {
    if (!t.history.length) return;
    const prev = t.history.pop();
    t.scoreHome = prev.scoreHome;
    t.scoreAway = prev.scoreAway;
  }

  updateTableUI(tableId);

  fetch("/api/table/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId,
      scoreHome: t.scoreHome,
      scoreAway: t.scoreAway
    })
  });
}

// -----------------------------------------------------------------------------
// FINISH GAME
// -----------------------------------------------------------------------------
async function finishGame(tableId, winnerSide) {
  const t = state.tables[tableId];
  if (!t || !t.gameId) return;

  const prevHome = state.teams.home.score;
  const prevAway = state.teams.away.score;

  const res = await fetch("/api/table/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tableId, winnerSide })
  });

  const data = await res.json();

  state.teams = data.teams;
  state.history = data.history;

  $("homeScore").textContent = state.teams.home.score;
  $("awayScore").textContent = state.teams.away.score;

  if (state.teams.home.score !== prevHome) flashScore("home");
  if (state.teams.away.score !== prevAway) flashScore("away");
  updateQuadroTeamHeader();
  checkMatchEnd();

  renderHistory();
  clearTable(tableId, true);
  updateQuadroRowActions();
  syncHistoryHeight();

  if (t.quadroId) {
    const count = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta && g.quadroId === t.quadroId).length;
    if (count >= 4) {
      updateQuadroButtonsStatus();
      renderSubstitutionSelectors();
      maybeAutoAdvanceQuadro(t.quadroId);
    }
  }

  updateGuidance();
}

function checkMatchEnd() {
  const { home, away, played } = getSequentialScoreInfo();
  if (home >= 9 || away >= 9 || (home === 8 && away === 8 && played >= 16)) {
    flashWinner(home > away ? "home" : "away");
    showToast("Jogo terminado.", "success");
    lockEditingOnMatchEnd();
    scheduleEndLock();
  }
}

function scheduleEndLock() {
  if (endLockTimer) clearTimeout(endLockTimer);
  endLockTimer = setTimeout(() => {
    lockAllAfterTimeout();
  }, 10 * 60 * 1000);
}

function lockAllAfterTimeout() {
  document.querySelectorAll("select, button, input, textarea").forEach(el => {
    if (el.id === "resetAllBtn") return;
    el.disabled = true;
    el.classList.add("disabled");
  });
  document.body.classList.add("locked-after-end");
  alert('Jogo terminado. Para começar um novo jogo, clica em "Começar de Novo".');
}

function getSequentialScoreInfo() {
  if (viewMode === "open") {
    const home = state.teams.home.score || 0;
    const away = state.teams.away.score || 0;
    return { home, away, played: (state.history || []).filter(g => !g.isAdjustment && !g.isMeta).length };
  }
  const result = computeCompetitionScoreWithStandby(state.history || [], state.tables || {});
  return { home: result.home, away: result.away, played: result.played };
}

function flashWinner(side) {
  flashScore(side);
}

function lockEditingOnMatchEnd() {
  document.querySelectorAll("select").forEach(el => {
    if (el.classList.contains("history-winner-select")) return;
    el.disabled = true;
  });
  document.querySelectorAll("button").forEach(el => {
    if (el.id === "resetAllBtn") return;
    if (el.classList.contains("quadro-btn")) return;
    el.disabled = true;
  });
}

function unlockEditingAfterCorrection() {
  document.querySelectorAll("select, button").forEach(el => {
    el.disabled = false;
  });
  if (endLockTimer) {
    clearTimeout(endLockTimer);
    endLockTimer = null;
  }
  document.body.classList.remove("locked-after-end");
  applyViewMode();
  updateLockButtons();
  updateQuadroButtonsStatus();
  renderSubstitutionSelectors();
  updateQuadroLockState();
  renderQueue();
  updateSubstitutionWarning();
}

function isMatchEnded() {
  const { home, away, played } = getSequentialScoreInfo();
  return home >= 9 || away >= 9 || (home === 8 && away === 8 && played >= 16);
}

function maybeAutoAdvanceQuadro(quadroId) {
  if (quadroId === 1) {
    setActiveQuadro(2);
  } else if (quadroId === 2) {
    setActiveQuadro(3);
  } else if (quadroId === 3) {
    setActiveQuadro(4);
  }
}

function renumberQueue() {
  const completed = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta).length;
  state.queue.forEach((g, i) => {
    g.gameNumber = completed + i + 1;
  });
  updateQuadroButtonsStatus();
}

function getNextGameNumber() {
  const completed = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta).length;
  return completed + state.queue.length + 1;
}

function updateGuidance() {
  // Post-its removed.
}

function updateQuadroTeamHeader() {
  const homeName = $("homeTeamName")?.textContent || state?.teams?.home?.name || "Equipa A";
  const awayName = $("awayTeamName")?.textContent || state?.teams?.away?.name || "Equipa B";
  const homeScore = state?.teams?.home?.score ?? 0;
  const awayScore = state?.teams?.away?.score ?? 0;

  const homeLabel = $("quadroHomeTeamName");
  const awayLabel = $("quadroAwayTeamName");
  const homeScoreEl = $("quadroHomeScore");
  const awayScoreEl = $("quadroAwayScore");

  if (homeLabel) homeLabel.textContent = homeName;
  if (awayLabel) awayLabel.textContent = awayName;
  if (homeScoreEl) homeScoreEl.textContent = homeScore;
  if (awayScoreEl) awayScoreEl.textContent = awayScore;
}

function updateCompetitionVisibility() {
  const block = $("competitionBlock");
  if (!block) return;
  if (viewMode === "open") {
    block.classList.add("d-none");
    return;
  }
  const mode = getTeamsMode();
  block.classList.toggle("d-none", mode !== "portal");
}

// -----------------------------------------------------------------------------
// HISTORY PANEL
// -----------------------------------------------------------------------------
function renderHistory() {
  const container = $("history");
  if (!container) return;
  container.innerHTML = "";

  const games = (state.history || []).filter(g => !g.isAdjustment && !g.isMeta);
  if (!games.length) {
    container.innerHTML = "<div class=\"text-muted\">Sem jogos concluídos.</div>";
    return;
  }

  const sorted = games.slice().sort((a, b) => (b.gameNumber ?? b.id) - (a.gameNumber ?? a.id));
  const standbyGameNumber = getStandbyGameNumber(sorted);

  sorted.forEach(g => {
      const num = Number.isFinite(g.gameNumber) ? g.gameNumber : g.id;
      const isStandby = Number.isFinite(num) && standbyGameNumber != null && num === standbyGameNumber;
      const row = document.createElement("div");
      const label = `Jogo ${g.gameNumber ?? g.id}`;
      const winClass = g.winnerSide === "home" ? "history-win-home" : "history-win-away";
      const homeClass = g.winnerSide === "home" ? "winner-home" : "";
      const awayClass = g.winnerSide === "away" ? "winner-away" : "";
      row.className = `history-row border rounded bg-white small ${winClass} ${isStandby ? "history-standby" : ""}`;
      const standbyTag = isStandby ? `<span class="badge text-bg-warning">Em standby</span>` : "";
      row.innerHTML = `
        <div class="d-flex flex-wrap align-items-center gap-2">
          <strong>${label}:</strong>
          <span class="history-name ${homeClass}">${g.playerHome}</span>

          <span class="fw-bold">${g.scoreHome} - ${g.scoreAway}</span>

          <span class="history-name ${awayClass}">${g.playerAway}</span>
          ${standbyTag}

          <div class="ms-auto">
            <select id="w_${g.id}" class="form-select form-select-sm history-winner-select" style="width:120px"
                    onchange="saveHistoryEdit(${g.id})">
              <option value="home" ${g.winnerSide === "home" ? "selected" : ""}>Locais</option>
              <option value="away" ${g.winnerSide === "away" ? "selected" : ""}>Visitantes</option>
            </select>
          </div>
        </div>
      `;
      container.appendChild(row);
    });
  updateQuadroRowActions();
  syncHistoryHeight();
}

function getStandbyGameNumber(sortedGames) {
  if (viewMode === "open") return null;
  const result = computeCompetitionScoreWithStandby(sortedGames || [], state.tables || {});
  return result.standbyNum ?? null;
}

function computeCompetitionScoreWithStandby(history, tables) {
  const items = (history || [])
    .filter(g => !g.isAdjustment && !g.isMeta)
    .map(g => {
      const num = Number.isFinite(g.gameNumber) ? g.gameNumber : g.id;
      return Number.isFinite(num) ? { g, num } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);

  if (!items.length) return { home: 0, away: 0, played: 0, standbyNum: null };

  const map = new Map();
  let maxNum = 0;
  items.forEach(item => {
    map.set(item.num, item.g);
    if (item.num > maxNum) maxNum = item.num;
  });

  const inProgressNums = new Set(
    Object.values(tables || {})
      .filter(t => t?.gameId && Number.isFinite(t.gameNumber))
      .map(t => t.gameNumber)
  );

  let home = 0;
  let away = 0;
  let played = 0;
  let standbyNum = null;

  for (let n = 1; n <= maxNum; n++) {
    const g = map.get(n);
    if (!g) {
      if (inProgressNums.has(n)) continue;
      break;
    }
    if (g.winnerSide === "home") home++;
    else if (g.winnerSide === "away") away++;
    played++;
    if (home >= 9 || away >= 9 || (home === 8 && away === 8 && played >= 16)) {
      const hasLowerInPlay = [...inProgressNums].some(num => num < n);
      standbyNum = hasLowerInPlay ? n : null;
      break;
    }
  }

  return { home, away, played, standbyNum };
}

async function saveHistoryEdit(id) {
  const prevHome = state.teams.home.score;
  const prevAway = state.teams.away.score;

  const w = $(`w_${id}`).value;
  const h = w === "home" ? 1 : 0;
  const a = w === "away" ? 1 : 0;

  const res = await fetch("/api/history/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      scoreHome: h,
      scoreAway: a,
      winnerSide: w
    })
  });

  const data = await res.json();
  state.teams = data.teams;
  state.history = data.history;

  $("homeScore").textContent = state.teams.home.score;
  $("awayScore").textContent = state.teams.away.score;

  if (state.teams.home.score !== prevHome) flashScore("home");
  if (state.teams.away.score !== prevAway) flashScore("away");

  updateQuadroTeamHeader();
  renderHistory();
  if (wasMatchEnded && !isMatchEnded()) {
    showReopenBanner();
  }
  wasMatchEnded = isMatchEnded();
  if (wasMatchEnded) {
    lockEditingOnMatchEnd();
  } else {
    unlockEditingAfterCorrection();
  }
}

function flashScore(side) {
  const el = $(side === "home" ? "homeScoreWrap" : "awayScoreWrap");
  if (!el) return;
  const cls = side === "home" ? "score-flash-home" : "score-flash-away";
  el.classList.remove("score-flash-home", "score-flash-away");
  // force reflow to restart animation
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 1600);
}

// flashQuadroAway removed

function editPlayers(side) {
  const list = side === "home" ? $("homePlayersList") : $("awayPlayersList");
  const editor = side === "home" ? $("homePlayerEditor") : $("awayPlayerEditor");
  const saveBtn = side === "home" ? $("saveHomePlayersBtn") : $("saveAwayPlayersBtn");
  const panel = side === "home" ? $("homePlayersPanel") : $("awayPlayersPanel");
  if (panel) panel.classList.remove("players-collapsed");

  // Fill textarea with player list
  const players = state.teams[side].players.join("\n");
  editor.value = players;

  // Hide list, show editor
  list.classList.add("d-none");
  editor.classList.remove("d-none");
  saveBtn.classList.remove("d-none");
}

function saveEditedPlayers(side) {
  const editor = side === "home" ? $("homePlayerEditor") : $("awayPlayerEditor");
  const list = side === "home" ? $("homePlayersList") : $("awayPlayersList");
  const saveBtn = side === "home" ? $("saveHomePlayersBtn") : $("saveAwayPlayersBtn");
  const panel = side === "home" ? $("homePlayersPanel") : $("awayPlayersPanel");

  const players = editor.value
    .split("\n")
    .map(p => p.trim())
    .filter(p => p.length > 1);

  state.teams[side].players = players;

  renderPlayers();
  populatePlayerDropdowns();
  syncTeamsToServer();

  // back to view mode
  editor.classList.add("d-none");
  saveBtn.classList.add("d-none");
  list.classList.remove("d-none");
  if (panel && viewMode !== "open") panel.classList.add("players-collapsed");
}


// -----------------------------------------------------------------------------
// RESET EVERYTHING
// -----------------------------------------------------------------------------
function setupResetButton() {
  $("resetAllBtn").addEventListener("click", async () => {
    if (!confirm("Tem a certeza que quer repor tudo?")) return;
    if (endLockTimer) {
      clearTimeout(endLockTimer);
      endLockTimer = null;
    }
    document.body.classList.remove("locked-after-end");

    // 🔹 Limpar Open Mode (frontend)
    openPlayers = [];
    localStorage.removeItem("openPlayers");
    localStorage.removeItem("viewMode");
    localStorage.removeItem("teamsMode");

    // Apagar UI do Open
    const openInput = $("openPlayersInput");
    const openList = $("openPlayersList");
    const toggle = $("modeToggle");

    if (openInput) openInput.value = "";
    if (openList) openList.innerHTML = "";
    if (toggle) toggle.checked = false;

    // Reiniciar modo para teams
    viewMode = "teams";
    applyViewMode();

    // 🔹 Reset no backend
    const res = await fetch("/api/reset-all", { method: "POST" });
    const newState = await res.json();
    state = newState;

    $("homeScore").textContent = state.teams.home.score || 0;
    $("awayScore").textContent = state.teams.away.score || 0;

    renderPlayers();
    populatePlayerDropdowns();
    renderQueue();
    renderTables();
    renderHistory();

    showToast("Estado reposto.", "success");
    setTimeout(() => location.reload(), 300);
  });
}
