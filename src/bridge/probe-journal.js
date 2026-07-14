#!/usr/bin/env node
/**
 * SONDAGE du JOURNAL des alertes (pour lire le VRAI message texte, sans VPS).
 *
 *   node src/bridge/probe-journal.js
 *
 * Le message du tir (« RUGA PRO OLD: BUY ENTRY / SL / TP ») est VIDE dans
 * l'API mais VISIBLE dans le journal. Ce sondage cherche ce texte a 2 endroits :
 *   A) objets internes de TradingView (window.TradingViewApi / window.TradingView)
 *   B) le texte affiche dans la page (DOM du panneau Journal)
 *
 * IMPORTANT : ouvre d'abord dans TradingView le panneau ALERTES -> onglet
 * JOURNAL (la liste des alertes DECLENCHEES), pour que le texte soit charge.
 *
 * Copie-colle toute la sortie et envoie-la moi.
 */
import { evaluateAsync } from '../connection.js';

function line() { console.log('------------------------------------------------------------'); }

async function main() {
  line();
  console.log('A) OBJETS INTERNES (window.TradingViewApi / window.TradingView)');
  line();
  try {
    const info = await evaluateAsync(`(async function(){
      var out = { roots: [], hits: [] };
      function names(o){ try { return Object.keys(o||{}); } catch(e){ return []; } }
      var roots = {
        'TradingViewApi': window.TradingViewApi,
        'TradingView': window.TradingView
      };
      for (var rn in roots){
        var r = roots[rn]; if(!r) continue;
        var ks = names(r).filter(function(k){ return /alert|notif|log|fire|event|journal|hist/i.test(k); });
        out.roots.push({ root: rn, keys: ks.slice(0, 40) });
      }
      // Recherche large : toute propriete (profondeur 2) qui expose un tableau
      // d'objets contenant un champ ressemblant a un message.
      var budget = { n: 800 };
      function scan(obj, path, depth){
        if(!obj || budget.n<=0 || depth>2) return; budget.n--;
        var arr = null;
        try {
          if(Array.isArray(obj)) arr = obj;
          else if(typeof obj.value==='function'){ var v=obj.value(); if(Array.isArray(v)) arr=v; }
        } catch(e){}
        if(arr && arr.length && typeof arr[0]==='object' && arr[0]){
          var f = Object.keys(arr[0]);
          if(f.some(function(x){ return /message|desc|text|body|fire/i.test(x); })){
            out.hits.push({ path: path, len: arr.length, fields: f.slice(0,14), sample: JSON.stringify(arr[0]).slice(0,240) });
          }
        }
        if(depth<2){
          var ks = names(obj);
          for(var i=0;i<ks.length && budget.n>0;i++){
            try { scan(obj[ks[i]], path+'.'+ks[i], depth+1); } catch(e){}
          }
        }
      }
      for (var rn2 in roots){ if(roots[rn2]) scan(roots[rn2], 'window.'+rn2, 0); }
      return out;
    })()`);
    for (const r of info?.roots || []) console.log('   ', r.root, '=>', JSON.stringify(r.keys));
    console.log('   collections avec message/fire :');
    for (const h of info?.hits || []) {
      console.log('     * path  :', h.path, '(', h.len, 'elts )');
      console.log('       champs:', JSON.stringify(h.fields));
      console.log('       ex    :', h.sample);
    }
    if (!(info?.hits || []).length) console.log('     (rien trouve cote objets)');
  } catch (e) { console.log('   ERREUR objets:', e.message); }

  line();
  console.log('B) TEXTE AFFICHE (DOM) — on cherche les blocs contenant ENTRY + SL + TP');
  line();
  try {
    const dom = await evaluateAsync(`(async function(){
      var out = [];
      var all = document.querySelectorAll('div,li,td,span,p');
      var seen = 0;
      for (var i=0; i<all.length && out.length<6; i++){
        var el = all[i];
        var txt = (el.innerText || el.textContent || '').trim();
        if(!txt || txt.length>400) continue;
        var up = txt.toUpperCase();
        // On veut un bloc qui ressemble a un message RUGA (entree + SL + TP).
        if(up.indexOf('ENTRY')>=0 && up.indexOf('SL')>=0 && up.indexOf('TP')>=0){
          // Construit un selecteur lisible pour ce noeud.
          var path = el.tagName.toLowerCase();
          if(el.className && typeof el.className==='string') path += '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.');
          out.push({ selector: path, classes: (typeof el.className==='string'? el.className : ''), text: txt.slice(0,300) });
        }
      }
      return { count: all.length, matches: out };
    })()`);
    console.log('   noeuds scannes :', dom?.count);
    if ((dom?.matches || []).length) {
      for (const m of dom.matches) {
        console.log('     * selecteur:', m.selector);
        console.log('       classes  :', m.classes);
        console.log('       texte    :', JSON.stringify(m.text));
      }
    } else {
      console.log('     (aucun bloc ENTRY+SL+TP trouve — le panneau JOURNAL est-il ouvert ?)');
    }
  } catch (e) { console.log('   ERREUR DOM:', e.message); }

  line();
  console.log('FIN — copie toute cette sortie et envoie-la moi.');
  line();
  process.exit(0);
}

main().catch((e) => { console.error('Erreur fatale:', e); process.exit(1); });
