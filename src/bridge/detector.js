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
    // Labels a NE JAMAIS traiter comme entree, meme s'ils contiennent buy/sell
    // (ex. "BUY LIMIT" = ordre en attente, pas une entree immediate).
    this.excludeKw = this.ind.exclude_keywords || [];
    // Confirmation : un signal doit PERSISTER ce delai (secondes) avant d'etre
    // trade. Filtre les signaux non confirmes qui repeignent/disparaissent.
    this.confirmMs = (this.ind.confirm_seconds || 0) * 1000;
    this.lastEmitted = null; // { state, price } du dernier signal envoye
    this.pending = null;     // { state, price, reason, since } en attente de confirmation
  }

  /** Deux prix sont-ils "le meme niveau" ? (tolerance 0.2%) */
  _priceClose(a, b) {
    if (a == null || b == null) return true;
    return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.002;
  }

  /** Meme signal ? (meme sens ET meme niveau de prix) */
  _sameSignal(a, b) {
    return a && b && a.state === b.state && this._priceClose(a.price, b.price);
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
        // Exclusions (ex. "BUY LIMIT") : jamais traites comme entree.
        if (this.excludeKw.length && matchesAny(lb.text, this.excludeKw)) continue;
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
    const read = mode === 'study_value' ? await this.readFromStudyValue() : await this.readFromLabels();
    if (!read || read.state == null) return null;

    const cur = { state: read.state, price: read.price ?? null, reason: read.reason || '', labelId: read.labelId ?? null };

    // Securite au demarrage : on enregistre l'etat courant SANS trader (ne pas
    // ouvrir sur le dernier signal HISTORIQUE deja affiche).
    if (!this.initialized) {
      this.initialized = true;
      this.lastEmitted = { state: cur.state, price: cur.price };
      return null;
    }

    // --- Sans confirmation : comportement immediat ---------------------------
    if (this.confirmMs <= 0) {
      if (this._sameSignal(cur, this.lastEmitted)) return null; // deja trade
      this.lastEmitted = { state: cur.state, price: cur.price };
      return await this._buildSignal(cur);
    }

    // --- Avec confirmation : le signal doit PERSISTER avant de trader --------
    if (this.pending) {
      if (this._sameSignal(cur, this.pending)) {
        // Toujours affiche -> confirme si le delai est ecoule.
        if (Date.now() - this.pending.since >= this.confirmMs) {
          const p = this.pending;
          this.pending = null;
          this.lastEmitted = { state: p.state, price: p.price };
          return await this._buildSignal(p);
        }
        return null; // encore en attente de confirmation
      }
      this.pending = null; // le signal a change/disparu -> repaint -> annule
    }

    if (this._sameSignal(cur, this.lastEmitted)) return null; // deja trade, rien de neuf
    // Nouveau candidat -> demarrer l'attente de confirmation.
    this.pending = { state: cur.state, price: cur.price, reason: cur.reason, labelId: cur.labelId, since: Date.now() };
    return null;
  }

  /** Construit l'objet signal (action + SL/TP) a partir d'un candidat. */
  async _buildSignal(sig) {
    let action;
    if (sig.state === STATE.LONG) action = 'BUY';
    else if (sig.state === STATE.SHORT) action = 'SELL';
    else action = 'CLOSE';

    let sl_price = 0, tp_price = 0, sl_dist = 0, tp_dist = 0;
    if (action !== 'CLOSE' && this.sltp?.enabled) {
      let entryPrice = sig.price;
      if (entryPrice == null || entryPrice === 0) {
        try { entryPrice = (await this.data.getQuote({}))?.price ?? null; } catch { entryPrice = null; }
      }
      if (entryPrice != null) {
        try {
          const lv = await this.readSlTp({ isBuy: action === 'BUY', entryPrice });
          sl_price = lv.sl_price;
          tp_price = lv.tp_price;
          if (sl_price > 0) sl_dist = Math.round(Math.abs(entryPrice - sl_price) * 100) / 100;
          if (tp_price > 0) tp_dist = Math.round(Math.abs(entryPrice - tp_price) * 100) / 100;
        } catch { /* SL/TP optionnels */ }
      }
    }

    return {
      action,
      from: '',
      to: sig.state,
      reason: sig.reason || '',
      price: sig.price ?? null,
      labelId: sig.labelId ?? null,
      sl_price, tp_price, sl_dist, tp_dist,
    };
  }
}

export { STATE };
