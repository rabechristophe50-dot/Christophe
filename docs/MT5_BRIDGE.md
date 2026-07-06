# Pont TradingView → MT5 (indicateur verrouillé)

Ce module lit les **signaux d'un indicateur Pine verrouillé** sur ton graphique
TradingView Desktop et **prend les positions dans MetaTrader 5 en temps réel**.

Le code du Pine est chiffré et illisible — **ce n'est pas un problème**. On ne lit
pas son code : on lit ce qu'il **affiche** (labels « Buy / Sell », valeurs de plot)
via le protocole CDP que ce dépôt utilise déjà.

## Schéma

```
TradingView Desktop (indicateur verrouillé, graphique live)
        │  lecture via CDP :9222
        ▼
Pont Node  (npm run bridge)
        │  détecte Buy / Sell / Close, anti-doublon
        ├─►  écrit tv_signal.json  (voie principale)
        └─►  sert GET /signal en HTTP  (alternative)
        ▼
Expert Advisor  TVBridgeEA.mq5  (dans MT5)
        lit le signal sur timer → ouvre / ferme les positions (lot, SL, TP)
```

L'EA est **idempotent** : chaque signal a un `id` incrémental, il n'exécute
jamais deux fois le même.

---

## 1. Préparer TradingView

1. Ouvre **TradingView Desktop** avec le débogage CDP actif sur le port 9222
   (voir `SETUP_GUIDE.md` / scripts `scripts/launch_tv_debug_*`).
2. Affiche ton graphique avec **l'indicateur verrouillé visible**.
   ⚠️ Les outils de lecture Pine ne voient que ce qui est **affiché** à l'écran.

## 2. Configurer le pont

Copie l'exemple et adapte-le :

```bash
cp bridge.config.example.json bridge.config.json
```

Points clés de `bridge.config.json` :

| Champ | Rôle |
|-------|------|
| `indicator.study_filter` | Un bout du **nom** de ton indicateur (laisse `""` pour tout scanner). |
| `indicator.mode` | `"label"` (signaux dessinés par `label.new()`) ou `"study_value"` (valeur numérique de la Data Window). |
| `indicator.buy_keywords` / `sell_keywords` / `flat_keywords` | Mots-clés cherchés dans le texte des labels (ex. `"buy"`, `"long"`, `"▲"`). Adapte-les **à ton indicateur**. |
| `indicator.study_value` | En mode `study_value` : nom du champ + règles `"> 0"`, `"< 0"`, `"== 0"`. |
| `sltp.enabled` / `source` | Lit le **SL et le TP dessinés par ton indicateur** et les envoie à MT5 comme prix exacts. `source`: `"label"`, `"line"` ou `"auto"`. |
| `sltp.sl_keywords` / `tp_keywords` | Mots-clés du texte des labels SL/TP (ex. `"sl"`, `"stop"`, `"tp"`, `"target"`). |
| `symbol_map` | Traduit le symbole TradingView → symbole de ton broker MT5 (ex. `"BTCUSDT" → "BTCUSD"`). |
| `order.lot` | Taille de lot. |
| `order.sl_points` / `tp_points` | **Secours** en points, utilisés seulement si l'indicateur ne fournit pas de niveau (0 = désactivé). |
| `sink.file_path` | **Où écrire le signal** (voir étape 3). |
| `sink.http_port` | Port HTTP si tu utilises la voie WebRequest. |

### Comment trouver les bons mots-clés ?

Regarde ton graphique : quels textes ton indicateur affiche-t-il quand il donne
un signal ? (« BUY », « Long », « ▲ », « CALL »…). Mets exactement ces mots dans
`buy_keywords` / `sell_keywords`. Le pont logue chaque label détecté, donc tu peux
lancer le pont et observer ce qu'il lit pour caler la config.

## 3. Relier le fichier signal à MT5 (voie recommandée)

L'EA lit le fichier dans le **dossier commun** de MetaTrader :

```
Windows :  C:\Users\<toi>\AppData\Roaming\MetaQuotes\Terminal\Common\Files\
```

(Dans MT5 : **Fichier → Ouvrir le dossier de données**, puis remonte à `Terminal\Common\Files`.)

Fais pointer `sink.file_path` **directement** vers ce dossier, par exemple :

```json
"sink": {
  "file": true,
  "file_path": "C:\\Users\\TOI\\AppData\\Roaming\\MetaQuotes\\Terminal\\Common\\Files\\tv_signal.json"
}
```

Ainsi le pont écrit et l'EA lit le même fichier — aucune configuration réseau.

> Alternative HTTP : mets `sink.http: true`, `InpUseHttp = true` dans l'EA, et
> ajoute `http://127.0.0.1:8787/signal` dans **MT5 → Outils → Options → Expert
> Advisors → Autoriser les URL suivantes**.

## 4. Installer l'Expert Advisor

1. Copie `mql5/TVBridgeEA.mq5` dans `MQL5\Experts\` (via **Fichier → Ouvrir le
   dossier de données** dans MetaEditor).
2. **Compile** (F7) dans MetaEditor.
3. Sur MT5 : coche **Algo Trading** (bouton vert), puis glisse `TVBridgeEA` sur un
   graphique.
4. Règle les entrées :
   - `InpAllowTrading = false` d'abord → **mode simulation** (logue sans trader).
   - `InpFileName = tv_signal.json`, `InpDefaultLot`, `InpSlPoints`, `InpTpPoints`.
   - Passe `InpAllowTrading = true` quand tu es sûr.

## 5. Lancer le pont

```bash
npm run bridge          # utilise bridge.config.json
# ou
node src/bridge/run.js /chemin/config.json
```

Sortie typique :

```
[bridge] Config: .../bridge.config.json
[12:04:07] SIGNAL #1  FLAT -> LONG  => BUY BTCUSD  (BUY 24550)
[12:07:31] SIGNAL #2  LONG -> SHORT => SELL BTCUSD (SELL 24610)
```

L'EA, côté MT5, écrit dans l'onglet « Experts » :

```
Signal #1 recu : action=BUY symbol=BTCUSD lot=0.10 ...
OK BUY 0.10 BTCUSD @~24550.00 (ret=10009)
```

---

## Logique des signaux

L'état cible est **LONG / SHORT / FLAT**. Un ordre n'est envoyé **qu'au changement
d'état** :

| Transition | Action MT5 |
|-----------|------------|
| → LONG | `BUY` (ferme d'abord un SELL si `close_opposite`) |
| → SHORT | `SELL` (ferme d'abord un BUY) |
| → FLAT | `CLOSE` (ferme la position du symbole) |

L'EA n'empile pas : s'il est déjà LONG et reçoit un nouveau BUY, il ignore.

### SL et TP depuis l'indicateur

Ton indicateur affiche **BUY, SELL, SL et TP** — le pont exploite tout :

1. À l'apparition d'un signal d'entrée (BUY/SELL), il lit les niveaux **SL** et
   **TP** que l'indicateur dessine (labels « SL 24500 » / « TP 24600 », ou lignes
   horizontales) et les envoie comme **prix absolus** à MT5.
2. L'EA place l'ordre avec **exactement** ces SL/TP. Pas de recalcul en points.
3. Validation géométrique : un SL au-dessus du prix pour un achat (ou du mauvais
   côté) est **automatiquement ignoré** pour éviter un rejet du broker.
4. S'il y a plusieurs TP (TP1/TP2/TP3), le pont prend le **plus proche** (TP1,
   le plus prudent).
5. Les labels SL/TP ont souvent un `id` plus récent que l'entrée : le détecteur
   ne les confond jamais avec un signal — il ne traite comme entrée que les
   labels contenant tes `buy_keywords`/`sell_keywords`.

Si l'indicateur ne fournit pas de niveau, l'EA retombe sur `order.sl_points` /
`tp_points` (secours en points), sinon aucun SL/TP.

## Miroir visuel (afficher l'indicateur sur MT5)

Le code Pine étant verrouillé, on ne peut pas recréer l'indicateur en MQL5. En
revanche, le pont recopie ce qu'il **dessine** — lignes horizontales, niveaux
SL/TP, labels BUY/SELL — dans un fichier `tv_draw.txt`, et l'EA les **redessine
sur le graphique MT5** (rafraîchi toutes les ~5 s).

- Côté pont : section `drawings` de la config (`enabled`, `refresh_ms`,
  `max_labels`). `file_path` vide = même dossier que le signal.
- Côté EA : `InpShowDrawings = true`, `InpDrawFile = tv_draw.txt`.
- Code couleur MT5 : SL en rouge, TP en vert, BUY en bleu, SELL en orange, le
  reste en gris.

⚠️ C'est un **affichage** des niveaux, pas l'indicateur lui-même. Les prix
s'alignent car TradingView et MT5 sont sur le même symbole (XAUUSD). Les objets
portent le préfixe `TVD_` et sont nettoyés quand tu retires l'EA.

## Protection du capital (réglages EA)

Pour le trading réel, l'EA expose des garde-fous (tous optionnels, désactivés
par défaut pour ne pas changer le comportement existant) :

| Réglage EA | Rôle |
|------------|------|
| `InpRiskMode` | `RISK_FIXED_LOT` (défaut), `RISK_PERCENT` ou `RISK_MONEY`. En mode risque, le lot est calculé pour que la perte au SL = le risque voulu. |
| `InpRiskPercent` | % du capital risqué par trade (mode PERCENT), ex. `1.0`. |
| `InpRiskMoney` | Montant fixe risqué par trade (mode MONEY), ex. `5.0`. |
| `InpMaxTradesDay` | Nombre max de trades par jour (`0` = illimité). |
| `InpMaxSpreadPts` | Spread max en points pour entrer (`0` = pas de limite). Utile sur l'or. |

Le dimensionnement par le risque a besoin d'un **SL** (fourni par l'indicateur) ;
sans SL exploitable, l'EA retombe sur le lot fixe.

> ⚠️ Un tableau d'indicateur affichant « 100% win / 0 SL » ne garantit rien : la
> plupart des indicateurs comptent des stats partielles ou repeignent. Traite
> toujours la perte comme possible — c'est le rôle de ces garde-fous.

## Sécurité / bonnes pratiques

- **Teste toujours sur un compte DÉMO** d'abord (`InpAllowTrading = false` puis démo).
- Vérifie le `symbol_map` : un mauvais symbole = ordre rejeté.
- Le pont ne fait que **relayer** les signaux visibles ; il n'invente rien. Sa
  qualité dépend entièrement de la fiabilité de ton indicateur.
- Rien n'est garanti sur les marchés. Utilise du capital que tu peux perdre.

## Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| `Aucun label détecté` | L'indicateur n'est pas visible, ou `study_filter` trop restrictif. |
| Signaux jamais déclenchés | Mots-clés `buy/sell_keywords` ne correspondent pas au texte réel des labels. |
| EA ne lit rien | `sink.file_path` ne pointe pas vers `Common\Files`, ou mauvais `InpFileName`. |
| `WebRequest err` dans MT5 | URL non autorisée dans Options → Expert Advisors. |
| Ordre `ECHEC ret=10014` | Volume invalide → ajuste `order.lot` (min/step du broker). |
