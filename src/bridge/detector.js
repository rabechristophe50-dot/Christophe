/**
 * Detecteur de signal.
 *
 * L'indicateur Pine est verrouille : on ne lit PAS son code, on lit ce qu'il
 * DESSINE sur le graphique (labels, valeurs de plot) via CDP. On traduit ca en
 * un etat cible : LONG / SHORT / FLAT, puis on emet un signal uniquement quand
 * l'etat CHANGE (anti-doublon).
 */
import { data } from '../core/index.js';

const STATE = { LONG: 'LONG', SHORT: 'SHORT', FLAT: 'FLAT' };

function matchesAny(text, keywords) {
  const t = (text || '').toLowerCase();
  return keywords.some((k) => t.includes(String(k).toLowerCase()));
}

/** Parse une regle du type "> 0", "<= -1.5", "== 0" en fonction testable. */
function compileRule(rule) {
  if (!rule || typeof rule !== 'string') return () => false;
  const m = rule.trim().match(/^(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return () => false;
  const op = m[1];
  const n = parseFloat(m[2]);
  return (x) => {
    switch (op) {
      case '>': return x > n;
      case '<': return x < n;
      case '>=': return x >= n;
      case '<=': return x <= n;
      case '==': return x === n;
      case '!=': return x !== n;
      default: return false;
    }
  };
}

export class SignalDetector {
  constructor(cfg) {
    this.cfg = cfg;
    this.ind = cfg.indicator;
    this.lastState = STATE.FLAT;
    this.lastLabelId = null;
    this.longRule = compileRule(this.ind.study_value?.long_when);
    this.shortRule = compileRule(this.ind.study_value?.short_when);
    this.flatRule = compileRule(this.ind.study_value?.flat_when);
  }

  /** Determine l'etat cible depuis les labels dessines par l'indicateur. */
  async readFromLabels() {
    const res = await data.getPineLabels({
      study_filter: this.ind.study_filter,
      verbose: true,
      max_labels: 20,
    });
    const studies = res?.studies || [];
    if (studies.length === 0) return null;

    // Prendre le label le plus recent (id le plus eleve) parmi toutes les etudes ciblees.
    let newest = null;
    for (const st of studies) {
      for (const lb of st.labels || []) {
        const id = Number(lb.id);
        if (newest === null || id > newest.id) {
          newest = { id, text: lb.text, price: lb.price };
        }
      }
    }
    if (!newest) return null;

    // Meme label qu'au dernier tick -> rien de neuf.
    if (this.lastLabelId !== null && newest.id === this.lastLabelId) {
      return { state: this.lastState, labelId: newest.id, fresh: false, reason: newest.text };
    }

    let state = null;
    if (matchesAny(newest.text, this.ind.buy_keywords)) state = STATE.LONG;
    else if (matchesAny(newest.text, this.ind.sell_keywords)) state = STATE.SHORT;
    else if (matchesAny(newest.text, this.ind.flat_keywords)) state = STATE.FLAT;

    if (state === null) {
      // Nouveau label mais pas un signal reconnu -> on memorise l'id sans changer l'etat.
      return { state: this.lastState, labelId: newest.id, fresh: false, reason: newest.text };
    }
    return { state, labelId: newest.id, fresh: true, reason: newest.text, price: newest.price };
  }

  /** Determine l'etat cible depuis une valeur numerique de la Data Window. */
  async readFromStudyValue() {
    const field = this.ind.study_value?.field;
    if (!field) return null;
    const res = await data.getStudyValues();
    const studies = res?.studies || [];
    const filter = (this.ind.study_filter || '').toLowerCase();

    let value = null;
    let name = null;
    for (const st of studies) {
      if (filter && !(st.name || '').toLowerCase().includes(filter)) continue;
      const v = st.values?.[field];
      if (v != null) {
        const num = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
        if (!Number.isNaN(num)) { value = num; name = st.name; break; }
      }
    }
    if (value === null) return null;

    let state = this.lastState;
    if (this.longRule(value)) state = STATE.LONG;
    else if (this.shortRule(value)) state = STATE.SHORT;
    else if (this.flatRule(value)) state = STATE.FLAT;

    return { state, labelId: null, fresh: state !== this.lastState, reason: `${name} ${field}=${value}` };
  }

  /**
   * Poll une fois. Retourne un objet signal SEULEMENT quand l'etat change,
   * sinon null.
   */
  async poll() {
    const mode = this.ind.mode || 'label';
    let read = null;
    if (mode === 'study_value') read = await this.readFromStudyValue();
    else read = await this.readFromLabels();

    if (!read) return null;
    if (read.labelId != null) this.lastLabelId = read.labelId;

    if (read.state === this.lastState) return null; // pas de changement d'etat

    const prev = this.lastState;
    this.lastState = read.state;

    // Traduire la transition d'etat en action MT5.
    let action;
    if (read.state === STATE.LONG) action = 'BUY';
    else if (read.state === STATE.SHORT) action = 'SELL';
    else action = 'CLOSE';

    return {
      action,
      from: prev,
      to: read.state,
      reason: read.reason || '',
      price: read.price ?? null,
    };
  }
}

export { STATE };
