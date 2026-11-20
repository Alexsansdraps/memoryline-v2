/**
 * Les ventes de test du stand (20/11).
 *
 * Le jour du marché de Noël de Mulhouse, les ventes d'essai faites sur la
 * tablette se mêlaient aux vraies, dans la liste comme dans les chiffres
 * (Alexandra : « il faudrait ajouter "test" comme ça on peut mettre des
 * commandes en test », puis : « non pour mettre en test à la main c'est avec
 * sélectionner et une option à la sélection »). On coche les ventes dans
 * BO › Ventes stand, et la barre de la sélection les met en test : l'action
 * groupée « test » de commandes.ts.
 *
 * Une vente de test n'est pas un nouvel état de commande. C'est une vente du
 * stand ANNULÉE, par le chemin d'annulation qui existe déjà (commandes.ts,
 * `annulerLaCommande`, celui de POST /admin/orders/:id/cancel : aucun
 * courriel, l'encaissement sur place sort du grand livre), qui porte en plus
 * l'étiquette « test » et le motif « Commande de test ». L'annulation la sort
 * déjà de tous les chiffres (HORS_VENTES, statuts-vente.ts) ; l'étiquette la
 * range à part, dans l'onglet « Test » de Ventes stand, d'où elle se supprime
 * à la main comme toute vente du stand (Alexandra : « celles ci pourront être
 * supp manuellement »).
 *
 * Les TROIS conditions comptent : une vente du stand, annulée, étiquetée. Une
 * étiquette « test » posée à la main sur une vente qui n'est pas annulée ne
 * la sort d'aucun chiffre : la cacher de « Toutes » pour la ranger sous
 * « Test » ferait disparaître de la liste une vente qui compte encore. Elle
 * reste donc dans « Toutes », où la sélection propose de la mettre en test
 * pour de bon — et depuis la relecture du 20/11, cette étiquette ne s'y pose
 * plus à la main (`poseTestALaMain`, plus bas). Une commande du SITE annulée
 * et étiquetée « test » n'est pas non plus une vente de test : le site n'a
 * pas d'onglet « Test », et sa fiche reste celle d'une commande annulée.
 *
 * Rien ici ne lit ni n'écrit la base : les règles s'essaient sans elle
 * (tests/ventes-de-test.test.ts).
 */

import { HORS_VENTES } from "./statuts-vente.js";

/** L'étiquette posée sur la commande. Elle se relit sans tenir compte de la casse. */
export const ETIQUETTE_TEST = "test";

/** Le motif d'annulation d'une vente de test, au journal et dans `cancel_reason`. */
export const MOTIF_TEST = "Commande de test";

/** Les statuts d'une commande annulée ou avortée : ceux que HORS_VENTES écarte, panier mis à part. */
export const STATUTS_ANNULES: readonly string[] = ["cancelled", "voided"];

/** Vrai si l'une des étiquettes est « test », quelle que soit sa casse (« Test », « TEST »). */
export function porteEtiquetteTest(tags: unknown): boolean {
  return (
    Array.isArray(tags) &&
    tags.some((t) => typeof t === "string" && t.toLowerCase() === ETIQUETTE_TEST)
  );
}

/** Une vente de test : une vente du stand, annulée, ET étiquetée « test ». */
export function estVenteDeTest(o: { channel: string; status: string; tags?: unknown }): boolean {
  return (
    o.channel === "salon" && STATUTS_ANNULES.includes(o.status) && porteEtiquetteTest(o.tags)
  );
}

/**
 * L'étiquette « test » posée À LA MAIN (relecture du 20/11) : « Ajouter une
 * étiquette » de la sélection, ou l'éditeur d'étiquettes de la fiche. Sur une
 * vente du stand qui compte encore (ni panier, ni annulée), elle ne la sort
 * d'aucun chiffre, mais s'affiche dans la colonne Étiquettes comme si c'était
 * fait : le geste le plus proche d'« une option à la sélection » laissait les
 * chiffres faux sans rien dire. Elle se refuse donc, et la phrase du refus
 * mène à « Mettre en test » (`refusEtiquetteTest`).
 *
 * Vrai quand les étiquettes qu'on veut poser portent « test », que la vente ne
 * la portait pas déjà, et qu'elle compte encore. Une vente qui la porte déjà
 * (posée avant cette règle) peut toujours enregistrer ses autres étiquettes ;
 * une vente annulée la reçoit sans dommage, elle est déjà hors des chiffres.
 * Les commandes du site ne sont pas concernées.
 */
export function poseTestALaMain(
  o: { channel: string; status: string; tags?: unknown },
  etiquettes: readonly string[],
): boolean {
  return (
    o.channel === "salon" &&
    !HORS_VENTES.includes(o.status) &&
    porteEtiquetteTest(etiquettes) &&
    !porteEtiquetteTest(o.tags)
  );
}

/**
 * Le refus de `poseTestALaMain`, avec le numéro des ventes en cause (cinq au
 * plus, puis leur nombre) : au retour d'une sélection, on sait lesquelles
 * compteraient encore. Rien n'a été enregistré, et la phrase le dit.
 */
export function refusEtiquetteTest(numeros: readonly string[]): string {
  const vus = numeros.slice(0, 5);
  const autres = numeros.length - vus.length;
  const liste =
    autres > 0
      ? `${vus.join(", ")} et ${autres} autre${autres > 1 ? "s" : ""}`
      : vus.length > 1
        ? `${vus.slice(0, -1).join(", ")} et ${vus[vus.length - 1]}`
        : (vus[0] ?? "");
  return numeros.length > 1
    ? `L'étiquette « test » seule ne sort pas les ventes ${liste} des chiffres. Pour des ventes d'essai, cochez-les dans Ventes stand et choisissez « Mettre en test ». Aucune étiquette n'a été enregistrée.`
    : `L'étiquette « test » seule ne sort pas la vente ${liste} des chiffres. Pour une vente d'essai, cochez-la dans Ventes stand et choisissez « Mettre en test ». Aucune étiquette n'a été enregistrée.`;
}

/**
 * Les étiquettes de la commande, « test » en plus. Celles d'avant gardent leur
 * ordre et leur casse ; une étiquette « Test » déjà posée à la main suffit, on
 * n'en ajoute pas une seconde.
 */
export function avecEtiquetteTest(tags: unknown): string[] {
  const avant = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string")
    : [];
  return porteEtiquetteTest(avant) ? avant : [...avant, ETIQUETTE_TEST];
}

/**
 * Le filtre « test » de la liste des commandes : « seul » ne garde que les
 * ventes de test, « exclure » les écarte. Toute autre valeur, ou rien, ne
 * filtre rien : la liste reste celle que voient les autres écrans.
 */
export type FiltreTest = "seul" | "exclure";

export function lireFiltreTest(v: unknown): FiltreTest | null {
  return v === "seul" || v === "exclure" ? v : null;
}

/** Ce que demande la mise en test d'une commande, décidé avant d'écrire quoi que ce soit. */
export type MiseEnTest =
  /** Refusée, avec la phrase à montrer (réponse 400, ou commande écartée de la sélection). */
  | { geste: "refuser"; erreur: string }
  /** Déjà en test : rien à refaire, la réponse est un succès. */
  | { geste: "rien" }
  /**
   * Déjà annulée : l'étiquette et le motif, rien d'autre. Elle est déjà hors
   * des chiffres, et son annulation a déjà soldé son grand livre.
   */
  | { geste: "etiqueter" }
  /** Le chemin d'annulation d'une vente du stand, motif « Commande de test ». */
  | { geste: "annuler" };

export function miseEnTest(o: {
  number: string;
  channel: string;
  status: string;
  tags?: unknown;
  /** Non nul : une commande reprise de Shopify (17/11). */
  legacyId?: number | null;
}): MiseEnTest {
  // Une commande du site annulée écrit au client, et son argent se rend : rien
  // de tout cela n'est un essai qu'on range. Seules les ventes du stand
  // s'annulent sans courriel.
  if (o.channel !== "salon")
    return {
      geste: "refuser",
      erreur: `La commande ${o.number} vient du site : seules les ventes du stand se mettent en test. Annuler une commande du site prévient le client par courriel ; si c'est bien ce que vous voulez, faites-le depuis sa fiche, avec « Annuler la commande ».`,
    };
  // Une reprise de Shopify, même rangée au stand, a été réglée là-bas : rien
  // n'en repart d'ici. La route d'annulation la refuse d'office (index.ts,
  // GESTES_REFUSES_AUX_REPRISES) ; l'action groupée, qui ne passe pas par
  // elle, bute ici.
  if (o.legacyId != null)
    return {
      geste: "refuser",
      erreur: `La vente ${o.number} a été reprise de Shopify : réglée là-bas, elle ne se met pas en test.`,
    };
  // Un panier de la tablette n'est pas une vente : il ne compte nulle part.
  if (o.status === "draft")
    return {
      geste: "refuser",
      erreur: `${o.number} est un panier de la tablette, pas une vente : il ne compte dans aucun chiffre. Supprimez-le si vous voulez qu'il disparaisse.`,
    };
  if (estVenteDeTest(o)) return { geste: "rien" };
  if (STATUTS_ANNULES.includes(o.status)) return { geste: "etiqueter" };
  return { geste: "annuler" };
}
