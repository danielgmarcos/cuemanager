// ADSCR Control Panel v1.1 – backend with:
// - file persistence
// - OBS txt integration
// - PortalBilhar competitions + teams + players
// - history-based team scoring

import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
const OBS_DIR = path.join(__dirname, "obs_files");
const OBS_COMP_DIR = path.join(OBS_DIR, "competicao");
const OBS_OPEN_DIR = path.join(OBS_DIR, "modo_open");
const DEFAULT_LOGO = path.join(__dirname, "logo.png");
const DEFAULT_BALL8 = path.join(__dirname, "ball8.svg");
const OBS_REMOTE_CONFIG = {
  enabled: parseBoolean(process.env.OBS_REMOTE_ENABLED, true),
  host: process.env.OBS_REMOTE_HOST || "127.0.0.1",
  port: Number.parseInt(process.env.OBS_REMOTE_PORT || "4455", 10),
  password: process.env.OBS_REMOTE_PASSWORD || "",
  sceneName: process.env.OBS_SCENE_NAME || "Camp. Mesas Auto",
  cam1Source: process.env.OBS_CAM1_SOURCE || "Cam Mesa 1",
  cam2Source: process.env.OBS_CAM2_SOURCE || "Cam Mesa 2",
  overlaySource: process.env.OBS_OVERLAY_SOURCE || "Overlay Browser",
  canvasWidth: Number.parseInt(process.env.OBS_CANVAS_WIDTH || "1920", 10),
  canvasHeight: Number.parseInt(process.env.OBS_CANVAS_HEIGHT || "1080", 10),
  sponsorSafeHeight: Number.parseInt(process.env.OBS_SPONSOR_SAFE_HEIGHT || "136", 10),
  topSafeHeight: Number.parseInt(process.env.OBS_TOP_SAFE_HEIGHT || "82", 10),
  outerMargin: Number.parseInt(process.env.OBS_OUTER_MARGIN || "20", 10),
  layoutToSingleMs: Number.parseInt(process.env.OBS_LAYOUT_TO_SINGLE_MS || "10000", 10),
  layoutToSplitMs: Number.parseInt(process.env.OBS_LAYOUT_TO_SPLIT_MS || "5000", 10),
  reconnectMs: Number.parseInt(process.env.OBS_REMOTE_RECONNECT_MS || "5000", 10)
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(OBS_DIR, { recursive: true });
fs.mkdirSync(OBS_COMP_DIR, { recursive: true });
fs.mkdirSync(OBS_OPEN_DIR, { recursive: true });

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

function parseBoolean(value, defaultValue = false) {
  if (value == null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function computeObsLayoutRects(config) {
  const margin = config.outerMargin;
  const top = config.topSafeHeight;
  const bottom = config.sponsorSafeHeight;
  const width = config.canvasWidth;
  const height = config.canvasHeight;
  const gutter = 20;
  const videoTop = top;
  const videoHeight = Math.max(200, height - top - bottom);
  const splitWidth = Math.floor((width - (margin * 2) - gutter) / 2);
  const rightX = margin + splitWidth + gutter;
  const fullWidth = width - (margin * 2);

  return {
    split: {
      [config.cam1Source]: {
        positionX: margin,
        positionY: videoTop,
        boundsWidth: splitWidth,
        boundsHeight: videoHeight
      },
      [config.cam2Source]: {
        positionX: rightX,
        positionY: videoTop,
        boundsWidth: splitWidth,
        boundsHeight: videoHeight
      }
    },
    table1: {
      [config.cam1Source]: {
        positionX: margin,
        positionY: videoTop,
        boundsWidth: fullWidth,
        boundsHeight: videoHeight
      }
    },
    table2: {
      [config.cam2Source]: {
        positionX: margin,
        positionY: videoTop,
        boundsWidth: fullWidth,
        boundsHeight: videoHeight
      }
    }
  };
}

function computeRemoteLayout(state) {
  const activeTables = ["1", "2"].filter(tableId => Boolean(state.tables?.[tableId]?.gameId));
  if (activeTables.length >= 2) return "split";
  if (activeTables[0] === "1") return "table1";
  if (activeTables[0] === "2") return "table2";
  return "scoreboard";
}

function isSingleRemoteLayout(layout) {
  return layout === "table1" || layout === "table2";
}

function requiresDelayedRemoteTransition(fromLayout, toLayout) {
  return (
    (fromLayout === "split" && isSingleRemoteLayout(toLayout)) ||
    (isSingleRemoteLayout(fromLayout) && toLayout === "split")
  );
}

function getRemoteTransitionDelay(config, fromLayout, toLayout) {
  if (fromLayout === "split" && isSingleRemoteLayout(toLayout)) {
    return config.layoutToSingleMs;
  }
  if (isSingleRemoteLayout(fromLayout) && toLayout === "split") {
    return config.layoutToSplitMs;
  }
  return 0;
}

class ObsRemoteController {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.connectPromise = null;
    this.pending = new Map();
    this.requestCounter = 1;
    this.sceneItemIds = new Map();
    this.serial = Promise.resolve();
    this.lastAppliedLayout = null;
    this.displayLayout = null;
    this.pendingLayout = null;
    this.pendingTimer = null;
    this.lastError = null;
    this.lastErrorAt = 0;
    this.desiredState = null;
    this.reconnectTimer = null;
    this.rects = computeObsLayoutRects(config);
  }

  status() {
    return {
      enabled: this.config.enabled,
      connected: this.isConnected(),
      host: this.config.host,
      port: this.config.port,
      passwordConfigured: Boolean(this.config.password),
      sceneName: this.config.sceneName,
      cam1Source: this.config.cam1Source,
      cam2Source: this.config.cam2Source,
      overlaySource: this.config.overlaySource,
      displayLayout: this.displayLayout,
      pendingLayout: this.pendingLayout,
      lastAppliedLayout: this.lastAppliedLayout,
      lastError: this.lastError
    };
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  syncState(state) {
    if (!this.config.enabled) return;
    this.desiredState = JSON.parse(JSON.stringify(state));
    const layout = this.resolveDisplayLayout(state);
    this.serial = this.serial
      .then(() => this.applyLayout(layout))
      .catch(err => {
        this.recordError(err);
      });
  }

  clearPendingTransition() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingLayout = null;
  }

  schedulePendingTransition(layout, delayMs) {
    if (this.pendingLayout === layout && this.pendingTimer) return;
    this.clearPendingTransition();
    this.pendingLayout = layout;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.pendingLayout = null;
      const latestState = this.desiredState;
      const finalLayout = latestState ? computeRemoteLayout(latestState) : layout;
      this.displayLayout = finalLayout;

      if (latestState) {
        this.syncState(latestState);
        return;
      }

      this.serial = this.serial
        .then(() => this.applyLayout(finalLayout))
        .catch(err => {
          this.recordError(err);
        });
    }, delayMs);
  }

  resolveDisplayLayout(state) {
    const rawLayout = computeRemoteLayout(state);

    if (!this.displayLayout) {
      this.displayLayout = rawLayout;
      this.clearPendingTransition();
      return rawLayout;
    }

    if (rawLayout === this.displayLayout) {
      this.clearPendingTransition();
      return this.displayLayout;
    }

    if (requiresDelayedRemoteTransition(this.displayLayout, rawLayout)) {
      this.schedulePendingTransition(
        rawLayout,
        getRemoteTransitionDelay(this.config, this.displayLayout, rawLayout)
      );
      return this.displayLayout;
    }

    this.clearPendingTransition();
    this.displayLayout = rawLayout;
    return rawLayout;
  }

  recordError(err) {
    const message = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    this.lastError = message;
    if (now - this.lastErrorAt >= 15000) {
      console.error("OBS remote error:", message);
      this.lastErrorAt = now;
    }
  }

  async ensureConnected() {
    if (this.isConnected()) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.config.host}:${this.config.port}`);
      let settled = false;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        this.cleanupSocket();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      ws.addEventListener("error", () => {
        fail(new Error(`Não foi possível ligar ao OBS em ws://${this.config.host}:${this.config.port}`));
      });

      ws.addEventListener("close", () => {
        if (!settled) {
          fail(new Error("Ligação ao OBS fechada durante a autenticação."));
        } else {
          this.cleanupSocket();
        }
      });

      ws.addEventListener("message", async (event) => {
        try {
          const raw =
            typeof event.data === "string"
              ? event.data
              : Buffer.from(event.data).toString("utf8");
          const packet = JSON.parse(raw);

          if (packet.op === 0) {
            const authentication = packet.d?.authentication;
            const identify = {
              rpcVersion: packet.d?.rpcVersion || 1
            };
            if (authentication) {
              identify.authentication = this.buildAuthentication(authentication.challenge, authentication.salt);
            }
            ws.send(JSON.stringify({ op: 1, d: identify }));
            return;
          }

          if (packet.op === 2) {
            settled = true;
            this.ws = ws;
            this.lastError = null;
            this.sceneItemIds.clear();
            resolve();
            return;
          }

          if (packet.op === 7) {
            const requestId = packet.d?.requestId;
            if (!requestId) return;
            const pending = this.pending.get(requestId);
            if (!pending) return;
            this.pending.delete(requestId);
            if (packet.d?.requestStatus?.result) {
              pending.resolve(packet.d?.responseData || {});
            } else {
              pending.reject(new Error(packet.d?.requestStatus?.comment || `OBS request ${packet.d?.requestType || requestId} falhou.`));
            }
          }
        } catch (error) {
          fail(error);
        }
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    await this.connectPromise;
  }

  cleanupSocket() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // no-op
      }
    }
    this.ws = null;
    this.sceneItemIds.clear();
    this.lastAppliedLayout = null;
    this.displayLayout = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Ligação ao OBS perdida."));
    }
    this.pending.clear();
  }

  startBackgroundSync(loadStateFn) {
    if (!this.config.enabled || this.reconnectTimer) return;

    this.reconnectTimer = setInterval(() => {
      try {
        const latestState =
          this.desiredState ||
          (typeof loadStateFn === "function" ? loadStateFn() : null);

        if (!latestState) return;
        this.desiredState = latestState;

        const desiredLayout = this.resolveDisplayLayout(latestState);

        if (this.isConnected() && this.lastAppliedLayout === desiredLayout) {
          return;
        }

        this.serial = this.serial
          .then(() => this.applyLayout(desiredLayout))
          .catch(err => {
            this.recordError(err);
          });
      } catch (err) {
        this.recordError(err);
      }
    }, this.config.reconnectMs);
  }

  buildAuthentication(challenge, salt) {
    const secret = crypto
      .createHash("sha256")
      .update(`${this.config.password}${salt}`)
      .digest("base64");

    return crypto
      .createHash("sha256")
      .update(`${secret}${challenge}`)
      .digest("base64");
  }

  async call(requestType, requestData = undefined) {
    await this.ensureConnected();
    const requestId = String(this.requestCounter++);
    const payload = {
      op: 6,
      d: {
        requestType,
        requestId
      }
    };
    if (requestData && Object.keys(requestData).length > 0) {
      payload.d.requestData = requestData;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  async getSceneItemId(sourceName) {
    const key = `${this.config.sceneName}::${sourceName}`;
    if (this.sceneItemIds.has(key)) {
      return this.sceneItemIds.get(key);
    }
    const response = await this.call("GetSceneItemId", {
      sceneName: this.config.sceneName,
      sourceName
    });
    this.sceneItemIds.set(key, response.sceneItemId);
    return response.sceneItemId;
  }

  async setSceneItemEnabled(sourceName, sceneItemEnabled) {
    const sceneItemId = await this.getSceneItemId(sourceName);
    await this.call("SetSceneItemEnabled", {
      sceneName: this.config.sceneName,
      sceneItemId,
      sceneItemEnabled
    });
  }

  async setSceneItemTransform(sourceName, rect) {
    const sceneItemId = await this.getSceneItemId(sourceName);
    await this.call("SetSceneItemTransform", {
      sceneName: this.config.sceneName,
      sceneItemId,
      sceneItemTransform: {
        positionX: rect.positionX,
        positionY: rect.positionY,
        rotation: 0,
        alignment: 5,
        boundsType: "OBS_BOUNDS_STRETCH",
        boundsAlignment: 5,
        boundsWidth: rect.boundsWidth,
        boundsHeight: rect.boundsHeight,
        cropToBounds: false
      }
    });
  }

  async applyLayout(layout) {
    if (layout === this.lastAppliedLayout && this.isConnected()) {
      return;
    }

    await this.ensureConnected();

    const visibleSources = new Set();
    if (layout === "split") {
      visibleSources.add(this.config.cam1Source);
      visibleSources.add(this.config.cam2Source);
    } else if (layout === "table1") {
      visibleSources.add(this.config.cam1Source);
    } else if (layout === "table2") {
      visibleSources.add(this.config.cam2Source);
    }

    const cameraSources = [this.config.cam1Source, this.config.cam2Source];
    for (const sourceName of cameraSources) {
      await this.setSceneItemEnabled(sourceName, visibleSources.has(sourceName));
    }

    const rectSet = this.rects[layout];
    if (rectSet) {
      for (const [sourceName, rect] of Object.entries(rectSet)) {
        await this.setSceneItemTransform(sourceName, rect);
      }
    }

    if (this.config.overlaySource) {
      await this.setSceneItemEnabled(this.config.overlaySource, true);
    }

    this.lastAppliedLayout = layout;
  }
}

const obsRemote = new ObsRemoteController(OBS_REMOTE_CONFIG);

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

  // Initialize OBS files
  clearObsFiles();
  obsRemote.syncState(initial);
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

  const homeName = state.teams.home.name?.trim() || "Locais";
  const awayName = state.teams.away.name?.trim() || "Visitantes";
  const homeScore = Number.isFinite(state.teams.home.score) ? state.teams.home.score : 0;
  const awayScore = Number.isFinite(state.teams.away.score) ? state.teams.away.score : 0;

  const baseDir = state.viewMode === "open" ? OBS_OPEN_DIR : OBS_COMP_DIR;

  fs.writeFileSync(path.join(baseDir, "nome_equipa_casa.txt"), homeName);
  fs.writeFileSync(path.join(baseDir, "nome_equipa_visitante.txt"), awayName);
  fs.writeFileSync(
    path.join(baseDir, "classificacao.txt"),
    `${homeScore} - ${awayScore}`
  );

  updateObsTable("1", state.tables["1"], state.viewMode, baseDir);
  updateObsTable("2", state.tables["2"], state.viewMode, baseDir);
  obsRemote.syncState(state);
}

function clearObsFiles() {
  const dirs = [OBS_COMP_DIR, OBS_OPEN_DIR];
  dirs.forEach(dir => {
    fs.writeFileSync(path.join(dir, "nome_equipa_casa.txt"), "");
    fs.writeFileSync(path.join(dir, "nome_equipa_visitante.txt"), "");
    fs.writeFileSync(path.join(dir, "classificacao.txt"), "");

    fs.writeFileSync(path.join(dir, "mesa1_jogador_casa.txt"), "");
    fs.writeFileSync(path.join(dir, "mesa1_jogador_visitante.txt"), "");
    fs.writeFileSync(path.join(dir, "mesa2_jogador_casa.txt"), "");
    fs.writeFileSync(path.join(dir, "mesa2_jogador_visitante.txt"), "");

    // Só usados no modo Open
    fs.writeFileSync(path.join(dir, "mesa1_classificacao.txt"), "");
    fs.writeFileSync(path.join(dir, "mesa2_classificacao.txt"), "");

    // Logos
    const homeLogo = path.join(dir, "logo_equipa_casa.png");
    const awayLogo = path.join(dir, "logo_equipa_visitante.png");
    if (fs.existsSync(homeLogo)) fs.unlinkSync(homeLogo);
    if (fs.existsSync(awayLogo)) fs.unlinkSync(awayLogo);
  });
}

async function downloadLogoToFile(url, filePath) {
  const useDefault = () => {
    if (fs.existsSync(DEFAULT_LOGO)) {
      fs.copyFileSync(DEFAULT_LOGO, filePath);
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  };

  const useBall8 = () => {
    if (fs.existsSync(DEFAULT_BALL8)) {
      fs.copyFileSync(DEFAULT_BALL8, filePath);
    } else {
      useDefault();
    }
  };

  if (!url) {
    useDefault();
    return;
  }

  if (url === "__ball8__") {
    useBall8();
    return;
  }
  if (url === "__logo__") {
    useDefault();
    return;
  }

  try {
    const response = await client.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0",
        Accept: "image/*,*/*"
      }
    });

    fs.writeFileSync(filePath, Buffer.from(response.data));
  } catch {
    useDefault();
  }
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

// write table info to OBS files
function updateObsTable(tableId, table, viewMode = "teams", baseDir = OBS_COMP_DIR) {
  const p1File = path.join(baseDir, `mesa${tableId}_jogador_casa.txt`);
  const p2File = path.join(baseDir, `mesa${tableId}_jogador_visitante.txt`);
  const scoreFile = path.join(baseDir, `mesa${tableId}_classificacao.txt`);

  if (table && table.gameId) {
    // jogador 1 e jogador 2 em ficheiros separados
    fs.writeFileSync(p1File, table.playerHome || "");
    fs.writeFileSync(p2File, table.playerAway || "");

    if (viewMode === "open") {
      fs.writeFileSync(
        scoreFile,
        `${table.scoreHome ?? 0} - ${table.scoreAway ?? 0}`
      );
    } else {
      fs.writeFileSync(scoreFile, "");
    }
  } else {
    // sem jogo na mesa → limpar
    fs.writeFileSync(p1File, "");
    fs.writeFileSync(p2File, "");
    fs.writeFileSync(scoreFile, "");
  }
}


// --- PortalBilhar scraping --------------------------------------------------

// Base for competition listing (all variants); we’ll just extract any link with Comp=.
const ORG_ID = 118;
const COMP_BASE = `https://portalbilhar.pt/Publico/BT/Publico_P_Eqp.aspx?org=${ORG_ID}`;

// Pool Português encoded
const VARIANTE_POOL = "Pool_Portugu%C3%AAs";

// Players come from Publico_Eqp.aspx?Eqp=...
const TEAM_PAGE_BASE = "https://portalbilhar.pt/Publico/BT/Publico_Eqp.aspx?Eqp=";

// List competitions (we keep it simple: any link with Comp=)
// Correct competition scraping from dropdown <select id="ddlCompeticao">
app.get("/api/portal/competitions", async (req, res) => {
  try {
    const url =
      "https://portalbilhar.pt/Publico/BT/Publico_P_Eqp.aspx?Variante=Pool_Portugu%C3%AAs&org=118";

    // Make request with cookie jar (simulates browser)
    const response = await client.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-PT,pt;q=0.9",
      },
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

app.get("/api/obs/status", (req, res) => {
  const state = loadState();
  res.json({
    ...obsRemote.status(),
    desiredLayout: computeRemoteLayout(state),
    activeTables: ["1", "2"].filter(tableId => Boolean(state.tables?.[tableId]?.gameId))
  });
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

  try {
    const baseDir = state.viewMode === "open" ? OBS_OPEN_DIR : OBS_COMP_DIR;
    if (state.viewMode === "open") {
      downloadLogoToFile(null, path.join(baseDir, "logo_equipa_casa.png"));
      downloadLogoToFile(null, path.join(baseDir, "logo_equipa_visitante.png"));
    } else {
      if (state.teams.home.logoUrl) {
        downloadLogoToFile(state.teams.home.logoUrl, path.join(baseDir, "logo_equipa_casa.png"));
      }
      if (state.teams.away.logoUrl) {
        downloadLogoToFile(state.teams.away.logoUrl, path.join(baseDir, "logo_equipa_visitante.png"));
      }
    }
  } catch (err) {
    console.error("Logo download error:", err);
  }

  res.json({ viewMode: state.viewMode });
});

// Set teams (home & away) – we persist whatever object the frontend sends
app.post("/api/set-teams", async (req, res) => {
  const state = loadState();
  const prevHomeLogo = state.teams.home.logoUrl;
  const prevAwayLogo = state.teams.away.logoUrl;

  state.teams.home = normalizeTeam(req.body.home || state.teams.home, "home");
  state.teams.away = normalizeTeam(req.body.away || state.teams.away, "away");
  saveState(state);

  try {
    const baseDir = state.viewMode === "open" ? OBS_OPEN_DIR : OBS_COMP_DIR;
    if (state.viewMode === "open") {
      await downloadLogoToFile(null, path.join(baseDir, "logo_equipa_casa.png"));
      await downloadLogoToFile(null, path.join(baseDir, "logo_equipa_visitante.png"));
    } else {
      if (state.teams.home.logoUrl !== prevHomeLogo) {
        await downloadLogoToFile(
          state.teams.home.logoUrl,
          path.join(baseDir, "logo_equipa_casa.png")
        );
      }
      if (state.teams.away.logoUrl !== prevAwayLogo) {
        await downloadLogoToFile(
          state.teams.away.logoUrl,
          path.join(baseDir, "logo_equipa_visitante.png")
        );
      }
    }
  } catch (err) {
    console.error("Logo download error:", err);
  }

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
  const baseDir = state.viewMode === "open" ? OBS_OPEN_DIR : OBS_COMP_DIR;
  updateObsTable(tableId, state.tables[tableId], state.viewMode, baseDir);
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
  const baseDir = state.viewMode === "open" ? OBS_OPEN_DIR : OBS_COMP_DIR;
  updateObsTable(tableId, t, state.viewMode, baseDir);
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
  const baseDir = state.viewMode === "open" ? OBS_OPEN_DIR : OBS_COMP_DIR;
  updateObsTable(tableId, state.tables[tableId], state.viewMode, baseDir);
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
  const baseDir = state.viewMode === "open" ? OBS_OPEN_DIR : OBS_COMP_DIR;
  updateObsTable(tableId, state.tables[tableId], state.viewMode, baseDir);
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
  clearObsFiles();
  res.json(state);
});

// --- Start server -----------------------------------------------------------

// Reset state and OBS files on server start
initState();
clearObsFiles();
obsRemote.startBackgroundSync(loadState);

app.listen(PORT, () => {
  console.log(`🎱 ADSCR v1.1 backend running at http://localhost:${PORT}`);
});
