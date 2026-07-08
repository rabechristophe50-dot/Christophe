#!/usr/bin/env node
// ── Multi-Strategy Scalping Bot — entry point ───────────────────
// Usage:
//   node scalper-bot.js                 # paper mode (default, safe)
//   node scalper-bot.js --live          # LIVE trading (real money!)
//   node scalper-bot.js --symbol BTCUSDT --tf 1 --ticks 50
//   node scalper-bot.js --equity 500 --threshold 1.5
//
// Config precedence: CLI flags > scalper.config.json > built-in defaults.

import { loadConfig } from "./scalper/config.js";
import { Engine } from "./scalper/engine.js";
import { Exchange } from "./scalper/exchange.js";
import { backtest } from "./scalper/backtest.js";

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") o.mode = "live";
    else if (a === "--paper") o.mode = "paper";
    else if (a === "--symbol") o.symbol = argv[++i];
    else if (a === "--tf") o.timeframe = Number(argv[++i]);
    else if (a === "--ticks") o.maxTicks = Number(argv[++i]);
    else if (a === "--poll") o.pollMs = Number(argv[++i]);
    else if (a === "--threshold") o.entryThreshold = Number(argv[++i]);
    else if (a === "--equity") o.paper = { startEquity: Number(argv[++i]) };
    else if (a === "--shorts") o.allowShorts = true;
    else if (a === "--backtest") o.backtest = true;
    else if (a === "--bars") o.bars = Number(argv[++i]);
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}

const HELP = `
Multi-Strategy Scalping Bot

  --paper            Simulated trading on real market data (default)
  --live             Place REAL orders on BitGet (requires .env keys)
  --symbol <SYM>     Trading pair (default XRPUSDT)
  --tf <min>         Signal timeframe: 1, 5, 15, 60 (default 1)
  --ticks <n>        Stop after n ticks (default: run until Ctrl-C / halt)
  --poll <ms>        Loop interval in ms (default 5000)
  --threshold <n>    Confluence score needed to enter (default 1.2)
  --equity <usdt>    Paper starting equity (default 1000)
  --shorts           Allow simulated short positions (paper only)
  --backtest         Replay historical candles and print stats, then exit
  --bars <n>         Candles to pull for backtest (default 200, max 1000)

Strategy weights and risk settings live in scalper.config.json.
`;

const cli = parseArgs(process.argv.slice(2));
if (cli.help) {
  console.log(HELP);
  process.exit(0);
}

const cfg = loadConfig(cli);

if (cli.backtest) {
  const ex = new Exchange({ symbol: cfg.symbol, live: false });
  const limit = Math.min(cli.bars || 200, 1000);
  const candles = await ex.candles(cfg.timeframe, limit);
  console.log(`\n📈 Backtest — ${cfg.symbol} ${cfg.timeframe}m over ${candles.length} bars`);
  const r = backtest(cfg, candles);
  console.log(`  Trades: ${r.trades} | Win rate: ${r.winRate}% (${r.wins}W/${r.losses}L)`);
  console.log(`  Profit factor: ${r.profitFactor ?? "n/a"}`);
  console.log(`  Total PnL: ${r.totalPnl >= 0 ? "+" : ""}${r.totalPnl} | Return: ${r.returnPct}%`);
  console.log(`  Final equity: ${r.finalEquity}\n`);
  process.exit(0);
}

if (cfg.mode === "live") {
  console.log("\n⚠️  LIVE MODE — real orders will be placed with real funds.");
  console.log("   Press Ctrl-C within 5s to abort.\n");
  await new Promise((r) => setTimeout(r, 5000));
}

const engine = new Engine(cfg);
engine
  .run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
  });
