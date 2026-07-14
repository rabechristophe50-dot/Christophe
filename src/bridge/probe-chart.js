#!/usr/bin/env node
/**
 * SONDAGE du GRAPHIQUE RUGA.
 *
 *   node src/bridge/probe-chart.js
 *
 * Le message d'alerte etant introuvable via API, on lit les donnees
 * directement sur le graphique. Ce sondage montre TOUT ce que RUGA expose :
 * valeurs de plots (Entry/SL/TP ?), labels (BUY/SELL ENTRY, SL, TP), lignes.
 *
 * Copie-colle toute la sortie et envoie-la : j'en deduis quels champs lire
 * pour reconstruire sens + Entry + SL + TP de facon fiable.
 *
 * IMPORTANT : le graphique TradingView doit etre sur XAUUSD avec RUGA visible,
 * idealement juste apres un signal (pour voir un BUY/SELL ENTRY recent).
 */
import { chart, data } from '../core/index.js';

function line() { console.log('------------------------------------------------------------'); }
const cut = (s, n = 2000) => { const t = JSON.stringify(s); return t.length > n ? t.slice(0, n) + ' …(tronque)' : t; };

async function main() {
  line();
  console.log('1) ETAT DU GRAPHIQUE (symbole, TF, liste des indicateurs)');
  line();
  try {
    const st = await chart.getState();
    console.log('   symbol    :', st?.symbol, '| resolution:', st?.resolution);
    const studies = st?.studies || st?.indicators || [];
    console.log('   indicateurs:');
    for (const s of studies) console.log('     -', JSON.stringify({ id: s.id ?? s.entityId, name: s.name ?? s.title }));
  } catch (e) { console.log('   ERREUR getState:', e.message); }

  line();
  console.log('2) VALEURS DES PLOTS (data window) — Entry/SL/TP en chiffres ?');
  line();
  try {
    const sv = await data.getStudyValues();
    for (const s of sv?.studies || []) {
      console.log('   * study:', s.name);
      console.log('     values:', cut(s.values, 1200));
    }
    if (!(sv?.studies || []).length) console.log('   (aucune valeur — RUGA visible sur le chart ?)');
  } catch (e) { console.log('   ERREUR getStudyValues:', e.message); }

  line();
  console.log('3) LABELS RUGA (texte + prix) — c\'est ici qu\'on lit BUY/SELL ENTRY, SL, TP');
  line();
  try {
    const lb = await data.getPineLabels({ verbose: true, max_labels: 60 });
    for (const s of lb?.studies || []) {
      console.log('   * study:', s.name, ' — ', (s.labels || []).length, 'labels');
      for (const l of (s.labels || []).slice(0, 40)) {
        console.log('       ', JSON.stringify({ id: l.id, text: l.text, price: l.price, y: l.y }));
      }
    }
    if (!(lb?.studies || []).length) console.log('   (aucun label — RUGA visible ?)');
  } catch (e) { console.log('   ERREUR getPineLabels:', e.message); }

  line();
  console.log('4) LIGNES HORIZONTALES RUGA (niveaux)');
  line();
  try {
    const ln = await data.getPineLines({ verbose: true });
    for (const s of ln?.studies || []) {
      console.log('   * study:', s.name);
      console.log('     levels:', cut(s.horizontal_levels || s.levels || s.lines, 1200));
    }
    if (!(ln?.studies || []).length) console.log('   (aucune ligne)');
  } catch (e) { console.log('   ERREUR getPineLines:', e.message); }

  line();
  console.log('5) BOITES / ZONES RUGA');
  line();
  try {
    const bx = await data.getPineBoxes({});
    for (const s of bx?.studies || []) console.log('   * study:', s.name, '=>', cut(s.boxes, 800));
    if (!(bx?.studies || []).length) console.log('   (aucune boite)');
  } catch (e) { console.log('   ERREUR getPineBoxes:', e.message); }

  line();
  console.log('FIN — copie toute cette sortie et envoie-la moi.');
  line();
  process.exit(0);
}

main().catch((e) => { console.error('Erreur fatale:', e); process.exit(1); });
