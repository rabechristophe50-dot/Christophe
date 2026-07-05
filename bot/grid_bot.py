"""
Mini-bot GRILLE DE CASSURE sur l'OR (XAUUSD) - facon "GTS EA Gold Strategy".

Principe (comme la video de reference) :
  - Pose une ECHELLE de N Buy Stop AU-DESSUS du prix, espaces d'un pas fixe.
  - Pose une ECHELLE de N Sell Stop EN-DESSOUS du prix, espaces d'un pas fixe.
  - Chaque ordre = petit lot (0.01) avec son propre TP/SL.
  - Quand le prix casse dans un sens, les ordres se declenchent en cascade.
  - Protection globale : ferme tout si la perte (ou le profit) flottant atteint
    un seuil.
  - La grille est reconstruite quand le compte revient a plat.

⚠️ STRATEGIE A HAUT RISQUE. En marche sans direction (range) les Buy Stop et
Sell Stop se declenchent a tour de role et cumulent des pertes. Teste
serieusement en DEMO. Aucun profit garanti.

Usage :
    python grid_bot.py
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


class Ctx:
    point = 0.0
    pip = 0.0
    digits = 0
    tf = None
    last_bar_time = None
    grid_center = 0.0   # prix central de la grille en cours


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
    log(f"Symbole {C.SYMBOL} | pip={Ctx.pip} | {C.GRID_LEVELS} niveaux, pas={C.GRID_STEP_PIPS} pips")
    if C.DRY_RUN:
        log("MODE DRY_RUN : aucun ordre reel ne sera passe (log seulement).")
    return True


# ---------------------------------------------------------------------------
def is_trading_time():
    if not C.GRID_USE_TIME_FILTER:
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
    return [p for p in (pos or []) if p.magic == C.GRID_MAGIC]


def my_pending_orders():
    orders = mt5.orders_get(symbol=C.SYMBOL)
    return [o for o in (orders or []) if o.magic == C.GRID_MAGIC]


def floating_pnl():
    return sum(p.profit + p.swap for p in my_positions())


def filling_mode(info):
    f = info.filling_mode
    if f & 1:
        return mt5.ORDER_FILLING_FOK
    if f & 2:
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


# ---------------------------------------------------------------------------
def place_pending(order_type, price, sl, tp):
    info = mt5.symbol_info(C.SYMBOL)
    price = round(price, Ctx.digits)
    sl = round(sl, Ctx.digits) if sl else 0.0
    tp = round(tp, Ctx.digits) if tp else 0.0
    label = "BUY STOP" if order_type == mt5.ORDER_TYPE_BUY_STOP else "SELL STOP"

    if C.DRY_RUN:
        log(f"[DRY_RUN] {label} @ {price} | SL={sl} TP={tp} lot={C.GRID_LOT}")
        return True

    request = {
        "action": mt5.TRADE_ACTION_PENDING,
        "symbol": C.SYMBOL,
        "volume": float(C.GRID_LOT),
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": C.DEVIATION,
        "magic": C.GRID_MAGIC,
        "comment": C.GRID_COMMENT,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        rc = result.retcode if result else mt5.last_error()
        log(f"Echec {label} @ {price} ({rc})")
        return False
    return True


def cancel_pendings():
    for o in my_pending_orders():
        if C.DRY_RUN:
            log(f"[DRY_RUN] annulation pending #{o.ticket}")
            continue
        res = mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": o.ticket})
        if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
            log(f"Echec annulation pending #{o.ticket}")


def close_all_positions():
    for p in my_positions():
        if C.DRY_RUN:
            log(f"[DRY_RUN] fermeture position #{p.ticket}")
            continue
        info = mt5.symbol_info(C.SYMBOL)
        tick = mt5.symbol_info_tick(C.SYMBOL)
        is_buy = p.type == mt5.POSITION_TYPE_BUY
        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": C.SYMBOL,
            "volume": p.volume,
            "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
            "position": p.ticket,
            "price": tick.bid if is_buy else tick.ask,
            "deviation": C.DEVIATION,
            "magic": C.GRID_MAGIC,
            "type_filling": filling_mode(info),
        }
        mt5.order_send(req)


# ---------------------------------------------------------------------------
def open_market(is_buy):
    info = mt5.symbol_info(C.SYMBOL)
    tick = mt5.symbol_info_tick(C.SYMBOL)
    price = tick.ask if is_buy else tick.bid
    slp = C.GRID_SL_PIPS * Ctx.pip
    tpp = C.GRID_TP_PIPS * Ctx.pip

    if is_buy:
        sl = round(price - slp, Ctx.digits) if C.GRID_SL_PIPS > 0 else 0.0
        tp = round(price + tpp, Ctx.digits) if C.GRID_TP_PIPS > 0 else 0.0
        otype = mt5.ORDER_TYPE_BUY
    else:
        sl = round(price + slp, Ctx.digits) if C.GRID_SL_PIPS > 0 else 0.0
        tp = round(price - tpp, Ctx.digits) if C.GRID_TP_PIPS > 0 else 0.0
        otype = mt5.ORDER_TYPE_SELL

    label = "BUY" if is_buy else "SELL"
    if C.DRY_RUN:
        log(f"[DRY_RUN] {label} marche @ {price} | SL={sl} TP={tp} lot={C.GRID_LOT}")
        return

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": C.SYMBOL,
        "volume": float(C.GRID_LOT),
        "type": otype,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": C.DEVIATION,
        "magic": C.GRID_MAGIC,
        "comment": C.GRID_COMMENT,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        rc = result.retcode if result else mt5.last_error()
        log(f"Echec {label} marche @ {price} ({rc})")
    else:
        log(f"{label} marche ouvert @ {price} | SL={sl} TP={tp} lot={C.GRID_LOT}")
        notify(f"🔀 {label} {C.SYMBOL} ouvert @ {price} | SL={sl} TP={tp}")


def manage_dual_market(positions):
    """Maintient GRID_DUAL_PER_SIDE positions Buy et Sell (hedge continu)."""
    buys = sum(1 for p in positions if p.type == mt5.POSITION_TYPE_BUY)
    sells = sum(1 for p in positions if p.type == mt5.POSITION_TYPE_SELL)
    target = max(1, C.GRID_DUAL_PER_SIDE)
    if buys < target:
        open_market(True)
    if sells < target:
        open_market(False)


def build_grid():
    tick = mt5.symbol_info_tick(C.SYMBOL)
    if tick is None:
        return
    ask, bid = tick.ask, tick.bid

    first = C.GRID_FIRST_STEP_PIPS * Ctx.pip
    step = C.GRID_STEP_PIPS * Ctx.pip
    tp = C.GRID_TP_PIPS * Ctx.pip
    sl = C.GRID_SL_PIPS * Ctx.pip

    placed = 0
    for i in range(C.GRID_LEVELS):
        # BUY STOP au-dessus
        bp = ask + first + i * step
        b_tp = bp + tp if C.GRID_TP_PIPS > 0 else 0.0
        b_sl = bp - sl if C.GRID_SL_PIPS > 0 else 0.0
        if place_pending(mt5.ORDER_TYPE_BUY_STOP, bp, b_sl, b_tp):
            placed += 1

        # SELL STOP en-dessous
        sp = bid - first - i * step
        s_tp = sp - tp if C.GRID_TP_PIPS > 0 else 0.0
        s_sl = sp + sl if C.GRID_SL_PIPS > 0 else 0.0
        if place_pending(mt5.ORDER_TYPE_SELL_STOP, sp, s_sl, s_tp):
            placed += 1

    mid = (ask + bid) / 2.0
    Ctx.grid_center = mid
    log(f"Grille posee : {C.GRID_LEVELS} Buy Stop + {C.GRID_LEVELS} Sell Stop autour de {mid:.2f}")
    notify(f"🧊 Grille {C.SYMBOL} posee : {C.GRID_LEVELS}x2 ordres autour de {mid:.2f}")


def manage_global_risk():
    """Ferme tout si la perte/le profit flottant atteint le seuil. Retourne True si declenche."""
    pnl = floating_pnl()
    triggered = False
    if C.GRID_USE_EQUITY_STOP and pnl <= -abs(C.GRID_MAX_LOSS_MONEY):
        log(f"STOP GLOBAL : perte flottante {pnl:.2f} -> fermeture de tout")
        notify(f"🛑 STOP GLOBAL {C.SYMBOL} : perte {pnl:.2f} -> tout ferme")
        triggered = True
    if C.GRID_TAKE_ALL_PROFIT > 0 and pnl >= C.GRID_TAKE_ALL_PROFIT:
        log(f"OBJECTIF GLOBAL : profit flottant {pnl:.2f} -> fermeture de tout")
        notify(f"🎯 OBJECTIF {C.SYMBOL} : profit {pnl:.2f} -> tout ferme")
        triggered = True
    if triggered:
        close_all_positions()
        cancel_pendings()
    return triggered


# ---------------------------------------------------------------------------
def run():
    if not connect():
        return

    log("Grid bot demarre. Ctrl+C pour arreter.")
    notify_startup("Grid bot", C.SYMBOL, C.TIMEFRAME)
    try:
        while True:
            if manage_global_risk():
                time.sleep(C.POLL_SECONDS)
                continue

            positions = my_positions()
            pendings = my_pending_orders()

            rates = mt5.copy_rates_from_pos(C.SYMBOL, Ctx.tf, 0, 1)
            new_bar = False
            if rates is not None and len(rates) > 0:
                bt = rates[-1]["time"]
                if bt != Ctx.last_bar_time:
                    Ctx.last_bar_time = bt
                    new_bar = True

            over_cap = (C.GRID_MAX_OPEN_POSITIONS > 0
                        and len(positions) >= C.GRID_MAX_OPEN_POSITIONS)

            if is_trading_time() and spread_pips() <= C.GRID_MAX_SPREAD_PIPS and not over_cap:
                if C.GRID_DUAL_MARKET:
                    # MODE HEDGE : Buy ET Sell au marche en continu
                    manage_dual_market(positions)
                elif C.GRID_CONTINUOUS:
                    # MODE CONTINU : la grille suit le prix en temps reel
                    if not pendings:
                        build_grid()
                    else:
                        tick = mt5.symbol_info_tick(C.SYMBOL)
                        if tick is not None:
                            mid = (tick.ask + tick.bid) / 2.0
                            drift = abs(mid - Ctx.grid_center) / Ctx.pip
                            if drift >= C.GRID_RECENTER_MOVE_PIPS:
                                cancel_pendings()
                                build_grid()
                else:
                    # MODE CLASSIQUE : reconstruction seulement quand a plat
                    flat = len(positions) == 0
                    if flat and C.GRID_REBUILD_FLAT:
                        if not pendings:
                            build_grid()
                        elif C.GRID_REBUILD_EACH_BAR and new_bar:
                            cancel_pendings()
                            build_grid()

            time.sleep(C.POLL_SECONDS)

    except KeyboardInterrupt:
        log("Arret demande par l'utilisateur.")
    finally:
        mt5.shutdown()
        log("Bot arrete, connexion MT5 fermee.")


if __name__ == "__main__":
    run()
