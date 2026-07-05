# Grid Bot / GridEA — Grille de cassure (façon "GTS Gold Strategy")

Reproduit la stratégie de la **vidéo** : une **échelle (ladder) d'ordres stop**
empilés autour du prix de l'or.

- **`mt5/GridEA.mq5`** — version Expert Advisor (backtestable dans MT5).
- **`bot/grid_bot.py`** — version bot Python (config dans `config.py`, section GRID).

## Le principe

```
   BUY STOP 0.01   ← niveau 5     |
   BUY STOP 0.01   ← niveau 4     |  échelle de N Buy Stop
   BUY STOP 0.01   ← niveau 3     |  AU-DESSUS du prix
   BUY STOP 0.01   ← niveau 2     |  (se déclenchent si ça monte)
   BUY STOP 0.01   ← niveau 1     |
  ─────── PRIX ACTUEL ───────
   SELL STOP 0.01  ← niveau 1     |
   SELL STOP 0.01  ← niveau 2     |  échelle de N Sell Stop
   SELL STOP 0.01  ← niveau 3     |  EN-DESSOUS du prix
   SELL STOP 0.01  ← niveau 4     |  (se déclenchent si ça baisse)
   SELL STOP 0.01  ← niveau 5     |
```

Quand le prix **casse dans un sens**, les ordres stop se déclenchent en cascade
dans ce sens, chacun avec son petit TP. Le but : capturer un mouvement fort de
l'or (news, ouverture de session). La grille est reconstruite quand le compte
revient à plat (aucune position).

## Réglages (`config.py`, section GRID)

| Paramètre | Défaut | Rôle |
|---|---|---|
| `GRID_LEVELS` | 5 | Nombre d'ordres de chaque côté |
| `GRID_FIRST_STEP_PIPS` | 30 | Distance du prix au 1er ordre (0,30 $) |
| `GRID_STEP_PIPS` | 30 | Écart entre 2 ordres (0,30 $) |
| `GRID_LOT` | 0.01 | Lot par ordre |
| `GRID_TP_PIPS` | 50 | TP par ordre (0,50 $) — 0 = aucun |
| `GRID_SL_PIPS` | 100 | SL par ordre (1,00 $) — 0 = aucun |
| `GRID_USE_EQUITY_STOP` | True | Coupe-circuit sur la perte flottante |
| `GRID_MAX_LOSS_MONEY` | 50 | Ferme TOUT si perte flottante ≥ 50 (devise) |
| `GRID_TAKE_ALL_PROFIT` | 0 | Ferme tout à ce profit flottant (0 = off) |
| `GRID_REBUILD_FLAT` | True | Reconstruit la grille quand à plat |
| `GRID_MAX_SPREAD_PIPS` | 40 | Spread max (IC Markets Raw : 25) |

## Lancement

```bash
python grid_bot.py     # bot Python (garde MT5 ouvert)
```
Ou compile `GridEA.mq5` dans MetaEditor et pose-le sur XAUUSD M1.

**Commence TOUJOURS en `DRY_RUN = True`** pour voir où la grille se pose sans
risque.

## 🛑 AVERTISSEMENT SÉRIEUX — lis ça

Les stratégies de **grille** comme celles vendues sur les réseaux ("GTS EA",
"Gold Strategy"...) sont **parmi les plus dangereuses** :

1. **En marché sans direction (range)**, le prix monte, déclenche des Buy Stop,
   puis redescend et les met en perte, déclenche des Sell Stop, remonte... Tu
   **accumules les petites pertes des deux côtés** (whipsaw). C'est le piège
   classique qui vide un compte.
2. **Ça marche seulement** quand le prix part franchement dans **une** direction
   (cassure nette). Le reste du temps, ça saigne.
3. Les vidéos ne montrent **que les bons jours**. Le "early access" et le
   "type XAUUSD" sont souvent du **marketing** pour vendre un EA ou un signal.
4. **Ne mets jamais** ton salaire / ton épargne là-dessus.

**Protections que j'ai ajoutées** (utilise-les) :
- `GRID_MAX_LOSS_MONEY` : coupe-circuit qui ferme TOUT au-delà d'une perte.
- `GRID_TAKE_ALL_PROFIT` : sécurise un gain global.
- Filtre horaire : ne trade que sur les heures actives (news/sessions).

## Procédure obligatoire

1. **Backtest** `GridEA.mq5` dans le Strategy Tester (XAUUSD M1, ticks réels,
   plusieurs mois — inclure les périodes calmes, pas seulement les tendances).
   Regarde le **drawdown maximum** avant tout.
2. **Démo** IC Markets plusieurs semaines.
3. Réel en **0,01 lot** avec un capital que tu peux **totalement perdre**.

Aucun profit n'est garanti. Une grille peut gagner longtemps puis tout rendre
en une seule séance de range. Tu es seul responsable.
