/**
 * Les phrases des écrans des affiches de démonstration (BO › Atelier ›
 * Affiches de démonstration), écrites une seule fois pour le serveur ET pour
 * le navigateur.
 *
 * La page d'un lot (pages/affiches-demo/[id].astro) se dessine d'abord sur le
 * serveur, avec l'état de chaque affiche à l'ouverture, puis le sondage
 * (lib/affiches-demo-bo.ts) la tient à jour. Si chacun écrivait ses propres
 * phrases, la page changerait de mots sous les yeux de la boutique à la
 * première réponse — « Prête · 9,8 Mo », puis autre chose une seconde plus
 * tard. Le formulaire (pages/affiches-demo.astro) y prend ses compteurs, ses
 * erreurs et sa confirmation, que l'API redit à sa façon si on les contourne.
 *
 * Module PUR : ni DOM, ni Node, ni appel à l'API. Les textes suivent le plan
 * du 20/11 (§4.6) : vouvoiement, guillemets « », jamais de « (s) ».
 */
import type { EtatDemo } from "./api.ts";

const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** « 0 affiche », « 1 affiche », « 3 affiches » : le pluriel français, sans « (s) ». */
export function pluriel(n: number, singulier: string, forme = `${singulier}s`): string {
  return `${n} ${n > 1 ? forme : singulier}`;
}

/** Le poids d'un fichier : « 850 Ko », « 9,8 Mo », « 1,4 Go » (comme les PDF des commandes). */
export function taille(octets: number): string {
  if (octets >= 1e9) return `${nombre.format(octets / 1e9)} Go`;
  if (octets >= 1e6) return `${nombre.format(octets / 1e6)} Mo`;
  return `${nombre.format(Math.max(1, Math.round(octets / 1000)))} Ko`;
}

/** « 38 s », « 2 min 05 ». */
export function duree(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*  Le formulaire                                                             */
/* -------------------------------------------------------------------------- */

export const ERREUR_RIEN_CHOISI =
  "Choisissez au moins une affiche : mettez un nombre d'exemplaires en face.";

/**
 * « Un lot compte au plus 100 affiches ; vous en demandez 130. Faites-en
 * deux. » Mêmes mots que le refus de l'API (lireLaDemande), qui le redit si
 * la page est contournée.
 */
export function erreurTropParLot(demandees: number, plafond: number): string {
  return `Un lot compte au plus ${plafond} affiches ; vous en demandez ${demandees}. ${
    demandees <= 2 * plafond ? "Faites-en deux." : "Faites-en plusieurs."
  }`;
}

/** « 10 exemplaires au plus par affiche. » */
export function erreurTropParAffiche(plafond: number): string {
  return `${pluriel(plafond, "exemplaire")} au plus par affiche.`;
}

/** Le compteur sous le tableau : « Aucune affiche choisie », « 8 affiches, 14 exemplaires ». */
export function phraseChoix(affiches: number, exemplaires: number): string {
  return affiches
    ? `${pluriel(affiches, "affiche")}, ${pluriel(exemplaires, "exemplaire")}`
    : "Aucune affiche choisie";
}

/** Le bouton suit le compteur : « Générer 14 affiches ». Un exemplaire = une affiche, un PDF. */
export function libelleGenerer(exemplaires: number): string {
  return exemplaires ? `Générer ${pluriel(exemplaires, "affiche")}` : "Générer les affiches";
}

/**
 * Ce qu'on lit avant de lancer un lot. La moyenne est celle mesurée sur les
 * lots passés : le temps d'une affiche dont le décor est déjà calculé ne se
 * devine pas, il se constate. Sans mesure, on ne promet rien.
 */
export function confirmationGeneration(exemplaires: number, format: string, moyenneMs: number | null): string {
  const corps =
    exemplaires > 1
      ? `Elles se fabriquent une par une, en arrière-plan : comptez une à deux minutes pour chaque nouveau décor${
          moyenneMs ? `, puis environ ${duree(moyenneMs)} par affiche` : ""
        }.`
      : `Elle se fabrique en arrière-plan : comptez une à deux minutes si son décor est nouveau${
          moyenneMs ? `, sinon environ ${duree(moyenneMs)}` : ""
        }.`;
  return `Générer ${pluriel(exemplaires, "affiche")} en ${format} ?\n\n${corps} Les ventes du stand et les PDF des commandes passent toujours avant. Vous pouvez quitter la page.`;
}

/* -------------------------------------------------------------------------- */
/*  La page d'un lot                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Pourquoi une affiche attend, quand le serveur l'a déjà prise : il sert
 * d'abord ce qui se vend. Seulement pour elle (`devant` à 0, cf. Avancement) ;
 * les autres attendent simplement leur tour dans le lot.
 */
export const POURQUOI_ATTENTE =
  "En attente de son tour : une vente du stand ou un PDF demandé passe avant.";

/** Rien du lot ne se fabrique : les affiches d'un autre lot, lancé avant, passent d'abord. */
export const AUTRE_LOT_AVANT = "Un autre lot passe avant : ses affiches se font d'abord.";

/** L'infobulle de l'état d'une carte : la raison de l'attente, pour l'affiche que le serveur tient. */
export function infobulleEtat(e: EtatDemo | undefined): string {
  return e?.etat === "en_attente" && e.devant === 0 ? POURQUOI_ATTENTE : "";
}

/** L'état écrit sur la carte d'une affiche. */
export function texteEtat(e: EtatDemo | undefined): string {
  switch (e?.etat) {
    case "prete":
      return `Prête · ${taille(e.taille)}`;
    case "en_attente":
      return "En attente";
    case "en_cours":
      return `Fabrication en cours (${duree(e.depuisMs)})…`;
    case "echec":
      return `Échec : ${e.erreur}`;
    case "a_faire":
      return "À refaire";
    default:
      return "";
  }
}

/** Ce que montre le cadre de la vignette tant qu'il n'y a pas d'aperçu. */
export function texteSansVignette(e: EtatDemo | undefined): string {
  switch (e?.etat) {
    case "en_cours":
      return "En fabrication…";
    case "echec":
      return "Pas d'aperçu";
    case "prete":
      return "";
    default:
      return "Aperçu à venir";
  }
}

/** Où en est un lot, compté sur l'état de ses affiches. */
export interface Avancement {
  total: number;
  pretes: number;
  /** Le poids des PDF prêts, en octets. */
  taille: number;
  echecs: number;
  enAttente: number;
  aFaire: number;
  /** L'affiche en fabrication, s'il y en a une, avec de quoi la nommer. */
  enCours: { titre: string; scene: string; depuisMs: number } | null;
  /**
   * Le plus petit `devant` des affiches du lot en attente, au sens de l'API
   * (affiches-demo.ts, etatsEnMemoire) : 0 quand le serveur a déjà pris
   * l'une d'elles et qu'elle attend une place (une vente du stand ou un PDF
   * demandé passe avant) ; sinon, combien d'affiches de démonstration, TOUS
   * LOTS CONFONDUS, partiront avant elle. Plus de 0 sans affiche du lot en
   * cours : un autre lot passe d'abord. 0 aussi quand rien n'attend.
   */
  devant: number;
  arrete: boolean;
  /** Le temps moyen d'une affiche, mesuré ; null tant qu'on n'en sait rien. */
  moyenneMs: number | null;
}

/** Compte l'avancement d'un lot à partir de ses affiches (une sans état n'entre dans aucun compte). */
export function compter(
  affiches: readonly { titre: string; scene: string; etat: EtatDemo | undefined }[],
  arrete: boolean,
  moyenneMs: number | null,
): Avancement {
  const a: Avancement = {
    total: affiches.length,
    pretes: 0,
    taille: 0,
    echecs: 0,
    enAttente: 0,
    aFaire: 0,
    enCours: null,
    devant: 0,
    arrete,
    moyenneMs,
  };
  let devant: number | null = null;
  for (const x of affiches) {
    const e = x.etat;
    if (!e) continue;
    if (e.etat === "prete") {
      a.pretes++;
      a.taille += e.taille;
    } else if (e.etat === "echec") a.echecs++;
    else if (e.etat === "a_faire") a.aFaire++;
    else if (e.etat === "en_attente") {
      a.enAttente++;
      devant = devant === null ? e.devant : Math.min(devant, e.devant);
    } else if (!a.enCours || e.depuisMs > a.enCours.depuisMs)
      a.enCours = { titre: x.titre, scene: x.scene, depuisMs: e.depuisMs };
  }
  a.devant = Math.max(0, devant ?? 0);
  return a;
}

/** Ce qui reste à fabriquer : en file, en cours, et ce qui attend d'être relancé. */
export function resteAFaire(a: Avancement): number {
  return a.enAttente + a.aFaire + (a.enCours ? 1 : 0);
}

/**
 * La ligne d'avancement : « 9 prêtes sur 14 · en cours : MULHOUSE Place de
 * la Réunion (Famille), depuis 38 s · 4 en attente ».
 */
export function phraseAvancement(a: Avancement): string {
  if (!a.total) return "Ce lot n'a plus d'affiche.";
  if (a.pretes === a.total)
    return a.total > 1
      ? `Les ${a.total} affiches sont prêtes (${taille(a.taille)}).`
      : `L'affiche est prête (${taille(a.taille)}).`;
  const reste = resteAFaire(a);
  if (a.arrete && reste > 0)
    return `Lot arrêté : ${pluriel(a.pretes, "affiche prête", "affiches prêtes")}, ${reste} ${
      reste > 1 ? "restent" : "reste"
    } à faire${a.echecs ? `, ${pluriel(a.echecs, "échec")}` : ""}.`;
  const morceaux = [`${a.pretes} ${a.pretes > 1 ? "prêtes" : "prête"} sur ${a.total}`];
  if (a.enCours)
    morceaux.push(`en cours : ${a.enCours.titre} (${a.enCours.scene}), depuis ${duree(a.enCours.depuisMs)}`);
  if (a.enAttente) morceaux.push(`${a.enAttente} en attente`);
  if (a.aFaire) morceaux.push(`${a.aFaire} à refaire`);
  if (a.echecs) morceaux.push(pluriel(a.echecs, "échec"));
  return morceaux.join(" · ");
}

/** « Reste environ 6 min. » : une estimation, sur la moyenne mesurée. */
function estimation(a: Avancement): string {
  if (!a.moyenneMs || a.arrete) return "";
  const reste = resteAFaire(a);
  const ms = reste * a.moyenneMs - (a.enCours ? Math.min(a.enCours.depuisMs, a.moyenneMs) : 0);
  if (ms < 60_000) return "Reste moins d'une minute.";
  const minutes = Math.round(ms / 60_000);
  return minutes < 60
    ? `Reste environ ${minutes} min.`
    : `Reste environ ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}.`;
}

/**
 * « Reprendre » a-t-il quelque chose à faire ? Un lot arrêté qui a encore à
 * faire, des affiches « à refaire » que la page n'a pas réussi à relancer
 * d'elle-même (`bloque`), ou des échecs une fois la file vide : l'API les
 * refait alors avec la MÊME configuration — le seul moyen de retenter une
 * affiche tombée sur un manque passager, quand « Refaire au hasard » en
 * tire une autre.
 */
export function reprendrePossible(a: Avancement, bloque = false): boolean {
  return (a.aFaire > 0 && (a.arrete || bloque)) || (a.echecs > 0 && !a.enAttente && !a.enCours);
}

/**
 * La phrase sous l'avancement : ce qu'on peut faire, ou ce qu'on attend.
 * `bloque` : des affiches « à refaire » que la page n'a pas pu relancer.
 */
export function phraseDetail(a: Avancement, bloque = false): string {
  if (!a.total || a.pretes === a.total) return "";
  if (!a.arrete && (a.enAttente || a.enCours)) {
    // Rien du lot en fabrication, et des affiches avant les siennes : celles
    // d'un autre lot. Pas d'estimation, elle ne compterait que celui-ci.
    if (!a.enCours && a.devant > 0) return AUTRE_LOT_AVANT;
    const quoi = a.enCours
      ? "Vous pouvez quitter la page : le lot continue sur le serveur."
      : POURQUOI_ATTENTE;
    const reste = estimation(a);
    return reste ? `${quoi} ${reste}` : quoi;
  }
  if (a.arrete && a.enCours)
    return "L'affiche déjà en fabrication va jusqu'au bout ; « Reprendre » relancera les autres.";
  // Des affiches « à refaire » d'un lot qui tourne : la page les relance
  // d'elle-même, il n'y a rien à dire tant qu'elle essaie.
  if (!reprendrePossible(a, bloque)) return "";
  if (a.aFaire && a.echecs) return "« Reprendre » remet en fabrication ce qui reste à faire, échecs compris.";
  if (a.aFaire)
    return `« Reprendre » remet en fabrication ${
      a.aFaire > 1 ? `les ${a.aFaire} affiches qui restent` : "l'affiche qui reste"
    } à faire.`;
  return "« Reprendre » refait une affiche en échec avec les mêmes personnages ; « Refaire au hasard » en tire d'autres.";
}

/** « Tout télécharger (.zip, 138 Mo) », ou « Télécharger les 9 affiches prêtes (.zip) ». */
export function libelleZip(pretes: number, total: number, octets: number): string {
  if (pretes >= total) return `Tout télécharger (.zip, ${taille(octets)})`;
  return pretes > 1 ? `Télécharger les ${pretes} affiches prêtes (.zip)` : "Télécharger l'affiche prête (.zip)";
}

/** La confirmation de « Supprimer le lot », qui compte les PDF qu'elle efface. */
export function confirmationSuppression(pretes: number): string {
  if (!pretes) return "Supprimer ce lot ?\n\nSes affiches tirées seront oubliées. C'est sans retour.";
  return `Supprimer ce lot et ${
    pretes > 1 ? `ses ${pretes} PDF` : "son PDF"
  } ?\n\nLes fichiers seront effacés du serveur. C'est sans retour.`;
}

/** « Refaire au hasard » ne demande confirmation que s'il y a un PDF à perdre. */
export const CONFIRMATION_REFAIRE = "Refaire cette affiche au hasard ?\n\nSon PDF actuel sera remplacé.";

/** « Retirer du lot » efface le tirage, et le PDF s'il existe. */
export function confirmationRetrait(prete: boolean): string {
  return prete
    ? "Retirer cette affiche du lot ?\n\nSon PDF sera effacé du serveur. C'est sans retour."
    : "Retirer cette affiche du lot ?\n\nC'est sans retour.";
}
