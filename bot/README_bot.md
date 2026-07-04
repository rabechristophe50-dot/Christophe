# Mini-bot Python de Scalping OR (XAUUSD)

Un bot Python **100% automatique** qui reproduit la stratégie de scalping OR de
l'Expert Advisor, mais **hors MT5** : c'est un script Python qui se connecte à
ton terminal MetaTrader 5 (IC Markets) et passe les ordres tout seul.

> C'est le même cerveau que l'EA `PureScalperEA`, mais en Python. Tu peux le
> lancer, l'arrêter, le logger et le modifier facilement.

## Comment ça marche

```
scalper_bot.py  ←→  librairie MetaTrader5  ←→  Terminal MT5 (IC Markets)  ←→  Marché
```

Le bot lit les bougies via MT5, calcule EMA200 / EMA rapide-lente / RSI / ATR,
et quand les conditions s'alignent il envoie un ordre (avec SL/TP, break-even,
trailing) directement dans ton compte.

## Prérequis

- **Windows** (la librairie `MetaTrader5` ne fonctionne que sous Windows).
- **MetaTrader 5** installé et **connecté à ton compte IC Markets**.
- **Python 3.10+**.
- Dans MT5 : `Outils → Options → Expert Advisors` → coche
  **« Autoriser le trading algorithmique »**.

## Installation

```bash
pip install -r requirements.txt
```

## Configuration

Ouvre **`config.py`** et règle :

1. **Connexion** : laisse `MT5_LOGIN/PASSWORD/SERVER = None` pour utiliser le
   terminal déjà ouvert, OU renseigne ton compte IC Markets pour que le bot se
   connecte seul (ex. serveur `ICMarketsSC-Demo`).
2. **`SYMBOL`** : mets le nom **exact** de l'or chez IC Markets. Souvent
   `XAUUSD`, parfois `XAUUSD.a` ou `GOLD`. Vérifie dans l'Observation du marché.
3. **`TIMEFRAME`** : `M5` (normal) ou `M1` (agressif).
4. **Risque / filtres** : identiques à l'EA (voir commentaires dans `config.py`).

### Preset agressif (plus de trades)
Dans `config.py`, mets :
```
TIMEFRAME    = "M1"
FAST_EMA     = 5
SLOW_EMA     = 13
RSI_BUY_MAX  = 80.0 ; RSI_BUY_MIN  = 45.0
RSI_SELL_MIN = 20.0 ; RSI_SELL_MAX = 55.0
ATR_MIN_PIPS = 40.0
MAX_POSITIONS = 2
MAX_SPREAD_PIPS = 25.0   # IC Markets Raw
```

## Lancement

**Toujours tester d'abord** avec `DRY_RUN = True` dans `config.py` : le bot
détecte les signaux et les affiche **sans passer d'ordre réel**.

```bash
python scalper_bot.py
```

Tu verras dans la console :
```
[2026-07-04 14:32:10] Connecte. Compte 12345678 | ICMarketsSC-Demo | solde 10000.0 USD
[2026-07-04 14:32:10] Symbole XAUUSD | digits=2 point=0.01 pip=0.01
[2026-07-04 14:35:00] BUY OUVERT | lot=0.05 prix=2351.20 SL=2349.80 TP=2353.20
```

Arrête avec **Ctrl+C** (le bot ferme proprement la connexion).

## Le point « heure serveur »

Le filtre horaire utilise l'heure **de ta machine**. Si l'heure serveur MT5 IC
Markets diffère de ton PC, ajuste `START_HOUR` / `END_HOUR` en conséquence, ou
mets `USE_TIME_FILTER = False` pour désactiver le filtre.

## ⚠️ Sécurité et avertissements

- **DRY_RUN d'abord**, puis **compte DÉMO** plusieurs semaines, puis micro-lot réel.
- Le bot doit tourner en continu : garde le **PC allumé** et MT5 ouvert (ou
  utilise un VPS). S'il s'arrête, il ne gère plus les positions.
- Ne mets **jamais** ton mot de passe réel dans un fichier partagé/commité.
  `config.py` est en `.gitignore` conseillé si tu y mets des identifiants.
- Aucun bot ne garantit de gains. Le scalping de l'or est risqué (volatilité,
  news, spread). Tu es responsable de tes trades.

## Différence avec l'EA MT5

| | EA (`.mq5`) | Bot Python |
|---|---|---|
| Où ça tourne | Dans MT5 | Script séparé + MT5 ouvert |
| Modif du code | MetaEditor (MQL5) | N'importe quel éditeur (Python) |
| Backtest intégré | Oui (Strategy Tester) | Non (à coder à part) |
| Portabilité | MT5 uniquement | Facile à étendre (logs, Telegram, DB...) |

Pour **backtester**, utilise plutôt l'EA dans le Strategy Tester de MT5 : c'est
fait pour ça et c'est plus fiable.
