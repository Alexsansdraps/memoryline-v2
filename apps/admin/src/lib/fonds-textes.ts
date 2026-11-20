/**
 * Les phrases de « Créer un fond » (BO › Atelier, 20/11), écrites une seule
 * fois pour le serveur du back-office ET pour le navigateur : la confirmation
 * du coût, l'état d'un fond, les montants.
 *
 * Margaux : « Si seulement tu pouvais me faire un programme où j'ai juste à
 * mettre des photos et qu'il me génère des fonds automatiquement sans que je
 * discute pendant 2h pour faire un seule fond de ville ». Chaque dessin est
 * payé : l'écran le dit AVANT de lancer, en euros, photos × versions.
 *
 * Module PUR : ni DOM, ni Node, ni appel à l'API. Vouvoiement, guillemets
 * « », jamais de « (s) ».
 */

/** « 0 photo », « 1 photo », « 3 photos ». */
export function pluriel(n: number, singulier: string, forme = `${singulier}s`): string {
  return `${n} ${n > 1 ? forme : singulier}`;
}

/** 25 → « 0,25 € » ; 150 → « 1,50 € ». */
export function euros(cents: number): string {
  return `${(Math.max(0, cents) / 100).toFixed(2).replace(".", ",")} €`;
}

/**
 * La question posée avant d'envoyer un lot : chaque photo donne son fond,
 * chaque fond ses versions, et chaque version se paie.
 *
 * `resteCents` : ce qu'il reste pour les fonds ce mois-ci. Les fonds ont LEUR
 * plafond, à part de celui des affiches des clients (relecture du 20/11) : la
 * question dit combien il en reste, et qu'un lot ne coupe pas les clients.
 */
export function confirmationLot(
  photos: number,
  versions: number,
  coutParVersionCents: number,
  bouchon = false,
  resteCents: number | null = null,
): string {
  const images = photos * versions;
  const fonds = photos > 1 ? `${photos} fonds (un par photo)` : "1 fond";
  const lignes = [
    `Lancer ${fonds}, ${pluriel(versions, "version")} chacun ?`,
    bouchon
      ? "Mode d'essai : rien n'est envoyé à OpenAI, rien n'est payé."
      : `Coût estimé : ${euros(images * coutParVersionCents)} (${pluriel(images, "image")} à ${euros(coutParVersionCents)}).`,
  ];
  if (!bouchon && resteCents !== null)
    lignes.push(
      `Plafond des fonds ce mois-ci : il reste ${euros(resteCents)}, il en restera ${euros(resteCents - images * coutParVersionCents)}. ` +
        "Les affiches des clients ont leur propre plafond : ce lot ne peut pas les bloquer.",
    );
  lignes.push("Comptez une à deux minutes par image.");
  return lignes.join("\n");
}

/**
 * Le refus, AVANT d'envoyer les photos, d'un lot qui dépasserait ce qu'il
 * reste pour les fonds ce mois-ci. Null : il peut partir — l'API, elle,
 * revérifie toujours, la page ayant pu être ouverte depuis un moment.
 */
export function refusPlafondLot(
  images: number,
  coutParVersionCents: number,
  resteCents: number | null,
  bouchon = false,
): string | null {
  if (bouchon || resteCents === null) return null;
  const cout = images * coutParVersionCents;
  if (cout <= resteCents) return null;
  return (
    `Ce lot coûterait environ ${euros(cout)} : il ne reste que ${euros(resteCents)} pour les fonds ce mois-ci. ` +
    "Demandez moins de photos ou de versions, ou relevez le plafond des fonds (Réglages des fonds, en bas de la page)."
  );
}

/** La question posée avant un message de la discussion : une image de plus, payée. */
export function confirmationMessage(
  versions: number,
  coutParVersionCents: number,
  bouchon = false,
  resteCents: number | null = null,
): string {
  if (bouchon) return "Envoyer ce message ? (Mode d'essai : rien n'est payé.)";
  const question = `Envoyer ce message ? Il dessine ${pluriel(versions, "nouvelle image", "nouvelles images")}, payée${versions > 1 ? "s" : ""} : environ ${euros(versions * coutParVersionCents)}.`;
  return resteCents === null ? question : `${question} Il reste ${euros(resteCents)} pour les fonds ce mois-ci.`;
}

/** Ce qu'on lit d'un fond dans une liste. */
export function texteEtat(f: { etat: string; enCours: number; pretes: number; echecs: number }): string {
  if (f.etat === "en_cours") return f.enCours > 1 ? `${f.enCours} images en cours de dessin…` : "Dessin en cours…";
  if (f.etat === "echec") return "Échec du dessin";
  return f.echecs ? `Prêt · ${pluriel(f.echecs, "échec")}` : "Prêt";
}

/** Vrai tant qu'un fond (ou un des fonds d'un lot) attend son dessin : la page se met à jour seule. */
export function encoreEnCours(reponse: unknown): boolean {
  const r = reponse as { etat?: string; fonds?: { etat?: string }[] } | null;
  if (!r) return false;
  if (Array.isArray(r.fonds)) return r.fonds.some((f) => f.etat === "en_cours");
  return r.etat === "en_cours";
}

/** Un jeton pour un envoi : un double clic, ou la page renvoyée, ne paie pas deux fois. */
export function nouveauJeton(): string {
  const hasard =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `f-${hasard}`;
}
