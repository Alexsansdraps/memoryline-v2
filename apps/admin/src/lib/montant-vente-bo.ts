/**
 * Le montant d'une vente du stand, côté navigateur (26/11).
 *
 * 1. « Corriger le montant de la vente », sur la fiche (Margaux : « pouvoir
 *    modifier le montant € de la commande stand une fois qu'elle est
 *    validée ») : la confirmation redit l'ancien et le nouveau montant avant
 *    d'envoyer — une faute de frappe (390 € pour 39 €) se voit là, pas dans
 *    les statistiques du soir.
 *
 * 2. Le total DANS LA LIGNE de Ventes stand (Margaux : « commande stand
 *    pouvoir modifier directement le total dans la ligne ») : Entrée ou
 *    « OK » enregistre, SANS confirmation — elle en corrigera beaucoup, et
 *    le résultat s'affiche dans la ligne (« SAL-0036 : 69,00 € → 59,00 € »).
 *    Une valeur inchangée n'envoie rien, une saisie illisible non plus (la
 *    ligne le dit), et un second Entrée pendant l'envoi ne renvoie pas.
 *
 *    Relecture du 26/11 : un total tapé sans Entrée était perdu sans rien
 *    dire dès qu'on faisait Entrée sur une autre ligne, « Marquer
 *    terminées », un filtre… Désormais il se voit (cadre ambre, « Pas
 *    encore enregistré »), PART AVEC le prochain Entrée de n'importe quelle
 *    ligne (champ caché « autres »), et quitter la page autrement le fait
 *    retenir par le navigateur, comme les autres écrans du BO qui modifient
 *    en place (lib/pastilles.ts, lib/rangement.ts).
 *
 * Chargé par un <script> d'Astro (OrderTable.astro, commandes/[id].astro).
 * Sans script, les formulaires partent tels quels : le serveur refuse ce qui
 * ne va pas, et ne corrige pas un total inchangé.
 */
import {
  centimesSaisis,
  etatDuTotal,
  questionDeCorrection,
  questionTotauxEnAttente,
  refusDesFacturesEnAttente,
  SAISIE_ILLISIBLE,
  TOTAL_EN_ATTENTE,
} from "./montant-vente.ts";

/**
 * Ce que la barre de la sélection de Ventes stand (script de
 * components/OrderTable.astro) demande aux totaux tapés dans les lignes
 * (relecture finale du 26/11).
 */
export interface TotauxDeLaListe {
  /** Les numéros des ventes dont le total tapé n'est pas enregistré, parmi `ids` (toutes sans `ids`). */
  enAttente(ids?: readonly string[]): string[];
  /** Le refus de « Factures » quand une vente cochée a un total en attente ; null sinon. */
  avantFactures(ids: readonly string[]): string | null;
  /** Avant un geste qui recharge la page : vrai s'il n'y a rien en attente, ou si la perte est acceptée. */
  confirmerLaPerte(): boolean;
  /** La page part, la perte acceptée : le navigateur ne retient plus. */
  laisserPartir(): void;
}

declare global {
  interface Window {
    totauxDeLaListe?: TotauxDeLaListe;
  }
}

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-montant-vente]")) {
  form.addEventListener("submit", (evenement) => {
    const montant = form.querySelector<HTMLInputElement>('input[name="montant"]');
    const motif = form.querySelector<HTMLInputElement>('input[name="motif"]');
    const question = questionDeCorrection(
      form.dataset.numero ?? "",
      Number(form.dataset.avant) || 0,
      centimesSaisis(montant?.value ?? ""),
      motif?.value ?? "",
    );
    if (question && !window.confirm(question)) evenement.preventDefault();
  });
}

/** Une ligne de Ventes stand dont le total se corrige sur place. */
interface LigneDuTotal {
  form: HTMLFormElement;
  champ: HTMLInputElement;
  bouton: HTMLButtonElement | null;
  /** Le message sous le champ : le résultat rendu par la page, ou ce qu'on dit ici. */
  dit: HTMLElement | null;
  id: number;
  numero: string;
  avant: number;
}

const lignes: LigneDuTotal[] = [
  ...document.querySelectorAll<HTMLFormElement>("form[data-montant-ligne]"),
].flatMap((form) => {
  const champ = form.querySelector<HTMLInputElement>('input[name="montant"]');
  if (!champ) return [];
  return [
    {
      form,
      champ,
      bouton: form.querySelector<HTMLButtonElement>("button"),
      dit: form.parentElement?.querySelector<HTMLElement>("[data-montant-ligne-message]") ?? null,
      id: Number(form.querySelector<HTMLInputElement>('input[name="id"]')?.value),
      numero: form.querySelector<HTMLInputElement>('input[name="numero"]')?.value ?? "",
      avant: Number(form.dataset.avant) || 0,
    },
  ];
});

/** Un envoi est parti : plus rien ne repart, et la page peut se quitter. */
let envoiEnCours = false;
/** Les totaux en attente sont abandonnés en connaissance de cause (barre de la sélection). */
let pertesAcceptees = false;

const etat = (l: LigneDuTotal) => etatDuTotal(l.champ.value, l.avant);

/** Dit quelque chose sous le champ : « erreur » en rouge, « attente » en ambre. */
function dire(l: LigneDuTotal, texte: string, ton: "erreur" | "attente" | "info") {
  if (!l.dit) return;
  l.dit.textContent = texte;
  l.dit.hidden = !texte;
  l.dit.dataset.local = "1";
  l.dit.classList.remove("text-green-700");
  l.dit.classList.toggle("text-red-700", ton === "erreur");
  l.dit.classList.toggle("text-amber-800", ton === "attente");
  l.dit.classList.toggle("text-bo-muted", ton === "info");
}

/** Le cadre ambre d'un total tapé et pas encore envoyé, et sa phrase. */
function marquer(l: LigneDuTotal) {
  const attente = etat(l) !== "inchange";
  l.champ.classList.toggle("border-amber-500", attente);
  l.champ.classList.toggle("bg-amber-50", attente);
  l.champ.classList.toggle("border-bo-border", !attente);
  l.champ.classList.toggle("bg-bo-surface", !attente);
  if (attente) dire(l, TOTAL_EN_ATTENTE, "attente");
  // Revenu à la valeur enregistrée : la phrase d'ici s'efface (le résultat
  // rendu par la page, lui, avait déjà cédé la place à la saisie).
  else if (l.dit?.dataset.local === "1") dire(l, "", "info");
}

for (const l of lignes) {
  l.champ.addEventListener("input", () => marquer(l));
  // Une valeur gardée par le navigateur (retour arrière) se voit aussi.
  if (etat(l) !== "inchange") marquer(l);

  l.form.addEventListener("submit", (evenement) => {
    if (envoiEnCours) {
      evenement.preventDefault();
      return;
    }
    // Tous les totaux tapés partent ensemble : celui de cette ligne, s'il a
    // changé, et ceux des autres lignes, pas encore envoyés.
    const aEnvoyer = lignes.filter((x) => etat(x) !== "inchange");
    if (!aEnvoyer.length) {
      evenement.preventDefault();
      dire(l, "Inchangé : rien n'est envoyé.", "info");
      return;
    }
    const illisibles = aEnvoyer.filter((x) => etat(x) === "illisible");
    if (illisibles.length) {
      // Rien ne part tant qu'un total tapé ne se lit pas : envoyé, il
      // reviendrait à sa valeur enregistrée au rechargement, et la saisie
      // serait perdue.
      evenement.preventDefault();
      for (const x of illisibles) dire(x, SAISIE_ILLISIBLE, "erreur");
      if (!illisibles.includes(l))
        dire(
          l,
          `Le total tapé pour ${illisibles.map((x) => x.numero).join(", ")} ne se lit pas : corrigez-le, puis Entrée.`,
          "erreur",
        );
      illisibles[0]!.champ.focus();
      return;
    }
    let autres = l.form.querySelector<HTMLInputElement>('input[name="autres"]');
    if (!autres) {
      autres = document.createElement("input");
      autres.type = "hidden";
      autres.name = "autres";
      l.form.append(autres);
    }
    autres.value = JSON.stringify(
      aEnvoyer
        .filter((x) => x !== l)
        .map((x) => ({ id: x.id, numero: x.numero, avant: x.avant, montant: x.champ.value })),
    );
    envoiEnCours = true;
    l.bouton?.setAttribute("aria-busy", "true");
    l.bouton?.classList.add("opacity-60", "cursor-wait");
  });
}

// Quitter la page avec un total tapé et pas envoyé (un filtre, un onglet, la
// fiche…) : le navigateur demande d'abord. La barre de la sélection, elle,
// demande avant (`confirmerLaPerte`, plus bas).
if (lignes.length)
  window.addEventListener("beforeunload", (e) => {
    if (envoiEnCours || pertesAcceptees || !lignes.some((l) => etat(l) !== "inchange")) return;
    e.preventDefault();
    // Les navigateurs plus anciens ne demandent confirmation que si
    // `returnValue` est posé.
    e.returnValue = "";
  });

/** Les lignes dont le total tapé n'est pas enregistré, parmi `ids` (toutes sans `ids`). */
const enAttente = (ids?: readonly string[]) =>
  lignes.filter((l) => etat(l) !== "inchange" && (!ids || ids.includes(String(l.id))));

/*
 * Pour la barre de la sélection (relecture finale du 26/11). « Factures »
 * télécharge sans quitter la page : le garde ci-dessus ne la voyait pas, et
 * une vente cochée était facturée — pour toujours — à son ANCIEN total. Les
 * autres gestes rechargent la page : le navigateur demandait à sa façon, et
 * « Rester » laissait la barre bloquée. Ils demandent désormais eux-mêmes,
 * en nommant les ventes.
 */
window.totauxDeLaListe = {
  enAttente: (ids) => enAttente(ids).map((l) => l.numero),
  avantFactures(ids) {
    const lesquelles = enAttente(ids);
    return lesquelles.length ? refusDesFacturesEnAttente(lesquelles.map((l) => l.numero)) : null;
  },
  confirmerLaPerte() {
    const lesquelles = enAttente();
    return !lesquelles.length || window.confirm(questionTotauxEnAttente(lesquelles.map((l) => l.numero)));
  },
  laisserPartir() {
    pertesAcceptees = true;
  },
};

// Une page resservie par la flèche retour ne doit pas garder l'envoi bloqué.
window.addEventListener("pageshow", () => {
  envoiEnCours = false;
  pertesAcceptees = false;
  for (const l of lignes) {
    l.bouton?.removeAttribute("aria-busy");
    l.bouton?.classList.remove("opacity-60", "cursor-wait");
    marquer(l);
  }
});
