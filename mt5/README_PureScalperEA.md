# PureScalperEA — Expert Advisor de Scalping Pur (MT5)

EA de **scalping 100% automatique** pour MetaTrader 5. Il ouvre, gère et ferme les
trades tout seul, avec une gestion du risque intégrée.

## Stratégie : Trend-Momentum Scalper

L'EA prend une position **uniquement quand plusieurs conditions s'alignent** — c'est
ce qui filtre le bruit typique du scalping :

| Composant | Rôle |
|---|---|
| **EMA 200** | Filtre de tendance — on n'achète qu'au-dessus, on ne vend qu'en dessous |
| **EMA 8 / EMA 21** | Signal d'entrée : croisement de la rapide au-dessus/en dessous de la lente |
| **RSI 14** | Confirme le momentum et évite d'entrer en surachat/survente |
| **ATR 14** | Filtre de volatilité + calcule un SL/TP adapté au marché du moment |

**Achat** : prix > EMA200, EMA8 croise au-dessus d'EMA21, RSI entre 50 et 70, ATR suffisant.
**Vente** : prix < EMA200, EMA8 croise en dessous d'EMA21, RSI entre 30 et 50, ATR suffisant.

## Sécurités intégrées

- **Lot dynamique** basé sur un % du capital risqué par trade (défaut 1 %)
- **Stop Loss / Take Profit** calculés sur l'ATR (s'adaptent à la volatilité)
- **Break-even** : déplace le SL au point d'entrée dès que le trade est en profit
- **Trailing stop** : sécurise les gains quand le trade court
- **Filtre de spread** : ne trade pas quand le spread est trop large
- **Filtre horaire** : ne trade que pendant les heures liquides (défaut 7h–20h serveur)
- **Une seule position à la fois** par défaut (scalping propre)

## Installation

1. Ouvre **MetaTrader 5** → menu `Fichier` → `Ouvrir le dossier de données`.
2. Copie `PureScalperEA.mq5` dans `MQL5/Experts/`.
3. Ouvre **MetaEditor** (F4 dans MT5), ouvre le fichier et clique **Compiler** (F7).
   → Aucune erreur ne doit apparaître.
4. Reviens dans MT5 : l'EA apparaît dans `Navigateur → Expert Advisors`.
5. Glisse-le sur un graphique (**EUR/USD M1 ou M5 recommandé**).
6. Coche **« Autoriser le trading algorithmique »** et valide.
7. Vérifie que le bouton **AlgoTrading** (barre du haut) est bien vert.

## Réglages recommandés

| Marché | Timeframe | Spread max | Notes |
|---|---|---|---|
| EUR/USD, USD/JPY | M1 / M5 | 2–3 pips | Paires majeures = spread bas = idéal scalping |
| Indices (US30, NAS100) | M1 / M5 | selon broker | Augmente `InpMaxSpreadPips` |
| Or (XAUUSD) | M5 | 20–30 pts | Augmente `InpATRMinPips` et le spread max |

Paramètres clés à ajuster selon ton compte :
- `InpRiskPercent` : risque par trade (commence à **0.5 %** en test).
- `InpMaxSpreadPips` : adapte-le au spread réel de ton broker.
- `InpStartHour` / `InpEndHour` : cale-les sur les sessions Londres/New York (heure serveur).

## ⚠️ Avant de trader en réel — TESTE

1. **Strategy Tester** (Ctrl+R dans MT5) : choisis EUR/USD M5, période de plusieurs mois,
   modèle **« Chaque tick basé sur les ticks réels »**.
2. Lance le backtest, regarde la courbe d'équité, le drawdown et le profit factor.
3. Ensuite **compte démo** pendant au moins 2–4 semaines.
4. Passe en réel seulement une fois les résultats stables, avec un petit lot.

> Aucun EA ne garantit de gains. Le scalping est très sensible au spread, à la
> latence et aux conditions du broker. Teste toujours d'abord.

## Optimisation (Strategy Tester)

Paramètres intéressants à optimiser :
- `InpFastEMA`, `InpSlowEMA` (couple de croisement)
- `InpSL_ATR_Mult`, `InpTP_ATR_Mult` (ratio risque/récompense)
- `InpTrailStartPips`, `InpTrailStepPips` (gestion des gains)
- `InpATRMinPips` (agressivité du filtre de volatilité)
