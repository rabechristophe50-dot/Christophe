import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ema,
  rsi,
  atr,
  bollinger,
  macd,
  adx,
  vwap,
} from "../scalper/indicators.js";
import { positionSize, bracket, trail, shouldExit, RiskGuard } from "../scalper/risk.js";
import { STRATEGIES } from "../scalper/strategies.js";
import { backtest } from "../scalper/backtest.js";
import { DEFAULTS } from "../scalper/config.js";

// Build a deterministic sine-wave + drift candle series for testing.
function makeCandles(n, { base = 100, amp = 2, drift = 0.02 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const mid = base + drift * i + amp * Math.sin(i / 6);
    const open = mid - 0.1;
    const close = mid + 0.1 * Math.sin(i / 3);
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    out.push({ ts: i * 60000, open, high, low, close, vol: 1000 + (i % 10) * 50 });
  }
  return out;
}

test("indicators return sane values", () => {
  const c = makeCandles(120);
  const closes = c.map((x) => x.close);
  assert.ok(ema(closes, 8) > 0, "ema positive");
  const r = rsi(closes, 14);
  assert.ok(r >= 0 && r <= 100, "rsi in range");
  assert.ok(atr(c, 14) > 0, "atr positive");
  const bb = bollinger(closes, 20, 2);
  assert.ok(bb.upper > bb.basis && bb.basis > bb.lower, "bands ordered");
  assert.ok(macd(closes) !== null, "macd computed");
  assert.ok(adx(c, 14) >= 0, "adx non-negative");
  assert.ok(vwap(c) > 0, "vwap positive");
});

test("edge cases don't throw", () => {
  assert.equal(rsi([1, 2], 14), 50, "short series -> neutral rsi");
  assert.equal(atr([{ high: 1, low: 0, close: 0.5, open: 0.5, ts: 0, vol: 1 }], 14), null);
  assert.equal(bollinger([1, 2, 3], 20), null);
});

test("strategies return well-formed votes", () => {
  const c = makeCandles(120);
  for (const [name, fn] of Object.entries(STRATEGIES)) {
    const v = fn(c, DEFAULTS.strategies[name] || {});
    assert.ok([-1, 0, 1].includes(v.dir), `${name} dir valid`);
    assert.ok(v.strength >= 0 && v.strength <= 1, `${name} strength in [0,1]`);
    assert.equal(typeof v.reason, "string", `${name} has reason`);
  }
});

test("position sizing respects risk fraction", () => {
  const qty = positionSize({ equity: 1000, price: 100, stopPrice: 98, riskPct: 0.01, maxNotionalPct: 1 });
  // risk 1% of 1000 = 10; per-unit risk = 2; qty = 5
  assert.equal(qty, 5);
});

test("position sizing capped by max notional", () => {
  const qty = positionSize({ equity: 1000, price: 100, stopPrice: 99.9, riskPct: 0.5, maxNotionalPct: 0.2 });
  assert.ok(qty * 100 <= 1000 * 0.2 + 1e-9, "notional cap enforced");
});

test("bracket + shouldExit logic", () => {
  const b = bracket({ side: "long", entry: 100, atr: 1, slMult: 1.5, tpMult: 2 });
  assert.equal(b.stop, 98.5);
  assert.equal(b.target, 102);
  assert.equal(shouldExit({ side: "long", price: 98.4, stop: 98.5, target: 102 }), "stop-loss");
  assert.equal(shouldExit({ side: "long", price: 102.1, stop: 98.5, target: 102 }), "take-profit");
  assert.equal(shouldExit({ side: "long", price: 100, stop: 98.5, target: 102 }), null);
});

test("trailing stop only ratchets forward", () => {
  const up = trail({ side: "long", price: 110, stop: 105, atr: 1, trailMult: 1 });
  assert.equal(up, 109, "long stop moves up");
  const noMove = trail({ side: "long", price: 106, stop: 108, atr: 1, trailMult: 1 });
  assert.equal(noMove, 108, "long stop never drops");
});

test("risk guard halts on daily loss", () => {
  const g = new RiskGuard({ startEquity: 1000, maxDailyLossPct: 0.05, maxDrawdownPct: 0.2, maxConsecLosses: 10 });
  assert.equal(g.check(1000), null);
  assert.ok(g.check(940).includes("daily loss"));
});

test("risk guard halts on consecutive losses", () => {
  const g = new RiskGuard({ startEquity: 1000, maxDailyLossPct: 1, maxDrawdownPct: 1, maxConsecLosses: 3 });
  g.record(999, -1);
  g.record(998, -1);
  g.record(997, -1);
  assert.ok(g.check(997).includes("consecutive"));
});

test("backtest runs end-to-end and returns stats", () => {
  const c = makeCandles(400, { drift: 0.05, amp: 3 });
  const r = backtest(DEFAULTS, c);
  assert.equal(r.bars, 400);
  assert.ok(r.trades >= 0, "trades counted");
  assert.equal(typeof r.returnPct, "number");
  assert.equal(r.wins + r.losses, r.trades, "wins+losses == trades");
});
