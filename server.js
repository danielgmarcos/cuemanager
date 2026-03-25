// ADSCR Control Panel v1.1 – backend with:
// - file persistence
// - PortalBilhar competitions + teams + players
// - history-based team scoring

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// --- Directories & state file ----------------------------------------------

const DATA_DIR = path.join(__dirname, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });

const STATE_FILE = path.join(DATA_DIR, "state.json");

function defaultAccentColor(side) {
  return side === "home" ? "#f2f2f2" : "#d3a11d";
}

function normalizeTeam(team, side) {
  const current = team || {};
  return {
    id: current.id ?? null,
    name: current.name ?? "",
    players: Array.isArray(current.players) ? current.players : [],
    score: Number.isFinite(current.score) ? current.score : 0,
    logoUrl: current.logoUrl ?? null,
    accentColor: current.accentColor || defaultAccentColor(side)
  };
}

function normalizeStateShape(state) {
  const current = state || {};
  current.teams ||= {};
  current.teams.home = normalizeTeam(current.teams.home, "home");
  current.teams.away = normalizeTeam(current.teams.away, "away");
  return current;
}

// --- Initial state & helpers -----------------------------------------------

function initState() {
  const initial = {
    teams: {
      home: { id: null, name: "", players: [], score: 0, logoUrl: null, accentColor: defaultAccentColor("home") },
      away: { id: null, name: "", players: [], score: 0, logoUrl: null, accentColor: defaultAccentColor("away") }
    },
    viewMode: "teams",
    competitionId: null,
    quadroSelections: {
      home: ["", "", "", ""],
      away: ["", "", "", ""]
    },
    quadroBases: {
      home: [[], [], [], []],
      away: [[], [], [], []]
    },
    activeQuadroIndex: 1,
    substitutions: {
      home: [],
      away: []
    },
    locks: {
      quadro1Locked: false,
      subsLocked: false,
      quadroPlayableId: null
    },
    queue: [],
    tables: {
      "1": { gameId: null, playerHome: "", playerAway: "", scoreHome: 0, scoreAway: 0, history: [] },
      "2": { gameId: null, playerHome: "", playerAway: "", scoreHome: 0, scoreAway: 0, history: [] }
    },
    history: [],
    nextGameId: 1,
    nextQuadroId: 1
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
  return initial;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return initState();
  }
  return normalizeStateShape(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// recompute team scores purely from history
function computeCompetitionScore(history, tables) {
  const map = new Map();
  let maxNum = 0;
  (history || []).forEach(g => {
    if (g.isAdjustment || g.isMeta) return;
    const num = Number.isFinite(g.gameNumber) ? g.gameNumber : g.id;
    if (!Number.isFinite(num)) return;
    map.set(num, g);
    if (num > maxNum) maxNum = num;
  });

  const inProgressNums = new Set(
    Object.values(tables || {})
      .filter(t => t?.gameId && Number.isFinite(t.gameNumber))
      .map(t => t.gameNumber)
  );

  let home = 0;
  let away = 0;
  let played = 0;
  for (let n = 1; n <= maxNum; n++) {
    const g = map.get(n);
    if (!g) {
      if (inProgressNums.has(n)) continue;
      break; // stop at first gap not in play
    }
    if (g.winnerSide === "home") home++;
    else if (g.winnerSide === "away") away++;
    played++;
    if (home >= 9 || away >= 9 || (home === 8 && away === 8 && played >= 16)) {
      return { home, away };
    }
  }

  return { home, away };
}

function recomputeTeamScores(state) {
  if (state.viewMode !== "open") {
    const { home, away } = computeCompetitionScore(state.history || [], state.tables || {});
    state.teams.home.score = home;
    state.teams.away.score = away;
    return;
  }

  let home = 0;
  let away = 0;
  (state.history || []).forEach(g => {
    if (g.isAdjustment) return;
    if (g.winnerSide === "home") home++;
    else if (g.winnerSide === "away") away++;
  });
  state.teams.home.score = home;
  state.teams.away.score = away;
}

function countBaseWins(state) {
  if (state.viewMode !== "open") {
    return computeCompetitionScore(state.history || [], state.tables || {});
  }
  let home = 0;
  let away = 0;
  (state.history || []).forEach(g => {
    if (g.isAdjustment || g.isMeta) return;
    if (g.winnerSide === "home") home++;
    else if (g.winnerSide === "away") away++;
  });
  return { home, away };
}

function addAdjustments(state, side, count) {
  for (let i = 0; i < count; i++) {
    state.history.push({
      id: state.nextGameId++,
      table: "Ajuste",
      playerHome: "Ajuste",
      playerAway: "Ajuste",
      scoreHome: 0,
      scoreAway: 0,
      winnerSide: side,
      finishedAt: new Date().toISOString(),
      isAdjustment: true
    });
  }
}

function removeAdjustments(state, side, count) {
  if (!count) return 0;
  let remaining = count;
  for (let i = state.history.length - 1; i >= 0; i--) {
    const g = state.history[i];
    if (!g.isAdjustment) continue;
    if (g.winnerSide !== side) continue;
    state.history.splice(i, 1);
    remaining--;
    if (remaining === 0) break;
  }
  return remaining;
}

// --- PortalBilhar scraping --------------------------------------------------

// Base for competition listing (all variants); we’ll just extract any link with Comp=.
const ORG_ID = 118;
const COMP_BASE = `https://portalbilhar.pt/Publico/BT/Publico_P_Eqp.aspx?org=${ORG_ID}`;

// Pool Português encoded
const VARIANTE_POOL = "Pool_Portugu%C3%AAs";
const OPEN_ORG_ID = 13;
const OPEN_BOARD_URL = `https://portalbilhar.pt/Publico/Bt/Publico_P_Ind.aspx?Variante=${VARIANTE_POOL}&org=${OPEN_ORG_ID}`;

// Players come from Publico_Eqp.aspx?Eqp=...
const TEAM_PAGE_BASE = "https://portalbilhar.pt/Publico/BT/Publico_Eqp.aspx?Eqp=";

function getPortalHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "pt-PT,pt;q=0.9"
  };
}

function normalizePortalText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPortalPlaceholder(value) {
  return !value || /seleccione|escolher/i.test(value);
}

function parseOpenBoardRows($) {
  const matches = [];

  $("#tbl_Resultados tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) return;

    const scheduledAt = normalizePortalText($(cells[0]).text());
    const playerHome = normalizePortalText($(cells[1]).text());
    const resultText = normalizePortalText($(cells[2]).text());
    const playerAway = normalizePortalText($(cells[3]).text());
    const location = normalizePortalText($(cells[4]).text());

    if (!playerHome || !playerAway) return;
    if (/jogador/i.test(playerHome) || /jogador/i.test(playerAway)) return;

    const gameNumberMatch = resultText.match(/Jogo\s*n[ºo]\s*(\d+)/i);
    const scoreMatch = resultText.match(/(\d+)\s*-\s*(\d+)/);

    matches.push({
      gameNumber: gameNumberMatch ? Number.parseInt(gameNumberMatch[1], 10) : null,
      playerHome,
      playerAway,
      resultText,
      location,
      scheduledAt,
      portalScoreHome: scoreMatch ? Number.parseInt(scoreMatch[1], 10) : null,
      portalScoreAway: scoreMatch ? Number.parseInt(scoreMatch[2], 10) : null
    });
  });

  matches.sort((a, b) => {
    const aNumber = Number.isFinite(a.gameNumber) ? a.gameNumber : Number.MAX_SAFE_INTEGER;
    const bNumber = Number.isFinite(b.gameNumber) ? b.gameNumber : Number.MAX_SAFE_INTEGER;
    if (aNumber !== bNumber) return aNumber - bNumber;
    return a.playerHome.localeCompare(b.playerHome, "pt");
  });

  return matches;
}

// List competitions (we keep it simple: any link with Comp=)
// Correct competition scraping from dropdown <select id="ddlCompeticao">
app.get("/api/portal/competitions", async (req, res) => {
  try {
    const url =
      "https://portalbilhar.pt/Publico/BT/Publico_P_Eqp.aspx?Variante=Pool_Portugu%C3%AAs&org=118";

    // Make request with cookie jar (simulates browser)
    const response = await client.get(url, {
      headers: getPortalHeaders(),
    });

    const html = response.data;
    const $ = cheerio.load(html);

    const competitions = [];

    // Matches your screenshot: <select ... id="...dd_competicao">
    $("select[id$='dd_competicao'] option").each((i, el) => {
      const id = $(el).attr("value");
      const name = $(el).text().trim();
      if (id && name && !/seleccione/i.test(name)) {
        competitions.push({ id, name });
      }
    });

    res.json(competitions);
  } catch (err) {
    console.error("Competition scrape error:", err);
    res.status(500).json({ error: "Falha ao obter competições." });
  }
});

app.get("/api/portal/open-competitions", async (req, res) => {
  try {
    const response = await client.get(OPEN_BOARD_URL, {
      headers: getPortalHeaders()
    });
    const $ = cheerio.load(response.data);
    const competitions = [];

    $("select[id$='dd_competicao'] option").each((_, el) => {
      const id = normalizePortalText($(el).attr("value"));
      const name = normalizePortalText($(el).text());
      if (!id || isPortalPlaceholder(name)) return;
      competitions.push({ id, name });
    });

    res.json(competitions);
  } catch (err) {
    console.error("Open competitions scrape error:", err);
    res.status(500).json({ error: "Falha ao obter competições Open." });
  }
});

app.get("/api/portal/open-board", async (req, res) => {
  const comp = normalizePortalText(req.query.comp);
  if (!comp) {
    return res.status(400).json({ error: "Falta parâmetro ?comp=" });
  }

  try {
    const url = `${OPEN_BOARD_URL}&Comp=${encodeURIComponent(comp)}`;
    const response = await client.get(url, {
      headers: getPortalHeaders()
    });
    const $ = cheerio.load(response.data);
    const selected = $("select[id$='dd_competicao'] option:selected").first();
    const competitionName = normalizePortalText(selected.text()) || comp;
    const matches = parseOpenBoardRows($);
    const players = [...new Set(matches.flatMap(match => [match.playerHome, match.playerAway]))];

    res.json({
      competition: {
        id: comp,
        name: competitionName
      },
      players,
      matches
    });
  } catch (err) {
    console.error("Open board scrape error:", err);
    res.status(500).json({ error: "Falha ao obter quadro Open." });
  }
});



// List teams for a given competition (Pool Português)
app.get("/api/portal/teams", async (req, res) => {
  const comp = req.query.comp;
  if (!comp) {
    return res.status(400).json({ error: "Falta parâmetro ?comp=" });
  }

  try {
    const url =
      "https://portalbilhar.pt/Publico/BT/Publico_P_Eqp.aspx?Variante=Pool_Portugu%C3%AAs&org=118&Comp=" +
      encodeURIComponent(comp);

    const html = await (await fetch(url)).text();
    const $ = cheerio.load(html);

    const teams = [];

    $("a[href*='Publico_Eqp.aspx?Eqp=']").each((_, el) => {
      const href = $(el).attr("href");
      const name = $(el).text().trim();
      const idMatch = href.match(/Eqp=([^&]+)/);
      if (idMatch && name) {
        teams.push({ id: idMatch[1], name });
      }
    });

    res.json(teams);
  } catch (err) {
    console.error("Teams scrape error:", err);
    res.status(500).json({ error: "Falha ao obter equipas." });
  }
});


app.get("/api/portal/team", async (req, res) => {
  const eqp = req.query.eqp;
  if (!eqp) return res.status(400).json({ error: "Missing ?eqp=" });

  try {
    const url = `https://portalbilhar.pt/Publico/BT/Publico_Eqp.aspx?Eqp=${eqp}`;
    const response = await client.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0",
        Accept: "text/html",
        "Accept-Language": "pt-PT,pt;q=0.9",
      },
    });

    const $ = cheerio.load(response.data);

    const players = [];
    let logoUrl = null;

    // procurar todas as linhas da(s) tabela(s)
    $("table tr").each((i, row) => {
      const tds = $(row).find("td");
      if (tds.length < 2) return; // precisamos pelo menos de 2 colunas

      // normalmente: 0 = nº FPB, 1 = Nome, resto = info / Ok / etc
      let rawName = $(tds[1]).text().trim();
      if (!rawName) return;

      // filtrar cabeçalhos / lixo óbvio
      if (/nome/i.test(rawName)) return;      // linha "Nome"
      if (/jogador/i.test(rawName)) return;   // algum header
      if (/serie/i.test(rawName)) return;
      if (/fase/i.test(rawName)) return;

      // remover “Ok” ou coisas desse género que possam vir agarradas
      rawName = rawName.replace(/\bOk\b/gi, "").trim();

      // se ainda for só números, ignora
      if (!rawName || /^\d+$/.test(rawName)) return;

      // normalizar espaços
      const name = rawName.replace(/\s+/g, " ");

      players.push(name);
    });

    let imgEl = $("img[src*='Imagens/Clubes'], img[src*='imagens/clubes']").first();
    if (!imgEl || !imgEl.length) {
      imgEl = $("img").filter((_, el) => {
        const src = ($(el).attr("src") || "").toLowerCase();
        const alt = ($(el).attr("alt") || "").toLowerCase();
        return /logo|equipa|clube|emblema/.test(src + " " + alt);
      }).first();
    }

    if (imgEl && imgEl.length) {
      const src = imgEl.attr("src");
      if (src) {
        try {
          logoUrl = new URL(src, url).toString();
        } catch {
          logoUrl = null;
        }
      }
    }

    res.json({
      id: eqp,
      players,
      logoUrl
    });
  } catch (err) {
    console.error("PortalBilhar team error:", err);
    res.status(500).json({ error: "Falha ao obter equipa." });
  }
});



// --- API: state, teams, scores ---------------------------------------------

// Get full state
app.get("/api/state", (req, res) => {
  res.json(loadState());
});

// Set competition
app.post("/api/competition", (req, res) => {
  const state = loadState();
  state.competitionId = req.body.competitionId || null;
  saveState(state);
  res.json({ competitionId: state.competitionId });
});

// Set quadro selections (home/away arrays)
app.post("/api/quadro-selections", (req, res) => {
  const state = loadState();
  const home = Array.isArray(req.body.home) ? req.body.home.slice(0, 4) : ["", "", "", ""];
  const away = Array.isArray(req.body.away) ? req.body.away.slice(0, 4) : ["", "", "", ""];
  const basesHome = Array.isArray(req.body.basesHome) ? req.body.basesHome : null;
  const basesAway = Array.isArray(req.body.basesAway) ? req.body.basesAway : null;
  const active = Number(req.body.activeQuadroIndex || 1);

  state.quadroSelections = {
    home: [home[0] || "", home[1] || "", home[2] || "", home[3] || ""],
    away: [away[0] || "", away[1] || "", away[2] || "", away[3] || ""]
  };

  if (basesHome && basesAway) {
    state.quadroBases = {
      home: basesHome,
      away: basesAway
    };
  }

  state.activeQuadroIndex = [1,2,3,4].includes(active) ? active : 1;
  saveState(state);
  res.json({ quadroSelections: state.quadroSelections, quadroBases: state.quadroBases, activeQuadroIndex: state.activeQuadroIndex });
});

// Set substitutions
app.post("/api/substitutions", (req, res) => {
  const state = loadState();
  const home = Array.isArray(req.body.home) ? req.body.home.slice(0, 2) : [];
  const away = Array.isArray(req.body.away) ? req.body.away.slice(0, 2) : [];
  state.substitutions = { home, away };
  saveState(state);
  res.json({ substitutions: state.substitutions });
});

// Set locks
app.post("/api/locks", (req, res) => {
  const state = loadState();
  state.locks = {
    quadro1Locked: !!req.body.quadro1Locked,
    subsLocked: !!req.body.subsLocked
  };
  saveState(state);
  res.json({ locks: state.locks });
});

// Set view mode (teams | open)
app.post("/api/view-mode", (req, res) => {
  const state = loadState();
  const mode = req.body.viewMode === "open" ? "open" : "teams";
  state.viewMode = mode;
  saveState(state);
  res.json({ viewMode: state.viewMode });
});

// Set teams (home & away) – we persist whatever object the frontend sends
app.post("/api/set-teams", async (req, res) => {
  const state = loadState();
  state.teams.home = normalizeTeam(req.body.home || state.teams.home, "home");
  state.teams.away = normalizeTeam(req.body.away || state.teams.away, "away");
  saveState(state);
  res.json(state.teams);
});

// Manual override of team scores (rarely used, but kept)
app.post("/api/set-team-scores", (req, res) => {
  const state = loadState();
  let desiredHome = Number(req.body.homeScore || 0);
  let desiredAway = Number(req.body.awayScore || 0);

  const base = countBaseWins(state);
  let warning = null;

  if (desiredHome < base.home || desiredAway < base.away) {
    desiredHome = Math.max(desiredHome, base.home);
    desiredAway = Math.max(desiredAway, base.away);
    warning = "A classificação não pode ficar abaixo do histórico real. Ajustei para o mínimo possível.";
  }

  recomputeTeamScores(state);

  const currentHome = state.teams.home.score;
  const currentAway = state.teams.away.score;

  const diffHome = desiredHome - currentHome;
  const diffAway = desiredAway - currentAway;

  if (diffHome > 0) addAdjustments(state, "home", diffHome);
  if (diffHome < 0) removeAdjustments(state, "home", Math.abs(diffHome));

  if (diffAway > 0) addAdjustments(state, "away", diffAway);
  if (diffAway < 0) removeAdjustments(state, "away", Math.abs(diffAway));

  recomputeTeamScores(state);
  saveState(state);
  res.json({ teams: state.teams, history: state.history, warning });
});

// --- Queue ------------------------------------------------------------------

app.post("/api/queue/save", (req, res) => {
  const state = loadState();
  state.queue = req.body.queue || [];
  state.nextGameId = req.body.nextGameId || state.nextGameId;
  state.nextQuadroId = req.body.nextQuadroId || state.nextQuadroId;
  saveState(state);
  res.json({ ok: true });
});

// --- Tables -----------------------------------------------------------------

// Set game on table
app.post("/api/table/set", (req, res) => {
  const { tableId, game } = req.body;
  const state = loadState();
  state.tables[tableId] = {
    gameId: game.gameId,
    gameNumber: game.gameNumber ?? null,
    playerHome: game.playerHome,
    playerAway: game.playerAway,
    scoreHome: game.scoreHome || 0,
    scoreAway: game.scoreAway || 0,
    history: game.history || [],
    quadroId: game.quadroId ?? null,
    quadroIndex: game.quadroIndex ?? null
  };
  saveState(state);
  res.json(state.tables[tableId]);
});

// Update scores for ongoing game
app.post("/api/table/score", (req, res) => {
  const { tableId, scoreHome, scoreAway } = req.body;
  const state = loadState();
  const t = state.tables[tableId];

  if (!t) {
    return res.status(404).json({ error: "Mesa não encontrada" });
  }

  let h = Number(scoreHome || 0);
  let a = Number(scoreAway || 0);

  if (state.viewMode !== "open") {
    if (h > a) {
      h = 1; a = 0;
    } else if (a > h) {
      h = 0; a = 1;
    } else {
      h = 0; a = 0;
    }
  }

  t.scoreHome = h;
  t.scoreAway = a;
  saveState(state);
  res.json(t);
});

// Clear table without finishing
app.post("/api/table/clear", (req, res) => {
  const { tableId } = req.body;
  const state = loadState();
  state.tables[tableId] = {
    gameId: null,
    playerHome: "",
    playerAway: "",
    scoreHome: 0,
    scoreAway: 0,
    history: []
  };
  saveState(state);
  res.json(state.tables[tableId]);
});

// Finish game: push to history, recompute scores from history
app.post("/api/table/finish", (req, res) => {
  const { tableId, winnerSide } = req.body;
  const state = loadState();
  const table = state.tables[tableId];

  if (!table || !table.gameId) {
    return res.status(400).json({ error: "Nenhum jogo nesta mesa." });
  }

  const gameRecord = {
    id: table.gameId,
    gameNumber: table.gameNumber ?? null,
    table: tableId,
    playerHome: table.playerHome,
    playerAway: table.playerAway,
    scoreHome: state.viewMode !== "open" ? (winnerSide === "home" ? 1 : 0) : table.scoreHome,
    scoreAway: state.viewMode !== "open" ? (winnerSide === "away" ? 1 : 0) : table.scoreAway,
    winnerSide,
    quadroId: table.quadroId ?? null,
    quadroIndex: table.quadroIndex ?? null,
    finishedAt: new Date().toISOString()
  };

  state.history.push(gameRecord);

  // recompute scores from full history
  recomputeTeamScores(state);

  // clear table
  state.tables[tableId] = {
    gameId: null,
    playerHome: "",
    playerAway: "",
    scoreHome: 0,
    scoreAway: 0,
    history: []
  };

  saveState(state);
  res.json({ teams: state.teams, history: state.history });
});

// Edit a game in history + recompute scores
app.post("/api/history/update", (req, res) => {
  const { id, scoreHome, scoreAway, winnerSide } = req.body;
  const state = loadState();
  const game = (state.history || []).find(g => g.id === id);

  if (!game) {
    return res.status(404).json({ error: "Jogo não encontrado no histórico." });
  }

  game.scoreHome = Number(scoreHome || 0);
  game.scoreAway = Number(scoreAway || 0);
  game.winnerSide = winnerSide === "away" ? "away" : "home";

  recomputeTeamScores(state);
  saveState(state);
  res.json({ teams: state.teams, history: state.history });
});

// Add substitution event to history (meta only)
app.post("/api/history/substitution", (req, res) => {
  const { action, side, outPlayer, inPlayer, quadroId } = req.body;
  const state = loadState();
  state.history.push({
    id: state.nextGameId++,
    eventType: "substitution",
    action,
    side,
    outPlayer,
    inPlayer,
    quadroId: Number.isFinite(quadroId) ? quadroId : null,
    finishedAt: new Date().toISOString(),
    isMeta: true
  });
  saveState(state);
  res.json({ history: state.history });
});

// Delete a game from history + recompute scores
app.post("/api/history/delete", (req, res) => {
  const { id } = req.body;
  const state = loadState();
  const before = (state.history || []).length;
  state.history = (state.history || []).filter(g => g.id !== id);

  if (state.history.length === before) {
    return res.status(404).json({ error: "Jogo não encontrado no histórico." });
  }

  recomputeTeamScores(state);
  saveState(state);
  res.json({ teams: state.teams, history: state.history });
});

// --- Reset all --------------------------------------------------------------

app.post("/api/reset-all", (req, res) => {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
  const state = initState();
  res.json(state);
});

// --- Start server -----------------------------------------------------------

// Reset state on server start
initState();

app.listen(PORT, () => {
  console.log(`🎱 ADSCR v1.1 backend running at http://localhost:${PORT}`);
});
