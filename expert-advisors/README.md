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
   (ex. `OANDA:XAUUSD` en **M1**, `BINANCE:BTCUSD` ou `BTCUSD` en **M1**).
3. Onglet **Strategy Tester** : comparez Profit Factor / Drawdown avec MT5.
4. Réglez les paramètres à l'identique (EMA, ATR, R:R, risque).

> Les chiffres ne seront pas **exactement** identiques (données du courtier,
> spread, heures de session, source du prix diffèrent). On cherche la
> **cohérence de tendance**, pas l'égalité au centime.

---

## 4. Réglages recommandés — SCALPING M1

> 🚨 **Lisez ceci avant tout.** Le M1 est le timeframe le plus DUR pour être
> rentable. Vos gains par trade sont petits, mais les **coûts restent les
> mêmes** : sur l'or, un spread de 15–30 cents peut manger 20–40 % de votre
> stop. **Sur M1, ce sont les frais qui décident, pas le signal.** Règle d'or :
> ne scalpez que si votre **spread + commission** est petit devant votre stop
> (voir §5). Sinon, aucun réglage ne vous sauvera.

### 🥇 OR — XAUUSD (M1)

| Paramètre | Valeur |
|---|---|
| EMA rapide / lente | **9 / 30** (réactif pour scalp) |
| ATR / Stop (× ATR) | 14 / **1.5** |
| R:R | **1.5** |
| Risque par trade | **0.25–0.5 %** |
| Repli max sur EMA (× ATR) | 0.3 |
| Filtre volatilité (ATR % min) | **0.05** |
| Filtre horaire | **ON** — chevauchement Londres/NY : 13–17 (heure serveur) |
| Trailing ATR | ON (× 1.5) |

Sur M1, ne tradez l'or **que** pendant les heures de forte liquidité
(ouverture Londres, puis chevauchement Londres/NY). Hors de ces plages, le
bruit et le spread relatif tuent le scalping. Le filtre horaire est
**indispensable** ici.

### ₿ BTC — BTCUSD (M1)

| Paramètre | Valeur |
|---|---|
| EMA rapide / lente | **9 / 30** |
| ATR / Stop (× ATR) | 14 / **1.5** |
| R:R | **1.5** |
| Risque par trade | **0.25 %** (BTC + M1 = très nerveux) |
| Repli max sur EMA (× ATR) | 0.3 |
| Filtre volatilité (ATR % min) | **0.10** |
| Filtre horaire | **OFF** (crypto 24/7) mais évitez les week-ends mous |
| Trailing ATR | ON (× 1.5) |

Le BTC scalpé en M1 génère beaucoup de signaux : le **filtre de volatilité**
est votre meilleur ami pour ne trader que quand ça bouge vraiment.

> Ces valeurs sont des **points de départ scalping**, pas des réglages
> optimisés. Le seul juge reste votre backtest out-of-sample + votre démo.
> Sur M1, backtestez **impérativement** en mode « chaque tick basé sur les
> vrais ticks » — sinon le résultat est faux.

---

## 5. Sécurité — à lire absolument

- **Démo d'abord.** Faites tourner l'EA plusieurs semaines en démo avant tout
  euro réel. Comparez le live au backtest : un écart énorme = un problème.
- **Risque par trade** : ne dépassez jamais 1 % au début. Le dimensionnement
  automatique protège votre capital — ne le désactivez pas.
- **Un seul trade à la fois** par symbole (par conception).
- **Spread & slippage** : sur l'or et le BTC, le spread peut être large. Vérifiez
  que vos coûts réels ne mangent pas l'avantage vu en backtest.
- **🔑 Le test du spread (spécial M1)** : avant de scalper, faites ce calcul.
  Regardez votre spread actuel et la distance de stop (`ATR × 1.5`).
  Si `spread ÷ distance_stop` dépasse **~10 %**, le scalping M1 n'est pas
  viable chez ce courtier — les frais mangeront le bord statistique. Exemple :
  stop de 2 $ sur l'or et spread de 0,30 $ → 15 % → **trop cher**. Cherchez un
  compte à spread serré (ECN/raw) ou remontez de timeframe.
- Ceci **n'est pas un conseil financier**. Vous êtes seul responsable de vos
  décisions de trading.
