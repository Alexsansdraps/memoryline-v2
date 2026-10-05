/**
 * Les fichiers d'impression, vus du back-office : sur la fiche d'une commande
 * et dans la liste des commandes.
 *
 * « La plupart du temps on ne peut pas télécharger le PDF pour imprimer. »
 * Le lien ouvrait un onglet, et le fichier se fabriquait PENDANT ce temps :
 * un onglet blanc pendant une à deux minutes sur le serveur de test, une
 * ligne de code en guise d'erreur, ou rien du tout. Désormais la page
 * demande d'abord où en est chaque fichier (/admin/print-files/etat), et le
 * DIT : prêt, en préparation, ou impossible — avec la raison et de quoi
 * réessayer. Un clic sur un fichier qui n'est pas prêt lance sa préparation,
 * et le téléchargement part tout seul dès qu'il l'est.
 *
 * Sans ce script (ou si l'état ne peut pas être lu), chaque lien reste un
 * simple lien de téléchargement, comme avant.
 *
 * Le balisage, posé par la page :
 *   - `[data-impression]` entoure le tout ; `data-url-etat` donne l'adresse
 *     de l'état, et `data-preparer`, sur la fiche, fait préparer les fichiers
 *     dès l'ouverture : on ouvre une commande pour l'imprimer ;
 *   - `a[data-pdf-ligne="12"]` télécharge le PDF d'une ligne ; `data-pdf-nom`
 *     dit de quelle affiche il s'agit dans les info-bulles, `data-pdf-court`
 *     (« Affiche 2 ») dans les messages d'une colonne étroite ; avec
 *     `data-pdf-libelle="long"`, son texte suit l'état (fiche), sinon seul son
 *     aspect change (boutons « PDF », « 1 », « 2 » de la liste) ;
 *   - `[data-pdf-message="12"]`, facultatif, reçoit la phrase de cette ligne ;
 *   - `a[data-pdf-tout]` télécharge l'archive .zip de toutes les lignes
 *     `data-pdf-lignes`, une fois qu'elles sont toutes prêtes ;
 *   - `[data-pdf-groupe]` réunit les liens d'une commande, et son
 *     `[data-pdf-messages]` reçoit ce qui bloque (échec, archive en cours) ;
 *   - `[data-pdf-alerte]`, facultatif, reçoit l'erreur de réseau éventuelle.
 */

type Etat =
  | { etat: "pret"; taille: number }
  | { etat: "en_preparation"; lancee: boolean; devant: number; depuis: number }
  | { etat: "echec"; erreur: string }
  | { etat: "a_preparer" };

/** Entre deux questions, tant qu'un fichier se prépare ; plus espacées après une minute. */
const PAUSE = 2500;
const PAUSE_LONGUE = 6000;

const octets = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
function taille(n: number): string {
  return n >= 1_000_000 ? `${octets.format(n / 1_000_000)} Mo` : `${octets.format(n / 1000)} Ko`;
}
function duree(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

/** Lance un téléchargement comme le ferait un clic sur le lien. */
function telecharger(adresse: string): void {
  const a = document.createElement("a");
  a.href = adresse;
  a.download = "";
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}

function demarrer(racine: HTMLElement): void {
  const urlEtat = racine.dataset.urlEtat;
  if (!urlEtat) return;
  const preparerDOffice = racine.dataset.preparer === "1";

  const etats = new Map<number, Etat>();
  /** Les lignes dont la boutique a demandé le fichier : il partira dès qu'il sera prêt. */
  const voulues = new Set<number>();
  /** Les archives demandées avant que toutes leurs lignes soient prêtes. */
  const archivesVoulues = new Set<HTMLAnchorElement>();
  let erreurReseau: string | null = null;
  let minuterie = 0;
  let sondageEnCours = false;
  let attenteDepuis = 0;
  /**
   * Le numéro de la question dont chaque ligne tient sa réponse. Un clic et
   * une relecture peuvent se croiser : la réponse d'une question plus
   * ancienne, arrivée après, ne doit pas effacer la plus récente.
   */
  let questions = 0;
  const reponduPar = new Map<number, number>();
  /**
   * Combien de fois la préparation d'une ligne a été redemandée parce qu'elle
   * était retombée « à préparer » — ce qui n'arrive que si l'API a redémarré
   * (une mise en ligne) pendant le calcul. Borné : jamais de boucle.
   */
  const relances = new Map<number, number>();
  const RELANCES_MAX = 3;

  const liens = () => [...racine.querySelectorAll<HTMLAnchorElement>("a[data-pdf-ligne]")];
  const archives = () => [...racine.querySelectorAll<HTMLAnchorElement>("a[data-pdf-tout]")];
  const idDe = (a: HTMLAnchorElement) => Number(a.dataset.pdfLigne);
  const lignesDe = (a: HTMLAnchorElement) =>
    (a.dataset.pdfLignes ?? "").split(",").map(Number).filter((n) => n > 0);
  const nomDe = (a: HTMLAnchorElement) => a.dataset.pdfNom || "Le PDF d'impression";
  const tousLesIds = () => [...new Set([...liens().map(idDe), ...archives().flatMap(lignesDe)])];

  // Le texte d'origine de chaque lien, pour y revenir.
  for (const a of [...liens(), ...archives()]) a.dataset.pdfTexte ??= a.textContent?.trim() ?? "";

  function rendreLien(a: HTMLAnchorElement): void {
    const id = idDe(a);
    const e = etats.get(id);
    const nom = nomDe(a);
    const long = a.dataset.pdfLibelle === "long";
    let texte = a.dataset.pdfTexte ?? "";
    let titre: string;
    switch (e?.etat) {
      case "pret":
        titre = `${nom} : prêt (${taille(e.taille)}). Cliquer pour le télécharger.`;
        if (long) texte = "Télécharger le PDF d'impression";
        break;
      case "en_preparation":
        titre = `${nom} : en préparation…${voulues.has(id) ? " Il se téléchargera dès qu'il sera prêt." : " Cliquer pour le télécharger dès qu'il sera prêt."}`;
        if (long) texte = "PDF en préparation…";
        break;
      case "echec":
        titre = `${nom} : impossible à fabriquer — ${e.erreur} Cliquer pour réessayer.`;
        if (long) texte = "Réessayer le PDF";
        break;
      case "a_preparer":
        titre = `${nom} : pas encore prêt. Cliquer pour le préparer ; il se téléchargera tout seul.`;
        if (long) texte = "Préparer et télécharger le PDF";
        break;
      default:
        titre = `${nom} : télécharger le PDF d'impression`;
    }
    a.dataset.etat = e?.etat ?? "inconnu";
    a.setAttribute("aria-busy", String(e?.etat === "en_preparation"));
    a.title = titre;
    a.setAttribute("aria-label", titre);
    if (long && a.textContent !== texte) a.textContent = texte;

    // La phrase de la ligne, quand la page lui a fait une place (la fiche).
    const zone = racine.querySelector<HTMLElement>(`[data-pdf-message="${id}"]`);
    if (!zone) return;
    let phrase = "";
    let erreur = false;
    if (!e) {
      phrase = erreurReseau
        ? `État du fichier inconnu (${erreurReseau}) : le lien reste utilisable.`
        : "";
    } else if (e.etat === "pret") {
      phrase = `Prêt · ${taille(e.taille)}`;
    } else if (e.etat === "en_preparation") {
      phrase = e.lancee
        ? `Fabrication en cours (${duree(e.depuis)})… Le premier calcul d'un fond peut prendre une à deux minutes. Vous pouvez quitter la page : le fichier restera prêt.`
        : `En file d'attente${e.devant ? ` (${e.devant} fichier${e.devant > 1 ? "s" : ""} avant)` : ""}…`;
      if (voulues.has(id)) phrase += " Le téléchargement partira tout seul.";
    } else if (e.etat === "echec") {
      phrase = `Le PDF n'a pas pu être fabriqué : ${e.erreur}`;
      erreur = true;
    }
    zone.textContent = phrase;
    zone.classList.toggle("bo-pdf-erreur", erreur);
  }

  function rendreArchive(a: HTMLAnchorElement): void {
    const ids = lignesDe(a);
    const liste = ids.map((id) => etats.get(id));
    const prets = liste.filter((e) => e?.etat === "pret");
    let etat: string;
    if (liste.some((e) => !e)) etat = "inconnu";
    else if (prets.length === ids.length) etat = "pret";
    else if (liste.some((e) => e?.etat === "echec")) etat = "echec";
    else if (liste.some((e) => e?.etat === "en_preparation")) etat = "en_preparation";
    else etat = "a_preparer";
    const total = prets.reduce((n, e) => n + (e?.etat === "pret" ? e.taille : 0), 0);
    const enEchec = liste.filter((e) => e?.etat === "echec").length;
    const titre =
      etat === "pret"
        ? `Tout télécharger : les ${ids.length} PDF de la commande dans une archive .zip (${taille(total)}).`
        : etat === "inconnu"
          ? `Tout télécharger : les ${ids.length} PDF de la commande dans une archive .zip.`
          : etat === "echec"
            ? `Tout télécharger : ${prets.length} PDF prêt${prets.length > 1 ? "s" : ""} sur ${ids.length} ; ${enEchec} n'${enEchec > 1 ? "ont" : "a"} pas pu être fabriqué${enEchec > 1 ? "s" : ""} (la raison est dite à côté). Cliquer pour réessayer ; l'archive partira toute seule si tout réussit.`
            : `Tout télécharger : ${prets.length} PDF prêt${prets.length > 1 ? "s" : ""} sur ${ids.length}. Cliquer pour préparer les autres ; l'archive partira toute seule.`;
    a.dataset.etat = etat;
    a.setAttribute("aria-busy", String(etat === "en_preparation" && archivesVoulues.has(a)));
    a.title = titre;
    a.setAttribute("aria-label", titre);
  }

  function rendreGroupe(groupe: HTMLElement): void {
    const zone = groupe.querySelector<HTMLElement>("[data-pdf-messages]");
    if (!zone) return;
    const phrases: { texte: string; erreur: boolean }[] = [];
    for (const a of groupe.querySelectorAll<HTMLAnchorElement>("a[data-pdf-ligne]")) {
      const id = idDe(a);
      // Une ligne qui a sa propre phrase (la fiche) ne se répète pas ici.
      if (racine.querySelector(`[data-pdf-message="${id}"]`)) continue;
      const e = etats.get(id);
      // Le nom court d'abord (« Affiche 2 ») : dans une colonne étroite, la
      // raison doit venir avant que la ligne ne soit coupée.
      const court = a.dataset.pdfCourt || nomDe(a);
      if (e?.etat === "echec") phrases.push({ texte: `${court} : ${e.erreur}`, erreur: true });
      else if (e?.etat === "en_preparation" && voulues.has(id))
        phrases.push({ texte: `${court} : en préparation, le téléchargement partira tout seul…`, erreur: false });
    }
    const archive = groupe.querySelector<HTMLAnchorElement>("a[data-pdf-tout]");
    if (archive) {
      const ids = lignesDe(archive);
      const liste = ids.map((id) => etats.get(id));
      // Sur la fiche, les échecs sont déjà dits ligne par ligne : on dit
      // seulement pourquoi l'archive ne part pas.
      const echecs = ids.filter((id) => etats.get(id)?.etat === "echec");
      if (echecs.length && racine.querySelector(`[data-pdf-message="${echecs[0]}"]`))
        phrases.push({
          texte: `L'archive attend ${echecs.length > 1 ? `les ${echecs.length} affiches` : "l'affiche"} en échec ci-dessus.`,
          erreur: true,
        });
      if (archivesVoulues.has(archive)) {
        const prets = liste.filter((e) => e?.etat === "pret").length;
        phrases.push({
          texte: `Archive : ${prets} PDF prêt${prets > 1 ? "s" : ""} sur ${ids.length}, elle partira toute seule…`,
          erreur: false,
        });
      }
    }
    // Une raison déjà dépliée le reste quand l'état est redessiné.
    const depliees = new Set(
      [...zone.querySelectorAll<HTMLElement>("[aria-expanded='true']")].map((b) => b.textContent),
    );
    zone.replaceChildren(
      ...phrases.map((p) => {
        // Une raison d'échec est souvent longue : coupée à deux lignes dans
        // la liste, elle se déplie d'un clic — un téléphone n'a pas
        // d'info-bulle pour la lire en entier.
        const ligne = document.createElement(p.erreur ? "button" : "span");
        ligne.textContent = p.texte;
        ligne.title = p.texte;
        if (p.erreur) {
          ligne.className = "bo-pdf-erreur bo-pdf-raison";
          (ligne as HTMLButtonElement).type = "button";
          ligne.setAttribute("aria-expanded", String(depliees.has(p.texte)));
        }
        return ligne;
      }),
    );
  }

  function rendre(): void {
    for (const a of liens()) rendreLien(a);
    for (const a of archives()) rendreArchive(a);
    for (const g of racine.querySelectorAll<HTMLElement>("[data-pdf-groupe]")) rendreGroupe(g);
    const alerte = racine.querySelector<HTMLElement>("[data-pdf-alerte]");
    if (alerte) {
      alerte.textContent = erreurReseau
        ? `L'état des PDF d'impression n'a pas pu être lu (${erreurReseau}). Les liens restent utilisables ; nouvel essai dans quelques secondes.`
        : "";
      alerte.hidden = !erreurReseau;
    }
  }

  /** Ce que la boutique a demandé et qui est prêt part ; ce qui a échoué cesse d'attendre. */
  function declencher(): void {
    for (const id of [...voulues]) {
      const e = etats.get(id);
      if (e?.etat === "pret") {
        voulues.delete(id);
        const lien = liens().find((a) => idDe(a) === id);
        if (lien) telecharger(lien.href);
      } else if (e?.etat === "echec" || abandonnee(id)) voulues.delete(id);
    }
    for (const a of [...archivesVoulues]) {
      const ids = lignesDe(a);
      const liste = ids.map((id) => etats.get(id));
      if (liste.every((e) => e?.etat === "pret")) {
        archivesVoulues.delete(a);
        telecharger(a.href);
      } else if (liste.some((e) => e?.etat === "echec") || ids.some(abandonnee))
        archivesVoulues.delete(a);
    }
  }

  /** Une ligne retombée « à préparer » trop souvent : on cesse de la redemander. */
  function abandonnee(id: number): boolean {
    return etats.get(id)?.etat === "a_preparer" && (relances.get(id) ?? 0) >= RELANCES_MAX;
  }

  /** Les lignes dont le fichier doit se préparer : toutes sur la fiche, celles demandées dans la liste. */
  function aPreparer(id: number): boolean {
    return (
      preparerDOffice ||
      voulues.has(id) ||
      [...archivesVoulues].some((a) => lignesDe(a).includes(id))
    );
  }

  /** Repose la question tant qu'un fichier se prépare (ou que la réponse n'est pas venue). */
  function planifier(): void {
    window.clearTimeout(minuterie);
    const aSuivre = erreurReseau
      ? tousLesIds()
      : [...etats]
          .filter(
            ([id, e]) =>
              e.etat === "en_preparation" || (e.etat === "a_preparer" && aPreparer(id) && !abandonnee(id)),
          )
          .map(([id]) => id);
    if (!aSuivre.length) {
      attenteDepuis = 0;
      return;
    }
    attenteDepuis ||= Date.now();
    const pause = erreurReseau || Date.now() - attenteDepuis > 60_000 ? PAUSE_LONGUE : PAUSE;
    minuterie = window.setTimeout(() => void sonder(aSuivre), pause);
  }

  /**
   * Une relecture : les lignes à préparer repartent avec `preparer` — une
   * préparation perdue dans un redémarrage de l'API est relancée au lieu de
   * laisser la page attendre pour rien —, les autres sont seulement relues.
   */
  async function sonder(ids: number[]): Promise<void> {
    if (sondageEnCours) return;
    sondageEnCours = true;
    try {
      const preparer = ids.filter(aPreparer);
      for (const id of preparer)
        if (etats.get(id)?.etat === "a_preparer") relances.set(id, (relances.get(id) ?? 0) + 1);
      await Promise.all([
        questionner(preparer, "preparer"),
        questionner(ids.filter((id) => !preparer.includes(id))),
      ]);
    } finally {
      sondageEnCours = false;
    }
    apresReponse();
  }

  /** Un clic : la question part tout de suite, même pendant une relecture. */
  async function interroger(ids: number[], action?: "preparer" | "reessayer"): Promise<void> {
    await questionner(ids, action);
    apresReponse();
  }

  function apresReponse(): void {
    // D'abord ce qui part ou renonce : la page dit ensuite ce qui reste.
    declencher();
    rendre();
    planifier();
  }

  async function questionner(ids: number[], action?: "preparer" | "reessayer"): Promise<void> {
    if (!ids.length) return;
    const numero = ++questions;
    if (action)
      for (const id of ids) {
        // On vient de demander la préparation : la page le montre tout de
        // suite, et aucune réponse à une question plus ancienne — un
        // « échec » d'avant le nouvel essai — ne doit venir l'effacer.
        reponduPar.set(id, numero);
        const avant = etats.get(id);
        if (avant && avant.etat !== "pret" && avant.etat !== "en_preparation")
          etats.set(id, { etat: "en_preparation", lancee: false, devant: 0, depuis: 0 });
      }
    const parametres = new URLSearchParams({ lignes: ids.join(",") });
    if (action) parametres.set(action, "1");
    try {
      const reponse = await fetch(`${urlEtat}?${parametres}`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (reponse.status === 401) throw new Error("session expirée, reconnectez-vous");
      if (!reponse.ok) throw new Error(`le serveur a répondu ${reponse.status}`);
      const { lignes } = (await reponse.json()) as { lignes: Record<string, Etat> };
      for (const id of ids) {
        const e = lignes[id];
        if (!e || (reponduPar.get(id) ?? 0) > numero) continue;
        etats.set(id, e);
        reponduPar.set(id, numero);
        if (e.etat !== "a_preparer") relances.delete(id);
      }
      erreurReseau = null;
    } catch (e) {
      // L'API qui redémarre (une mise en ligne) ne répond pas pendant
      // quelques secondes : on le dit, et on repose la question.
      erreurReseau = e instanceof Error ? e.message : String(e);
    }
  }

  racine.addEventListener("click", (ev) => {
    const raison = (ev.target as Element | null)?.closest<HTMLButtonElement>(".bo-pdf-raison");
    if (raison && racine.contains(raison)) {
      raison.setAttribute("aria-expanded", String(raison.getAttribute("aria-expanded") !== "true"));
      return;
    }
    const a = (ev.target as Element | null)?.closest<HTMLAnchorElement>(
      "a[data-pdf-ligne], a[data-pdf-tout]",
    );
    if (!a || !racine.contains(a)) return;
    // Le clic télécharge, et rien d'autre : il n'ouvre pas la commande.
    ev.stopPropagation();

    if (a.dataset.pdfLigne) {
      const id = idDe(a);
      const e = etats.get(id);
      // Prêt — ou état inconnu : le lien fait son travail, comme avant.
      if (!e || e.etat === "pret") return;
      ev.preventDefault();
      voulues.add(id);
      // Déjà en préparation : la demande le fait passer en tête de file.
      void interroger([id], e.etat === "echec" ? "reessayer" : "preparer");
      rendre();
      return;
    }

    const ids = lignesDe(a);
    const liste = ids.map((id) => etats.get(id));
    if (liste.some((e) => !e) || liste.every((e) => e?.etat === "pret")) return;
    ev.preventDefault();
    archivesVoulues.add(a);
    const echouees = ids.filter((id) => etats.get(id)?.etat === "echec");
    const autres = ids.filter((id) => etats.get(id)?.etat !== "pret" && !echouees.includes(id));
    if (echouees.length) void interroger(echouees, "reessayer");
    if (autres.length) void interroger(autres, "preparer");
    rendre();
  });

  rendre();
  void interroger(tousLesIds(), preparerDOffice ? "preparer" : undefined);
}

for (const racine of document.querySelectorAll<HTMLElement>("[data-impression]")) demarrer(racine);
