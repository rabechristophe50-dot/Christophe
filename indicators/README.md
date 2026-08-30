# Indicateurs Pine Script

Stratégie de confluence combinant **Sweep de liquidité + IFVG + Cassure de trendline**.

| Fichier | Type | Usage |
|---|---|---|
| `liquidity_sweep_ifvg_trendline.pine` | `indicator()` | Détection visuelle + labels + tableau + alertes LONG/SHORT |
| `liquidity_sweep_ifvg_trendline_strategy.pine` | `strategy()` | Version backtestable avec entrées/sorties, SL/TP, statistiques |
| `opr_sessions_dashboard.pine` | `indicator()` | Opening Ranges Asia/London/US + dashboard (HEURE, OPR, RSI, SL, LOT) |
| `opr_sessions_strategy.pine` | `strategy()` | Cassure d'OPR backtestable : entrées/sorties, SL/TP, sizing par risque + dashboard |

## OPR — Sessions + Dashboard

`opr_sessions_dashboard.pine` trace les **Opening Ranges** (OPR) de 3 sessions
configurables (Asia / London / US) sous forme de boîtes + lignes High/Low/Mid,
et ajoute un **dashboard** en surimpression :

- **HEURE** — horloge (timezone configurable)
- **OPR** — High / Low / Range des 3 sessions
- **RSI** — valeur courante, colorée selon surachat/survente
- **SL** — distance de stop basée sur la range de l'OPR de référence (range complet ou demi-range)
- **LOT** — taille de position calculée : `Risque ÷ (distance SL × valeur du point)`

Réglages clés (groupe *Risque / Position*) : `capital`, mode de risque (% ou montant),
`Valeur d'1 point (par lot)`, `Base du SL`, et `OPR de référence` (Auto = dernière
session ouverte, ou Asia/London/US fixe).

## OPR — Stratégie backtestable

`opr_sessions_strategy.pine` reprend la logique OPR et ajoute des **entrées/sorties
réelles** pour un backtest TradingView :

- **Entrée** : cassure en clôture du haut (LONG) ou du bas (SHORT) de l'OPR de la
  session choisie (`Session à trader`, défaut US), pendant la fenêtre allant de la
  fin de l'OPR jusqu'à l'heure d'extension.
- **Stop Loss** : côté opposé de l'OPR (ou ATR ×).
- **Take Profit** : multiple du risque (`R:R`), option break-even à +1R.
- **Sizing** : LOT = `Risque ÷ (distance SL × valeur du point)` — le risque par trade
  est piloté par `capital` + `%`/montant.
- **Filtres** : tendance EMA, RSI. `1 seul trade par OPR` pour éviter le sur-trading.

Le **Strategy Tester** de TradingView donne alors winrate, profit factor, drawdown, etc.
⚠️ À utiliser en **intraday** ; la session tradée par défaut est US (9:30) pour éviter
les fenêtres qui passent minuit.

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
