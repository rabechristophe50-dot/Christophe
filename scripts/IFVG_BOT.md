# IFVG Bot — « Comment bien trader les IFVG ? »

Concept ICT **Inverse Fair Value Gap**, livré en **deux morceaux** avec une logique
strictement identique, réglés pour l'**OR (XAUUSD) en 5 min et 15 min** :

| Livrable | Fichier | Rôle |
|----------|---------|------|
| **Stratégie** (backtest) | [`ifvg_bot.pine`](./ifvg_bot.pine) | Pine Script v6 : backtest, entrées/SL/TP auto, Strategy Tester |
| **Bot live** (signaux) | [`../ifvg-bot.js`](../ifvg-bot.js) | Lit le chart TradingView live (CDP) et émet les signaux XAUUSD 5m/15m |

> Réglage OR 5/15m : la taille minimale de FVG est filtrée par **ATR(14)** (`0.25 × ATR`),
> donc le setup s'auto-adapte entre le 5 min et le 15 min sans retoucher de valeur en points.

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

### A. La stratégie (backtest sur TradingView)
1. Lance TradingView Desktop en mode debug (voir `SETUP_GUIDE.md`), chart sur **OANDA:XAUUSD** en 5m ou 15m.
2. Pousse et compile le script :
   ```bash
   cp scripts/ifvg_bot.pine scripts/current.pine
   node scripts/pine_push.js
   ```
3. Ouvre le **Strategy Tester** pour le backtest, ajuste les inputs.

### B. Le bot live (signaux + exécution broker)
```bash
node ifvg-bot.js                # scanne XAUUSD 5m & 15m — ordres en DRY-RUN (simulés)
node ifvg-bot.js --live         # 🔴 envoie de VRAIS ordres sur le broker
node ifvg-bot.js --signals-only # signaux seuls, aucune interaction broker
node ifvg-bot.js --selftest     # teste la logique sans TradingView
```
Le bot lit le chart via le CDP (port 9222), applique l'IFVG, log chaque signal
dans la console + `ifvg-signals.log`, dessine SL/TP sur le chart, puis passe l'ordre.

**Exécution broker (BitGet Futures / mix v2)** — réutilise la signature de `scalper-run.js`.
Clés lues dans `.env` : `BITGET_API_KEY` / `BITGET_SECRET_KEY` / `BITGET_PASSPHRASE`.
Chaque trade part en **ordre marché avec TP/SL préréglés**, taille calculée depuis le
risque $ (`riskUsd`) et la distance entry→SL, plafonnée par `maxSizeUsd`.

Config `CFG.broker` en haut du fichier :

| Champ | Rôle |
|-------|------|
| `enabled` | `false` = signaux seuls |
| `dryRun` | `true` par défaut (simule) ; `--live` l'inverse |
| `symbol` | ticker d'**exécution** chez le broker |
| `leverage` / `marginMode` | levier & mode de marge |
| `riskUsd` / `maxSizeUsd` | risque par trade & plafond notionnel |

> ⚠️ **Symbole OR** : le signal est calculé sur `OANDA:XAUUSD` (chart), mais BitGet ne liste
> pas le Forex XAUUSD. Le défaut `XAUTUSDT` (Tether Gold) est le proxy or le plus proche —
> mets dans `CFG.broker.symbol` le ticker exact de ton broker. Pour un vrai broker Forex/CFD
> (OANDA, MT5…), remplace `bitgetRequest`/`placeBrokerOrder` par l'API correspondante.
>
> 🔴 **Sécurité** : `dryRun` est actif par défaut. Vérifie le symbole, le levier et `riskUsd`,
> teste d'abord sur un compte démo, puis lance `--live` en connaissance de cause.

## Paramètres clés

- **Longueur des swings** — sensibilité de la liquidité (plus haut = swings majeurs).
- **Fenêtre max sweep→IFVG** — nombre de bougies avant expiration du setup.
- **Exiger 1 seul FVG** — applique strictement la règle #2.
- **Cible = ERL (swing)** — vise la liquidité externe ; sinon R:R fixe.

> ⚠️ Outil d'aide à la décision / backtest. Teste en démo avant tout usage réel.
