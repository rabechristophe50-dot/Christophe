# Multi-Strategy Scalping Bot

Un bot de scalping crypto (BitGet spot) qui combine **5 stratégies top** via un moteur
de confluence pondéré, avec une vraie gestion du risque (stop-loss/take-profit ATR,
trailing stop, coupe-circuit journalier). Tourne en **paper (simulation) par défaut** —
le mode live ne place des ordres réels que sur opt-in explicite.

## Démarrage rapide

```bash
# Backtest sur données historiques réelles (rien à risquer)
npm run scalper:backtest -- --symbol XRPUSDT --tf 1

# Paper trading en direct sur données de marché réelles (défaut, sûr)
npm run scalper:paper -- --symbol XRPUSDT

# Live — ordres RÉELS, nécessite les clés BitGet dans .env
npm run scalper:live -- --symbol XRPUSDT
```

> ⚠️ Le mode `--live` engage de l'argent réel. Il attend 5 s (Ctrl-C pour annuler),
> puis trade jusqu'à un coupe-circuit ou Ctrl-C. Le spot BitGet est **long-only** ;
> les shorts ne sont simulés qu'en paper (`--shorts`).

## Les stratégies

| Stratégie | Type | Idée |
|---|---|---|
| `emaTrend` | Suivi de tendance | Croisement EMA 8/21 filtré par l'EMA 50 |
| `vwapReversion` | Retour à la moyenne | Fade des écarts au VWAP de session |
| `rsiReversal` | Retournement | RSI(2) extrême + filtre de tendance EMA (style Conners) |
| `bollingerBreakout` | Cassure | Sortie de bandes de Bollinger après squeeze |
| `macdMomentum` | Momentum | MACD filtré par la force de tendance ADX |

Chaque stratégie **vote** long/short avec une force 0–1. Le moteur multiplie par le
poids configuré et somme : une position s'ouvre quand le score net dépasse
`entryThreshold`. Aucune stratégie seule ne déclenche un trade — il faut de la
**confluence**.

## Gestion du risque

- **Sizing** : chaque trade risque `riskPctPerTrade` (1 % par défaut) de l'équité jusqu'au stop, plafonné par `maxNotionalPct`.
- **Stop/Target** : distances basées sur l'ATR (`slAtrMult` / `tpAtrMult`).
- **Trailing stop** : le stop ne recule jamais, il suit le profit (`trailAtrMult`).
- **Coupe-circuits** : arrêt de session sur perte journalière, drawdown max, ou N pertes consécutives.

## Configuration

Tout se règle dans [`../scalper.config.json`](../scalper.config.json) : symbole,
timeframe, poids des stratégies (mettre à `0` pour désactiver), seuil de confluence,
et paramètres de risque. Les flags CLI surchargent le fichier.

```
--paper | --live       mode (défaut paper)
--symbol <SYM>         paire (défaut XRPUSDT)
--tf <min>             timeframe 1|5|15|60
--ticks <n>            arrêt après n itérations
--threshold <n>        seuil de confluence
--equity <usdt>        capital paper de départ
--shorts               autoriser les shorts simulés (paper)
--backtest --bars <n>  rejouer l'historique et afficher les stats
```

## Fichiers

```
scalper-bot.js          point d'entrée CLI
scalper.config.json     configuration
scalper/indicators.js   EMA, RSI, VWAP, ATR, Bollinger, MACD, ADX
scalper/strategies.js   les 5 stratégies + registre
scalper/risk.js         sizing, brackets, trailing, coupe-circuits
scalper/exchange.js     adaptateur BitGet (données publiques + ordres signés)
scalper/engine.js       boucle live/paper
scalper/backtest.js     rejeu historique bar-par-bar
```

Tests : `npm run test:scalper`.

## Avertissement

Le trading comporte des risques de perte. Backtestez, puis validez en paper sur
plusieurs sessions avant d'envisager le live avec de petits montants. Ce logiciel est
fourni tel quel, sans garantie de performance.
