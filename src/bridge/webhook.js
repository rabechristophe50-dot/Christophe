#!/usr/bin/env node
/**
 * Recepteur de WEBHOOK TradingView -> MT5 (bot 24/7, sans lecture d'ecran).
 *
 *   node src/bridge/webhook.js [chemin-config.json]
 *
 * TradingView (cloud) declenche une alerte -> envoie un POST ici -> on ecrit
 * tv_signal.json (dossier Common\Files) -> l'EA MT5 execute.
 *
 * Le message d'alerte peut etre :
 *   - du JSON : {"action":"SELL","symbol":"XAUUSD","sl":4058.5,"tp":4045.4}
 *   - ou du texte : "SELL XAUUSD SL 4058.5 TP 4045.4"
 * On en extrait : action (BUY/SELL/CLOSE), symbole, SL, TP, lot.
 */
import { createServer } from 'http';
import { loadConfig } from './config.js';
import { writeTextAtomic } from './sink.js';

const cfg = loadConfig(process.argv[2]);
const wcfg = cfg.webhook || {};
const PORT = wcfg.port || 8080;
const SECRET = wcfg.secret || '';           // optionnel : protege l'endpoint public
const SIGNAL_PATH = cfg.sink.file_path;
const DEFAULT_LOT = cfg.order?.lot || 0.01;
let counter = 0;

function num(v) { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isNaN(n) ? 0 : n; }

function cleanSymbol(s) {
  if (!s) return '';
  return String(s).includes(':') ? String(s).split(':').pop() : String(s);
}
function mapSymbol(sym) {
  const c = cleanSymbol(sym);
  return cfg.symbol_map?.[c] || cfg.symbol_map?.[sym] || c || cfg.default_symbol;
}

/** Extrait {action, symbol, sl, tp, lot, secret} d'un corps JSON ou texte. */
function parseBody(body) {
  let obj = null;
  try { obj = JSON.parse(body); } catch { /* pas du JSON */ }

  if (obj && typeof obj === 'object') {
    const raw = `${obj.action ?? obj.side ?? obj.signal ?? ''}`.toLowerCase();
    let action = null;
    if (/\b(buy|long)\b/.test(raw)) action = 'BUY';
    else if (/\b(sell|short)\b/.test(raw)) action = 'SELL';
    else if (/\b(close|exit|flat)\b/.test(raw)) action = 'CLOSE';
    // si l'action n'est pas dans un champ dedie, on relit le message texte
    if (!action && obj.message) return parseBody(String(obj.message));
    return {
      action,
      symbol: obj.symbol ?? obj.ticker ?? null,
      sl: num(obj.sl ?? obj.sl_price ?? obj.stop ?? obj.stoploss),
      tp: num(obj.tp ?? obj.tp_price ?? obj.target ?? obj.takeprofit),
      lot: num(obj.lot ?? obj.qty ?? obj.size),
      secret: obj.secret ?? obj.passphrase ?? null,
    };
  }

  // Texte libre : "SELL XAUUSD SL 4058.5 TP 4045.4"
  const t = String(body);
  const low = t.toLowerCase();
  let action = null;
  if (/\b(buy|long)\b/.test(low)) action = 'BUY';
  else if (/\b(sell|short)\b/.test(low)) action = 'SELL';
  else if (/\b(close|exit|flat)\b/.test(low)) action = 'CLOSE';
  const slm = t.match(/sl[^0-9\-]*(-?\d+(?:\.\d+)?)/i);
  const tpm = t.match(/tp[^0-9\-]*(-?\d+(?:\.\d+)?)/i);
  // Symbole = premier mot en MAJUSCULES qui n'est pas un mot-cle (BUY/SELL/SL/TP...).
  const STOP = new Set(['BUY', 'SELL', 'LONG', 'SHORT', 'CLOSE', 'EXIT', 'FLAT', 'SL', 'TP']);
  let symbol = null;
  for (const m of t.matchAll(/\b([A-Z]{3,}[A-Z0-9._]*)\b/g)) {
    if (!STOP.has(m[1])) { symbol = m[1]; break; }
  }
  return {
    action,
    symbol,
    sl: slm ? parseFloat(slm[1]) : 0,
    tp: tpm ? parseFloat(tpm[1]) : 0,
    lot: 0,
    secret: null,
  };
}

function writeSignal(sig) {
  counter += 1;
  const payload = {
    id: counter,
    action: sig.action,
    symbol: mapSymbol(sig.symbol),
    lot: sig.lot > 0 ? sig.lot : DEFAULT_LOT,
    sl_points: 0, tp_points: 0,
    sl_price: sig.sl > 0 ? sig.sl : 0,
    tp_price: sig.tp > 0 ? sig.tp : 0,
    sl_dist: 0, tp_dist: 0,
    reason: 'webhook',
    ts: Date.now(),
  };
  writeTextAtomic(SIGNAL_PATH, JSON.stringify(payload));
  return payload;
}

const server = createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(200); res.end('TV->MT5 webhook OK'); return; }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 100000) req.destroy(); });
  req.on('end', () => {
    const sig = parseBody(body);
    // Securite optionnelle : secret partage.
    if (SECRET && sig.secret !== SECRET) {
      console.warn(`[webhook] rejete : secret invalide`);
      res.writeHead(401); res.end('unauthorized'); return;
    }
    if (!sig.action) {
      console.warn(`[webhook] rejete : action introuvable dans le message: ${body.slice(0, 120)}`);
      res.writeHead(400); res.end('no action'); return;
    }
    const p = writeSignal(sig);
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`[${stamp}] WEBHOOK #${p.id}  ${p.action} ${p.symbol}  SL=${p.sl_price || '-'} TP=${p.tp_price || '-'}  lot=${p.lot}`);
    res.writeHead(200); res.end('ok');
  });
});

server.listen(PORT, () => {
  console.log(`[webhook] Recepteur TradingView -> MT5 en ecoute sur le port ${PORT}`);
  console.log(`[webhook] Fichier signal: ${SIGNAL_PATH}`);
  if (SECRET) console.log('[webhook] Secret ACTIVE (le message doit contenir "secret").');
  console.log('[webhook] URL webhook a mettre dans TradingView: http://<IP-du-VPS>:' + PORT + '/');
});
