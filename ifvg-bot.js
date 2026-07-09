#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
//  IFVG BOT (live) — "Comment bien trader les IFVG ?"  · OR / XAUUSD 5m & 15m
//
//  Bot d'exécution qui lit le chart TradingView live (via CDP port 9222),
//  applique le concept ICT Inverse Fair Value Gap et émet des signaux.
//  Logique STRICTEMENT identique à scripts/ifvg_bot.pine :
//    1. Prise de liquidité (sweep) avant l'IFVG
//    2. 1 seul FVG -> IFVG (pas de cluster)
//    3. Inversion confirmée par la CLÔTURE du corps
//    4. Cible IRL -> ERL (liquidité externe = swing opposé)
//
//  Usage :
//    node ifvg-bot.js              # boucle live sur XAUUSD 5m & 15m
//    node ifvg-bot.js --selftest   # teste la logique sans TradingView
// ════════════════════════════════════════════════════════════════════════

// ── Config ──────────────────────────────────────────────────────────────
const CFG = {
  symbol: "OANDA:XAUUSD",
  timeframes: ["5", "15"], // minutes
  pollMs: 20000, // fréquence de scan
  bars: 200, // profondeur d'historique lue
  pivotLen: 8, // longueur des swings (liquidité)
  windowBars: 18, // fenêtre max entre sweep et IFVG
  requireSingleFVG: true, // règle #2
  minFvgAtr: 0.25, // FVG min = 0.25 × ATR(14)  (auto 5m/15m)
  rrFallback: 2.0, // R:R si pas de swing pour la cible
  slPadPct: 0.05, // marge du stop au-delà de l'IFVG (%)
  drawOnChart: true, // dessine SL/TP sur le chart quand un signal sort
  logFile: "ifvg-signals.log",
};

// ════════════════════════════════════════════════════════════════════════
//  DÉTECTION IFVG (pur, testable sans CDP)
//  bars = [{time, open, high, low, close, volume}, ...] ordre chronologique
//  → renvoie la liste des signaux {index, time, side, entry, sl, tp, fvgTop, fvgBot}
// ════════════════════════════════════════════════════════════════════════
export function detectIFVG(bars, cfg = CFG) {
  const n = bars.length;
  const signals = [];
  if (n < cfg.pivotLen * 2 + 3) return signals;

  const atr = computeATR(bars, 14);

  // Pivots confirmés (fenêtre gauche = droite = pivotLen), timing type Pine :
  // un pivot situé à (j - pivotLen) est confirmé au bar j.
  let lastSwingHigh = NaN;
  let lastSwingLow = NaN;

  // State machine LONG
  let lState = 0, lTop = NaN, lBot = NaN, lCnt = 0, lExpiry = 0, lSweepLow = NaN;
  // State machine SHORT
  let sState = 0, sTop = NaN, sBot = NaN, sCnt = 0, sExpiry = 0, sSweepHigh = NaN;

  const p = cfg.pivotLen;

  for (let j = 0; j < n; j++) {
    const b = bars[j];

    // — confirmation d'un pivot à l'index (j - p) —
    if (j >= 2 * p) {
      const c = j - p;
      let isHigh = true, isLow = true;
      for (let k = c - p; k <= c + p; k++) {
        if (k === c) continue;
        if (bars[k].high >= bars[c].high) isHigh = false;
        if (bars[k].low <= bars[c].low) isLow = false;
      }
      if (isHigh) lastSwingHigh = bars[c].high;
      if (isLow) lastSwingLow = bars[c].low;
    }

    // — 1. Sweeps de liquidité —
    const sellsideSweep = !isNaN(lastSwingLow) && b.low < lastSwingLow && b.close > lastSwingLow;
    const buysideSweep = !isNaN(lastSwingHigh) && b.high > lastSwingHigh && b.close < lastSwingHigh;

    // — 2. FVG (3 bougies) — comparés à j-2
    const b2 = j >= 2 ? bars[j - 2] : null;
    const bullFVG = b2 && b.low > b2.high;
    const bearFVG = b2 && b.high < b2.low;
    const bullTop = b.low, bullBot = b2 ? b2.high : NaN;
    const bearTop = b2 ? b2.low : NaN, bearBot = b.high;
    const minSize = cfg.minFvgAtr * (atr[j] || 0);
    const big = (t, bt) => minSize <= 0 || t - bt >= minSize;
    const bullFVGok = bullFVG && big(bullTop, bullBot);
    const bearFVGok = bearFVG && big(bearTop, bearBot);

    // ── LONG : sweep sellside → FVG baissier → clôture corps AU-DESSUS ──
    // On ne (re)démarre le tracking que depuis l'état idle : une bougie qui
    // re-balaie le même plus-bas (ex. la bougie d'inversion) ne doit pas
    // réinitialiser le setup en cours.
    if (sellsideSweep && lState === 0) {
      lState = 1; lExpiry = j + cfg.windowBars; lCnt = 0; lTop = NaN; lBot = NaN; lSweepLow = b.low;
    }
    if (lState >= 1 && j > lExpiry) lState = 0;
    if (lState === 1 && bearFVGok) {
      lCnt++; lTop = bearTop; lBot = bearBot; lState = 2;
    } else if (lState === 2 && bearFVGok) {
      lCnt++;
      if (cfg.requireSingleFVG) lState = 0; // règle #2
      else { lTop = bearTop; lBot = bearBot; }
    }
    if (lState === 2 && b.close > lTop && b.close > b.open) {
      const entry = b.close;
      const sl = Math.min(lBot, isNaN(lSweepLow) ? lBot : lSweepLow) * (1 - cfg.slPadPct / 100);
      const risk = entry - sl;
      if (risk > 0) {
        const tp = !isNaN(lastSwingHigh) && lastSwingHigh > entry
          ? lastSwingHigh : entry + risk * cfg.rrFallback;
        signals.push({ index: j, time: b.time, side: "LONG", entry, sl, tp, fvgTop: lTop, fvgBot: lBot });
      }
      lState = 0;
    }

    // ── SHORT : sweep buyside → FVG haussier → clôture corps EN-DESSOUS ──
    if (buysideSweep && sState === 0) {
      sState = 1; sExpiry = j + cfg.windowBars; sCnt = 0; sTop = NaN; sBot = NaN; sSweepHigh = b.high;
    }
    if (sState >= 1 && j > sExpiry) sState = 0;
    if (sState === 1 && bullFVGok) {
      sCnt++; sTop = bullTop; sBot = bullBot; sState = 2;
    } else if (sState === 2 && bullFVGok) {
      sCnt++;
      if (cfg.requireSingleFVG) sState = 0;
      else { sTop = bullTop; sBot = bullBot; }
    }
    if (sState === 2 && b.close < sBot && b.close < b.open) {
      const entry = b.close;
      const sl = Math.max(sTop, isNaN(sSweepHigh) ? sTop : sSweepHigh) * (1 + cfg.slPadPct / 100);
      const risk = sl - entry;
      if (risk > 0) {
        const tp = !isNaN(lastSwingLow) && lastSwingLow < entry
          ? lastSwingLow : entry - risk * cfg.rrFallback;
        signals.push({ index: j, time: b.time, side: "SHORT", entry, sl, tp, fvgTop: sTop, fvgBot: sBot });
      }
      sState = 0;
    }
  }
  return signals;
}

// ATR(14) type RMA/Wilder
function computeATR(bars, len) {
  const atr = new Array(bars.length).fill(0);
  let prevTR = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const tr = i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close));
    if (i === 0) prevTR = tr;
    else prevTR = (prevTR * (len - 1) + tr) / len;
    atr[i] = prevTR;
  }
  return atr;
}

const fmt = (x) => (Math.round(x * 100) / 100).toFixed(2);

function describe(sig, tf) {
  const rr = sig.side === "LONG"
    ? (sig.tp - sig.entry) / (sig.entry - sig.sl)
    : (sig.entry - sig.tp) / (sig.sl - sig.entry);
  return `[${tf}m] ${sig.side}  entry=${fmt(sig.entry)}  SL=${fmt(sig.sl)}  TP=${fmt(sig.tp)}  R:R=${fmt(rr)}  (${new Date(sig.time).toISOString()})`;
}

// ════════════════════════════════════════════════════════════════════════
//  SELFTEST — vérifie la logique sans TradingView
// ════════════════════════════════════════════════════════════════════════
function selftest() {
  // Construit un scénario LONG : sweep sellside puis FVG baissier puis clôture au-dessus.
  const bars = [];
  let t = Date.UTC(2026, 0, 1) / 1000;
  const push = (o, h, l, c) => bars.push({ time: t++ * 1000, open: o, high: h, low: l, close: c, volume: 100 });
  // range de base (low ~2996)
  for (let i = 0; i < 7; i++) push(2998, 3000, 2996, 2998);
  push(2997, 2998, 2994, 2995);            // idx7 : swing low à 2994
  for (let i = 0; i < 7; i++) push(2998, 3000, 2996, 2998); // confirme le pivot
  // idx15 : sweep sellside (mèche sous 2994, clôture au-dessus)
  push(2998, 3000, 2990, 2998);
  // un SEUL FVG baissier (displacement 3 bougies : idx16-17-18)
  push(2998, 2999, 2995, 2995.5);          // idx16
  push(2995, 2995.5, 2991, 2991.5);        // idx17
  push(2991, 2991.5, 2988, 2989);          // idx18 : high<low[idx16] → FVG top=2995 bot=2991.5
  // idx19 : clôture du corps AU-DESSUS du FVG → IFVG haussier
  push(2990, 2996, 2989, 2995.5);
  const sigs = detectIFVG(bars, { ...CFG, minFvgAtr: 0, pivotLen: 3, windowBars: 30 });
  console.log(`selftest: ${sigs.length} signal(s)`);
  sigs.forEach((s) => console.log("  " + describe(s, 5)));
  console.log(sigs.length > 0 ? "✓ logique OK" : "✗ aucun signal — vérifier la logique");
}

// ════════════════════════════════════════════════════════════════════════
//  LIVE — connexion TradingView via le core CDP du repo
// ════════════════════════════════════════════════════════════════════════
async function live() {
  const { chart, data, drawing } = await import("./src/core/index.js");
  const { appendFileSync } = await import("fs");
  const seen = new Map(); // tf -> dernier time de signal traité

  const log = (line) => {
    console.log(line);
    try { appendFileSync(CFG.logFile, line + "\n"); } catch {}
  };

  log(`IFVG bot démarré · ${CFG.symbol} · ${CFG.timeframes.map((t) => t + "m").join(" & ")} · scan ${CFG.pollMs / 1000}s`);

  await chart.setSymbol({ symbol: CFG.symbol });

  const scan = async () => {
    for (const tf of CFG.timeframes) {
      try {
        await chart.setTimeframe({ timeframe: tf });
        await new Promise((r) => setTimeout(r, 1200)); // laisse le chart charger
        const res = await data.getOhlcv({ count: CFG.bars });
        const bars = res.bars;
        if (!bars || bars.length < 40) continue;

        // On ne signale que sur la DERNIÈRE bougie clôturée (avant-dernière du flux)
        const closedIdx = bars.length - 2;
        const sigs = detectIFVG(bars, CFG);
        const fresh = sigs.filter((s) => s.index >= closedIdx);
        for (const s of fresh) {
          if (seen.get(tf) === s.time) continue;
          seen.set(tf, s.time);
          log("🔔 " + describe(s, tf));
          if (CFG.drawOnChart) {
            try {
              await drawing.drawShape({ shape: "horizontal_line", point: { price: s.tp }, text: `IFVG TP ${tf}m` });
              await drawing.drawShape({ shape: "horizontal_line", point: { price: s.sl }, text: `IFVG SL ${tf}m` });
            } catch {}
          }
        }
      } catch (e) {
        log(`⚠️  ${tf}m: ${e.message}`);
      }
    }
  };

  await scan();
  setInterval(scan, CFG.pollMs);
}

// ── Entrée ──────────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (process.argv.includes("--selftest")) selftest();
  else live().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
}
