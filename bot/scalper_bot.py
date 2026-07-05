"""
Mini-bot de scalping OR (XAUUSD) - 100% automatique.

Reproduit la strategie de l'Expert Advisor PureScalperEA en Python, via la
librairie officielle MetaTrader5. Le bot se connecte a ton terminal MT5
(IC Markets), lit les prix, calcule les indicateurs, ouvre/gere/ferme les
trades tout seul.

Strategie : Trend-Momentum Scalper
  - Filtre de tendance   : EMA 200
  - Signal d'entree      : croisement EMA rapide/lente + RSI
  - Filtre de volatilite : ATR
  - Gestion du risque    : lot dynamique (% du capital)
  - Protection           : SL/TP ATR, break-even, trailing stop

Usage :
    python scalper_bot.py

⚠️ Teste TOUJOURS en compte DEMO d'abord. Aucun profit garanti.
"""

import sys
import time
from datetime import datetime

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERREUR : la librairie MetaTrader5 n'est pas installee.")
    print("Installe-la avec :  pip install MetaTrader5")
    sys.exit(1)

import numpy as np

import config as C
from telegram_notify import notify, notify_startup


# ---------------------------------------------------------------------------
# Indicateurs (calcul manuel, sans dependance lourde)
# ---------------------------------------------------------------------------
def ema(values, period):
    """Moyenne mobile exponentielle. Retourne un tableau numpy de meme taille."""
    values = np.asarray(values, dtype=float)
    alpha = 2.0 / (period + 1.0)
    out = np.empty_like(values)
    out[0] = values[0]
    for i in range(1, len(values)):
        out[i] = alpha * values[i] + (1.0 - alpha) * out[i - 1]
    return out


def rsi(closes, period):
    """RSI classique (Wilder). Retourne un tableau numpy."""
    closes = np.asarray(closes, dtype=float)
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    out = np.full_like(closes, 50.0)
    if len(closes) <= period:
        return out

    avg_gain = gains[:period].mean()
    avg_loss = losses[:period].mean()

    for i in range(period, len(closes)):
        g = gains[i - 1]
        l = losses[i - 1]
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100.0 - (100.0 / (1.0 + rs))
    return out


def atr(highs, lows, closes, period):
    """Average True Range (Wilder). Retourne un tableau numpy."""
    highs = np.asarray(highs, dtype=float)
    lows = np.asarray(lows, dtype=float)
    closes = np.asarray(closes, dtype=float)

    tr = np.zeros(len(closes))
    tr[0] = highs[0] - lows[0]
    for i in range(1, len(closes)):
        tr[i] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )

    out = np.zeros(len(closes))
    if len(closes) <= period:
        return out
    out[period] = tr[1:period + 1].mean()
    for i in range(period + 1, len(closes)):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


# ---------------------------------------------------------------------------
# Etat global (calcule a l'init)
# ---------------------------------------------------------------------------
class Ctx:
    point = 0.0
    pip = 0.0
    digits = 0
    tf = None
    last_bar_time = None


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


TF_MAP = {
    "M1": None, "M5": None, "M15": None, "M30": None,
    "H1": None, "H4": None, "D1": None,
}


def resolve_timeframes():
    TF_MAP["M1"] = mt5.TIMEFRAME_M1
    TF_MAP["M5"] = mt5.TIMEFRAME_M5
    TF_MAP["M15"] = mt5.TIMEFRAME_M15
    TF_MAP["M30"] = mt5.TIMEFRAME_M30
    TF_MAP["H1"] = mt5.TIMEFRAME_H1
    TF_MAP["H4"] = mt5.TIMEFRAME_H4
    TF_MAP["D1"] = mt5.TIMEFRAME_D1


# ---------------------------------------------------------------------------
# Connexion / init
# ---------------------------------------------------------------------------
def connect():
    kwargs = {}
    if C.MT5_PATH:
        kwargs["path"] = C.MT5_PATH
    if C.MT5_LOGIN and C.MT5_PASSWORD and C.MT5_SERVER:
        kwargs.update(login=int(C.MT5_LOGIN), password=C.MT5_PASSWORD, server=C.MT5_SERVER)

    if not mt5.initialize(**kwargs):
        log(f"Echec initialize() : {mt5.last_error()}")
        return False

    resolve_timeframes()
    Ctx.tf = TF_MAP.get(C.TIMEFRAME)
    if Ctx.tf is None:
        log(f"Timeframe inconnu : {C.TIMEFRAME}")
        return False

    # Selectionne le symbole dans Market Watch
    if not mt5.symbol_select(C.SYMBOL, True):
        log(f"Impossible de selectionner le symbole {C.SYMBOL}")
        return False

    info = mt5.symbol_info(C.SYMBOL)
    if info is None:
        log(f"Symbole introuvable : {C.SYMBOL}")
        return False

    Ctx.digits = info.digits
    Ctx.point = info.point
    Ctx.pip = info.point * 10 if info.digits in (3, 5) else info.point

    acc = mt5.account_info()
    log(f"Connecte. Compte {acc.login} | {acc.server} | solde {acc.balance} {acc.currency}")
    log(f"Symbole {C.SYMBOL} | digits={Ctx.digits} point={Ctx.point} pip={Ctx.pip}")
    if C.DRY_RUN:
        log("MODE DRY_RUN : aucun ordre reel ne sera passe (log seulement).")
    return True


# ---------------------------------------------------------------------------
# Filtres
# ---------------------------------------------------------------------------
def is_trading_time():
    if not C.USE_TIME_FILTER:
        return True
    h = datetime.now().hour  # heure locale de la machine ~ heure serveur si machine reglee
    if C.START_HOUR <= C.END_HOUR:
        return C.START_HOUR <= h < C.END_HOUR
    return h >= C.START_HOUR or h < C.END_HOUR


def spread_pips():
    tick = mt5.symbol_info_tick(C.SYMBOL)
    if tick is None:
        return 1e9
    return (tick.ask - tick.bid) / Ctx.pip


def count_my_positions():
    positions = mt5.positions_get(symbol=C.SYMBOL)
    if positions is None:
        return 0
    return sum(1 for p in positions if p.magic == C.MAGIC_NUMBER)


# ---------------------------------------------------------------------------
# Calcul du lot
# ---------------------------------------------------------------------------
def normalize_lot(lot, info):
    step = info.volume_step
    if step > 0:
        lot = np.floor(lot / step) * step
    lot = max(info.volume_min, min(lot, info.volume_max))
    return round(lot, 2)


def calc_lot(sl_distance):
    info = mt5.symbol_info(C.SYMBOL)
    if not C.USE_MONEY_MGMT:
        return normalize_lot(C.FIXED_LOT, info)

    acc = mt5.account_info()
    risk_money = acc.balance * C.RISK_PERCENT / 100.0

    tick_value = info.trade_tick_value
    tick_size = info.trade_tick_size
    if tick_size <= 0 or tick_value <= 0:
        return normalize_lot(C.FIXED_LOT, info)

    loss_per_lot = (sl_distance / tick_size) * tick_value
    if loss_per_lot <= 0:
        return normalize_lot(C.FIXED_LOT, info)

    lot = risk_money / loss_per_lot
    lot = min(lot, C.MAX_LOT)
    return normalize_lot(lot, info)


# ---------------------------------------------------------------------------
# Passage d'ordre
# ---------------------------------------------------------------------------
def filling_mode(info):
    """Detecte un mode de remplissage supporte par le symbole."""
    filling = info.filling_mode
    if filling & 1:      # SYMBOL_FILLING_FOK
        return mt5.ORDER_FILLING_FOK
    if filling & 2:      # SYMBOL_FILLING_IOC
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def open_trade(direction, atr_value):
    info = mt5.symbol_info(C.SYMBOL)
    tick = mt5.symbol_info_tick(C.SYMBOL)
    price = tick.ask if direction == "buy" else tick.bid

    sl_dist = atr_value * C.SL_ATR_MULT
    tp_dist = atr_value * C.TP_ATR_MULT

    min_stop = info.trade_stops_level * Ctx.point
    if sl_dist < min_stop:
        sl_dist = min_stop * 1.5
    if tp_dist < min_stop:
        tp_dist = min_stop * 1.5

    if direction == "buy":
        sl = price - sl_dist
        tp = price + tp_dist
        order_type = mt5.ORDER_TYPE_BUY
    else:
        sl = price + sl_dist
        tp = price - tp_dist
        order_type = mt5.ORDER_TYPE_SELL

    sl = round(sl, Ctx.digits)
    tp = round(tp, Ctx.digits)
    lot = calc_lot(sl_dist)
    if lot <= 0:
        log("Lot invalide, trade annule.")
        return

    if C.DRY_RUN:
        log(f"[DRY_RUN] {direction.upper()} lot={lot} prix={price} SL={sl} TP={tp}")
        return

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": C.SYMBOL,
        "volume": float(lot),
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": C.DEVIATION,
        "magic": C.MAGIC_NUMBER,
        "comment": C.COMMENT,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    result = mt5.order_send(request)
    if result is None:
        log(f"order_send a retourne None : {mt5.last_error()}")
        return
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        log(f"Echec {direction.upper()} retcode={result.retcode} ({result.comment})")
    else:
        log(f"{direction.upper()} OUVERT | lot={lot} prix={price} SL={sl} TP={tp}")
        notify(f"📈 {direction.upper()} {C.SYMBOL} ouvert | lot={lot} @ {price} | SL={sl} TP={tp}")


# ---------------------------------------------------------------------------
# Gestion des positions ouvertes : break-even + trailing
# ---------------------------------------------------------------------------
def modify_sl(position, new_sl):
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": C.SYMBOL,
        "position": position.ticket,
        "sl": round(new_sl, Ctx.digits),
        "tp": position.tp,
        "magic": C.MAGIC_NUMBER,
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        rc = result.retcode if result else mt5.last_error()
        log(f"Echec modification SL ticket={position.ticket} ({rc})")


def manage_positions():
    if not C.USE_BREAKEVEN and not C.USE_TRAILING:
        return
    positions = mt5.positions_get(symbol=C.SYMBOL)
    if not positions:
        return
    tick = mt5.symbol_info_tick(C.SYMBOL)

    for p in positions:
        if p.magic != C.MAGIC_NUMBER:
            continue
        is_buy = p.type == mt5.POSITION_TYPE_BUY
        cur_price = tick.bid if is_buy else tick.ask
        profit_pips = ((cur_price - p.price_open) if is_buy else (p.price_open - cur_price)) / Ctx.pip

        new_sl = p.sl

        if C.USE_BREAKEVEN and profit_pips >= C.BREAKEVEN_PIPS:
            be = (p.price_open + C.BREAKEVEN_LOCK * Ctx.pip) if is_buy \
                else (p.price_open - C.BREAKEVEN_LOCK * Ctx.pip)
            if is_buy and (p.sl < be or p.sl == 0):
                new_sl = be
            if not is_buy and (p.sl > be or p.sl == 0):
                new_sl = be

        if C.USE_TRAILING and profit_pips >= C.TRAIL_START_PIPS:
            trail = (cur_price - C.TRAIL_STEP_PIPS * Ctx.pip) if is_buy \
                else (cur_price + C.TRAIL_STEP_PIPS * Ctx.pip)
            if is_buy and trail > new_sl:
                new_sl = trail
            if not is_buy and (trail < new_sl or new_sl == 0):
                new_sl = trail

        if new_sl != p.sl and abs(new_sl - p.sl) >= Ctx.point:
            modify_sl(p, new_sl)


# ---------------------------------------------------------------------------
# Logique de signal
# ---------------------------------------------------------------------------
def check_signals():
    # On recupere assez de bougies pour l'EMA200
    bars = max(C.TREND_EMA + 50, 260)
    rates = mt5.copy_rates_from_pos(C.SYMBOL, Ctx.tf, 0, bars)
    if rates is None or len(rates) < C.TREND_EMA + 5:
        return

    closes = rates["close"]
    highs = rates["high"]
    lows = rates["low"]

    trend = ema(closes, C.TREND_EMA)
    fast = ema(closes, C.FAST_EMA)
    slow = ema(closes, C.SLOW_EMA)
    r = rsi(closes, C.RSI_PERIOD)
    a = atr(highs, lows, closes, C.ATR_PERIOD)

    # Index -2 = derniere bougie fermee, -3 = precedente
    trend_v = trend[-2]
    fast0, slow0 = fast[-2], slow[-2]
    fast1, slow1 = fast[-3], slow[-3]
    rsi_v = r[-2]
    atr_v = a[-2]
    close_v = closes[-2]

    atr_pips = atr_v / Ctx.pip
    if atr_pips < C.ATR_MIN_PIPS:
        return

    cross_up = fast1 <= slow1 and fast0 > slow0
    trend_up = close_v > trend_v and fast0 > trend_v
    rsi_buy = C.RSI_BUY_MIN < rsi_v < C.RSI_BUY_MAX
    if cross_up and trend_up and rsi_buy:
        open_trade("buy", atr_v)
        return

    cross_dn = fast1 >= slow1 and fast0 < slow0
    trend_dn = close_v < trend_v and fast0 < trend_v
    rsi_sell = C.RSI_SELL_MIN < rsi_v < C.RSI_SELL_MAX
    if cross_dn and trend_dn and rsi_sell:
        open_trade("sell", atr_v)


# ---------------------------------------------------------------------------
# Boucle principale
# ---------------------------------------------------------------------------
def run():
    if not connect():
        return

    log("Bot demarre. Ctrl+C pour arreter.")
    notify_startup("Scalper bot", C.SYMBOL, C.TIMEFRAME)
    try:
        while True:
            # Gestion des positions ouvertes a chaque tour
            manage_positions()

            # Detection de nouvelle bougie
            rates = mt5.copy_rates_from_pos(C.SYMBOL, Ctx.tf, 0, 1)
            new_bar = False
            if rates is not None and len(rates) > 0:
                bar_time = rates[-1]["time"]
                if bar_time != Ctx.last_bar_time:
                    Ctx.last_bar_time = bar_time
                    new_bar = True

            look_for_entry = new_bar if C.ONE_TRADE_PER_BAR else True

            if look_for_entry:
                if is_trading_time() and spread_pips() <= C.MAX_SPREAD_PIPS \
                        and count_my_positions() < C.MAX_POSITIONS:
                    check_signals()

            time.sleep(C.POLL_SECONDS)

    except KeyboardInterrupt:
        log("Arret demande par l'utilisateur.")
    finally:
        mt5.shutdown()
        log("Bot arrete, connexion MT5 fermee.")


if __name__ == "__main__":
    run()
