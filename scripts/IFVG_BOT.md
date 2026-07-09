# IFVG Bot — « Comment bien trader les IFVG ? »

Concept ICT **Inverse Fair Value Gap**, livré en **deux morceaux** avec une logique
strictement identique, réglés pour l'**OR (XAUUSD) en 5 min et 15 min** :

| Livrable | Fichier | Rôle |
|----------|---------|------|
| **Stratégie** (backtest) | [`ifvg_bot.pine`](./ifvg_bot.pine) | Pine Script v6 : backtest, entrées/SL/TP auto, Strategy Tester |
| **Indicateur d'entrée** | [`ifvg_indicator.pine`](./ifvg_indicator.pine) | Affiche les entrées (flèches), zones IFVG, TP/SL + **alertes** (dont JSON webhook) |
| **Bot live** (exécution) | [`../ifvg-bot.js`](../ifvg-bot.js) | Lit le chart TradingView live (CDP), émet les signaux et passe les ordres |

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

### A-bis. L'indicateur d'entrée (TradingView)
Charge [`ifvg_indicator.pine`](./ifvg_indicator.pine) sur ton chart XAUUSD 5m/15m.
Il **n'ouvre pas d'ordres** — il affiche `ENTRY ↑ / ↓`, la zone IFVG, les niveaux TP/SL,
et fournit **3 alertes** :

| Alerte | Condition | Usage |
|--------|-----------|-------|
| `IFVG LONG` | entrée achat confirmée | notif simple |
| `IFVG SHORT` | entrée vente confirmée | notif simple |
| *Any alert() function call* | message **JSON** dynamique | webhook → bridge MT5/cTrader |

Le message JSON est identique au payload du bot (`symbol`, `side`, `entry`, `sl`, `tp`…),
donc l'alerte de l'indicateur peut piloter directement ton exécution.

**MT5 / cTrader** : TradingView ne se connecte pas nativement à MT5/cTrader → il faut un
*bridge* qui reçoit le webhook. Deux options : (1) un EA MT5 / cBot cTrader qui écoute un
webhook local, ou (2) faire tourner `ifvg-bot.js` (mode `webhook`) qui relaie vers ce bridge.
Le concept peut aussi être réécrit en **MQL5** (MT5) ou **C#/cAlgo** (cTrader) pour tourner
100% nativement sur la plateforme, sans TradingView.

### B. Le bot live (signaux + exécution broker)
```bash
node ifvg-bot.js                # scanne XAUUSD 5m & 15m — ordres en DRY-RUN (simulés)
node ifvg-bot.js --live         # 🔴 envoie de VRAIS ordres sur le broker
node ifvg-bot.js --signals-only # signaux seuls, aucune interaction broker
node ifvg-bot.js --selftest     # teste la logique sans TradingView
```
Le bot lit le chart via le CDP (port 9222), applique l'IFVG, log chaque signal
dans la console + `ifvg-signals.log`, dessine SL/TP sur le chart, puis passe l'ordre.

**Exécution agnostique au broker.** Symbole par défaut : **`XAUUSD`** (le GOLD standard,
accepté par la plupart des brokers Forex/CFD). Deux modes via `CFG.broker.type` :

- **`"webhook"` (défaut, universel)** — le bot POST un ordre JSON standard vers
  `CFG.broker.webhookUrl`. Ton connecteur/bridge le traduit en ordre réel : EA
  **MT4/MT5**, cTrader, **OANDA** REST, 3Commas, Alertatron… Marche avec *n'importe quel*
  broker qui accepte le gold. Payload envoyé :
  ```json
  { "symbol":"XAUUSD", "side":"buy", "type":"market",
    "size":6.67, "lots":0.07, "entry":2995.5, "sl":2988.5, "tp":3009.5,
    "riskUsd":20, "timeframe":"5", "strategy":"IFVG" }
  ```
- **`"bitget"`** — adaptateur crypto Futures/mix v2 (clés `.env` :
  `BITGET_API_KEY` / `BITGET_SECRET_KEY` / `BITGET_PASSPHRASE`), ordre marché + TP/SL préréglés.

Dans les deux cas, la **taille** vient du risque $ (`riskUsd`) ÷ distance entry→SL,
plafonnée par `maxSizeUsd` ; les **lots** = size ÷ `contractSize` (100 oz/lot par défaut).

Config `CFG.broker` :

| Champ | Rôle |
|-------|------|
| `enabled` | `false` = signaux seuls |
| `dryRun` | `true` par défaut (simule) ; `--live` l'inverse |
| `type` | `"webhook"` (universel) ou `"bitget"` |
| `symbol` | ticker d'exécution (`XAUUSD` par défaut) |
| `webhookUrl` / `webhookHeaders` | endpoint de ton broker + entêtes/auth |
| `riskUsd` / `maxSizeUsd` / `contractSize` | dimensionnement |

> 🔴 **Sécurité** : `dryRun` est actif par défaut. Renseigne `webhookUrl`, vérifie
> symbole/`riskUsd`, teste en démo, puis lance `--live`.

## Paramètres clés

- **Longueur des swings** — sensibilité de la liquidité (plus haut = swings majeurs).
- **Fenêtre max sweep→IFVG** — nombre de bougies avant expiration du setup.
- **Exiger 1 seul FVG** — applique strictement la règle #2.
- **Cible = ERL (swing)** — vise la liquidité externe ; sinon R:R fixe.

> ⚠️ Outil d'aide à la décision / backtest. Teste en démo avant tout usage réel.
