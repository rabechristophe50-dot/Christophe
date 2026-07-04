# PureScalperEA — Version OR AGRESSIVE (XAUUSD / IC Markets)

Version qui prend **plus de trades par jour** sur l'or, calibrée pour un
compte **IC Markets Raw Spread** (spreads très serrés sur l'or). Pensée pour
le **M1**.

## Fichiers
- **`PureScalperEA_Gold_Aggressive.mq5`** — l'EA agressif, valeurs déjà réglées.
- **`XAUUSD_Gold_Aggressive.set`** — preset à charger (bouton *Load*) sur l'EA d'origine.

## Ce qui rend cette version plus agressive

| Paramètre | Gold normal | **Gold agressif** | Effet |
|---|---|---|---|
| Timeframe conseillé | M5 | **M1** | Beaucoup plus de signaux |
| `InpFastEMA` / `InpSlowEMA` | 8 / 21 | **5 / 13** | Croisements plus fréquents |
| `InpRSIBuyMax` / `InpRSIBuyMin` | 70 / 50 | **80 / 45** | Bande d'achat élargie |
| `InpRSISellMin` / `InpRSISellMax` | 30 / 50 | **20 / 55** | Bande de vente élargie |
| `InpATRMinPips` | 80 | **40** | Trade même en volatilité plus faible |
| `InpMaxPositions` | 1 | **2** | Deux trades en même temps |
| `InpMaxSpreadPips` | 40 | **25** | IC Markets Raw = spread serré |
| `InpEndHour` | 20 | **21** | Fenêtre de trading un peu plus large |

Le **risque reste à 0,5 %** et le SL/TP reste basé sur l'ATR : plus de trades,
mais chaque trade garde sa protection.

## ⚙️ Réglage du spread selon ton compte IC Markets

- **Raw Spread / cTrader Raw** (avec commission) : spread or souvent 0,10–0,20 $
  → `InpMaxSpreadPips=25` est bon, tu peux même descendre à 20.
- **Standard** (sans commission, spread plus large) : monte à `35–45`, sinon
  l'EA loupera des trades.

Vérifie le spread réel : dans MT5, clic droit sur *Observation du marché* →
*Spread*, et regarde la colonne pendant les heures actives.

## Combien de trades par jour ?

Avec cette config en **M1**, compte grossièrement **10 à 25 trades/jour** selon
la volatilité (jours de news US = beaucoup plus). En marché très calme ça peut
retomber à quelques trades. Le chiffre exact vient du **Strategy Tester**.

## ⚠️ Attention — l'agressivité a un coût

Plus de trades = **plus de frais** (commission IC Markets à chaque trade) et
**plus d'exposition au bruit** du M1. Une version agressive n'est pas forcément
plus rentable qu'une version sélective.

**Procédure obligatoire avant le réel :**
1. **Strategy Tester** — XAUUSD **M1**, modèle *ticks réels*, 2–3 mois.
   Regarde surtout le **profit factor**, le **drawdown max** et le **net après
   commissions** (mets bien la commission IC Markets dans les réglages du test).
2. **Compte démo** IC Markets plusieurs semaines.
3. Réel en **0,01 lot** seulement une fois les résultats stables.

Aucun EA ne garantit de gains, encore moins en mode agressif. Teste d'abord.
