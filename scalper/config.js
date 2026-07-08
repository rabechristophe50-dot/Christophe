// ── Config loading ──────────────────────────────────────────────
// Merges scalper.config.json over built-in defaults and pulls API keys
// from .env (only needed for LIVE mode).

import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = {
  symbol: "XRPUSDT",
  timeframe: 1, // signal timeframe in minutes
  pollMs: 5000, // how often the engine ticks
  mode: "paper", // "paper" | "live"

  // Strategy weights — set to 0 to disable a strategy.
  strategies: {
    emaTrend: { weight: 1.0, fast: 8, slow: 21, trend: 50 },
    vwapReversion: { weight: 0.8, stretch: 0.0015 },
    rsiReversal: { weight: 1.0, period: 2, buy: 10, sell: 90, trend: 50 },
    bollingerBreakout: { weight: 0.9, period: 20, mult: 2, squeeze: 0.02 },
    macdMomentum: { weight: 0.8, adxMin: 20 },
  },

  // Confluence: enter when the net weighted score crosses this threshold.
  entryThreshold: 1.2,

  risk: {
    riskPctPerTrade: 0.01, // fraction of equity risked to the stop
    maxNotionalPct: 0.5, // cap on position size as fraction of equity
    atrPeriod: 14,
    slAtrMult: 1.5, // stop distance = 1.5 * ATR
    tpAtrMult: 2.0, // target distance = 2.0 * ATR (1.33 R:R)
    trailAtrMult: 1.0, // trailing stop distance once in profit
    useTrailing: true,
    maxDailyLossPct: 0.05,
    maxDrawdownPct: 0.1,
    maxConsecLosses: 5,
    feeRate: 0.001, // per-side taker fee estimate (paper accounting)
  },

  paper: {
    startEquity: 1000, // virtual USDT
  },

  allowShorts: false, // spot LIVE is long-only; paper can simulate shorts
  maxTicks: 0, // 0 = run until halted / Ctrl-C
  logFile: "scalper-log.json",
};

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (typeof over !== "object" || over === null) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] =
      typeof base?.[k] === "object" && base[k] !== null && !Array.isArray(base[k])
        ? deepMerge(base[k], over[k])
        : over[k];
  }
  return out;
}

export function loadEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return {};
  const env = {};
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line) => {
      const [k, ...v] = line.split("=");
      if (k && !k.startsWith("#") && v.length) env[k.trim()] = v.join("=").trim();
    });
  return env;
}

export function loadConfig(overrides = {}) {
  let fileCfg = {};
  const path = join(ROOT, "scalper.config.json");
  if (existsSync(path)) {
    try {
      fileCfg = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`Invalid scalper.config.json: ${e.message}`);
    }
  }
  const cfg = deepMerge(deepMerge(DEFAULTS, fileCfg), overrides);

  const env = loadEnv();
  cfg.keys =
    env.BITGET_API_KEY && env.BITGET_SECRET_KEY && env.BITGET_PASSPHRASE
      ? {
          apiKey: env.BITGET_API_KEY,
          secret: env.BITGET_SECRET_KEY,
          passphrase: env.BITGET_PASSPHRASE,
        }
      : null;

  cfg.root = ROOT;
  return cfg;
}
