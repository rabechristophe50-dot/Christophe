"""
Mini-bot STRADDLE / REVERSION sur l'OR (XAUUSD) - 100% automatique.

Principe (mode "reversion", defaut) :
  - On pose 2 ordres en attente autour du prix :
        Buy Limit  en bas  (ligne "buy")
        Sell Limit en haut (ligne "sell")
  - SL TRES SERRE juste au-dela de la ligne.
  - TP = la LIGNE OPPOSEE : quand le prix "revient" vers l'autre bord, profit.
  - Des qu'un ordre est rempli, l'autre ordre en attente est annule (OCO).

Mode "breakout" (optionnel) :
  - Buy Stop en haut / Sell Stop en bas, TP dans le sens de la cassure.

Pourquoi des ordres LIMIT en reversion ?
  Pour qu'un TP "au niveau oppose quand le prix revient" existe, il faut entrer
  aux extremes et viser le retour. Un vrai buy STOP achete en haut et exige que
  le prix CONTINUE de monter : impossible d'avoir un TP "au retour". Les LIMIT
  sont donc le seul montage coherent avec ta description.

Usage :
    python straddle_bot.py

⚠️ Teste TOUJOURS en DRY_RUN puis en compte DEMO. Aucun profit garanti.
"""

import sys
import time
from datetime import datetime

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERREUR : librairie MetaTrader5 manquante. Installe :  pip install MetaTrader5")
    sys.exit(1)

import numpy as np

import config as C
from telegram_notify import notify, notify_startup


# ---------------------------------------------------------------------------
class Ctx:
    point = 0.0
    pip = 0.0
    digits = 0
    tf = None
    last_bar_time = None


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


TF_MAP = {}


def connect():
    kwargs = {}
    if C.MT5_PATH:
        kwargs["path"] = C.MT5_PATH
    if C.MT5_LOGIN and C.MT5_PASSWORD and C.MT5_SERVER:
        kwargs.update(login=int(C.MT5_LOGIN), password=C.MT5_PASSWORD, server=C.MT5_SERVER)

    if not mt5.initialize(**kwargs):
        log(f"Echec initialize() : {mt5.last_error()}")
        return False

    TF_MAP.update({
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    })
    Ctx.tf = TF_MAP.get(C.TIMEFRAME)
    if Ctx.tf is None:
        log(f"Timeframe inconnu : {C.TIMEFRAME}")
        return False

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
    log(f"Symbole {C.SYMBOL} | digits={Ctx.digits} pip={Ctx.pip} | MODE={C.STR_MODE}")
    if C.DRY_RUN:
        log("MODE DRY_RUN : aucun ordre reel ne sera passe (log seulement).")
    return True


# ---------------------------------------------------------------------------
def is_trading_time():
    if not C.STR_USE_TIME_FILTER:
        return True
    h = datetime.now().hour
    if C.START_HOUR <= C.END_HOUR:
        return C.START_HOUR <= h < C.END_HOUR
    return h >= C.START_HOUR or h < C.END_HOUR


def spread_pips():
    tick = mt5.symbol_info_tick(C.SYMBOL)
    if tick is None:
        return 1e9
    return (tick.ask - tick.bid) / Ctx.pip


def my_positions():
    pos = mt5.positions_get(symbol=C.SYMBOL)
    return [p for p in (pos or []) if p.magic == C.STR_MAGIC]


def my_pending_orders():
    orders = mt5.orders_get(symbol=C.SYMBOL)
    return [o for o in (orders or []) if o.magic == C.STR_MAGIC]


# ---------------------------------------------------------------------------
def normalize_lot(lot, info):
    step = info.volume_step
    if step > 0:
        lot = np.floor(lot / step) * step
    return round(max(info.volume_min, min(lot, info.volume_max)), 2)


def calc_lot(sl_distance):
    info = mt5.symbol_info(C.SYMBOL)
    if not C.STR_USE_RISK:
        return normalize_lot(C.STR_LOT, info)
    acc = mt5.account_info()
    risk_money = acc.balance * C.STR_RISK_PERCENT / 100.0
    tick_value = info.trade_tick_value
    tick_size = info.trade_tick_size
    if tick_size <= 0 or tick_value <= 0 or sl_distance <= 0:
        return normalize_lot(C.STR_LOT, info)
    loss_per_lot = (sl_distance / tick_size) * tick_value
    if loss_per_lot <= 0:
        return normalize_lot(C.STR_LOT, info)
    return normalize_lot(risk_money / loss_per_lot, info)


def filling_mode(info):
    f = info.filling_mode
    if f & 1:
        return mt5.ORDER_FILLING_FOK
    if f & 2:
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


# ---------------------------------------------------------------------------
def place_pending(order_type, price, sl, tp, lot):
    info = mt5.symbol_info(C.SYMBOL)
    price = round(price, Ctx.digits)
    sl = round(sl, Ctx.digits)
    tp = round(tp, Ctx.digits)

    names = {
        mt5.ORDER_TYPE_BUY_LIMIT: "BUY LIMIT",
        mt5.ORDER_TYPE_SELL_LIMIT: "SELL LIMIT",
        mt5.ORDER_TYPE_BUY_STOP: "BUY STOP",
        mt5.ORDER_TYPE_SELL_STOP: "SELL STOP",
    }
    label = names.get(order_type, str(order_type))

    if C.DRY_RUN:
        log(f"[DRY_RUN] {label} @ {price} | SL={sl} TP={tp} lot={lot}")
        return

    request = {
        "action": mt5.TRADE_ACTION_PENDING,
        "symbol": C.SYMBOL,
        "volume": float(lot),
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": C.DEVIATION,
        "magic": C.STR_MAGIC,
        "comment": C.STR_COMMENT,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        rc = result.retcode if result else mt5.last_error()
        cm = result.comment if result else ""
        log(f"Echec {label} @ {price} | retcode={rc} {cm}")
    else:
        log(f"{label} POSE @ {price} | SL={sl} TP={tp} lot={lot}")
        notify(f"⏳ {label} {C.SYMBOL} pose @ {price} | SL={sl} TP={tp} lot={lot}")


def cancel_pendings():
    for o in my_pending_orders():
        if C.DRY_RUN:
            log(f"[DRY_RUN] annulation pending #{o.ticket}")
            continue
        req = {"action": mt5.TRADE_ACTION_REMOVE, "order": o.ticket}
        res = mt5.order_send(req)
        if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
            rc = res.retcode if res else mt5.last_error()
            log(f"Echec annulation pending #{o.ticket} ({rc})")
        else:
            log(f"Pending #{o.ticket} annule")


# ---------------------------------------------------------------------------
def place_straddle():
    """Pose les 2 ordres en attente autour du prix courant."""
    tick = mt5.symbol_info_tick(C.SYMBOL)
    if tick is None:
        return
    mid = (tick.ask + tick.bid) / 2.0

    d = C.STR_ENTRY_DISTANCE_PIPS * Ctx.pip
    sl = C.STR_SL_PIPS * Ctx.pip
    tp = C.STR_TP_PIPS * Ctx.pip

    upper = mid + d      # ligne "sell" (haut)
    lower = mid - d      # ligne "buy"  (bas)
    lot = calc_lot(sl)

    if C.STR_MODE == "reversion":
        # Sell Limit en haut : SL serre au-dessus, TP = ligne opposee (bas)
        place_pending(mt5.ORDER_TYPE_SELL_LIMIT, upper, upper + sl, lower, lot)
        # Buy Limit en bas : SL serre en-dessous, TP = ligne opposee (haut)
        place_pending(mt5.ORDER_TYPE_BUY_LIMIT, lower, lower - sl, upper, lot)
    elif C.STR_MODE == "breakout":
        # Buy Stop en haut : SL serre en-dessous, TP dans le sens de la cassure
        place_pending(mt5.ORDER_TYPE_BUY_STOP, upper, upper - sl, upper + tp, lot)
        # Sell Stop en bas : SL serre au-dessus, TP dans le sens de la cassure
        place_pending(mt5.ORDER_TYPE_SELL_STOP, lower, lower + sl, lower - tp, lot)
    else:
        log(f"STR_MODE inconnu : {C.STR_MODE} (utilise 'reversion' ou 'breakout')")


# ---------------------------------------------------------------------------
def run():
    if not connect():
        return

    log("Straddle bot demarre. Ctrl+C pour arreter.")
    notify_startup("Straddle bot", C.SYMBOL, C.STR_MODE)
    try:
        while True:
            positions = my_positions()
            pendings = my_pending_orders()

            # OCO : si une position est ouverte, on annule les ordres restants
            if positions and pendings:
                log("Position ouverte -> annulation des ordres en attente restants (OCO)")
                p = positions[0]
                side = "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL"
                notify(f"✅ {side} {C.SYMBOL} declenche @ {p.price_open} | SL={p.sl} TP={p.tp} - autres ordres annules")
                cancel_pendings()

            # Detection de nouvelle bougie
            rates = mt5.copy_rates_from_pos(C.SYMBOL, Ctx.tf, 0, 1)
            new_bar = False
            if rates is not None and len(rates) > 0:
                bt = rates[-1]["time"]
                if bt != Ctx.last_bar_time:
                    Ctx.last_bar_time = bt
                    new_bar = True

            can_trade = (is_trading_time()
                         and spread_pips() <= C.STR_MAX_SPREAD_PIPS
                         and len(positions) < C.STR_MAX_POSITIONS)

            if can_trade and not positions:
                if not pendings:
                    # Aucun ordre : on pose le straddle
                    place_straddle()
                elif C.STR_RECENTER_EACH_BAR and new_bar:
                    # On recentre les ordres autour du nouveau prix
                    log("Nouvelle bougie -> recentrage du straddle")
                    cancel_pendings()
                    place_straddle()

            time.sleep(C.POLL_SECONDS)

    except KeyboardInterrupt:
        log("Arret demande par l'utilisateur.")
    finally:
        mt5.shutdown()
        log("Bot arrete, connexion MT5 fermee.")


if __name__ == "__main__":
    run()
