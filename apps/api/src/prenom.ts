/**
 * Le prénom à mettre dans le « Bonjour … » d'un courrier, ou "" s'il est
 * inconnu (l'appelant met alors sa formule par défaut).
 *
 * Le prénom SAISI d'abord (`firstName`, demandé à l'inscription) : « Marie
 * Claire Dupont » est saluée « Marie Claire », et plus « Marie » (recette du
 * 17/11). À défaut — fiche d'avant ce champ, vente du stand qui ne demande
 * qu'un nom —, le premier mot du nom complet, comme avant.
 *
 * Chaque lecture de la fiche qui alimente un courrier doit donc AUSSI lire
 * `firstName` : un `select({ name })` sans lui retomberait en silence sur le
 * premier mot.
 */
export function prenomPourCourrier(
  client: { firstName?: string | null; name?: string | null } | null | undefined,
): string {
  const saisi = (client?.firstName ?? "").trim();
  if (saisi) return saisi;
  return (client?.name ?? "").trim().split(/\s+/)[0] ?? "";
}
