// ── Backtester ──────────────────────────────────────────────────
// Replays historical candles bar-by-bar through the same strategy +
// risk logic the live engine uses, so results are directly comparable.
// Fills are simulated at each bar's close; stops/targets are checked
// against the bar's high/low for realism.

import { STRATEGIES } from "./strategies.js";
import { atr as calcATR } from "./indicators.js";
import { positionSize, bracket, trail } from "./risk.js";

function confluence(cfg, window) {
  let score = 0;
  for (const [name, sc] of Object.entries(cfg.strategies)) {
    const weight = sc.weight ?? 0;
    if (weight <= 0 || !STRATEGIES[name]) continue;
    const v = STRATEGIES[name](window, sc);
    score += v.dir * v.strength * weight;
  }
  return score;
}

export function backtest(cfg, candles, { warmup = 60 } = {}) {
  let equity = cfg.paper.startEquity;
  const startEquity = equity;
  let pos = null;
  const trades = [];
  const { risk } = cfg;

  for (let i = warmup; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const bar = candles[i];
    const price = bar.close;
    const a = calcATR(window, risk.atrPeriod);
    if (!a) continue;

    // Manage open position against this bar's range.
    if (pos) {
      if (risk.useTrailing)
        pos.stop = trail({ side: pos.side, price, stop: pos.stop, atr: a, trailMult: risk.trailAtrMult });

      let exitPrice = null;
      let reason = null;
      if (pos.side === "long") {
        if (bar.low <= pos.stop) [exitPrice, reason] = [pos.stop, "stop-loss"];
        else if (bar.high >= pos.target) [exitPrice, reason] = [pos.target, "take-profit"];
      } else {
        if (bar.high >= pos.stop) [exitPrice, reason] = [pos.stop, "stop-loss"];
        else if (bar.low <= pos.target) [exitPrice, reason] = [pos.target, "take-profit"];
      }
      if (exitPrice != null) {
        const gross =
          pos.side === "long" ? (exitPrice - pos.entry) * pos.qty : (pos.entry - exitPrice) * pos.qty;
        const fee = pos.qty * exitPrice * risk.feeRate;
        const pnl = gross - fee;
        equity += pnl;
        trades.push({ ...pos, exit: exitPrice, reason, pnl });
        pos = null;
      }
    }

    // Open new position on confluence when flat.
    if (!pos) {
      const score = confluence(cfg, window);
      const side = score >= cfg.entryThreshold ? "long" : score <= -cfg.entryThreshold ? "short" : null;
      if (side && (side === "long" || cfg.allowShorts)) {
        const { stop, target } = bracket({ side, entry: price, atr: a, slMult: risk.slAtrMult, tpMult: risk.tpAtrMult });
        const qty = positionSize({ equity, price, stopPrice: stop, riskPct: risk.riskPctPerTrade, maxNotionalPct: risk.maxNotionalPct });
        if (qty > 0 && qty * price >= 1) {
          const fee = qty * price * risk.feeRate;
          equity -= fee;
          pos = { side, qty, entry: price, stop, target };
        }
      }
    }
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const gains = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const draws = trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  return {
    bars: candles.length,
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? Number(((wins / trades.length) * 100).toFixed(1)) : 0,
    profitFactor: draws !== 0 ? Number((gains / -draws).toFixed(2)) : null,
    totalPnl: Number((equity - startEquity).toFixed(4)),
    returnPct: Number((((equity - startEquity) / startEquity) * 100).toFixed(2)),
    finalEquity: Number(equity.toFixed(2)),
  };
}
