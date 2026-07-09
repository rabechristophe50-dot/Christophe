# IFVG Bot — « Comment bien trader les IFVG ? »

Stratégie Pine Script (v6) qui automatise le concept ICT d'**Inverse Fair Value Gap**.
Fichier : [`ifvg_bot.pine`](./ifvg_bot.pine)

## Les 4 règles du concept (et où elles vivent dans le code)

| # | Règle (note manuscrite) | Implémentation |
|---|--------------------------|----------------|
| 1 | **Prise de liquidité avant l'IFVG** | Détection d'un *sweep* : la mèche prend un swing (`ta.pivothigh`/`ta.pivotlow`) puis la bougie referme du bon côté (`sellsideSweep` / `buysideSweep`). |
| 2 | **1 FVG → IFVG, pas plusieurs FVG** | Compteur `lFvgCnt`/`sFvgCnt` + option `requireSingleFVG` : si un 2ᵉ FVG se forme dans la fenêtre, le setup est invalidé. |
| 3 | **Clôturer avec le corps en dessous / au-dessus** | Signal validé seulement si la **clôture du corps** inverse le FVG : `close > lFvgTop and close > open` (long) / `close < sFvgBot and close < open` (short). |
| 4 | **Target claire = IRL to ERL** | La cible (`lTP`/`sTP`) vise la **liquidité externe opposée** = dernier swing (`lastSwingHigh` / `lastSwingLow`). Repli sur un R:R fixe si aucun swing dispo. |

## Séquence d'un trade

**LONG (IFVG haussier)**
1. Sweep de la liquidité *sellside* (prise sous un plus-bas).
2. Un FVG **baissier** se forme (un seul).
3. Clôture du corps **au-dessus** du FVG → il s'inverse en support (IFVG).
4. Entrée long · SL sous l'IFVG/le sweep · TP = swing high (ERL).

**SHORT (IFVG baissier)** : miroir exact (sweep buyside → FVG haussier → clôture corps en-dessous → TP = swing low).

## Utilisation

1. Lance TradingView Desktop en mode debug (voir `SETUP_GUIDE.md`).
2. Pousse et compile le script :
   ```bash
   cp scripts/ifvg_bot.pine scripts/current.pine
   node scripts/pine_push.js
   ```
3. Ouvre le **Strategy Tester** pour le backtest, ajuste les inputs (longueur des swings, fenêtre, R:R).

## Paramètres clés

- **Longueur des swings** — sensibilité de la liquidité (plus haut = swings majeurs).
- **Fenêtre max sweep→IFVG** — nombre de bougies avant expiration du setup.
- **Exiger 1 seul FVG** — applique strictement la règle #2.
- **Cible = ERL (swing)** — vise la liquidité externe ; sinon R:R fixe.

> ⚠️ Outil d'aide à la décision / backtest. Teste en démo avant tout usage réel.
