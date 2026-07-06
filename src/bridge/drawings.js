/**
 * Miroir visuel : lit ce que l'indicateur DESSINE (lignes horizontales + labels
 * texte) et le formate en texte simple, ligne par ligne, pour que l'EA MT5 le
 * redessine sur son propre graphique.
 *
 * Format de sortie (facile a parser en MQL5) :
 *   L|4150.43            -> ligne horizontale a ce prix
 *   T|4126.42|BUY HC     -> texte "BUY HC" a ce prix
 */
import { data as coreData } from '../core/index.js';

export async function collectDrawings({ study_filter, max_labels = 60 } = {}, deps = {}) {
  const data = deps.data || coreData;
  const out = [];

  // Labels (texte + prix)
  try {
    const res = await data.getPineLabels({ study_filter, verbose: false, max_labels });
    for (const st of res?.studies || []) {
      for (const lb of st.labels || []) {
        if (lb.price == null) continue;
        const text = String(lb.text || '').trim().replace(/[|\r\n]+/g, ' ');
        if (!text) continue;
        out.push(`T|${lb.price}|${text}`);
      }
    }
  } catch { /* pas de labels -> on continue */ }

  // Lignes horizontales (niveaux sans texte)
  try {
    const res = await data.getPineLines({ study_filter });
    for (const st of res?.studies || []) {
      for (const lvl of st.horizontal_levels || []) {
        if (lvl == null) continue;
        out.push(`L|${lvl}`);
      }
    }
  } catch { /* pas de lignes -> on continue */ }

  return out.join('\n');
}
