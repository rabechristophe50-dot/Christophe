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
import { data } from '../core/index.js';

function mapSymbol(cfg, tvSymbol) {
  if (!tvSymbol) return cfg.default_symbol;
  // Le symbole TV peut etre "BINANCE:BTCUSDT" -> on garde la partie apres ":".
  const clean = tvSymbol.includes(':') ? tvSymbol.split(':').pop() : tvSymbol;
  return cfg.symbol_map[clean] || cfg.symbol_map[tvSymbol] || clean;
}

async function currentTvSymbol() {
  try {
    const q = await data.getQuote({});
    return q?.symbol || null;
  } catch {
    return null;
  }
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

  let consecutiveErrors = 0;
  while (running) {
    const t0 = Date.now();
    try {
      const signal = await detector.poll();
      consecutiveErrors = 0;

      if (drawCfg.enabled && t0 - lastDraw >= (drawCfg.refresh_ms || 3000)) {
        lastDraw = t0;
        try {
          const text = await collectDrawings({ study_filter: cfg.indicator.study_filter, max_labels: drawCfg.max_labels }, { data });
          writeTextAtomic(drawPath, text);
        } catch (e) { /* miroir optionnel : on n'interrompt pas le trading */ }
      }
      if (signal) {
        const tvSym = await currentTvSymbol();
        const mtSym = mapSymbol(cfg, tvSym);
        const published = sink.publish({
          action: signal.action,
          symbol: mtSym,
          lot: cfg.order.lot,
          sl_points: cfg.order.sl_points,
          tp_points: cfg.order.tp_points,
          sl_price: signal.sl_price,
          tp_price: signal.tp_price,
          reason: signal.reason,
        });
        const stamp = new Date().toISOString().slice(11, 19);
        const sltp = (signal.sl_price || signal.tp_price)
          ? `  SL=${signal.sl_price || '-'} TP=${signal.tp_price || '-'}`
          : '';
        console.log(
          `[${stamp}] SIGNAL #${published.id}  ${signal.from} -> ${signal.to}  ` +
          `=> ${signal.action} ${mtSym}${sltp}  (${signal.reason})`,
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
