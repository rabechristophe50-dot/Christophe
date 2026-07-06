#!/usr/bin/env node
/**
 * Pont TradingView (indicateur verrouille) -> MT5, en temps reel.
 *
 *   node src/bridge/run.js [chemin-config.json]
 *
 * Boucle : lit le graphique via CDP, detecte les changements de signal de
 * l'indicateur, et publie un ordre (fichier + HTTP) que l'EA MT5 execute.
 */
import { dirname, join } from 'path';
import { loadConfig } from './config.js';
import { SignalDetector } from './detector.js';
import { SignalSink, writeTextAtomic } from './sink.js';
import { collectDrawings } from './drawings.js';
import { data, chart } from '../core/index.js';

function cleanSymbol(tvSymbol) {
  if (!tvSymbol) return '';
  return tvSymbol.includes(':') ? tvSymbol.split(':').pop() : tvSymbol;
}

function mapSymbol(cfg, tvSymbol) {
  if (!tvSymbol) return cfg.default_symbol;
  const clean = cleanSymbol(tvSymbol);
  return cfg.symbol_map[clean] || cfg.symbol_map[tvSymbol] || clean;
}

/** Lit symbole + timeframe (resolution) du graphique TV affiche. */
async function currentChart() {
  try {
    const st = await chart.getState();
    return { symbol: st?.symbol || null, resolution: st?.resolution != null ? String(st.resolution) : null };
  } catch {
    return { symbol: null, resolution: null };
  }
}

/** Verifie que le graphique TV est sur le bon symbole ET un timeframe autorise. */
function guardCheck(guard, symbol, resolution) {
  if (!guard || !guard.enabled) return { ok: true };
  const tfs = (guard.timeframes || []).map(String);
  if (tfs.length && (resolution == null || !tfs.includes(resolution))) {
    return { ok: false, reason: `timeframe ${resolution || '?'} non autorise (attendu: ${tfs.join('/')})` };
  }
  if (guard.symbol) {
    const cs = cleanSymbol(symbol).toUpperCase();
    if (cs !== guard.symbol.toUpperCase() && !cs.includes(guard.symbol.toUpperCase())) {
      return { ok: false, reason: `symbole ${cs || '?'} != ${guard.symbol}` };
    }
  }
  return { ok: true };
}

async function main() {
  const cfg = loadConfig(process.argv[2]);
  console.log(`[bridge] Config: ${cfg._source}`);
  console.log(`[bridge] Mode indicateur: ${cfg.indicator.mode} | filtre: "${cfg.indicator.study_filter || '(tous)'}"`);
  console.log(`[bridge] Ordre: lot=${cfg.order.lot} SL=${cfg.order.sl_points}pts TP=${cfg.order.tp_points}pts`);

  const detector = new SignalDetector(cfg);
  const sink = new SignalSink(cfg);
  sink.start();

  if (cfg.sink.file) console.log(`[bridge] Fichier signal: ${cfg.sink.file_path}`);
  console.log(`[bridge] Demarrage de la boucle (poll ${cfg.poll_ms} ms). Ctrl+C pour arreter.\n`);

  let running = true;
  const stop = () => { running = false; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Miroir visuel : ecrit periodiquement les dessins de l'indicateur dans un
  // fichier texte que l'EA MT5 redessine sur son graphique.
  const drawCfg = cfg.drawings || {};
  const drawPath = drawCfg.file_path || join(dirname(cfg.sink.file_path), 'tv_draw.txt');
  if (drawCfg.enabled) console.log(`[bridge] Miroir visuel: ${drawPath}`);
  let lastDraw = 0;

  // Garde-fou : ne trader que le bon symbole + timeframes autorises (M5/M15).
  const guard = cfg.guard || {};
  if (guard.enabled) {
    console.log(`[bridge] Garde-fou: ${guard.symbol || '(tout symbole)'} en ${(guard.timeframes || []).join('/') || '(tout TF)'}`);
  }
  let lastRes = null;

  let consecutiveErrors = 0;
  while (running) {
    const t0 = Date.now();
    try {
      const { symbol: tvSym, resolution: tvRes } = await currentChart();

      // Changement de timeframe -> re-caler le detecteur sans trader le passage.
      if (tvRes !== null && tvRes !== lastRes) {
        if (lastRes !== null) {
          detector.initialized = false;
          console.log(`[bridge] Timeframe change: ${lastRes} -> ${tvRes} (re-calibrage, aucun trade sur le changement)`);
        }
        lastRes = tvRes;
      }

      const signal = await detector.poll();
      consecutiveErrors = 0;

      if (drawCfg.enabled && t0 - lastDraw >= (drawCfg.refresh_ms || 3000)) {
        lastDraw = t0;
        try {
          const text = await collectDrawings({
            study_filter: cfg.indicator.study_filter,
            max_labels: drawCfg.max_labels,
            mode: drawCfg.mode || 'active',
            buy_keywords: cfg.indicator.buy_keywords,
            sell_keywords: cfg.indicator.sell_keywords,
            exclude_keywords: cfg.indicator.exclude_keywords,
            sl_keywords: cfg.sltp?.sl_keywords,
            tp_keywords: cfg.sltp?.tp_keywords,
          }, { data });
          writeTextAtomic(drawPath, text);
        } catch (e) { /* miroir optionnel : on n'interrompt pas le trading */ }
      }
      if (signal) {
        // Garde-fou : refuser si TV n'est pas sur le bon symbole / timeframe.
        const g = guardCheck(guard, tvSym, tvRes);
        if (!g.ok) {
          const stamp = new Date().toISOString().slice(11, 19);
          console.warn(`[${stamp}] SIGNAL IGNORE (${signal.action}) : ${g.reason}`);
          continue;
        }
        const mtSym = mapSymbol(cfg, tvSym);
        const published = sink.publish({
          action: signal.action,
          symbol: mtSym,
          lot: cfg.order.lot,
          sl_points: cfg.order.sl_points,
          tp_points: cfg.order.tp_points,
          sl_price: signal.sl_price,
          tp_price: signal.tp_price,
          sl_dist: signal.sl_dist,
          tp_dist: signal.tp_dist,
          reason: signal.reason,
        });
        const stamp = new Date().toISOString().slice(11, 19);
        const sltp = (signal.sl_dist || signal.tp_dist)
          ? `  distSL=${signal.sl_dist || '-'} distTP=${signal.tp_dist || '-'}`
          : '';
        console.log(
          `[${stamp}] SIGNAL #${published.id}  ${signal.from} -> ${signal.to}  ` +
          `=> ${signal.action} ${mtSym}${sltp}`,
        );
        // Detail pour comparer avec ce qu'affiche TradingView.
        console.log(
          `           label declencheur: "${signal.reason}"  id=${signal.labelId}  ` +
          `prixTV=${signal.price}  TF=${tvRes}`,
        );
      }
    } catch (e) {
      consecutiveErrors++;
      if (consecutiveErrors <= 3 || consecutiveErrors % 20 === 0) {
        console.warn(`[bridge] Erreur de lecture (${consecutiveErrors}): ${e.message}`);
      }
    }
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, cfg.poll_ms - elapsed);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  sink.stop();
  console.log('\n[bridge] Arrete.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[bridge] Erreur fatale:', e);
  process.exit(1);
});
