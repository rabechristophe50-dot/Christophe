# Indicateurs Pine Script

| Fichier | Type | Usage |
|---|---|---|
| `liquidity_sweep_ifvg_trendline.pine` | `indicator()` | Détection visuelle + labels + tableau + alertes LONG/SHORT |
| `liquidity_sweep_ifvg_trendline_strategy.pine` | `strategy()` | Version backtestable avec entrées/sorties, SL/TP, statistiques |
| `adaptive_trend_risk_strategy.pine` | `strategy()` | Bot suivi de tendance + moteur de risque (dimensionnement par % risque, stop ATR, break-even, trailing). Voir `BACKTEST_GUIDE.md` |

> ⚠️ **Aucun bot n'est garanti rentable.** Avant tout usage réel, lis
> [`BACKTEST_GUIDE.md`](BACKTEST_GUIDE.md) : comment backtester honnêtement,
> quels chiffres regarder (Profit Factor, Max Drawdown, nombre de trades) et
> comment éviter l'overfitting.

## Stratégie de confluence (Sweep + IFVG + Trendline)

## Logique de confluence

1. **Sweep de liquidité** — le prix balaie un swing high/low (chasse aux stops) puis referme
   de l'autre côté, avec récupération d'au moins X % de la mèche.
2. **IFVG (Inverse Fair Value Gap)** — un FVG traversé en clôture s'inverse et devient
   support/résistance dans le sens opposé.
3. **Cassure de trendline** — une ligne reliant deux pivots consécutifs (descendants ou
   montants) est cassée en clôture.

Un signal se déclenche quand les 3 conditions (ou 2 sur 3, configurable) tombent dans une
fenêtre glissante de N bougies.

- **LONG** = Sweep bas + IFVG haussier + cassure trendline baissière
- **SHORT** = Sweep haut + IFVG baissier + cassure trendline haussière

## Installation

1. Ouvrir le **Pine Editor** dans TradingView.
2. Coller le contenu du fichier `.pine` voulu.
3. *Add to chart*.

## Paramètres clés à régler

- `pivotLen` / `tlPivotLen` — sensibilité des swings et trendlines (baisser = plus de signaux).
- `fvgMinAtr` — filtre des micro-gaps.
- `confluenceWindow` — tolérance temporelle entre les 3 conditions.
- **(Strategy)** `slMode`, `atrMult`, `rr` — gestion du risque (SL ATR ou extrême du sweep, ratio R:R).
- **(Strategy)** filtres optionnels : tendance EMA, plage horaire.

## Avertissement

Ces scripts sont des outils d'aide à la décision à but éducatif. Ils ne garantissent aucun
résultat. Backtestez et validez sur votre instrument / timeframe avant tout usage réel, et
gérez toujours votre risque.
