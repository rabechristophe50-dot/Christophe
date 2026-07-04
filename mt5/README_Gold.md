# PureScalperEA — Version OR (XAUUSD)

Réglages spécifiques pour scalper l'**or** avec l'EA. Le Forex et l'or n'ont
**rien à voir** en volatilité et en spread : ne mets jamais l'EA forex tel quel
sur l'or, sinon il ne tradera jamais (le filtre de spread bloque tout).

## Deux façons de l'utiliser

### Option A — Version Gold dédiée (le plus simple)
Utilise **`PureScalperEA_Gold.mq5`** : ses valeurs par défaut sont déjà réglées
pour l'or. Tu le compiles et tu le poses sur le graphique, rien à charger.

### Option B — Preset `.set` sur l'EA d'origine
1. Copie **`XAUUSD_Gold.set`** dans `MQL5/Presets/` (dossier de données MT5).
2. Pose `PureScalperEA` sur un graphique XAUUSD → dans la fenêtre de l'EA,
   onglet *Paramètres*, clique **Load** et choisis `XAUUSD_Gold.set`.
3. Dans le Strategy Tester, même bouton **Load** dans l'onglet des paramètres.

## Comprendre l'unité « pip » sur l'or

Dans l'EA, **1 pip = 0,01 $ (1 cent)** sur l'or.

| Mouvement de l'or | En « pips » de l'EA |
|---|---|
| 0,01 $ (1 cent) | 1 pip |
| 0,10 $ | 10 pips |
| 1,00 $ | 100 pips |
| 5,00 $ | 500 pips |

C'est pour ça que les valeurs Gold sont beaucoup plus grandes que le Forex.

## Valeurs Gold vs Forex

| Paramètre | Forex | **Gold** | Signification Gold |
|---|---|---|---|
| `InpMaxSpreadPips` | 3 | **40** | ne trade pas si spread > 0,40 $ |
| `InpATRMinPips` | 3 | **80** | il faut au moins 0,80 $ de volatilité |
| `InpBreakEvenPips` | 5 | **120** | break-even dès +1,20 $ |
| `InpBreakEvenLock` | 1 | **20** | verrouille +0,20 $ |
| `InpTrailStartPips` | 8 | **180** | trailing dès +1,80 $ |
| `InpTrailStepPips` | 5 | **100** | trailing suit à 1,00 $ |
| `InpRiskPercent` | 1,0 | **0,5** | risque réduit (l'or est violent) |

> ⚠️ Vérifie le **spread réel** de ton broker sur l'or. S'il est souvent à
> 0,25–0,35 $, garde `InpMaxSpreadPips=40`. S'il est plus large (broker à
> spread élevé), monte-le à 50–60, sinon l'EA ne tradera pas.

## Réglages selon ton style

- **Plus de trades** : passe en M1, baisse `InpATRMinPips` à 50, élargis le RSI
  (`InpRSIBuyMax=75`, `InpRSISellMin=25`).
- **Plus prudent** : reste en M5, monte `InpATRMinPips` à 120, garde le risque à 0,3 %.

## ⚠️ Rappel important

L'or est l'un des instruments les plus **violents et imprévisibles** (news, USD,
taux). Le SL/TP est basé sur l'ATR donc il s'adapte, mais :

1. **Backteste** d'abord dans le Strategy Tester (XAUUSD M5, ticks réels, 2–3 mois).
2. Puis **démo** plusieurs semaines.
3. Réel seulement en micro-lot (0,01) au début.

Aucun EA ne garantit de profit. Teste, mesure, puis décide.
