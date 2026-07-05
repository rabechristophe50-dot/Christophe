"""
Envoi de notifications Telegram pour les bots de trading.

Sans danger : si Telegram est desactive ou en cas d'erreur reseau, la fonction
ne fait rien et ne bloque jamais le bot (le trading passe toujours avant la
notification).

Configuration dans config.py :
    TG_ENABLED, TG_TOKEN, TG_CHAT_ID
"""

from datetime import datetime

import config as C

try:
    import requests
    _HAS_REQUESTS = True
except ImportError:
    _HAS_REQUESTS = False


def notify(message):
    """Envoie un message Telegram. Silencieux si desactive ou en cas d'erreur."""
    if not getattr(C, "TG_ENABLED", False):
        return
    if not _HAS_REQUESTS:
        print("[Telegram] librairie 'requests' manquante (pip install requests)")
        return
    token = getattr(C, "TG_TOKEN", "")
    chat_id = getattr(C, "TG_CHAT_ID", "")
    if not token or not chat_id:
        return

    stamp = datetime.now().strftime("%H:%M:%S")
    text = f"[{stamp}] {message}"
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        requests.post(url, data={"chat_id": chat_id, "text": text}, timeout=5)
    except Exception as e:  # noqa: BLE001 - on ne veut jamais crasher le bot
        print(f"[Telegram] echec envoi : {e}")


def notify_startup(bot_name, symbol, mode=""):
    extra = f" | mode {mode}" if mode else ""
    notify(f"🤖 {bot_name} demarre sur {symbol}{extra}")
