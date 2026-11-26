/**
 * Un passage à la fois par commande.
 *
 * Deux clics rapprochés sur « Envoyée » expédiaient deux fois et
 * prévenaient deux fois la cliente. Le second attend ici la fin du premier,
 * relit la commande, et la trouve déjà envoyée. L'API tourne dans un seul
 * processus : un verrou en mémoire suffit, sans tenir de connexion ouverte.
 *
 * Sorti de commandes.ts le 26/11 (relecture de « ventes du stand à
 * imprimer ») : « Revenir à ma commande » de la tablette (salon.ts) le prend
 * aussi. « Marquer terminées » (la frise, changerEtape) lisait une vente
 * payée hors de toute transaction, puis écrivait sa remise ; la tablette,
 * qui la rouvrait au même instant sous le verrou de LIGNE en base, annulait
 * les remises entre les deux. Le panier rouvert gardait alors une remise
 * réussie, et la vente revalidée naissait « Terminée » sans que personne ne
 * l'ait marquée (essai sur base : 4 fois sur 4 à moins de 5 ms d'écart).
 * Sous le même verrou, l'un passe après l'autre : la frise trouve un panier
 * (« rouverte sur la tablette »), ou la réouverture annule une remise déjà
 * écrite.
 */
const passagesEnCours = new Map<number, Promise<unknown>>();

export async function unPassageALaFois<T>(orderId: number, faire: () => Promise<T>): Promise<T> {
  const avant = passagesEnCours.get(orderId) ?? Promise.resolve();
  const celuiCi = avant.catch(() => undefined).then(faire);
  passagesEnCours.set(orderId, celuiCi);
  try {
    return await celuiCi;
  } finally {
    if (passagesEnCours.get(orderId) === celuiCi) passagesEnCours.delete(orderId);
  }
}
