/**
 * Les ventes de test du stand (20/11, Alexandra : « il faudrait ajouter
 * "test" comme ça on peut mettre des commandes en test », puis : « non pour
 * mettre en test à la main c'est avec sélectionner et une option à la
 * sélection »).
 *
 * Une vente de test est une vente DU STAND, ANNULÉE, qui porte l'étiquette
 * « test », la casse ignorée : la même règle que l'API
 * (apps/api/src/ventes-de-test.ts, `estVenteDeTest`), qui range ces ventes
 * dans l'onglet « Test » de Ventes stand et les sort de « Toutes » et
 * d'« Annulées ». Le back-office n'importe rien de l'API : la règle tient en
 * une ligne, recopiée ici pour la phrase du bloc Statut de la fiche.
 *
 * Le canal compte (relecture du 20/11) : une commande du SITE annulée et
 * étiquetée « test » à la main n'est rangée dans aucun onglet « Test », et sa
 * fiche doit rester celle d'une commande annulée.
 *
 * Sans dépendance ni base : essayé par tests/vente-de-test.test.mjs.
 */
export function estVenteDeTest(o: {
  channel?: string | null;
  status?: string | null;
  tags?: readonly string[] | null;
}): boolean {
  return (
    o.channel === "salon" &&
    (o.status === "cancelled" || o.status === "voided") &&
    (o.tags ?? []).some((t) => t.toLowerCase() === "test")
  );
}

/**
 * Le compte rendu de « Mettre en test », la commande de la sélection : combien
 * de ventes viennent de passer en test (`count`), et pourquoi les autres sont
 * restées telles quelles (`ecartees`, une raison par commande, avec son
 * numéro). Chaque nombre accorde ses mots : pas de « (s) ».
 */
export function compteRenduMiseEnTest(r: {
  count: number;
  ecartees?: readonly { raison: string }[] | null;
}): string {
  const n = r.count;
  const passees =
    n <= 0
      ? "Aucune vente n'a été mise en test."
      : n === 1
        ? "1 vente mise en test : elle ne compte plus dans vos chiffres et se range dans l'onglet « Test », d'où vous pourrez la supprimer. Aucun courriel n'est parti."
        : `${n} ventes mises en test : elles ne comptent plus dans vos chiffres et se rangent dans l'onglet « Test », d'où vous pourrez les supprimer. Aucun courriel n'est parti.`;
  const ecartees = r.ecartees ?? [];
  if (!ecartees.length) return passees;
  // Deux ventes refusées pour la même raison ne la font pas lire deux fois.
  const raisons = [...new Set(ecartees.map((e) => e.raison))].join(" ");
  return ecartees.length === 1
    ? `${passees} 1 commande laissée telle quelle : ${raisons}`
    : `${passees} ${ecartees.length} commandes laissées telles quelles : ${raisons}`;
}
