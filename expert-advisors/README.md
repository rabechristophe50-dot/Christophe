# Expert Advisor MT5 — Adaptive Trend + Risk Engine

`AdaptiveTrendRisk.mq5` est le **jumeau MetaTrader 5** de la stratégie Pine
`indicators/adaptive_trend_risk_strategy.pine`. Même logique (suivi de tendance
+ entrée sur repli + moteur de risque), pour que ce que vous **vérifiez sur
TradingView** corresponde à ce que **l'EA trade sur MT5**.

> ⚠️ **Aucun EA n'est garanti rentable.** Backtestez dans le Strategy Tester
> MT5 **et** vérifiez sur TradingView avant tout usage réel. Commencez toujours
> en **compte DÉMO**.

---

## 1. Installer l'EA sur MetaTrader 5

1. MT5 → menu **Fichier → Ouvrir le dossier de données**.
2. Copiez `AdaptiveTrendRisk.mq5` dans `MQL5/Experts/`.
3. Ouvrez **MetaEditor** (F4) → ouvrez le fichier → **Compiler** (F7).
   Il doit compiler sans erreur.
4. De retour dans MT5, glissez l'EA depuis l'onglet *Navigateur → Expert Advisors*
   sur un graphique **XAUUSD** ou **BTCUSD**.
5. Cochez **Autoriser le trading algorithmique** (le bouton en haut) et validez.

## 2. Backtester l'EA (Strategy Tester MT5)

1. MT5 → **Vue → Testeur de stratégie** (Ctrl+R).
2. Choisissez `AdaptiveTrendRisk`, le symbole (XAUUSD / BTCUSD), la période.
3. Modèle : **« Chaque tick basé sur les vrais ticks »** (le plus réaliste).
4. Lancez et regardez : **Profit Factor**, **Drawdown**, **nb de trades**.
5. Faites un test **out-of-sample** (voir `indicators/BACKTEST_GUIDE.md`).

## 3. Vérifier la même logique sur TradingView (Pine)

C'est l'étape de **contrôle croisé** : si Pine et MT5 donnent des résultats
cohérents, vous avez confiance dans la logique.

1. TradingView → **Pine Editor** → collez
   `indicators/adaptive_trend_risk_strategy.pine` → *Add to chart*.
2. Mettez le **même symbole et le même timeframe** que sur MT5
   (ex. `OANDA:XAUUSD` en 15 min, `BINANCE:BTCUSD` ou `BTCUSD` en 1 h).
3. Onglet **Strategy Tester** : comparez Profit Factor / Drawdown avec MT5.
4. Réglez les paramètres à l'identique (EMA, ATR, R:R, risque).

> Les chiffres ne seront pas **exactement** identiques (données du courtier,
> spread, heures de session, source du prix diffèrent). On cherche la
> **cohérence de tendance**, pas l'égalité au centime.

---

## 4. Réglages recommandés de départ

### 🥇 OR — XAUUSD (H1 conseillé)

| Paramètre | Valeur |
|---|---|
| EMA rapide / lente | 21 / 55 |
| ATR / Stop (× ATR) | 14 / **2.0** |
| R:R | 2.0 |
| Risque par trade | **0.5–1.0 %** |
| Filtre volatilité (ATR % min) | 0.15 |
| Filtre horaire | ON, session Londres/NY : 08–17 (heure serveur) |
| Trailing ATR | ON (× 2.0) |

L'or bouge fort sur l'ouverture de Londres et de New York. Le filtre horaire
évite les heures asiatiques molles où les faux signaux dominent.

### ₿ BTC — BTCUSD (H1 ou H4 conseillé)

| Paramètre | Valeur |
|---|---|
| EMA rapide / lente | 21 / 55 (ou 34 / 89 en H4) |
| ATR / Stop (× ATR) | 14 / **2.5** |
| R:R | 2.0 |
| Risque par trade | **0.5 %** (BTC est très volatil) |
| Filtre volatilité (ATR % min) | 0.4 |
| Filtre horaire | **OFF** (le crypto trade 24/7) |
| Trailing ATR | ON (× 2.5) |

Le BTC ne dort jamais : pas de filtre horaire. Sa volatilité est plus élevée →
stop un peu plus large (× 2.5) et risque par trade plus prudent.

> Ces valeurs sont des **points de départ**, pas des réglages optimisés. Le seul
> juge, c'est votre backtest out-of-sample + votre paper trading.

---

## 5. Sécurité — à lire absolument

- **Démo d'abord.** Faites tourner l'EA plusieurs semaines en démo avant tout
  euro réel. Comparez le live au backtest : un écart énorme = un problème.
- **Risque par trade** : ne dépassez jamais 1 % au début. Le dimensionnement
  automatique protège votre capital — ne le désactivez pas.
- **Un seul trade à la fois** par symbole (par conception).
- **Spread & slippage** : sur l'or et le BTC, le spread peut être large. Vérifiez
  que vos coûts réels ne mangent pas l'avantage vu en backtest.
- Ceci **n'est pas un conseil financier**. Vous êtes seul responsable de vos
  décisions de trading.
