# ✅ Checklist de validation — avant de passer au réel

> But : décider **objectivement** si le bot est prêt, avec des **seuils chiffrés**.
> Règle d'or : **si UNE seule étape échoue, on ne passe pas au réel.** Pas d'exception,
> pas de « ça va probablement marcher ». Le marché ne pardonne pas l'optimisme.

Cochez chaque case dans l'ordre. On ne passe à l'étape suivante que si la
précédente est ✅.

---

## PHASE 1 — Qualité du backtest (sinon tout le reste est faux)

- [ ] **Données** : au moins **6 mois** d'historique M1/M3 (idéalement 1–2 ans).
- [ ] **Modèle de test** MT5 = **« Chaque tick basé sur les vrais ticks »**.
- [ ] **Qualité de modélisation** affichée ≥ **90 %** (sinon données trop pauvres).
- [ ] **Coûts activés** : spread réel de votre courtier + commission. Jamais spread = 0.
- [ ] **Test du spread OK** : `spread ÷ distance_stop` < **10 %** (voir README §5).

❌ Une case non cochée ici → le backtest ne veut rien dire. On s'arrête.

---

## PHASE 2 — Les chiffres du backtest (les seuils GO / NO-GO)

| Métrique | ❌ Rejeté | ⚠️ Limite | ✅ Bon | Où le lire (MT5) |
|---|---|---|---|---|
| **Nombre de trades** | < 100 | 100–200 | **> 200** | Onglet Résultats |
| **Profit Factor** | < 1.2 | 1.2–1.3 | **≥ 1.3** (viser 1.5) | Résultats |
| **Max Drawdown** | > 30 % | 20–30 % | **< 20 %** | Résultats (relatif) |
| **Espérance / trade** | ≤ 0 | ~0 | **> 0** (positive) | Trade attendu |
| **Recovery Factor** | < 2 | 2–3 | **≥ 3** | Résultats |
| **Sharpe Ratio** | < 0.5 | 0.5–1.0 | **> 1.0** | Résultats |

> **Win rate** : ne le jugez PAS seul. Avec un R:R de 2, un WR de **40 %** suffit à
> être rentable. Un WR de 80 % avec R:R 0.3 peut être perdant. Ce qui compte,
> c'est **Profit Factor + Espérance positive**, pas le % de trades gagnants.

❌ Une seule colonne « Rejeté » → **NO-GO**. On ne passe pas au réel.

---

## PHASE 3 — Robustesse (le vrai test anti-illusion)

C'est ici qu'on démasque l'**overfitting** (réglages qui marchent seulement sur le passé).

- [ ] **Out-of-sample** : optimisé sur période A (ex. 2024), testé **sans y toucher**
      sur période B (ex. 2025). Le Profit Factor de B reste **≥ 70 %** de celui de A.
- [ ] **Multi-périodes** : rentable sur **au moins 3 régimes** différents
      (marché haussier, baissier, range) — pas seulement une belle année.
- [ ] **Sensibilité des paramètres** : si changer un réglage de ±20 % (ex. ATR 1.5 → 1.8)
      **détruit** la performance → c'est de l'overfitting. Un bon bot reste rentable
      sur une **plage** de réglages, pas sur une valeur unique.
- [ ] **Les deux symboles** : testé séparément sur **XAUUSD ET BTCUSD**.

❌ Échec out-of-sample = overfitting = **NO-GO**, même si le backtest était magnifique.

---

## PHASE 4 — Test en DÉMO (argent fictif, conditions réelles)

Le backtest ment toujours un peu (slippage, latence, requotes). La démo tranche.

- [ ] Tourne en **démo** pendant **≥ 4 semaines** (idéalement 6–8).
- [ ] **≥ 30 trades** réalisés en démo (sinon pas assez de recul).
- [ ] Résultat démo **cohérent** avec le backtest : Profit Factor démo
      **≥ 70 %** du backtest. Un écart énorme = problème (coûts, repaint, latence).
- [ ] **Aucun bug** : pas d'ordre rejeté, pas de trade bloqué, le trailing bouge bien.
- [ ] Testé sur **VPS** si vous visez le 24/7 (voir README).

❌ Démo décevante ou incohérente → retour Phase 2, on ne passe pas au réel.

---

## PHASE 5 — Passage au réel (progressif, jamais brutal)

- [ ] Capital que vous pouvez **perdre entièrement** sans impact sur votre vie.
- [ ] **Risque par trade ≤ 0.5 %** au début (ou lot fixe minimal 0.01).
- [ ] **Petit capital d'abord** (ex. 100–200 €) pendant **1 mois** en réel.
- [ ] Le réel reste **cohérent** avec la démo avant d'augmenter quoi que ce soit.
- [ ] **Règle d'arrêt (kill switch)** définie À L'AVANCE : si le compte perd
      **X %** (ex. 15 %), vous **coupez le bot** et vous ré-analysez. Pas de « je laisse
      courir, ça va revenir ».
- [ ] Vous augmentez le capital **seulement** après 1–2 mois réels conformes.

---

## Tableau de décision final

| Situation | Décision |
|---|---|
| Toutes les phases ✅ | **GO** — réel avec petit capital et risque ≤ 0.5 % |
| Phase 1 ou 2 échoue | **NO-GO** — le bot n'a pas d'edge prouvé |
| Phase 3 échoue | **NO-GO** — overfitting, ça cassera en réel |
| Phase 4 incohérente | **NO-GO** — problème d'exécution à régler d'abord |

---

## Ce que cette checklist NE garantit PAS

Même 100 % validée, elle **ne garantit pas** que vous gagnerez de l'argent. Elle
garantit seulement que vous ne partez **pas à l'aveugle**. Un edge passé peut
disparaître (le marché change). C'est pour ça que le **kill switch** et le
**risque faible** sont non négociables : ils vous gardent en vie assez longtemps
pour vous adapter.

*Ceci n'est pas un conseil financier. Vous êtes seul responsable de vos décisions.*
