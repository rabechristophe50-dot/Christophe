# Straddle Bot — Ordres en attente + SL serré + TP au niveau opposé

Bot Python autonome qui pose **deux ordres en attente** autour du prix de l'or,
avec un **Stop Loss très serré** et un **Take Profit au niveau opposé** (le prix
« revient » vers l'autre bord).

Fichier : **`straddle_bot.py`** — réglages dans **`config.py`** (section STRADDLE).

## Le principe (mode `reversion`, par défaut)

```
        Sell Limit @ HAUT   ← ligne "sell"   | SL serré juste au-dessus
              ....                            | TP = ligne du BAS (opposée)
   Prix -->  MILIEU
              ....
        Buy Limit  @ BAS    ← ligne "buy"    | SL serré juste en-dessous
                                             | TP = ligne du HAUT (opposée)
```

- Le prix monte jusqu'en haut → **Sell Limit** rempli → on est vendeur.
  Le prix **revient** vers le bas → TP touché sur la ligne opposée. ✅
- Le prix descend jusqu'en bas → **Buy Limit** rempli → on est acheteur.
  Le prix **revient** vers le haut → TP touché sur la ligne opposée. ✅
- Si ça part contre nous, le **SL très serré** coupe vite (petite perte).
- Dès qu'un ordre est rempli, l'autre est **annulé** (OCO).

## ⚠️ Pourquoi LIMIT et pas STOP ?

Tu as parlé de « buy stop / sell stop ». Mais un vrai *buy stop* achète **en
haut** et exige que le prix **continue** de monter — il ne peut donc **jamais**
avoir un TP « quand le prix revient ». Ta logique (entrer aux extrêmes, TP au
bord opposé quand ça revient, SL serré) n'est réalisable qu'avec des ordres
**LIMIT**. C'est ce que fait le mode `reversion`.

> Si tu voulais vraiment la **cassure** (acheter en haut et viser plus haut),
> mets `STR_MODE = "breakout"` dans `config.py` : Buy Stop / Sell Stop avec TP
> dans le sens de la cassure.

## Réglages clés (`config.py`, section STRADDLE)

| Paramètre | Défaut | Rôle |
|---|---|---|
| `STR_MODE` | `"reversion"` | `"reversion"` (TP opposé) ou `"breakout"` |
| `STR_ENTRY_DISTANCE_PIPS` | 100 | Distance des ordres au prix (100 = 1,00 $) |
| `STR_SL_PIPS` | 20 | SL très serré (20 = 0,20 $) |
| `STR_TP_PIPS` | 150 | TP **uniquement en mode breakout** |
| `STR_LOT` | 0.01 | Lot fixe |
| `STR_MAX_POSITIONS` | 1 | Positions ouvertes max |
| `STR_RECENTER_EACH_BAR` | True | Recentre les ordres à chaque nouvelle bougie |
| `STR_MAX_SPREAD_PIPS` | 40 | Spread max pour agir (IC Markets Raw : 25) |
| `STR_MAGIC` | 20260705 | Magic dédié (séparé du scalper) |

En mode reversion, le **TP est calculé automatiquement** = la ligne opposée
(donc à `2 × STR_ENTRY_DISTANCE_PIPS` de l'entrée). `STR_TP_PIPS` est ignoré.

## Lancement

```bash
pip install -r requirements.txt
python straddle_bot.py
```

**Toujours** commencer avec `DRY_RUN = True` (dans `config.py`) pour voir où le
bot poserait les ordres, sans rien risquer. Exemple de log :

```
[..] BUY LIMIT POSE @ 2349.00 | SL=2348.80 TP=2351.00 lot=0.01
[..] SELL LIMIT POSE @ 2351.00 | SL=2351.20 TP=2349.00 lot=0.01
[..] Position ouverte -> annulation des ordres en attente restants (OCO)
```

## Comportement du recentrage

Tant qu'aucun ordre n'est rempli, à chaque nouvelle bougie le bot **annule et
repose** les deux ordres autour du prix courant (`STR_RECENTER_EACH_BAR`). Mets
`False` si tu veux fixer les lignes une fois et ne plus y toucher.

## ⚠️ Avertissements spécifiques à cette stratégie

- Le SL est **très serré** : en marché qui tend fort, tu peux enchaîner plusieurs
  petits stops. La reversion marche mieux en **range** (marché qui oscille).
- Chaque ordre rempli chez IC Markets = **commission** (compte Raw). Beaucoup de
  petits trades = frais qui s'accumulent. Regarde le **net après commissions**.
- Le TP au niveau opposé est **loin** (2× la distance d'entrée) : le prix doit
  faire tout le chemin retour. Ajuste `STR_ENTRY_DISTANCE_PIPS` selon la
  volatilité de l'or.
- **DRY_RUN → DÉMO → micro-lot réel.** Aucun profit garanti.
