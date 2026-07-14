/**
 * Detecteur de signal.
 *
 * L'indicateur Pine est verrouille : on ne lit PAS son code, on lit ce qu'il
 * DESSINE sur le graphique (labels, valeurs de plot) via CDP. On traduit ca en
 * un etat cible : LONG / SHORT / FLAT, puis on emet un signal uniquement quand
 * l'etat CHANGE (anti-doublon).
 */
import { data as coreData, alerts as coreAlerts } from '../core/index.js';

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
    this.alerts = deps.alerts || coreAlerts;
    this.fireTimes = {};     // (mode alert) alert_id -> derniere heure de declenchement
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
    this.lastDir = null;     // (mode study_value) dernier sens trade
    this.seenIds = new Set();// ids des labels DEJA affiches (baseline) ou deja tradus
    this.seenSig = new Set();// (mode alert) ids des ENTREES RUGA deja connues/tradees
    this.lastKey = null;     // "sens@prix-arrondi" du dernier signal envoye (anti-doublon)
    this.status = 'demarrage...'; // etat lisible pour le suivi en direct
  }

  /**
   * Lit les signaux RUGA GROUPES depuis le graphique.
   * RUGA dessine chaque signal en 3 labels d'id consecutifs :
   *   id   = "BUY ENTRY" / "SELL ENTRY" (+ variantes "(HIGH CONF)")
   *   id+1 = "SL"
   *   id+2 = "TP 1"
   * On reconstruit {id, state, entry, sl, tp} et on valide la geometrie
   * (achat : SL<entree<TP ; vente : SL>entree>TP). Source 100% fiable.
   */
  async _readGroupedSignals() {
    const res = await this.data.getPineLabels({ study_filter: this.ind.study_filter, verbose: true, max_labels: 60 });
    const labels = [];
    for (const st of res?.studies || []) {
      for (const lb of st.labels || []) {
        if (lb.price == null) continue;
        labels.push({ id: Number(lb.id), text: String(lb.text || ''), price: lb.price });
      }
    }
    const byId = new Map(labels.map((l) => [l.id, l]));
    // Trouve, apres une entree, le 1er label SL puis TP dans les id qui suivent.
    const findAfter = (entryId, kw) => {
      for (let d = 1; d <= 3; d++) {
        const l = byId.get(entryId + d);
        if (l && matchesAny(l.text, kw)) return l.price;
      }
      return 0;
    };
    const out = [];
    for (const l of labels) {
      const t = l.text.toLowerCase();
      if (!t.includes('entry') && !t.includes('entr')) continue; // doit etre une ENTREE
      if (this.excludeKw.length && matchesAny(l.text, this.excludeKw)) continue; // ex. LIMIT
      let state = null;
      if (matchesAny(l.text, this.ind.buy_keywords)) state = STATE.LONG;
      else if (matchesAny(l.text, this.ind.sell_keywords)) state = STATE.SHORT;
      if (state == null) continue;
      const sl = findAfter(l.id, this.sltp?.sl_keywords || ['sl', 'stop']);
      const tp = findAfter(l.id, this.sltp?.tp_keywords || ['tp', 'target']);
      // Validation geometrique : evite un mauvais appariement SL/TP.
      const okGeom = state === STATE.LONG
        ? (sl > 0 && tp > 0 && sl < l.price && tp > l.price)
        : (sl > 0 && tp > 0 && sl > l.price && tp < l.price);
      out.push({ id: l.id, state, entry: l.price, sl, tp, text: l.text, okGeom });
    }
    return out;
  }

  /**
   * Signal RUGA le plus RECENT et NOUVEAU (id jamais vu), avec SL/TP valides.
   * Reessaie quelques fois : RUGA met un court instant a dessiner les labels.
   */
  async _newestChartSignal() {
    const tries = Math.max(1, this.sltp?.read_tries || 3);
    for (let i = 0; i < tries; i++) {
      let sigs = [];
      try { sigs = await this._readGroupedSignals(); } catch { sigs = []; }
      const fresh = sigs.filter((s) => !this.seenSig.has(s.id) && s.okGeom);
      if (fresh.length) {
        fresh.sort((a, b) => b.id - a.id); // le plus recent = id le plus grand
        for (const s of fresh) this.seenSig.add(s.id); // ne pas re-trader les autres
        return fresh[0];
      }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  }

  /** Enregistre TOUS les signaux d'entree actuels comme "deja connus" (baseline). */
  async _populateSeen() {
    try {
      const res = await this.data.getPineLabels({ study_filter: this.ind.study_filter, verbose: false, max_labels: 60 });
      for (const st of res?.studies || []) {
        for (const lb of st.labels || []) {
          if (lb.price == null) continue;
          if (this.excludeKw.length && matchesAny(lb.text, this.excludeKw)) continue;
          let state = null;
          if (matchesAny(lb.text, this.ind.buy_keywords)) state = STATE.LONG;
          else if (matchesAny(lb.text, this.ind.sell_keywords)) state = STATE.SHORT;
          else if (matchesAny(lb.text, this.ind.flat_keywords)) state = STATE.FLAT;
          if (state === null) continue;
          this.seen.push({ state, price: lb.price });
        }
      }
    } catch { /* ignore */ }
  }

  /** Ce signal est-il deja connu (existant au demarrage ou deja trade) ? */
  _isKnown(sig) {
    return this.seen.some((s) => this._sameSignal(s, sig));
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

  /** Determine le signal actif depuis les labels dessines par l'indicateur. */
  async readFromLabels() {
    const res = await this.data.getPineLabels({
      study_filter: this.ind.study_filter,
      verbose: true,
      max_labels: 60,
    });
    const studies = res?.studies || [];
    if (studies.length === 0) return null;

    // Prix marche courant : le signal ACTIF de l'indicateur est celui dessine
    // le plus PRES du prix actuel (les autres labels sont d'anciens signaux).
    let curPrice = null;
    try { curPrice = (await this.data.getQuote({}))?.price ?? null; } catch { curPrice = null; }

    // On ne retient que les VRAIS labels d'entree (buy/sell/flat, hors exclus),
    // puis on garde celui le plus proche du prix (ou le plus grand id si pas de prix).
    let best = null;
    for (const st of studies) {
      for (const lb of st.labels || []) {
        if (this.excludeKw.length && matchesAny(lb.text, this.excludeKw)) continue;
        let state = null;
        if (matchesAny(lb.text, this.ind.buy_keywords)) state = STATE.LONG;
        else if (matchesAny(lb.text, this.ind.sell_keywords)) state = STATE.SHORT;
        else if (matchesAny(lb.text, this.ind.flat_keywords)) state = STATE.FLAT;
        if (state === null) continue; // label SL/TP/autre -> pas un signal
        const id = Number(lb.id);
        const dist = (curPrice != null && lb.price != null) ? Math.abs(lb.price - curPrice) : null;
        if (best === null
          || (dist != null && best.dist != null && dist < best.dist)
          || (dist == null && best.dist == null && id > best.id)) {
          best = { id, text: lb.text, price: lb.price, state, dist };
        }
      }
    }
    if (!best) return null;
    return { state: best.state, labelId: best.id, reason: best.text, price: best.price };
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
  /** Retourne TOUS les labels d'entree actuels (avec leur id). */
  async readAllEntries() {
    const res = await this.data.getPineLabels({ study_filter: this.ind.study_filter, verbose: true, max_labels: 60 });
    const out = [];
    for (const st of res?.studies || []) {
      for (const lb of st.labels || []) {
        if (lb.price == null) continue;
        if (this.excludeKw.length && matchesAny(lb.text, this.excludeKw)) continue;
        let state = null;
        if (matchesAny(lb.text, this.ind.buy_keywords)) state = STATE.LONG;
        else if (matchesAny(lb.text, this.ind.sell_keywords)) state = STATE.SHORT;
        else if (matchesAny(lb.text, this.ind.flat_keywords)) state = STATE.FLAT;
        if (state === null) continue;
        out.push({ id: Number(lb.id), state, price: lb.price, reason: lb.text });
      }
    }
    return out;
  }

  async poll() {
    if ((this.ind.mode || 'label') === 'alert') return this._pollAlerts();
    if ((this.ind.mode || 'label') === 'study_value') return this._pollStudyValue();

    const entries = await this.readAllEntries();
    if (entries.length === 0) { this.status = 'aucun signal RUGA lu (TV connecte ? indicateur visible ?)'; return null; }

    // Prix courant (pour ne garder que les signaux proches = vraiment actifs).
    let curPrice = null;
    try { curPrice = (await this.data.getQuote({}))?.price ?? null; } catch { curPrice = null; }
    const maxPct = this.ind.max_entry_pct > 0 ? this.ind.max_entry_pct : 0.5;

    // DEMARRAGE : on enregistre TOUS les labels deja affiches -> on ne les trade pas.
    if (!this.initialized) {
      this.initialized = true;
      for (const e of entries) this.seenIds.add(e.id);
      this.status = `demarrage : ${entries.length} signaux deja affiches ignores, en attente d'un NOUVEAU`;
      return null;
    }

    // NOUVEAUX labels (id jamais vu) ET proches du prix actuel.
    const fresh = entries.filter((e) => {
      if (this.seenIds.has(e.id)) return false;
      if (curPrice != null && Math.abs(e.price - curPrice) / curPrice * 100 > maxPct) return false;
      return true;
    });

    if (fresh.length === 0) {
      // memoriser les nouveaux labels LOINTAINS pour ne pas les trader plus tard.
      for (const e of entries) if (!this.seenIds.has(e.id) && curPrice != null
        && Math.abs(e.price - curPrice) / curPrice * 100 > maxPct) this.seenIds.add(e.id);
      this.status = `aucun nouveau signal proche du prix (en attente)`;
      return null;
    }

    // On prend le plus proche du prix. Les autres nouveaux seront pris aux polls suivants.
    fresh.sort((a, b) => Math.abs(a.price - (curPrice ?? a.price)) - Math.abs(b.price - (curPrice ?? b.price)));
    const pick = fresh[0];
    const dir = pick.state === STATE.LONG ? 'BUY' : pick.state === STATE.SHORT ? 'SELL' : 'FLAT';
    const key = `${pick.state}@${Math.round(pick.price)}`;

    this.seenIds.add(pick.id);
    if (key === this.lastKey) { // anti-doublon si l'indicateur reattribue les ids
      this.status = `signal ${dir} @${pick.price} deja pris (id renouvele)`;
      return null;
    }
    this.lastKey = key;
    this.status = `>>> NOUVEAU SIGNAL ${dir} @${pick.price} (id ${pick.id}) -> envoye a MT5`;
    return await this._buildSignal(pick);
  }

  /**
   * Mode ALERTE (le plus fiable) : on surveille les alertes RUGA et on trade
   * quand une alerte se DECLENCHE (last_fire_time change). Le sens vient du
   * message de l'alerte (contient "buy" ou "sell").
   */
  async _pollAlerts() {
    let list;
    try { list = (await this.alerts.list())?.alerts || []; }
    catch (e) { this.status = 'lecture des alertes impossible (TV connecte ?)'; return null; }

    const fireNum = (v) => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      const n = Date.parse(v);
      return Number.isNaN(n) ? Number(v) || 0 : n;
    };
    // Une alerte est retenue si elle est sur le bon SYMBOLE (ex. XAUUSD). Si
    // aucun symbole n'est impose (guard vide), on retombe sur les mots-cles.
    // IMPORTANT : quand un symbole est impose, il est OBLIGATOIRE -> on ne
    // tradera JAMAIS une alerte d'un autre symbole (evite un trade sur le
    // mauvais instrument).
    const kws = [...(this.ind.buy_keywords || []), ...(this.ind.sell_keywords || []), 'signal', 'alert', this.ind.study_filter || ''].filter(Boolean);
    const cleanSym = (s) => { const x = String(s || ''); return (x.includes(':') ? x.split(':').pop() : x).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    const symWanted = (this.cfg.guard?.symbol || '').toUpperCase();
    const isSignalAlert = (a) => {
      if (symWanted) return cleanSym(a.symbol).includes(symWanted);
      const txt = `${a.message || ''} ${a.condition || ''}`;
      return kws.some((k) => matchesAny(txt, [k]));
    };
    const relevant = list.filter((a) => a.active !== false && isSignalAlert(a));

    if (!this.initialized) {
      this.initialized = true;
      for (const a of relevant) this.fireTimes[a.alert_id] = fireNum(a.last_fired);
      // Baseline : memoriser les signaux RUGA DEJA affiches -> on ne les trade pas.
      try { for (const s of await this._readGroupedSignals()) this.seenSig.add(s.id); } catch { /* ignore */ }
      this.status = `demarrage : ${relevant.length} alertes surveillees, ${this.seenSig.size} signaux deja affiches ignores, en attente d'un declenchement`;
      return null;
    }

    // Chercher une alerte qui vient de se declencher (heure de fire plus recente).
    let fired = null;
    for (const a of relevant) {
      const prev = this.fireTimes[a.alert_id] ?? 0;
      const now = fireNum(a.last_fired);
      if (now > prev) { this.fireTimes[a.alert_id] = now; fired = a; }
    }

    if (!fired) { this.status = `${relevant.length} alertes surveillees (aucun declenchement)`; return null; }

    // DIAGNOSTIC : afficher le message BRUT lu, pour verifier la coherence avec MT5.
    const rawMsg = fired.message || '';
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`[${stamp}] ALERTE DECLENCHEE. Message brut lu par le pont:`);
    console.log(rawMsg.trim() ? `----\n${rawMsg.trim()}\n----` : '----\n(MESSAGE VIDE — le pont va lire le graphique en secours)\n----');

    // On decode le MESSAGE de l'alerte : sens + SL + TP + entree (en chiffres).
    const parsed = this._parseAlertMessage(rawMsg);
    console.log(`[${stamp}] Decode: sens=${parsed.state || '(aucun)'} entry=${parsed.entry || '-'} SL=${parsed.sl || '-'} TP=${parsed.tp || '-'}`);
    if (!parsed.state) console.log(`[${stamp}] ATTENTION: aucun BUY/SELL trouve dans le message -> secours graphique (risque d'inversion).`);

    // Ne trader QUE les vrais messages d'ENTREE. La condition "Tout appel de la
    // fonction alerte()" fait tirer CHAQUE alert() de RUGA (TP HIT, SL HIT, EXIT,
    // LIMIT...). On ignore tout ce qui n'est pas une entree pour eviter les faux
    // trades (ex. "BUY TP1 HIT" contient "buy" mais n'est PAS une entree).
    if (rawMsg.trim()) {
      if (this.excludeKw.length && matchesAny(rawMsg, this.excludeKw)) {
        this.status = `alerte IGNOREE : ordre en attente/exclu (mot: ${this.excludeKw.join(',')})`;
        return null;
      }
      const entryKw = this.ind.entry_keywords || ['entry', 'entrée', 'entree'];
      if (!matchesAny(rawMsg, entryKw)) {
        this.status = `alerte IGNOREE : pas un signal d'ENTREE (sortie / TP-SL hit / notif ?)`;
        return null;
      }
    }
    // 1) On tente le MESSAGE (souvent VIDE pour "Tout appel de la fonction alerte()").
    let state = parsed.state;
    let price = parsed.entry || null;
    let sl = parsed.sl || 0;
    let tp = parsed.tp || 0;
    let reason = rawMsg.trim() || fired.condition || 'alerte';

    // 2) Message incomplet -> on lit le GRAPHIQUE : signal RUGA le plus RECENT et
    //    NOUVEAU (labels groupes ENTRY/SL/TP par id consecutifs). Source fiable.
    if (!(state && price && sl > 0 && tp > 0)) {
      const g = await this._newestChartSignal();
      if (g) {
        state = g.state; price = g.entry; sl = g.sl; tp = g.tp;
        reason = `${g.text} @${g.entry}`;
        const gd = g.state === STATE.LONG ? 'BUY' : 'SELL';
        console.log(`[${stamp}] Graphique: ${gd} entry=${g.entry} SL=${g.sl} TP=${g.tp} (id ${g.id})`);
      } else {
        this.status = `alerte declenchee mais aucun NOUVEAU signal RUGA sur le graphique (TF affiche ? deja trade ?)`;
        return null;
      }
    }

    if (state == null) { this.status = 'alerte declenchee mais sens indetermine'; return null; }

    const dir = state === STATE.LONG ? 'BUY' : 'SELL';
    const signal = await this._buildSignal({ state, price, reason, sl_price: sl, tp_price: tp });
    // Le trade doit partir sur le symbole de L'ALERTE, pas du graphique affiche.
    signal.symbol = cleanSym(fired.symbol) || null;

    // Securite : ne PAS ouvrir une position nue. Si le SL/TP est introuvable
    // (signal non confirme / repaint), on ignore ce declenchement.
    if (this.sltp?.enabled && this.sltp?.require !== false && (!signal.sl_price || !signal.tp_price)) {
      this.status = `alerte ${dir} IGNOREE : SL/TP introuvable (signal non confirme ?) - pas de position nue`;
      return null;
    }

    this.status = `>>> ALERTE ${dir} declenchee (SL=${signal.sl_price} TP=${signal.tp_price}) -> envoye a MT5`;
    return signal;
  }

  /**
   * Entree RUGA la plus proche du prix. Si preferredState est donne, on ne
   * garde que les entrees de ce sens (ex. l'alerte dit BUY -> on prend le
   * "BUY ENTRY", pas un "SELL ENTRY" qui serait plus proche).
   */
  async _nearestChartSignal(preferredState = null) {
    let entries = [];
    try { entries = await this.readAllEntries(); } catch { return null; }
    if (!entries.length) return null;
    let curPrice = null;
    try { curPrice = (await this.data.getQuote({}))?.price ?? null; } catch { curPrice = null; }

    const pick = (list) => {
      let best = null;
      for (const e of list) {
        const dist = (curPrice != null && e.price != null) ? Math.abs(e.price - curPrice) : Infinity;
        if (best === null || dist < best.dist) best = { dist, state: e.state, price: e.price, reason: e.reason };
      }
      return best;
    };

    let best = null;
    if (preferredState != null) best = pick(entries.filter((e) => e.state === preferredState));
    if (!best) best = pick(entries); // aucun du bon sens -> le plus proche tout court
    return best ? { state: best.state, price: best.price, reason: best.reason } : null;
  }

  /** Mode study_value : on trade au changement de sens. */
  async _pollStudyValue() {
    const read = await this.readFromStudyValue();
    if (!read || read.state == null) { this.status = 'aucune valeur lue'; return null; }
    const dir = read.state === STATE.LONG ? 'BUY' : read.state === STATE.SHORT ? 'SELL' : 'FLAT';
    if (!this.initialized) { this.initialized = true; this.lastDir = read.state; this.status = `demarrage : sens ${dir}`; return null; }
    if (read.state === this.lastDir) { this.status = `sens ${dir} (inchange)`; return null; }
    this.lastDir = read.state;
    this.status = `>>> CHANGEMENT DE SENS -> ${dir}`;
    return await this._buildSignal({ state: read.state, price: read.price ?? null, reason: read.reason });
  }

  /** Decode un message d'alerte : { state, entry, sl, tp } (chiffres). */
  _parseAlertMessage(msg) {
    const t = String(msg || '');
    const low = t.toLowerCase();
    let state = null;
    const hasBuy = (this.ind.buy_keywords || []).some((k) => low.includes(String(k).toLowerCase()));
    const hasSell = (this.ind.sell_keywords || []).some((k) => low.includes(String(k).toLowerCase()));
    if (hasBuy && !hasSell) state = STATE.LONG;
    else if (hasSell && !hasBuy) state = STATE.SHORT;
    const grab = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : 0; };
    const sl = grab(/\bs\.?\s*l\.?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i) || grab(/\bstop\s*(?:loss)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
    const tp = grab(/\bt\.?\s*p\.?\s*1?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i) || grab(/\btarget\s*1?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
    const entry = grab(/\bentr[yeé]e?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i) || grab(/\bentry\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
    return { state, entry, sl, tp };
  }

  /** Construit l'objet signal (action + SL/TP) a partir d'un candidat. */
  async _buildSignal(sig) {
    let action;
    if (sig.state === STATE.LONG) action = 'BUY';
    else if (sig.state === STATE.SHORT) action = 'SELL';
    else action = 'CLOSE';

    let sl_price = 0, tp_price = 0, sl_dist = 0, tp_dist = 0;
    // Si le SL/TP est deja fourni (depuis le message d'alerte) -> on l'utilise.
    if (action !== 'CLOSE' && (sig.sl_price > 0 || sig.tp_price > 0)) {
      sl_price = sig.sl_price || 0;
      tp_price = sig.tp_price || 0;
      const ep = sig.price;
      if (ep != null) {
        if (sl_price > 0) sl_dist = Math.round(Math.abs(ep - sl_price) * 100) / 100;
        if (tp_price > 0) tp_dist = Math.round(Math.abs(ep - tp_price) * 100) / 100;
      }
    } else if (action !== 'CLOSE' && this.sltp?.enabled) {
      let entryPrice = sig.price;
      if (entryPrice == null || entryPrice === 0) {
        try { entryPrice = (await this.data.getQuote({}))?.price ?? null; } catch { entryPrice = null; }
      }
      if (entryPrice != null) {
        // On reessaie quelques fois : au moment du signal, RUGA peut mettre un
        // court instant a dessiner le SL/TP.
        const tries = Math.max(1, this.sltp?.read_tries || 3);
        for (let i = 0; i < tries; i++) {
          try {
            const lv = await this.readSlTp({ isBuy: action === 'BUY', entryPrice });
            sl_price = lv.sl_price;
            tp_price = lv.tp_price;
          } catch { /* on reessaie */ }
          if (sl_price > 0 && tp_price > 0) break;
          if (i < tries - 1) await new Promise((r) => setTimeout(r, 600));
        }
        if (sl_price > 0) sl_dist = Math.round(Math.abs(entryPrice - sl_price) * 100) / 100;
        if (tp_price > 0) tp_dist = Math.round(Math.abs(entryPrice - tp_price) * 100) / 100;
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
