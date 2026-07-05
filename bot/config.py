"""
Configuration du mini-bot de scalping OR (XAUUSD).

Tous les reglages sont ici. Modifie ces valeurs, pas le code du bot.
1 pip = 0.01 $ (1 cent) sur l'or, comme dans l'EA MT5.
"""

# ----- Connexion MT5 -----
# Laisse a None pour utiliser le terminal MT5 deja ouvert et connecte.
# Sinon renseigne ton compte IC Markets pour que le bot se connecte lui-meme.
MT5_LOGIN = None          # ex : 12345678 (numero de compte)
MT5_PASSWORD = None       # ex : "MonMotDePasse"
MT5_SERVER = None         # ex : "ICMarketsSC-Demo" ou "ICMarketsSC-Live"
MT5_PATH = None           # ex : r"C:\Program Files\MetaTrader 5\terminal64.exe" (optionnel)

# ----- Symbole / timeframe -----
SYMBOL = "XAUUSD"         # adapte au nom exact chez IC Markets (parfois "XAUUSD.a" / "GOLD")
TIMEFRAME = "M5"          # M1, M5, M15... (M1 = plus agressif)

# ----- Identification -----
MAGIC_NUMBER = 20260704
COMMENT = "PureScalperBot"

# ----- Gestion du risque -----
USE_MONEY_MGMT = True     # lot dynamique base sur le risque
RISK_PERCENT = 0.5        # risque par trade (% du capital)
FIXED_LOT = 0.01          # lot fixe si USE_MONEY_MGMT = False
MAX_LOT = 5.0             # lot maximum autorise
MAX_POSITIONS = 1         # positions simultanees (2 = plus agressif)

# ----- Indicateurs -----
TREND_EMA = 200           # EMA filtre de tendance
FAST_EMA = 8              # EMA rapide (5 = agressif)
SLOW_EMA = 21             # EMA lente (13 = agressif)
RSI_PERIOD = 14
RSI_BUY_MAX = 70.0        # RSI max pour acheter
RSI_BUY_MIN = 50.0        # RSI min pour acheter (milieu bande)
RSI_SELL_MIN = 30.0       # RSI min pour vendre
RSI_SELL_MAX = 50.0       # RSI max pour vendre (milieu bande)
ATR_PERIOD = 14
ATR_MIN_PIPS = 80.0       # ATR minimum en pips (40 = agressif)

# ----- Stop Loss / Take Profit (bases sur l'ATR) -----
SL_ATR_MULT = 1.5
TP_ATR_MULT = 2.0

# ----- Protection dynamique -----
USE_BREAKEVEN = True
BREAKEVEN_PIPS = 120.0    # profit (pips) avant break-even
BREAKEVEN_LOCK = 20.0     # pips verrouilles au break-even
USE_TRAILING = True
TRAIL_START_PIPS = 180.0  # profit (pips) avant trailing
TRAIL_STEP_PIPS = 100.0   # distance du trailing (pips)

# ----- Filtres -----
MAX_SPREAD_PIPS = 40.0    # spread max (IC Markets Raw : 25 suffit)
USE_TIME_FILTER = True
START_HOUR = 7            # heure serveur
END_HOUR = 20            # heure serveur
ONE_TRADE_PER_BAR = True  # une seule entree par bougie

# ----- Divers -----
DEVIATION = 20            # slippage max autorise (points)
POLL_SECONDS = 5          # frequence de la boucle (secondes)
DRY_RUN = False           # True = simule sans passer d'ordre reel (log seulement)


# ===========================================================================
# STRADDLE BOT (straddle_bot.py) - reglages independants
# ===========================================================================
# Deux ordres autour du prix, SL tres serre, TP au niveau oppose.
#   MODE "reversion" : Buy Limit en bas / Sell Limit en haut.
#                      TP = ligne opposee (le prix "revient"). SL serre au-dela.
#   MODE "breakout"  : Buy Stop en haut / Sell Stop en bas.
#                      TP dans le sens de la cassure. SL serre.
STR_MODE = "reversion"          # "reversion" (defaut, TP au niveau oppose) ou "breakout"

STR_ENTRY_DISTANCE_PIPS = 100.0 # distance des ordres au prix (100 pips = 1.00 $ sur l'or)
STR_SL_PIPS = 20.0              # SL tres serre (20 pips = 0.20 $)
STR_TP_PIPS = 150.0             # TP en mode breakout uniquement (en reversion : TP = ligne opposee)

STR_LOT = 0.01                  # lot fixe
STR_USE_RISK = False            # True = lot dynamique base sur le risque et le SL
STR_RISK_PERCENT = 0.5          # risque par trade (% du capital) si STR_USE_RISK
STR_MAX_POSITIONS = 1           # positions ouvertes max

STR_RECENTER_EACH_BAR = True    # re-centre les ordres en attente a chaque nouvelle bougie
STR_MAX_SPREAD_PIPS = 40.0      # spread max pour poser/gerer les ordres
STR_USE_TIME_FILTER = True      # respecter START_HOUR / END_HOUR ci-dessus
STR_MAGIC = 20260705            # magic dedie (different du scalper pour ne pas melanger)
STR_COMMENT = "PureStraddleBot"


# ===========================================================================
# NOTIFICATIONS TELEGRAM (optionnel, pour les deux bots)
# ===========================================================================
# 1. Cree un bot via @BotFather sur Telegram -> recupere le TOKEN.
# 2. Ecris un message a ton bot, puis va sur
#    https://api.telegram.org/bot<TOKEN>/getUpdates pour lire ton chat_id.
TG_ENABLED = False              # True pour activer les notifications
TG_TOKEN = ""                   # ex : "123456789:AAExxxxxxxxxxxxxxxxxxxxxxxx"
TG_CHAT_ID = ""                 # ex : "987654321"
