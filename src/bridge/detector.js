/**
 * Detecteur de signal.
 *
 * L'indicateur Pine est verrouille : on ne lit PAS son code, on lit ce qu'il
 * DESSINE sur le graphique (labels, valeurs de plot) via CDP. On traduit ca en
 * un etat cible : LONG / SHORT / FLAT, puis on emet un signal uniquement quand
 * l'etat CHANGE (anti-doublon).
 */
import { data as coreData } from '../core/index.js';

const STATE = { LONG: 'LONG', SHORT: 'SHORT', FLAT: 'FLAT' };

function matchesAny(text, keywords) {
  const t = (text || '').toLowerCase();
  return keywords.some((k) => t.includes(String(k).toLowerCase()));
}

/** Extrait le premier nombre (prix) present dans un texte de label. */
function parsePriceFromText(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
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
  constructor(cfg, deps = {}) {
    this.cfg = cfg;
    this.data = deps.data || coreData; // injectable pour les tests
    this.ind = cfg.indicator;
    this.lastState = STATE.FLAT;
    this.lastLabelId = null;
    this.longRule = compileRule(this.ind.study_value?.long_when);
    this.shortRule = compileRule(this.ind.study_value?.short_when);
    this.flatRule = compileRule(this.ind.study_value?.flat_when);
    this.sltp = cfg.sltp || { enabled: false };
  }

  /**
   * Lit les niveaux SL et TP que l'indicateur dessine (labels "SL 24500" /
   * "TP 24600" ou lignes horizontales), et les valide par geometrie :
   *  - achat  : SL sous le prix d'entree, TP au-dessus
   *  - vente  : SL au-dessus, TP en dessous
   * Retourne des PRIX absolus, prets a etre envoyes a MT5.
   */
  async readSlTp({ isBuy, entryPrice }) {
    if (!this.sltp?.enabled) return { sl_price: 0, tp_price: 0 };
    const source = this.sltp.source || 'label';
    const cands = { sl: [], tp: [] }; // listes de prix candidats

    if (source === 'label' || source === 'auto') {
      const res = await this.data.getPineLabels({ study_filter: this.ind.study_filter, verbose: true, max_labels: 40 });
      for (const st of res?.studies || []) {
        for (const lb of st.labels || []) {
          const price = this.sltp.use_label_price !== false && lb.price != null
            ? lb.price
            : parsePriceFromText(lb.text);
          if (price == null) continue;
          if (matchesAny(lb.text, this.sltp.sl_keywords || ['sl', 'stop'])) cands.sl.push(price);
          else if (matchesAny(lb.text, this.sltp.tp_keywords || ['tp', 'target'])) cands.tp.push(price);
        }
      }
    }
    if (source === 'line' || (source === 'auto' && cands.sl.length === 0 && cands.tp.length === 0)) {
      // Sans texte : on deduit par position. Parmi les lignes horizontales,
      // celles du bon cote de l'entree deviennent SL ou TP.
      const res = await this.data.getPineLines({ study_filter: this.ind.study_filter });
      const levels = [];
      for (const st of res?.studies || []) levels.push(...(st.horizontal_levels || []));
      for (const lvl of levels) {
        if (isBuy) { (lvl < entryPrice ? cands.sl : cands.tp).push(lvl); }
        else { (lvl > entryPrice ? cands.sl : cands.tp).push(lvl); }
      }
    }

    // Garder seulement les niveaux du bon cote, puis prendre le plus PROCHE
    // de l'entree (SL le plus serre, TP1 le plus conservateur).
    const nearest = (arr, keep) => {
      const valid = arr.filter(keep);
      if (valid.length === 0) return 0;
      return valid.reduce((a, b) => (Math.abs(b - entryPrice) < Math.abs(a - entryPrice) ? b : a));
    };
    const sl_price = isBuy
      ? nearest(cands.sl, (p) => p < entryPrice)
      : nearest(cands.sl, (p) => p > entryPrice);
    const tp_price = isBuy
      ? nearest(cands.tp, (p) => p > entryPrice)
      : nearest(cands.tp, (p) => p < entryPrice);
    return { sl_price, tp_price };
  }

  /** Determine l'etat cible depuis les labels dessines par l'indicateur. */
  async readFromLabels() {
    const res = await this.data.getPineLabels({
      study_filter: this.ind.study_filter,
      verbose: true,
      max_labels: 20,
    });
    const studies = res?.studies || [];
    if (studies.length === 0) return null;

    // Classer chaque label. IMPORTANT : l'indicateur dessine aussi des labels
    // SL et TP (souvent avec un id PLUS RECENT que l'entree). On ne retient que
    // les labels qui sont de VRAIS signaux d'entree/sortie, puis on prend le
    // plus recent de CEUX-LA — sinon on confondrait le TP avec le signal.
    let newest = null;
    for (const st of studies) {
      for (const lb of st.labels || []) {
        let state = null;
        if (matchesAny(lb.text, this.ind.buy_keywords)) state = STATE.LONG;
        else if (matchesAny(lb.text, this.ind.sell_keywords)) state = STATE.SHORT;
        else if (matchesAny(lb.text, this.ind.flat_keywords)) state = STATE.FLAT;
        if (state === null) continue; // label SL/TP/autre -> ignore comme signal
        const id = Number(lb.id);
        if (newest === null || id > newest.id) {
          newest = { id, text: lb.text, price: lb.price, state };
        }
      }
    }
    if (!newest) return null;

    // Meme signal qu'au dernier tick -> rien de neuf.
    if (this.lastLabelId !== null && newest.id === this.lastLabelId) {
      return { state: this.lastState, labelId: newest.id, fresh: false, reason: newest.text };
    }
    return { state: newest.state, labelId: newest.id, fresh: true, reason: newest.text, price: newest.price };
  }

  /** Determine l'etat cible depuis une valeur numerique de la Data Window. */
  async readFromStudyValue() {
    const field = this.ind.study_value?.field;
    if (!field) return null;
    const res = await this.data.getStudyValues();
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

    // signal_mode :
    //  - 'on_new_label'   : un trade a CHAQUE nouveau label d'entree (BUY HC,
    //                       BUY, ... consecutifs = trades distincts). Ideal pour
    //                       un indicateur qui empile les setups (ex. RUGA PRO).
    //  - 'on_state_change': un trade seulement quand le SENS change (LONG<->SHORT).
    const signalMode = mode === 'study_value' ? 'on_state_change'
      : (this.ind.signal_mode || 'on_new_label');

    // Securite au demarrage : on enregistre l'etat courant SANS trader, pour ne
    // pas ouvrir une position sur le dernier signal HISTORIQUE (502 labels passes).
    if (!this.initialized) {
      this.initialized = true;
      this.lastLabelId = read.labelId ?? null;
      this.lastState = read.state;
      return null;
    }

    let emit = false;
    if (signalMode === 'on_new_label') {
      if (read.labelId != null && read.labelId !== this.lastLabelId) emit = true;
    } else if (read.state !== this.lastState) {
      emit = true;
    }

    const prev = this.lastState;
    if (read.labelId != null) this.lastLabelId = read.labelId;
    this.lastState = read.state;
    if (!emit) return null;

    // Traduire le signal en action MT5.
    let action;
    if (read.state === STATE.LONG) action = 'BUY';
    else if (read.state === STATE.SHORT) action = 'SELL';
    else action = 'CLOSE';

    let sl_price = 0;
    let tp_price = 0;
    if (action !== 'CLOSE' && this.sltp?.enabled) {
      // Prix d'entree : celui du label, sinon le prix marche courant.
      let entryPrice = read.price;
      if (entryPrice == null || entryPrice === 0) {
        try { entryPrice = (await this.data.getQuote({}))?.price ?? null; } catch { entryPrice = null; }
      }
      if (entryPrice != null) {
        try {
          const lv = await this.readSlTp({ isBuy: action === 'BUY', entryPrice });
          sl_price = lv.sl_price;
          tp_price = lv.tp_price;
        } catch { /* SL/TP optionnels : on continue sans si echec */ }
      }
    }

    return {
      action,
      from: prev,
      to: read.state,
      reason: read.reason || '',
      price: read.price ?? null,
      sl_price,
      tp_price,
    };
  }
}

export { STATE };
