#!/usr/bin/env node
/**
 * SONDAGE des alertes TradingView.
 *
 *   node src/bridge/probe-alerts.js
 *
 * But : trouver OU se trouve le vrai message d'un tir d'alerte
 * (« RUGA PRO OLD: BUY ENTRY ... »), car pour la condition
 * « Tout appel de la fonction alerte() » le message n'est PAS dans la
 * definition (list_alerts) mais dans le JOURNAL des tirs.
 *
 * Copie-colle toute la sortie et envoie-la : j'en deduis la source exacte
 * a lire, et je branche le pont dessus.
 */
import { alerts as coreAlerts } from '../core/index.js';
import { evaluateAsync } from '../connection.js';

function line() { console.log('------------------------------------------------------------'); }

async function main() {
  line();
  console.log('1) DEFINITIONS via list_alerts (ce que le pont lit AUJOURD\'HUI)');
  line();
  try {
    const res = await coreAlerts.list();
    const list = res?.alerts || [];
    console.log(`   ${list.length} alerte(s) trouvee(s).`);
    for (const a of list) {
      const msg = (a.message ?? '').toString();
      console.log('   - alert_id :', a.alert_id);
      console.log('     symbol   :', a.symbol);
      console.log('     condition:', JSON.stringify(a.condition));
      console.log('     message  :', msg === '' ? '(VIDE)' : JSON.stringify(msg.slice(0, 200)));
      console.log('     last_fire:', a.last_fired);
      console.log('');
    }
  } catch (e) { console.log('   ERREUR list_alerts:', e.message); }

  line();
  console.log('2) SERVICE INTERNE window.TradingViewApi._alertService (journal en memoire ?)');
  line();
  try {
    const info = await evaluateAsync(`(async function(){
      var out = { available:false, keys:[], candidates:[] };
      try {
        var svc = window.TradingViewApi && window.TradingViewApi._alertService;
        if (!svc) return out;
        out.available = true;
        // Noms des proprietes/methodes du service (1er niveau).
        var seen = {};
        var o = svc;
        for (var depth=0; depth<3 && o; depth++) {
          Object.getOwnPropertyNames(o).forEach(function(k){ seen[k]=true; });
          o = Object.getPrototypeOf(o);
        }
        out.keys = Object.keys(seen).filter(function(k){ return k[0] !== '_' || /log|fire|event|hist|alert|list|message/i.test(k); }).slice(0, 60);
        // Cherche des collections d'objets contenant un champ message/desc/text.
        function scan(obj, path, budget) {
          if (!obj || budget.n <= 0) return;
          budget.n--;
          try {
            var arr = null;
            if (Array.isArray(obj)) arr = obj;
            else if (obj && typeof obj.value === 'function') { try { var v = obj.value(); if (Array.isArray(v)) arr = v; } catch(e){} }
            if (arr && arr.length) {
              var s = arr[0];
              if (s && typeof s === 'object') {
                var fields = Object.keys(s);
                if (fields.some(function(f){ return /message|desc|text|fire|body/i.test(f); })) {
                  out.candidates.push({ path: path, len: arr.length, sample_fields: fields.slice(0,12), sample: JSON.stringify(s).slice(0,220) });
                }
              }
            }
          } catch(e){}
        }
        var budget = { n: 400 };
        var keys = Object.keys(svc);
        for (var i=0;i<keys.length;i++){ try { scan(svc[keys[i]], '_alertService.'+keys[i], budget); } catch(e){} }
        scan(svc, '_alertService', budget);
      } catch(e) { out.error = e.message; }
      return out;
    })()`);
    console.log('   disponible :', info?.available);
    if (info?.error) console.log('   erreur     :', info.error);
    console.log('   proprietes interessantes :', JSON.stringify(info?.keys || []));
    console.log('   collections avec message/fire :');
    for (const c of info?.candidates || []) {
      console.log('     * path   :', c.path, '  (', c.len, 'elements )');
      console.log('       champs :', JSON.stringify(c.sample_fields));
      console.log('       exemple:', c.sample);
    }
    if (!(info?.candidates || []).length) console.log('     (aucune collection evidente trouvee)');
  } catch (e) { console.log('   ERREUR service interne:', e.message); }

  line();
  console.log('3) JOURNAL via REST (endpoints candidats)');
  line();
  try {
    const rest = await evaluateAsync(`(async function(){
      var urls = [
        'https://pricealerts.tradingview.com/list_fired_alerts',
        'https://pricealerts.tradingview.com/list_events',
        'https://pricealerts.tradingview.com/history_alerts',
        'https://pricealerts.tradingview.com/get_events',
        'https://pricealerts.tradingview.com/list_alerts_log'
      ];
      var res = [];
      for (var i=0;i<urls.length;i++){
        try {
          var r = await fetch(urls[i], { credentials:'include' });
          var t = await r.text();
          res.push({ url: urls[i], status: r.status, body: t.slice(0, 200) });
        } catch(e) { res.push({ url: urls[i], error: e.message }); }
      }
      return res;
    })()`);
    for (const r of rest || []) {
      console.log('   -', r.url);
      console.log('     status:', r.status ?? ('ERREUR ' + r.error));
      if (r.body) console.log('     body  :', r.body);
    }
  } catch (e) { console.log('   ERREUR REST:', e.message); }

  line();
  console.log('FIN DU SONDAGE — copie toute cette sortie et envoie-la moi.');
  line();
  process.exit(0);
}

main().catch((e) => { console.error('Erreur fatale:', e); process.exit(1); });
