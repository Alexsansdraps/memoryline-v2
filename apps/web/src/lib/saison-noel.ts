/**
 * La saison de la nuit de Noël sur la fiche Ciel étoilé (27/11, Alexandra :
 * « Un bouton "Nuit de Noël 2026" sur la fiche Ciel étoilé règle la date sur
 * le 24 décembre à minuit »).
 *
 * L'étiquette ne s'affiche que du 1er novembre au 31 janvier (date du
 * navigateur). L'année est celle du mois de décembre de la saison : en
 * novembre et décembre, l'année en cours ; en janvier, l'année d'avant — le
 * Noël qui vient de passer.
 */
export function saisonDeNoel(maintenant: Date): { enSaison: boolean; annee: number } {
  const mois = maintenant.getMonth(); // 0 = janvier, 10 = novembre, 11 = décembre
  const an = maintenant.getFullYear();
  if (mois === 10 || mois === 11) return { enSaison: true, annee: an };
  if (mois === 0) return { enSaison: true, annee: an - 1 };
  return { enSaison: false, annee: an };
}
