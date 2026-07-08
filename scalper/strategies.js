// ── Scalping strategies ─────────────────────────────────────────
// Each strategy is a pure function (candles, cfg) -> {
//   dir: -1 | 0 | 1,        // short / flat / long vote
//   strength: 0..1,          // confidence of the vote
//   reason: string           // human-readable explanation
// }
// The engine combines their weighted votes into a confluence score.

import {
  ema,
  emaSeries,
  rsi,
  vwap,
  bollinger,
  macd,
  adx,
} from "./indicators.js";

const flat = (reason) => ({ dir: 0, strength: 0, reason });

// 1) EMA trend-following crossover with a higher-EMA trend filter.
//    Classic scalping engine: only take crossovers in the direction of trend.
export function emaTrend(candles, cfg = {}) {
  const fast = cfg.fast ?? 8;
  const slow = cfg.slow ?? 21;
  const trend = cfg.trend ?? 50;
  const closes = candles.map((c) => c.close);
  if (closes.length < trend + 2) return flat("not enough data");

  const fastS = emaSeries(closes, fast);
  const slowS = emaSeries(closes, slow);
  const trendE = ema(closes, trend);
  const price = closes[closes.length - 1];

  const fNow = fastS[fastS.length - 1];
  const sNow = slowS[slowS.length - 1];
  const fPrev = fastS[fastS.length - 2];
  const sPrev = slowS[slowS.length - 2];

  const crossUp = fPrev <= sPrev && fNow > sNow;
  const crossDn = fPrev >= sPrev && fNow < sNow;
  const spread = Math.abs(fNow - sNow) / price; // separation = conviction

  if ((crossUp || fNow > sNow) && price > trendE) {
    const strength = Math.min(1, 0.5 + spread * 200 + (crossUp ? 0.3 : 0));
    return { dir: 1, strength, reason: `EMA${fast}>${slow} in uptrend` };
  }
  if ((crossDn || fNow < sNow) && price < trendE) {
    const strength = Math.min(1, 0.5 + spread * 200 + (crossDn ? 0.3 : 0));
    return { dir: -1, strength, reason: `EMA${fast}<${slow} in downtrend` };
  }
  return flat("no EMA alignment");
}

// 2) VWAP mean-reversion — fade stretched moves back to the VWAP.
export function vwapReversion(candles, cfg = {}) {
  const stretch = cfg.stretch ?? 0.0015; // 0.15% away from VWAP
  const closes = candles.map((c) => c.close);
  const vw = vwap(candles);
  const price = closes[closes.length - 1];
  const dev = (price - vw) / vw;

  if (dev <= -stretch) {
    const strength = Math.min(1, Math.abs(dev) / (stretch * 3));
    return { dir: 1, strength, reason: `price ${(dev * 100).toFixed(2)}% below VWAP` };
  }
  if (dev >= stretch) {
    const strength = Math.min(1, Math.abs(dev) / (stretch * 3));
    return { dir: -1, strength, reason: `price ${(dev * 100).toFixed(2)}% above VWAP` };
  }
  return flat("price near VWAP");
}

// 3) RSI(2) extreme reversal with EMA trend filter (Larry Conners style).
export function rsiReversal(candles, cfg = {}) {
  const period = cfg.period ?? 2;
  const buyLvl = cfg.buy ?? 10;
  const sellLvl = cfg.sell ?? 90;
  const trend = cfg.trend ?? 50;
  const closes = candles.map((c) => c.close);
  if (closes.length < trend + period) return flat("not enough data");

  const r = rsi(closes, period);
  const trendE = ema(closes, trend);
  const price = closes[closes.length - 1];

  if (r <= buyLvl && price > trendE) {
    return { dir: 1, strength: Math.min(1, (buyLvl - r) / buyLvl + 0.5), reason: `RSI${period}=${r.toFixed(0)} oversold, uptrend` };
  }
  if (r >= sellLvl && price < trendE) {
    return { dir: -1, strength: Math.min(1, (r - sellLvl) / (100 - sellLvl) + 0.5), reason: `RSI${period}=${r.toFixed(0)} overbought, downtrend` };
  }
  return flat(`RSI${period}=${r.toFixed(0)} neutral`);
}

// 4) Bollinger squeeze breakout — trade expansion out of low-volatility.
export function bollingerBreakout(candles, cfg = {}) {
  const period = cfg.period ?? 20;
  const mult = cfg.mult ?? 2;
  const squeeze = cfg.squeeze ?? 0.02; // relative width below which we call it a squeeze
  const closes = candles.map((c) => c.close);
  const bb = bollinger(closes, period, mult);
  if (!bb) return flat("not enough data");
  const price = closes[closes.length - 1];
  const prev = closes[closes.length - 2];

  const wasSqueezed = bb.width < squeeze * 1.5;
  if (price > bb.upper && prev <= bb.upper) {
    return { dir: 1, strength: wasSqueezed ? 1 : 0.6, reason: "close broke above upper band" };
  }
  if (price < bb.lower && prev >= bb.lower) {
    return { dir: -1, strength: wasSqueezed ? 1 : 0.6, reason: "close broke below lower band" };
  }
  return flat("inside Bollinger bands");
}

// 5) MACD histogram momentum with ADX trend-strength gate.
export function macdMomentum(candles, cfg = {}) {
  const adxMin = cfg.adxMin ?? 20;
  const closes = candles.map((c) => c.close);
  const m = macd(closes, cfg.fast ?? 12, cfg.slow ?? 26, cfg.signal ?? 9);
  const a = adx(candles, cfg.adxPeriod ?? 14);
  if (!m || a == null) return flat("not enough data");
  if (a < adxMin) return flat(`ADX=${a.toFixed(0)} too weak`);

  if (m.hist > 0 && m.line > m.signal) {
    return { dir: 1, strength: Math.min(1, a / 40), reason: `MACD bullish, ADX=${a.toFixed(0)}` };
  }
  if (m.hist < 0 && m.line < m.signal) {
    return { dir: -1, strength: Math.min(1, a / 40), reason: `MACD bearish, ADX=${a.toFixed(0)}` };
  }
  return flat("MACD flat");
}

// Registry — name -> fn. The engine reads weights from config.
export const STRATEGIES = {
  emaTrend,
  vwapReversion,
  rsiReversal,
  bollingerBreakout,
  macdMomentum,
};
