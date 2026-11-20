/**
 * La page d'un lot d'affiches de démonstration, vue du navigateur : où en est
 * chaque affiche, sans recharger la page.
 *
 * Les affiches se fabriquent une à une sur le serveur, en arrière-plan : un
 * lot de quarante A3 peut prendre une heure, et la page ne doit ni rester
 * figée sur « En attente » ni tenir une requête ouverte pendant tout ce
 * temps. Elle redemande donc l'état du lot (GET …/lots/:id/etat), toutes les
 * 2,5 s, puis toutes les 6 s au-delà d'une minute — le rythme de
 * lib/impression-bo.ts pour les PDF des commandes, sans le réutiliser : ses
 * phrases parlent de commandes, et il sert la liste et les fiches des
 * commandes. Une question à la fois ; plus aucune quand plus rien n'avance.
 *
 * La première question porte `reprendre=1` : ce qui était resté « à refaire »
 * (l'API redémarrée pendant le lot, une mise en ligne) repart en fabrication
 * dès qu'on ouvre la page. L'API ne relance jamais un lot ARRÊTÉ, et la page
 * ne le demande pas. Bornée : si rien ne repart après trois essais, la page
 * cesse de redemander et propose « Reprendre ».
 *
 * Les gestes (arrêter, reprendre, refaire, retirer, supprimer) restent des
 * formulaires traités par le serveur du back-office : ce script ne fait que
 * LIRE l'état, et dire ce qu'il en est.
 *
 * Le balisage, posé par la page (pages/affiches-demo/[id].astro) :
 *   - `[data-lot-demo]` entoure le tout ; `data-url-etat` donne l'adresse de
 *     l'état, `data-arrete="1"` un lot arrêté à l'ouverture ; le script y
 *     tient `data-pretes` à jour ;
 *   - `[data-affiche="12"]` est la carte d'une affiche : `data-titre` et
 *     `data-scene` la nomment dans la ligne d'avancement, et le script y
 *     tient `data-etat` à jour (« prete », « en_cours »…). Dedans :
 *     `[data-etat-texte]`, `a[data-pdf]`, `form[data-refaire]`,
 *     `form[data-retirer]`, `[data-vignette]` (le cadre, avec `data-src`,
 *     l'adresse de la vignette) et `[data-vignette-texte]` ;
 *   - `[data-barre]` (dans un `[role=progressbar]`), `[data-avancement]`,
 *     `[data-detail]`, `[data-alerte]` ;
 *   - `a[data-zip]`, `[data-si-reste]` (« Arrêter le lot »),
 *     `[data-si-reprendre]` (« Reprendre »), et `form[data-supprimer-lot]`,
 *     dont le script réécrit `data-confirme` : la question compte les PDF
 *     qu'elle efface, et ce nombre monte pendant que la page reste ouverte.
 */
import type { EtatDemo, EtatLotDemo } from "./api.ts";
import {
  compter,
  confirmationSuppression,
  infobulleEtat,
  libelleZip,
  phraseAvancement,
  phraseDetail,
  reprendrePossible,
  resteAFaire,
  texteEtat,
  texteSansVignette,
} from "./affiches-demo-textes.ts";

/** Entre deux questions, tant que quelque chose se fabrique ; plus espacées après une minute. */
const PAUSE = 2500;
const PAUSE_LONGUE = 6000;
/** Combien de fois on redemande la reprise d'affiches « à refaire » qui ne repartent pas. */
const RELANCES_MAX = 3;

function demarrer(racine: HTMLElement): void {
  const urlEtat = racine.dataset.urlEtat;
  if (!urlEtat) return;

  let arrete = racine.dataset.arrete === "1";
  let moyenneMs: number | null = null;
  const etats = new Map<number, EtatDemo>();
  /** L'heure de la dernière réponse : la durée d'une fabrication en cours avance entre deux questions. */
  let recuLe = 0;
  /** Le nombre d'affiches du lot selon le serveur : s'il diffère des cartes, le lot a changé ailleurs. */
  let totalServeur: number | null = null;
  let erreur: string | null = null;
  let disparu = false;
  let minuterie = 0;
  let horloge = 0;
  let questionEnCours = false;
  let attenteDepuis = 0;
  let premiere = true;
  let relances = 0;

  const cartes = () => [...racine.querySelectorAll<HTMLElement>("[data-affiche]")];
  const aFaire = () => [...etats.values()].filter((e) => e.etat === "a_faire").length;
  const enFile = () => [...etats.values()].some((e) => e.etat === "en_attente" || e.etat === "en_cours");
  /** Des affiches « à refaire » dans un lot qui n'est pas arrêté : la page demande leur reprise. */
  const aRelancer = () => !arrete && aFaire() > 0 && relances < RELANCES_MAX;

  function rendreCarte(carte: HTMLElement, e: EtatDemo): void {
    carte.dataset.etat = e.etat;
    const texte = carte.querySelector<HTMLElement>("[data-etat-texte]");
    if (texte) {
      const t = texteEtat(e);
      if (texte.textContent !== t) texte.textContent = t;
      texte.title = infobulleEtat(e);
      texte.classList.toggle("text-red-700", e.etat === "echec");
      texte.classList.toggle("text-green-700", e.etat === "prete");
    }
    const pdf = carte.querySelector<HTMLAnchorElement>("a[data-pdf]");
    if (pdf) pdf.hidden = e.etat !== "prete";

    const cadre = carte.querySelector<HTMLElement>("[data-vignette]");
    if (!cadre) return;
    let image = cadre.querySelector<HTMLImageElement>("img");
    const sans = cadre.querySelector<HTMLElement>("[data-vignette-texte]");
    if (e.etat === "prete" && cadre.dataset.src) {
      // La version dans l'adresse : une affiche refaite garde la même
      // adresse de vignette, et le navigateur montrerait l'ancienne.
      const voulue = `${cadre.dataset.src}?v=${e.taille}`;
      if (!image) {
        image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.dataset.apercuLargeur = "360";
        image.className = "bo-vignette h-full w-full object-cover";
        cadre.prepend(image);
      }
      if (image.getAttribute("src") !== voulue) image.src = voulue;
      image.hidden = false;
      if (sans) sans.hidden = true;
    } else {
      if (image) image.hidden = true;
      if (sans) {
        sans.hidden = false;
        sans.textContent = texteSansVignette(e);
      }
    }
  }

  /**
   * Le lot a été supprimé ailleurs (un autre onglet, un autre poste) : plus
   * rien n'avance ni ne se fait. L'horloge s'arrête — elle faisait monter sans
   * fin le compteur d'une carte « en cours » —, les boutons du lot et des
   * cartes partent, et aucune carte ne prétend encore se fabriquer.
   */
  function figer(): void {
    if (horloge) {
      window.clearInterval(horloge);
      horloge = 0;
    }
    const avancement = racine.querySelector<HTMLElement>("[data-avancement]");
    if (avancement) avancement.textContent = "Ce lot n'existe plus.";
    const detail = racine.querySelector<HTMLElement>("[data-detail]");
    if (detail) detail.textContent = "";
    const gestes =
      "a[data-zip], [data-si-reste], [data-si-reprendre], form[data-supprimer-lot], a[data-pdf], form[data-refaire], form[data-retirer]";
    for (const el of racine.querySelectorAll<HTMLElement>(gestes)) el.hidden = true;
    for (const carte of cartes()) {
      if (carte.dataset.etat !== "en_cours" && carte.dataset.etat !== "en_attente") continue;
      const texte = carte.querySelector<HTMLElement>("[data-etat-texte]");
      if (texte) {
        texte.textContent = "";
        texte.title = "";
      }
      const sans = carte.querySelector<HTMLElement>("[data-vignette-texte]");
      if (sans) sans.textContent = "";
    }
  }

  function rendre(): void {
    const alerte = racine.querySelector<HTMLElement>("[data-alerte]");
    if (alerte) {
      alerte.textContent = disparu
        ? "Ce lot n'existe plus : il a été supprimé. Revenez à la liste des lots."
        : erreur ?? "";
      alerte.hidden = !disparu && !erreur;
    }
    if (disparu) {
      figer();
      return;
    }
    // Avant la première réponse, la page garde ce que le serveur a dessiné.
    if (!recuLe) return;

    const ecoule = Date.now() - recuLe;
    const lignes = cartes().map((carte) => {
      const brut = etats.get(Number(carte.dataset.affiche));
      // Une fabrication en cours avance d'elle-même entre deux réponses.
      const etat: EtatDemo | undefined =
        brut?.etat === "en_cours" ? { etat: "en_cours", depuisMs: brut.depuisMs + ecoule } : brut;
      if (etat) rendreCarte(carte, etat);
      return { titre: carte.dataset.titre ?? "", scene: carte.dataset.scene ?? "", etat };
    });
    const a = compter(lignes, arrete, moyenneMs);
    racine.dataset.pretes = String(a.pretes);

    const pourcent = a.total ? Math.round((a.pretes / a.total) * 100) : 0;
    const barre = racine.querySelector<HTMLElement>("[data-barre]");
    if (barre) {
      barre.style.width = `${pourcent}%`;
      barre.closest("[role=progressbar]")?.setAttribute("aria-valuenow", String(pourcent));
    }
    // Des affiches « à refaire » que trois relances n'ont pas fait repartir :
    // la page cesse d'insister et propose « Reprendre ».
    const bloque = !arrete && relances >= RELANCES_MAX;
    const avancement = racine.querySelector<HTMLElement>("[data-avancement]");
    if (avancement) avancement.textContent = phraseAvancement(a);
    const detail = racine.querySelector<HTMLElement>("[data-detail]");
    if (detail) {
      // Une affiche retirée dans un autre onglet : les cartes de cette page
      // ne sont plus celles du lot.
      const change = totalServeur !== null && totalServeur !== a.total;
      detail.textContent = change
        ? "Ce lot a changé depuis l'ouverture de la page : rechargez-la."
        : phraseDetail(a, bloque);
    }

    const zip = racine.querySelector<HTMLAnchorElement>("a[data-zip]");
    if (zip) {
      zip.hidden = a.pretes === 0;
      const libelle = libelleZip(a.pretes, a.total, a.taille);
      if (zip.textContent?.trim() !== libelle) zip.textContent = libelle;
    }
    const reste = resteAFaire(a);
    for (const el of racine.querySelectorAll<HTMLElement>("[data-si-reste]"))
      el.hidden = arrete || reste === 0;
    for (const el of racine.querySelectorAll<HTMLElement>("[data-si-reprendre]"))
      el.hidden = !reprendrePossible(a, bloque);
    const supprimer = racine.querySelector<HTMLFormElement>("form[data-supprimer-lot]");
    if (supprimer) supprimer.dataset.confirme = confirmationSuppression(a.pretes);

    // La durée « en cours » se compte à la seconde, entre deux questions.
    const fabrique = lignes.some((l) => l.etat?.etat === "en_cours");
    if (fabrique && !horloge) horloge = window.setInterval(rendre, 1000);
    if (!fabrique && horloge) {
      window.clearInterval(horloge);
      horloge = 0;
    }
  }

  /** Repose la question tant que quelque chose se fabrique, attend ou doit être relancé. */
  function planifier(): void {
    window.clearTimeout(minuterie);
    minuterie = 0;
    if (disparu || (!erreur && !enFile() && !aRelancer())) {
      attenteDepuis = 0;
      return;
    }
    attenteDepuis ||= Date.now();
    const pause = erreur || Date.now() - attenteDepuis > 60_000 ? PAUSE_LONGUE : PAUSE;
    minuterie = window.setTimeout(() => void questionner(), pause);
  }

  async function questionner(): Promise<void> {
    if (questionEnCours) return;
    questionEnCours = true;
    window.clearTimeout(minuterie);
    minuterie = 0;
    // La première question relance ce qui est resté à refaire ; les suivantes
    // seulement si des affiches « à refaire » ne sont toujours pas reparties.
    const reprendre = !arrete && (premiere || (aFaire() > 0 && !enFile() && relances < RELANCES_MAX));
    if (reprendre && !premiere) relances++;
    premiere = false;
    try {
      const reponse = await fetch(`${urlEtat}${reprendre ? "?reprendre=1" : ""}`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (reponse.status === 404) {
        // Les derniers états reçus ne valent plus rien : rien ne doit plus
        // être redessiné d'après eux (cf. figer).
        disparu = true;
        etats.clear();
        return;
      }
      if (reponse.status === 401) throw new Error("Session expirée : reconnectez-vous.");
      if (!reponse.ok) throw new Error(`le serveur a répondu ${reponse.status}`);
      const lu = (await reponse.json()) as EtatLotDemo;
      etats.clear();
      for (const [id, e] of Object.entries(lu.affiches ?? {})) etats.set(Number(id), e);
      arrete = !!lu.arrete;
      moyenneMs = lu.moyenneMs ?? null;
      totalServeur = typeof lu.total === "number" ? lu.total : null;
      recuLe = Date.now();
      erreur = null;
      if (!aFaire() || enFile()) relances = 0;
    } catch (e) {
      // L'API qui redémarre (une mise en ligne) ne répond pas pendant
      // quelques secondes : on le dit, et on repose la question.
      const raison = e instanceof Error ? e.message : String(e);
      erreur = raison.startsWith("Session expirée")
        ? raison
        : `L'état du lot n'a pas pu être lu (${raison}). Nouvel essai dans quelques secondes.`;
    } finally {
      questionEnCours = false;
      rendre();
      planifier();
    }
  }

  // Un onglet revenu au premier plan n'attend pas la fin de sa pause : les
  // navigateurs ralentissent les minuteries des onglets cachés.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && minuterie) void questionner();
  });

  void questionner();
}

for (const racine of document.querySelectorAll<HTMLElement>("[data-lot-demo]")) demarrer(racine);
