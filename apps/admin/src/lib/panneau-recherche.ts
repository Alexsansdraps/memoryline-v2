/**
 * La recherche du haut de page (le champ #ml-recherche-champ de
 * layouts/Admin.astro) : le panneau qui s'ouvre sous le champ.
 *
 * Elle interroge /recherche.json (pages/recherche.json.ts), qui réunit les
 * données de l'API, les écrans et l'aide, et range les réponses par groupe.
 * Quatre choses comptent plus que le reste ici :
 *
 *   - On n'interroge PAS le serveur à chaque touche. On attend que la frappe
 *     s'arrête, et la requête précédente est abandonnée dès qu'une nouvelle
 *     part : sans cela, « cathédrale » lancerait onze recherches dont dix pour
 *     rien, et la plus lente pourrait revenir en dernier et écraser la bonne.
 *   - Tout se construit avec createElement et textContent, surlignage compris
 *     (les <mark> sont créés, jamais lus dans du HTML). Les noms de clientes et
 *     les textes des affiches viennent de la base : les coller en HTML ferait
 *     exécuter, dans le back-office, ce que quelqu'un aurait écrit dans un
 *     formulaire de la boutique.
 *   - Entrée ouvre toujours le résultat de ce qui est ÉCRIT, jamais celui de
 *     la saisie d'avant : tapée pendant l'attente, elle lance la recherche et
 *     ouvre son premier résultat au retour.
 *   - Le clavier seul doit suffire : la barre oblique pour venir, les flèches
 *     pour choisir, Entrée pour ouvrir, Ctrl+Entrée pour tout voir, Échap pour
 *     renoncer.
 */
import {
  RECHERCHE_MINIMUM,
  decouper,
  emplacementComplet,
  type GroupeRecherche,
  type Passage,
  type ReponseRecherche,
  type ResultatRecherche,
} from "@memoryline/types/recherche";

/**
 * Le temps qu'on laisse aux doigts. Trop court, on rappelle le serveur au
 * milieu d'un mot ; trop long, le panneau traîne derrière la frappe. Deux
 * dixièmes de seconde est le point où l'on ne sent ni l'un ni l'autre.
 */
const ATTENTE = 180;

class SessionExpiree extends Error {}

function demarrer(): void {
  const boite = document.getElementById("ml-recherche");
  if (!boite) return; // vendeur : pas de recherche
  const champ = document.getElementById("ml-recherche-champ") as HTMLInputElement | null;
  const panneau = document.getElementById("ml-recherche-panneau");
  const raccourci = document.getElementById("ml-recherche-raccourci");
  if (!champ || !panneau) return;

  // Le champ naît inactif pour ne rien promettre sans JavaScript.
  champ.disabled = false;
  if (raccourci) raccourci.hidden = false;

  const API = boite.dataset.api ?? "";
  const BASE = boite.dataset.base ?? "";

  let minuteur: ReturnType<typeof setTimeout> | null = null;
  /** La requête en vol, et ce qu'elle cherche. */
  let encours: AbortController | null = null;
  let qEnCours = "";
  /** Ce que montre le panneau en ce moment : la saisie à laquelle il répond. */
  let qDessinee: string | null = null;
  /** Entrée tapée avant la réponse : on ouvrira au retour. */
  let ouvrirAuRetour = false;
  /** Les options du panneau (<a>), dans l'ordre d'affichage. */
  let lignes: HTMLAnchorElement[] = [];
  let choisi = -1;

  const saisie = () => champ.value.trim();
  const pageComplete = (q: string) => `${BASE}/recherche?q=${encodeURIComponent(q)}`;

  function ouvrir(): void {
    panneau!.hidden = false;
    champ!.setAttribute("aria-expanded", "true");
  }

  /**
   * Fermer, c'est aussi renoncer à ce qui était en route : Échap juste après
   * une frappe ne doit pas voir le panneau se rouvrir tout seul un instant
   * plus tard, quand la recherche attendue part ou revient.
   */
  function fermer(): void {
    if (minuteur) clearTimeout(minuteur);
    minuteur = null;
    if (encours) encours.abort();
    encours = null;
    qEnCours = "";
    ouvrirAuRetour = false;
    panneau!.hidden = true;
    panneau!.replaceChildren();
    panneau!.removeAttribute("aria-busy");
    panneau!.classList.remove("opacity-60");
    champ!.setAttribute("aria-expanded", "false");
    champ!.removeAttribute("aria-activedescendant");
    lignes = [];
    choisi = -1;
    qDessinee = null;
  }

  /** Une phrase au milieu du panneau, sans rien à choisir. */
  function message(texte: string): void {
    lignes = [];
    choisi = -1;
    qDessinee = null;
    const p = document.createElement("p");
    p.className = "px-3 py-3 text-sm text-bo-muted";
    p.textContent = texte;
    panneau!.replaceChildren(p);
    panneau!.removeAttribute("aria-busy");
    panneau!.classList.remove("opacity-60");
    ouvrir();
  }

  function marquer(): void {
    lignes.forEach((ligne, i) => {
      const actif = i === choisi;
      ligne.classList.toggle("bg-bo-bg", actif);
      ligne.setAttribute("aria-selected", actif ? "true" : "false");
    });
    const actuelle = choisi >= 0 ? lignes[choisi] : undefined;
    if (actuelle) {
      champ!.setAttribute("aria-activedescendant", actuelle.id);
      // « nearest » : on ne recentre pas la liste sous les yeux de quelqu'un
      // qui descend d'un cran.
      actuelle.scrollIntoView({ block: "nearest" });
    } else champ!.removeAttribute("aria-activedescendant");
  }

  function deplacer(pas: number): void {
    if (!lignes.length) return;
    choisi = (choisi + pas + lignes.length) % lignes.length;
    marquer();
  }

  /** L'adresse d'une vignette, telle que le navigateur doit la demander. */
  function vignette(chemin: string): string {
    return /^https?:\/\//.test(chemin) ? chemin : API + chemin;
  }

  /** Un texte et ses passages trouvés, surlignés par des <mark> CRÉÉS (jamais du HTML lu). */
  function surligne(parent: HTMLElement, texte: string, passages: readonly Passage[]): void {
    for (const morceau of decouper(texte, passages)) {
      if (morceau.marque) {
        const mark = document.createElement("mark");
        mark.className = "ml-marque";
        mark.textContent = morceau.texte;
        parent.appendChild(mark);
      } else parent.appendChild(document.createTextNode(morceau.texte));
    }
  }

  /** Une option du panneau : un lien que les flèches et la souris désignent. */
  function option(href: string): HTMLAnchorElement {
    const lien = document.createElement("a");
    lien.id = `ml-recherche-${lignes.length}`;
    lien.href = href;
    lien.setAttribute("role", "option");
    lien.setAttribute("aria-selected", "false");
    lien.className = "flex items-center gap-3 px-3 py-2 text-sm no-underline";
    // La souris et les flèches désignent la MÊME ligne : deux surbrillances à
    // l'écran ne diraient plus laquelle Entrée ouvre.
    const rang = lignes.length;
    lien.addEventListener("mousemove", () => {
      if (choisi === rang) return;
      choisi = rang;
      marquer();
    });
    lignes.push(lien);
    return lien;
  }

  /** Une ligne de texte simple en bas du panneau (une option « Voir tous… »). */
  function optionTexte(href: string, texte: string, classe = "text-bo-accent"): HTMLAnchorElement {
    const lien = option(href);
    const s = document.createElement("span");
    s.className = classe;
    s.textContent = texte;
    lien.appendChild(s);
    return lien;
  }

  function avis(texte: string, classe = "px-3 py-1.5 text-xs text-bo-muted"): HTMLParagraphElement {
    const p = document.createElement("p");
    p.setAttribute("role", "presentation");
    p.className = classe;
    p.textContent = texte;
    return p;
  }

  function ligneResultat(r: ResultatRecherche, avecNature: boolean): HTMLAnchorElement {
    const lien = option(BASE + r.href);
    lien.title = emplacementComplet(r);

    if (r.image) {
      const img = document.createElement("img");
      img.src = vignette(r.image);
      img.alt = "";
      img.loading = "lazy";
      img.className = "h-10 w-7 shrink-0 rounded border border-bo-border object-cover";
      lien.appendChild(img);
    }

    const textes = document.createElement("span");
    textes.className = "min-w-0 flex-1";

    const titre = document.createElement("span");
    titre.className = "block truncate";
    surligne(titre, r.titre, r.titrePassages);
    textes.appendChild(titre);

    // Où, dans l'objet, le passage a été trouvé, puis ce qu'on sait de
    // l'objet. La nature n'est dite que dans un groupe qui en mélange
    // plusieurs (un cadre, un personnage, un décor dans « Atelier »).
    const seconde = [avecNature ? r.nature : null, r.ou, r.detail].filter((x): x is string => !!x);
    if (seconde.length) {
      const sous = document.createElement("span");
      sous.className = "block truncate text-xs text-bo-muted";
      sous.textContent = seconde.join(" · ");
      textes.appendChild(sous);
    }

    if (r.extrait) {
      const extrait = document.createElement("span");
      extrait.className = "mt-0.5 block line-clamp-2 text-xs text-bo-muted";
      surligne(extrait, r.extrait.texte, r.extrait.passages);
      textes.appendChild(extrait);
    }

    lien.appendChild(textes);
    return lien;
  }

  function enteteGroupe(g: GroupeRecherche): HTMLParagraphElement {
    const titre = document.createElement("p");
    // Un titre de groupe n'est pas une option : les lecteurs d'écran ne
    // doivent pas le compter parmi les choix de la liste.
    titre.setAttribute("role", "presentation");
    titre.className = "px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-bo-muted";
    titre.textContent = `${g.titre} · ${g.plafonne ? `${g.total}+` : g.total}`;
    return titre;
  }

  function dessiner(reponse: ReponseRecherche): void {
    const q = reponse.q;
    lignes = [];
    const morceaux = document.createDocumentFragment();
    const groupes = Array.isArray(reponse.groupes) ? reponse.groupes : [];

    if (!groupes.length) {
      morceaux.appendChild(avis(`Rien ne correspond à « ${q} ».`, "px-3 pb-1 pt-3 text-sm text-bo-muted"));
      if (reponse.partiel) morceaux.appendChild(avis("Une partie de la recherche n'a pas répondu.", "px-3 py-1.5 text-xs text-amber-800"));
      // Plutôt qu'un cul-de-sac : les filtres des écrans ont leurs propres
      // règles (un numéro partiel, un statut), et l'aide répond peut-être.
      const enc = encodeURIComponent(q);
      morceaux.appendChild(optionTexte(`${BASE}/commandes?q=${enc}`, `Chercher « ${q} » dans les commandes`));
      morceaux.appendChild(optionTexte(`${BASE}/clients?q=${enc}`, `Chercher « ${q} » dans les clients`));
      morceaux.appendChild(optionTexte(`${BASE}/produits?q=${enc}`, `Chercher « ${q} » dans les affiches`));
      morceaux.appendChild(optionTexte(`${BASE}/aide`, "Ouvrir l'aide"));
    } else {
      if (reponse.corrections?.length)
        morceaux.appendChild(
          avis(`Résultats approchés pour ${reponse.corrections.map((c) => `« ${c.propose} »`).join(", ")}`),
        );
      let total = 0;
      let plafonne = false;
      for (const g of groupes) {
        total += g.total;
        plafonne ||= g.plafonne;
        morceaux.appendChild(enteteGroupe(g));
        const natures = new Set(g.resultats.map((r) => r.nature));
        for (const r of g.resultats) morceaux.appendChild(ligneResultat(r, natures.size > 1));
      }
      if (reponse.partiel) morceaux.appendChild(avis("Une partie de la recherche n'a pas répondu.", "px-3 py-1.5 text-xs text-amber-800"));
      const tous = optionTexte(pageComplete(q), `Voir tous les résultats (${total}${plafonne ? "+" : ""})`);
      tous.classList.add("border-t", "border-bo-border", "mt-1");
      morceaux.appendChild(tous);
    }

    panneau!.replaceChildren(morceaux);
    panneau!.removeAttribute("aria-busy");
    panneau!.classList.remove("opacity-60");
    qDessinee = q;
    // Le premier résultat est retenu d'emblée : taper un numéro de commande
    // puis Entrée doit ouvrir la commande, sans détour par la flèche du bas.
    choisi = groupes.length && lignes.length ? 0 : -1;
    marquer();
    ouvrir();
  }

  /** Ouvre ce que désigne Entrée une fois la réponse arrivée. */
  function ouvrirLePremier(reponse: ReponseRecherche): void {
    const premier = reponse.groupes?.[0]?.resultats?.[0];
    window.location.assign(premier ? BASE + premier.href : pageComplete(reponse.q));
  }

  function chercher(): void {
    if (minuteur) clearTimeout(minuteur);
    minuteur = null;
    const q = saisie();
    if (encours) encours.abort();
    encours = null;
    if (q.length < RECHERCHE_MINIMUM) {
      fermer();
      return;
    }
    // Pendant la recherche, ce qui est affiché RESTE, atténué : un panneau
    // qui se vide et se remplit à chaque lettre clignote et ne se lit plus.
    if (panneau!.hidden || !panneau!.childElementCount) message("Recherche…");
    else {
      panneau!.setAttribute("aria-busy", "true");
      panneau!.classList.add("opacity-60");
    }
    const controleur = new AbortController();
    encours = controleur;
    qEnCours = q;
    fetch(`${BASE}/recherche.json?q=${encodeURIComponent(q)}`, {
      // Même origine que la page : le cookie de session part tout seul.
      credentials: "same-origin",
      // Une session expirée renvoie vers la page de connexion : on veut le
      // savoir, pas lire la page de connexion comme une réponse.
      redirect: "manual",
      headers: { Accept: "application/json" },
      signal: controleur.signal,
    })
      .then((r) => {
        if (r.type === "opaqueredirect" || r.status === 401) throw new SessionExpiree();
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ReponseRecherche>;
      })
      .then((reponse) => {
        // La saisie a pu changer pendant le trajet : on ne dessine que la
        // réponse à ce qui est écrit maintenant.
        if (controleur !== encours) return;
        encours = null;
        qEnCours = "";
        if (ouvrirAuRetour) {
          ouvrirAuRetour = false;
          dessiner(reponse);
          ouvrirLePremier(reponse);
          return;
        }
        dessiner(reponse);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string } | null)?.name === "AbortError") return;
        if (controleur !== encours) return;
        encours = null;
        qEnCours = "";
        ouvrirAuRetour = false;
        message(
          e instanceof SessionExpiree
            ? "Votre session a expiré : rechargez la page."
            : "La recherche n'a pas répondu. Réessayez.",
        );
      });
  }

  champ.addEventListener("input", () => {
    // On attend l'arrêt de la frappe : voir ATTENTE plus haut.
    if (minuteur) clearTimeout(minuteur);
    minuteur = setTimeout(chercher, ATTENTE);
  });

  // Revenir sur un champ déjà rempli rouvre ce qu'on y avait trouvé, au lieu
  // d'obliger à retaper une lettre.
  champ.addEventListener("focus", () => {
    if (saisie().length >= RECHERCHE_MINIMUM && panneau.hidden) chercher();
  });

  champ.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      deplacer(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      deplacer(-1);
    } else if (e.key === "Enter") {
      const q = saisie();
      if (q.length < RECHERCHE_MINIMUM) return;
      e.preventDefault();
      // Ctrl (ou Maj) + Entrée : tous les résultats, sur leur page.
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        window.location.assign(pageComplete(q));
        return;
      }
      const aJour = qDessinee === q && !minuteur && !encours;
      if (aJour) {
        const ligne = choisi >= 0 ? lignes[choisi] : undefined;
        if (ligne) ligne.click();
        else window.location.assign(pageComplete(q));
        return;
      }
      // Ce qui est affiché répond à la saisie d'AVANT : on cherche ce qui est
      // écrit maintenant, et on ouvrira son premier résultat au retour.
      ouvrirAuRetour = true;
      if (!(encours && qEnCours === q && !minuteur)) chercher();
    } else if (e.key === "Escape") {
      // Le premier Échap ferme le panneau, le second rend le champ : renoncer
      // à la liste et renoncer à la recherche sont deux gestes différents.
      if (!panneau.hidden || minuteur || encours) {
        e.preventDefault();
        fermer();
      } else {
        champ.value = "";
        champ.blur();
      }
    }
  });

  // Un clic sur un résultat ferme le panneau. S'il mène à l'écran déjà
  // ouvert, seul le fragment change, et le script d'arrivée prend le relais.
  panneau.addEventListener("click", (e) => {
    const lien = (e.target as Element | null)?.closest?.("a[role=option]");
    // Fermé juste APRÈS le clic : le lien garde le temps de partir.
    if (lien && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.shiftKey) setTimeout(fermer, 0);
  });

  // Un clic à l'extérieur ferme, comme partout ailleurs.
  document.addEventListener("mousedown", (e) => {
    if (!boite.contains(e.target as Node | null)) fermer();
  });

  // La barre oblique amène ici. Une touche seule plutôt qu'une combinaison :
  // elle se tape d'une main. Elle ne prend donc la main QUE si l'on n'est pas
  // déjà en train d'écrire quelque part, sinon on ne pourrait plus taper
  // « 12/03 » dans une note.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const ou = document.activeElement as HTMLElement | null;
    const balise = ou?.tagName?.toLowerCase() ?? "";
    if (balise === "input" || balise === "textarea" || balise === "select" || ou?.isContentEditable) return;
    e.preventDefault();
    champ.focus();
    champ.select();
  });
}

demarrer();
