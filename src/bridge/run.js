#!/usr/bin/env node
/**
 * Pont TradingView (indicateur verrouille) -> MT5, en temps reel.
 *
 *   node src/bridge/run.js [chemin-config.json]
 *
 * Boucle : lit le graphique via CDP, detecte les changements de signal de
 * l'indicateur, et publie un ordre (fichier + HTTP) que l'EA MT5 execute.
 */
import { loadConfig } from './config.js';
import { SignalDetector } from './detector.js';
import { SignalSink } from './sink.js';
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
  // En mode ALERTE, le signal ne depend PAS du graphique affiche (il vient des
  // alertes TradingView). On desactive donc le garde-fou/re-calibrage/anti-repaint
  // qui se basent sur le graphique affiche : ils bloqueraient a tort de vraies
  // alertes si l'utilisateur regarde un autre symbole/timeframe.
  const isAlert = cfg.indicator.mode === 'alert';
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

  // Garde-fou : ne trader que le bon symbole + timeframes autorises (M5/M15).
  const guard = cfg.guard || {};
  if (guard.enabled) {
    console.log(`[bridge] Garde-fou: ${guard.symbol || '(tout symbole)'} en ${(guard.timeframes || []).join('/') || '(tout TF)'}`);
  }
  let lastRes = null;
  let lastStatus = null;

  let consecutiveErrors = 0;
  while (running) {
    const t0 = Date.now();
    try {
      const { symbol: tvSym, resolution: tvRes } = await currentChart();

      // Changement de timeframe -> re-caler le detecteur (mode label/study_value
      // seulement). En mode alerte, le graphique affiche n'a aucune importance.
      if (!isAlert && tvRes !== null && tvRes !== lastRes) {
        if (lastRes !== null) {
          detector.initialized = false;
          console.log(`[bridge] Timeframe change: ${lastRes} -> ${tvRes} (re-calibrage, aucun trade sur le changement)`);
        }
        lastRes = tvRes;
      }

      const signal = await detector.poll();
      consecutiveErrors = 0;

      // Suivi en direct : afficher l'etat du detecteur quand il change.
      if (detector.status && detector.status !== lastStatus) {
        lastStatus = detector.status;
        const stamp = new Date().toISOString().slice(11, 19);
        console.log(`[${stamp}] etat: ${detector.status}`);
      }

      if (signal) {
        // Garde-fou symbole. En mode alerte, on valide le symbole de L'ALERTE
        // (deja filtre par le detecteur) ; sinon le symbole du graphique affiche.
        const guardSym = isAlert ? (signal.symbol || tvSym) : tvSym;
        const g = guardCheck(guard, guardSym, isAlert ? null : tvRes);
        if (!g.ok) {
          const stamp = new Date().toISOString().slice(11, 19);
          console.warn(`[${stamp}] SIGNAL IGNORE (${signal.action}) : ${g.reason}`);
          continue;
        }
        // Anti-repaint (mode label uniquement) : un vieux label redessine est
        // loin du prix -> on le rejette. En mode alerte, le declenchement fait
        // foi : on ne rejette jamais sur la distance de prix.
        const maxPct = isAlert ? 0 : cfg.indicator.max_entry_pct;
        if (maxPct > 0 && signal.price != null) {
          let cur = null;
          try { cur = (await data.getQuote({}))?.price ?? null; } catch { cur = null; }
          if (cur != null && cur > 0) {
            const diffPct = Math.abs(signal.price - cur) / cur * 100;
            if (diffPct > maxPct) {
              const stamp = new Date().toISOString().slice(11, 19);
              console.warn(
                `[${stamp}] SIGNAL IGNORE (${signal.action}) : label a ${signal.price} loin du prix ${cur} ` +
                `(${diffPct.toFixed(2)}% > ${maxPct}%) - probable repaint`,
              );
              continue;
            }
          }
        }
        // En mode alerte : symbole de l'alerte. Sinon : symbole du graphique.
        const mtSym = mapSymbol(cfg, (isAlert && signal.symbol) ? signal.symbol : tvSym);
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
      const cdp = /CDP|connection failed|fetch failed|No TradingView/i.test(e.message || '');
      if (cdp) {
        // Message clair et non alarmant : TradingView pas (encore) connecte.
        if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
          console.log('[bridge] En attente de TradingView (lance-le en mode debogage : demarrer.bat)...');
        }
      } else if (consecutiveErrors <= 3 || consecutiveErrors % 20 === 0) {
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
