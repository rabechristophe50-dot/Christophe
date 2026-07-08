// ── Risk management ─────────────────────────────────────────────
// ATR-based stop-loss / take-profit, trailing stops, position sizing
// by fixed fractional risk, and account-level circuit breakers.

// Size a position so that hitting the stop loses `riskPct` of equity.
// Falls back to a notional cap so a tiny stop distance can't blow up size.
export function positionSize({ equity, price, stopPrice, riskPct, maxNotionalPct }) {
  const riskCapital = equity * riskPct;
  const perUnitRisk = Math.abs(price - stopPrice);
  let qty = perUnitRisk > 0 ? riskCapital / perUnitRisk : 0;
  const maxNotional = equity * maxNotionalPct;
  if (qty * price > maxNotional) qty = maxNotional / price;
  return qty;
}

// Build stop/target levels from ATR for a fresh entry.
export function bracket({ side, entry, atr, slMult, tpMult }) {
  const dist = atr * slMult;
  if (side === "long") {
    return {
      stop: entry - dist,
      target: entry + atr * tpMult,
    };
  }
  return {
    stop: entry + dist,
    target: entry - atr * tpMult,
  };
}

// Ratchet a trailing stop in the direction of profit only.
export function trail({ side, price, stop, atr, trailMult }) {
  const dist = atr * trailMult;
  if (side === "long") return Math.max(stop, price - dist);
  return Math.min(stop, price + dist);
}

// Decide whether an open position should be closed this tick.
export function shouldExit({ side, price, stop, target }) {
  if (side === "long") {
    if (price <= stop) return "stop-loss";
    if (price >= target) return "take-profit";
  } else {
    if (price >= stop) return "stop-loss";
    if (price <= target) return "take-profit";
  }
  return null;
}

// Account-level guard: stop the whole session when limits are hit.
export class RiskGuard {
  constructor({ startEquity, maxDailyLossPct, maxDrawdownPct, maxConsecLosses }) {
    this.startEquity = startEquity;
    this.peakEquity = startEquity;
    this.maxDailyLossPct = maxDailyLossPct;
    this.maxDrawdownPct = maxDrawdownPct;
    this.maxConsecLosses = maxConsecLosses;
    this.consecLosses = 0;
  }

  record(equity, pnl) {
    this.peakEquity = Math.max(this.peakEquity, equity);
    if (pnl < 0) this.consecLosses += 1;
    else if (pnl > 0) this.consecLosses = 0;
  }

  // Returns a halt reason string, or null if trading may continue.
  check(equity) {
    const dailyLoss = (this.startEquity - equity) / this.startEquity;
    if (dailyLoss >= this.maxDailyLossPct)
      return `daily loss limit hit (${(dailyLoss * 100).toFixed(1)}%)`;
    const dd = (this.peakEquity - equity) / this.peakEquity;
    if (dd >= this.maxDrawdownPct)
      return `max drawdown hit (${(dd * 100).toFixed(1)}%)`;
    if (this.maxConsecLosses && this.consecLosses >= this.maxConsecLosses)
      return `${this.consecLosses} consecutive losses`;
    return null;
  }
}
