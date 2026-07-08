// ── Scalping engine ─────────────────────────────────────────────
// Ties strategies + risk + exchange together into a live/paper loop:
//   1. pull candles          2. run + weight strategies (confluence)
//   3. manage open position   4. open new positions when confluent
//   5. enforce account-level risk guards

import { writeFileSync } from "fs";
import { join } from "path";
import { STRATEGIES } from "./strategies.js";
import { atr as calcATR } from "./indicators.js";
import {
  positionSize,
  bracket,
  trail,
  shouldExit,
  RiskGuard,
} from "./risk.js";
import { Exchange } from "./exchange.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Engine {
  constructor(cfg) {
    this.cfg = cfg;
    this.live = cfg.mode === "live";
    this.ex = new Exchange({
      symbol: cfg.symbol,
      live: this.live,
      keys: cfg.keys,
      feeRate: cfg.risk.feeRate,
    });
    this.equity = cfg.paper.startEquity;
    this.position = null; // { side, qty, entry, stop, target }
    this.trades = [];
    this.log = [];
    this.halt = null;
  }

  // Combine strategy votes into a single net score in [-∞, +∞].
  confluence(candles) {
    const votes = [];
    let score = 0;
    for (const [name, sc] of Object.entries(this.cfg.strategies)) {
      const weight = sc.weight ?? 0;
      if (weight <= 0 || !STRATEGIES[name]) continue;
      const v = STRATEGIES[name](candles, sc);
      const contribution = v.dir * v.strength * weight;
      score += contribution;
      if (v.dir !== 0)
        votes.push(`${name}:${v.dir > 0 ? "L" : "S"}(${v.strength.toFixed(2)}) ${v.reason}`);
    }
    return { score, votes };
  }

  async openPosition(side, price, atr) {
    if (side === "short" && !this.cfg.allowShorts) return;
    const { slAtrMult, tpAtrMult, riskPctPerTrade, maxNotionalPct } = this.cfg.risk;
    const { stop, target } = bracket({ side, entry: price, atr, slMult: slAtrMult, tpMult: tpAtrMult });
    const qty = positionSize({
      equity: this.equity,
      price,
      stopPrice: stop,
      riskPct: riskPctPerTrade,
      maxNotionalPct,
    });
    if (qty <= 0 || qty * price < 1) return; // below minimum order value

    if (this.live) {
      // Spot LIVE: buys spend USDT notional, sells spend base qty.
      const size = side === "long" ? (qty * price).toFixed(2) : qty.toFixed(4);
      const res = await this.ex.marketOrder(side === "long" ? "buy" : "sell", size);
      if (res.code !== "00000") {
        console.log(`  ❌ Order rejected: ${res.msg}`);
        return;
      }
      console.log(`  ✅ LIVE ${side} ${size} — ${res.data?.orderId}`);
    }

    this.position = { side, qty, entry: price, stop, target, openedAt: Date.now() };
    const fee = qty * price * this.cfg.risk.feeRate;
    this.equity -= fee;
    console.log(
      `  🟢 OPEN ${side} qty=${qty.toFixed(4)} @ ${price} | stop=${stop.toFixed(4)} target=${target.toFixed(4)}`,
    );
  }

  async closePosition(price, reason) {
    const p = this.position;
    const gross =
      p.side === "long" ? (price - p.entry) * p.qty : (p.entry - price) * p.qty;
    const fee = p.qty * price * this.cfg.risk.feeRate;
    const pnl = gross - fee;
    this.equity += pnl;

    if (this.live) {
      // Close a long by selling the base qty; close a short by buying it back.
      const size = p.side === "long" ? p.qty.toFixed(4) : (p.qty * price).toFixed(2);
      const res = await this.ex.marketOrder(p.side === "long" ? "sell" : "buy", size);
      if (res.code !== "00000") console.log(`  ⚠️  Close order issue: ${res.msg}`);
    }

    this.trades.push({ ...p, exit: price, reason, pnl, closedAt: Date.now() });
    console.log(
      `  🔴 CLOSE ${p.side} @ ${price} — ${reason} | PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} | equity ${this.equity.toFixed(2)}`,
    );
    this.guard.record(this.equity, pnl);
    this.position = null;
  }

  async tick(n) {
    const candles = await this.ex.candles(this.cfg.timeframe, 200);
    if (candles.length < 60) {
      console.log(`[${n}] not enough candles yet (${candles.length})`);
      return;
    }
    const price = candles[candles.length - 1].close;
    const atr = calcATR(candles, this.cfg.risk.atrPeriod);
    if (!atr) return;

    // 1) Manage an open position first.
    if (this.position) {
      const p = this.position;
      if (this.cfg.risk.useTrailing) {
        p.stop = trail({ side: p.side, price, stop: p.stop, atr, trailMult: this.cfg.risk.trailAtrMult });
      }
      const exit = shouldExit({ side: p.side, price, stop: p.stop, target: p.target });
      if (exit) await this.closePosition(price, exit);
    }

    // 2) Look for a new entry when flat.
    const { score, votes } = this.confluence(candles);
    console.log(
      `[${n}] ${this.cfg.symbol} ${price} | score=${score.toFixed(2)} | eq=${this.equity.toFixed(2)}${this.position ? ` | in ${this.position.side}` : ""}`,
    );
    if (votes.length) console.log(`     ${votes.join(" | ")}`);

    if (!this.position) {
      if (score >= this.cfg.entryThreshold) await this.openPosition("long", price, atr);
      else if (score <= -this.cfg.entryThreshold) await this.openPosition("short", price, atr);
    }

    // 3) Account-level circuit breaker.
    this.halt = this.guard.check(this.equity);
    this.recordTick(n, price, score, votes);
  }

  recordTick(n, price, score, votes) {
    this.log.push({
      tick: n,
      ts: new Date().toISOString(),
      price,
      score: Number(score.toFixed(3)),
      votes,
      equity: Number(this.equity.toFixed(4)),
      position: this.position
        ? { side: this.position.side, entry: this.position.entry, stop: this.position.stop }
        : null,
    });
  }

  async warmup() {
    if (this.live) {
      if (!this.cfg.keys) throw new Error("LIVE mode needs BITGET_* keys in .env");
      this.equity = await this.ex.liveBalanceUSDT();
      console.log(`💰 Live USDT balance: ${this.equity.toFixed(2)}`);
    }
    this.guard = new RiskGuard({
      startEquity: this.equity,
      maxDailyLossPct: this.cfg.risk.maxDailyLossPct,
      maxDrawdownPct: this.cfg.risk.maxDrawdownPct,
      maxConsecLosses: this.cfg.risk.maxConsecLosses,
    });
  }

  summary() {
    const wins = this.trades.filter((t) => t.pnl > 0).length;
    const losses = this.trades.filter((t) => t.pnl <= 0).length;
    const totalPnl = this.trades.reduce((s, t) => s + t.pnl, 0);
    const winRate = this.trades.length ? (wins / this.trades.length) * 100 : 0;
    return {
      trades: this.trades.length,
      wins,
      losses,
      winRate: Number(winRate.toFixed(1)),
      totalPnl: Number(totalPnl.toFixed(4)),
      finalEquity: Number(this.equity.toFixed(2)),
      returnPct: Number(
        (((this.equity - this.guard.startEquity) / this.guard.startEquity) * 100).toFixed(2),
      ),
    };
  }

  flushLog() {
    const path = join(this.cfg.root, this.cfg.logFile);
    writeFileSync(
      path,
      JSON.stringify(
        {
          session: new Date().toISOString(),
          mode: this.cfg.mode,
          summary: this.summary(),
          ticks: this.log,
          trades: this.trades,
        },
        null,
        2,
      ),
    );
  }

  async run() {
    await this.warmup();
    console.log(
      `\n🤖 Multi-Strategy Scalper — ${this.cfg.mode.toUpperCase()} mode`,
    );
    console.log(
      `Symbol ${this.cfg.symbol} | TF ${this.cfg.timeframe}m | poll ${this.cfg.pollMs}ms | threshold ${this.cfg.entryThreshold}`,
    );
    const active = Object.entries(this.cfg.strategies)
      .filter(([, s]) => (s.weight ?? 0) > 0)
      .map(([n, s]) => `${n}(${s.weight})`);
    console.log(`Strategies: ${active.join(", ")}\n`);

    let n = 0;
    const stop = () => {
      this.halt = this.halt || "interrupted";
    };
    process.on("SIGINT", stop);

    while (!this.halt) {
      n += 1;
      try {
        await this.tick(n);
      } catch (e) {
        console.log(`  ⚠️  tick error: ${e.message}`);
      }
      if (this.cfg.maxTicks && n >= this.cfg.maxTicks) break;
      if (this.halt) break;
      await sleep(this.cfg.pollMs);
    }

    // Flatten any open position at session end (paper safety).
    if (this.position && !this.live) {
      const price = await this.ex.price();
      await this.closePosition(price, "session-end");
    }

    if (this.halt && this.halt !== "interrupted")
      console.log(`\n🛑 Halted: ${this.halt}`);

    const s = this.summary();
    console.log(`\n📊 Session summary`);
    console.log(`  Trades: ${s.trades} | Win rate: ${s.winRate}% (${s.wins}W/${s.losses}L)`);
    console.log(`  Total PnL: ${s.totalPnl >= 0 ? "+" : ""}${s.totalPnl} | Return: ${s.returnPct}%`);
    console.log(`  Final equity: ${s.finalEquity}\n`);
    this.flushLog();
    return s;
  }
}
