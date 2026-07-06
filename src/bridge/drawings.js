/**
 * Miroir visuel : lit ce que l'indicateur DESSINE et le formate pour l'EA MT5.
 *
 * Format de sortie (facile a parser en MQL5) :
 *   L|4150.43            -> ligne horizontale a ce prix
 *   T|4126.42|BUY HC     -> texte "BUY HC" a ce prix
 *   B|4155.0|4148.0      -> boite (Order Block) entre high et low
 *
 * Deux modes :
 *   - 'active' (defaut) : uniquement le DERNIER signal d'entree + son SL + son TP
 *     (on n'affiche pas les vieux signaux deja tradus).
 *   - 'all' : toutes les lignes + labels recents.
 */
import { data as coreData } from '../core/index.js';

function matchesAny(text, keywords) {
  const t = (text || '').toLowerCase();
  return (keywords || []).some((k) => t.includes(String(k).toLowerCase()));
}

function sanitize(text) {
  return String(text || '').trim().replace(/[|\r\n]+/g, ' ');
}

/** Parmi des prix candidats, celui le plus proche de l'entree du bon cote. */
function nearest(prices, entry, keep) {
  const valid = prices.filter(keep);
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => (Math.abs(b - entry) < Math.abs(a - entry) ? b : a));
}

export async function collectDrawings(opts = {}, deps = {}) {
  const data = deps.data || coreData;
  const {
    study_filter,
    max_labels = 60,
    mode = 'active',
    buy_keywords = ['buy'],
    sell_keywords = ['sell'],
    exclude_keywords = ['limit'],
    sl_keywords = ['sl'],
    tp_keywords = ['tp'],
    show_boxes = true,
    max_boxes = 4,
  } = opts;

  if (mode === 'active') return collectActive();
  return collectAll();

  // Lit les boites (Order Blocks) et garde les 'limit' plus proches d'un prix.
  async function readBoxes(reference, limit) {
    if (!show_boxes) return [];
    try {
      const res = await data.getPineBoxes({ study_filter });
      const zones = [];
      for (const st of res?.studies || []) for (const z of st.zones || []) {
        if (z.high != null && z.low != null) zones.push(z);
      }
      if (reference != null && zones.length > limit) {
        const mid = (z) => (z.high + z.low) / 2;
        zones.sort((a, b) => Math.abs(mid(a) - reference) - Math.abs(mid(b) - reference));
        return zones.slice(0, limit);
      }
      return zones.slice(0, limit);
    } catch { return []; }
  }

  // --- Mode 'active' : dernier signal d'entree + son SL + son TP -----------
  async function collectActive() {
    const res = await data.getPineLabels({ study_filter, verbose: true, max_labels: 80 });
    const all = [];
    for (const st of res?.studies || []) for (const lb of st.labels || []) {
      if (lb.price == null) continue;
      all.push({ id: Number(lb.id), text: sanitize(lb.text), price: lb.price });
    }
    if (all.length === 0) return '';

    // Derniere entree (id le plus eleve), hors LIMIT.
    let entry = null;
    for (const lb of all) {
      if (matchesAny(lb.text, exclude_keywords)) continue;
      const isBuy = matchesAny(lb.text, buy_keywords);
      const isSell = matchesAny(lb.text, sell_keywords);
      if (!isBuy && !isSell) continue;
      if (entry === null || lb.id > entry.id) entry = { ...lb, isBuy };
    }
    if (!entry) return '';

    // SL / TP les plus proches de l'entree, du bon cote.
    const sls = all.filter((l) => matchesAny(l.text, sl_keywords)).map((l) => l.price);
    const tps = all.filter((l) => matchesAny(l.text, tp_keywords)).map((l) => l.price);
    const sl = entry.isBuy
      ? nearest(sls, entry.price, (p) => p < entry.price)
      : nearest(sls, entry.price, (p) => p > entry.price);
    const tp = entry.isBuy
      ? nearest(tps, entry.price, (p) => p > entry.price)
      : nearest(tps, entry.price, (p) => p < entry.price);

    const out = [`T|${entry.price}|${entry.text}`];
    if (sl > 0) { out.push(`L|${sl}`); out.push(`T|${sl}|SL`); }
    if (tp > 0) { out.push(`L|${tp}`); out.push(`T|${tp}|TP`); }
    // Order Blocks les plus proches de l'entree.
    for (const z of await readBoxes(entry.price, max_boxes)) out.push(`B|${z.high}|${z.low}`);
    return out.join('\n');
  }

  // --- Mode 'all' : toutes les lignes + labels recents ---------------------
  async function collectAll() {
    const out = [];
    try {
      const res = await data.getPineLabels({ study_filter, verbose: false, max_labels });
      for (const st of res?.studies || []) for (const lb of st.labels || []) {
        if (lb.price == null) continue;
        const text = sanitize(lb.text);
        if (text) out.push(`T|${lb.price}|${text}`);
      }
    } catch { /* pas de labels */ }
    try {
      const res = await data.getPineLines({ study_filter });
      for (const st of res?.studies || []) for (const lvl of st.horizontal_levels || []) {
        if (lvl != null) out.push(`L|${lvl}`);
      }
    } catch { /* pas de lignes */ }
    for (const z of await readBoxes(null, max_boxes)) out.push(`B|${z.high}|${z.low}`);
    return out.join('\n');
  }
}
