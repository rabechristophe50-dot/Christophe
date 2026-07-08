/**
 * Chargement + validation de la config du pont TradingView -> MT5.
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const DEFAULTS = {
  poll_ms: 1000,
  symbol_map: {},
  default_symbol: 'EURUSD',
  indicator: {
    study_filter: '',
    mode: 'label',
    signal_mode: 'on_new_label',
    buy_keywords: ['buy', 'long'],
    sell_keywords: ['sell', 'short'],
    flat_keywords: ['close', 'exit', 'flat'],
    exclude_keywords: ['limit'],
    max_entry_pct: 0.5,
    confirm_seconds: 0,
    study_value: { field: 'Signal', long_when: '> 0', short_when: '< 0', flat_when: '== 0' },
  },
  sltp: {
    enabled: true,
    source: 'auto',
    sl_keywords: ['sl', 'stop'],
    tp_keywords: ['tp', 'target', 'take profit'],
    use_label_price: true,
  },
  order: { lot: 0.1, sl_points: 0, tp_points: 0, close_opposite: true },
  guard: { enabled: true, symbol: 'XAUUSD', timeframes: [] },
  sink: { file: true, file_path: './mt5-signal/tv_signal.json', http: true, http_port: 8787 },
  drawings: { enabled: true, mode: 'active', file_path: '', refresh_ms: 3000, max_labels: 60, show_boxes: true, max_boxes: 4 },
};

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (k.startsWith('_comment')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function loadConfig(path) {
  const candidates = [
    path,
    process.env.BRIDGE_CONFIG,
    resolve(ROOT, 'bridge.config.json'),
    resolve(ROOT, 'bridge.config.example.json'),
  ].filter(Boolean);

  let file = null;
  for (const c of candidates) {
    if (existsSync(c)) { file = c; break; }
  }
  if (!file) {
    console.warn('[bridge] Aucun fichier de config trouve, utilisation des valeurs par defaut.');
    return { ...DEFAULTS, _source: 'defaults' };
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const cfg = deepMerge(DEFAULTS, raw);
  cfg._source = file;
  // Resoudre le chemin fichier en absolu par rapport a la racine du projet
  if (cfg.sink.file_path && !cfg.sink.file_path.startsWith('/')) {
    cfg.sink.file_path = resolve(ROOT, cfg.sink.file_path);
  }
  return cfg;
}
