# Guide de backtest — Est-ce que ce bot est vraiment rentable ?

> **La vérité d'abord :** aucun bot n'est *garanti* rentable. Un backtest te dit
> comment une stratégie *aurait* performé sur le passé — pas comment elle
> performera demain. Ce guide t'apprend à évaluer honnêtement une stratégie
> pour ne pas te faire piéger par des chiffres trompeurs.

## 1. Charger la stratégie

1. Ouvre TradingView, choisis un instrument (ex. `BTCUSD`, `ES1!`, `EURUSD`) et
   un timeframe (ex. 15 min ou 1 h).
2. Pine Editor → colle `adaptive_trend_risk_strategy.pine` → *Add to chart*.
3. Ouvre l'onglet **Strategy Tester** en bas.

## 2. Les 4 chiffres qui comptent vraiment

| Métrique | Ce que ça veut dire | Seuil correct |
|---|---|---|
| **Profit Factor** | Gains bruts ÷ pertes brutes | > 1.3 (idéalement > 1.5) |
| **Max Drawdown** | Pire chute du capital | < 20–25 % |
| **Nombre de trades** | Fiabilité statistique | > 100 (sinon = chance) |
| **Win rate + R:R** | Ensemble, pas séparément | 40 % à R:R 2 = rentable |

Un backtest avec **Profit Factor 5.0 mais seulement 12 trades** ne vaut RIEN :
c'est de la chance, pas une stratégie.

## 3. Les pièges qui rendent un backtest MENTEUR

- **Overfitting (sur-optimisation)** : bidouiller les réglages jusqu'à ce que la
  courbe soit belle. Ça marche sur le passé, ça casse sur le futur.
- **Coûts ignorés** : sans commission ni slippage, tout paraît rentable. Ce bot
  inclut déjà `commission 0.04 %` + `slippage 2` — **garde-les** (ou augmente-les
  pour ton courtier réel).
- **Repainting** : signaux qui changent après coup. Ce bot utilise
  `process_orders_on_close=true` pour l'éviter.
- **Trop peu de données** : teste sur plusieurs années et plusieurs régimes de
  marché (hausse, baisse, range).

## 4. Méthode honnête : le test « out-of-sample »

1. Optimise tes réglages sur **2021–2023** uniquement.
2. Fige les réglages. Teste sur **2024–2025** sans y toucher.
3. Si ça reste rentable sur la période jamais vue → signal encourageant.
   Si ça s'effondre → c'était de l'overfitting.

## 5. Réglages de départ raisonnables

- `Risque par trade` : **1 %** max (jamais plus au début).
- `R:R` : **2.0**, `Stop = ATR × 2.0`.
- Active le **filtre de volatilité** pour éviter les marchés plats.
- Teste `EMA rapide/lente` 21/55 puis 34/89, sans sur-optimiser.

## 6. Avant de risquer de l'argent réel

1. **Paper trading** (compte démo) pendant plusieurs semaines minimum.
2. Compare le résultat live au backtest : un écart énorme = problème.
3. Ne risque que ce que tu peux perdre entièrement.

## 7. Attentes réalistes

- Une bonne stratégie systématique vise ~1.3–1.8 de Profit Factor, pas 10.
- Les séries de pertes (5–10 trades perdants d'affilée) sont **normales**.
- La discipline (respecter les stops) compte plus que le signal d'entrée.

---

*Ce document fait partie du projet. Il n'est pas un conseil financier.*
