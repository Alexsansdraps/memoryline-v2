/// <reference lib="dom" />
/**
 * La recherche INSTANTANÉE du site (17/11) :
 *
 *   « la recherche fait vieux, il faut que ce soit dynamique et adapté au
 *   mobile : je tape "col" et ça cherche, avec l'image assez grande pour
 *   choisir » ; « plus besoin de la page de résultats : une bonne recherche
 *   bien visible, on clique, on arrive sur la page de l'affiche ».
 *
 * Dès deux lettres, les affiches trouvées s'affichent en grandes vignettes et
 * se mettent à jour à chaque lettre. Un clic — ou Entrée, qui prend la
 * première — mène droit à la fiche. Sur grand écran, sous le champ de
 * l'en-tête ; sur téléphone, la loupe ouvre la recherche en plein écran.
 *
 * Sans JavaScript, rien ne change : le champ et la loupe mènent à l'ancienne
 * page de résultats, gardée pour ce cas.
 *
 * Elle lit la même route que cette page (`/products?q=`) : mêmes affiches,
 * même ordre.
 */
import { PUBLIC_API_URL, avecStand } from "./api-navigateur.ts";

interface Trouvee {
  slug: string;
  name: string;
  image: string | null;
}

/** Combien d'affiches on montre ; au-delà, on invite à préciser. */
const AU_PLUS = 24;
/** Le temps de laisser finir un mot avant d'interroger : une requête par pause, pas par lettre. */
const ATTENTE_MS = 160;

/** « COLMAR Noël - Affiche personnalisée » → « COLMAR Noël », comme sous les vignettes. */
const nomCourt = (nom: string) => nom.replace(/\s*[-–]\s*Affiche.*$/i, "");

/** La vignette en 400 px de large : nette, et légère à charger. */
function vignette(chemin: string | null): string | null {
  if (!chemin) return null;
  if (/^https?:\/\//i.test(chemin)) return chemin;
  return `${PUBLIC_API_URL}${chemin}?l=400`;
}

interface Branchement {
  champ: HTMLInputElement;
  /** Porte les textes (data-*) et contient [data-etat], la liste et [data-plus]. */
  panneau: HTMLElement;
  /** Vrai : le panneau se montre et se cache (en-tête). Faux : il reste là (plein écran). */
  basculer: boolean;
}

function brancher({ champ, panneau, basculer }: Branchement): void {
  const liste = panneau.querySelector("ul");
  const etat = panneau.querySelector<HTMLElement>("[data-etat]");
  const plus = panneau.querySelector<HTMLElement>("[data-plus]");
  if (!liste || !etat || !plus) return;

  const langue = panneau.dataset.langue ?? "fr";
  const lienFiche = panneau.dataset.fiche ?? "/affiches";
  const texteAucun = panneau.dataset.aucun ?? "";
  const textePlus = panneau.dataset.plus ?? "";
  const texteCherche = panneau.dataset.cherche ?? "";

  let minuterie: number | undefined;
  let enCours: AbortController | null = null;
  let derniere = "";

  const ouvrir = () => {
    if (basculer) panneau.hidden = false;
    champ.setAttribute("aria-expanded", "true");
  };
  const fermer = () => {
    if (basculer) panneau.hidden = true;
    champ.setAttribute("aria-expanded", "false");
  };
  const vider = () => {
    liste.replaceChildren();
    etat.hidden = true;
    plus.hidden = true;
  };

  function afficher(affiches: Trouvee[], total: number): void {
    liste!.replaceChildren(
      ...affiches.slice(0, AU_PLUS).map((a) => {
        const li = document.createElement("li");
        const lien = document.createElement("a");
        lien.href = avecStand(`${lienFiche}/${encodeURIComponent(a.slug)}`);
        lien.className = "group block focus:outline-none";
        const cadre = document.createElement("div");
        cadre.className =
          "ml-squelette overflow-hidden ring-terracotta ring-offset-2 transition group-hover:ring-2 group-focus-visible:ring-2";
        cadre.style.aspectRatio = "1020 / 1400";
        const src = vignette(a.image);
        if (src) {
          const img = document.createElement("img");
          img.src = src;
          img.alt = "";
          img.loading = "lazy";
          img.decoding = "async";
          img.className = "h-full w-full object-cover";
          img.addEventListener("load", () => cadre.classList.add("est-charge"));
          cadre.appendChild(img);
        }
        const nom = document.createElement("span");
        nom.className =
          "mt-1.5 block text-[13px] font-semibold leading-tight group-hover:text-terracotta";
        nom.textContent = nomCourt(a.name);
        lien.append(cadre, nom);
        li.appendChild(lien);
        return li;
      }),
    );
    etat!.hidden = affiches.length > 0;
    etat!.textContent = affiches.length ? "" : texteAucun;
    plus!.hidden = total <= AU_PLUS;
    plus!.textContent = textePlus.replace("{n}", String(total));
    ouvrir();
  }

  async function chercher(q: string): Promise<void> {
    enCours?.abort();
    const controle = new AbortController();
    enCours = controle;
    // « Recherche… » seulement quand rien n'est encore affiché : à chaque
    // lettre, l'ancienne liste reste sous les yeux le temps que la nouvelle
    // arrive, sans clignoter.
    if (!liste!.children.length) {
      etat!.textContent = texteCherche;
      etat!.hidden = false;
      ouvrir();
    }
    try {
      const p = new URLSearchParams({ q, limit: String(AU_PLUS) });
      if (langue !== "fr") p.set("lang", langue);
      const res = await fetch(`${PUBLIC_API_URL}/products?${p.toString()}`, {
        signal: controle.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const affiches = (await res.json()) as Trouvee[];
      const annonce = Number(res.headers.get("X-Total-Count"));
      const total = Number.isFinite(annonce) && annonce > 0 ? annonce : affiches.length;
      if (controle.signal.aborted || q !== champ.value.trim()) return;
      derniere = q;
      afficher(affiches, total);
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      // L'API ne répond pas : rien à montrer.
      vider();
      fermer();
    }
  }

  champ.setAttribute("role", "combobox");
  champ.setAttribute("aria-autocomplete", "list");
  champ.setAttribute("aria-controls", panneau.id);
  champ.setAttribute("aria-expanded", "false");

  champ.addEventListener("input", () => {
    const q = champ.value.trim();
    window.clearTimeout(minuterie);
    if (q.length < 2) {
      enCours?.abort();
      derniere = "";
      vider();
      fermer();
      return;
    }
    minuterie = window.setTimeout(() => void chercher(q), ATTENTE_MS);
  });

  // Revenir dans le champ rouvre les derniers résultats.
  champ.addEventListener("focus", () => {
    if (derniere && derniere === champ.value.trim() && liste.children.length) ouvrir();
  });

  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // Entrée : la première affiche trouvée, directement. Pas de page de
      // résultats à traverser.
      e.preventDefault();
      const premier = liste.querySelector<HTMLAnchorElement>("a");
      if (premier && derniere === champ.value.trim()) {
        window.location.href = premier.href;
      } else if (champ.value.trim().length >= 2) {
        window.clearTimeout(minuterie);
        void chercher(champ.value.trim());
      }
    } else if (e.key === "Escape" && basculer) {
      fermer();
    } else if (e.key === "ArrowDown") {
      const premier = liste.querySelector("a");
      if (premier) {
        e.preventDefault();
        ouvrir();
        premier.focus();
      }
    }
  });

  // Flèches entre les vignettes, Échap pour revenir au champ.
  panneau.addEventListener("keydown", (e) => {
    const liens = Array.from(liste.querySelectorAll<HTMLAnchorElement>("a"));
    const i = liens.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    if (e.key === "Escape") {
      if (basculer) fermer();
      champ.focus();
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      liens[Math.min(i + 1, liens.length - 1)]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      if (i === 0) champ.focus();
      else liens[i - 1]?.focus();
    }
  });

  if (basculer) {
    // Un clic ailleurs ferme le panneau.
    document.addEventListener("pointerdown", (e) => {
      const cible = e.target as Node;
      if (!panneau.contains(cible) && cible !== champ) fermer();
    });
  }
}

export function brancherRechercheInstantanee(): void {
  // Grands écrans : le champ de l'en-tête, le panneau dessous.
  const champ = document.getElementById("ml-q") as HTMLInputElement | null;
  const panneau = document.getElementById("ml-q-panneau");
  if (champ && panneau) brancher({ champ, panneau, basculer: true });

  // Téléphones et tablettes : la loupe ouvre la recherche en plein écran.
  const loupe = document.getElementById("ml-q-loupe");
  const ecran = document.getElementById("ml-q-ecran");
  const champEcran = document.getElementById("ml-q-ecran-champ") as HTMLInputElement | null;
  const panneauEcran = document.getElementById("ml-q-ecran-panneau");
  if (!loupe || !ecran || !champEcran || !panneauEcran) return;
  brancher({ champ: champEcran, panneau: panneauEcran, basculer: false });

  const ouvrirEcran = () => {
    ecran.hidden = false;
    document.documentElement.style.overflow = "hidden";
    champEcran.focus();
  };
  const fermerEcran = () => {
    ecran.hidden = true;
    document.documentElement.style.overflow = "";
    loupe.focus();
  };
  loupe.addEventListener("click", (e) => {
    e.preventDefault();
    ouvrirEcran();
  });
  ecran.querySelector("[data-fermer]")?.addEventListener("click", fermerEcran);
  ecran.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fermerEcran();
  });
  // Au retour d'une fiche (bouton « précédent »), le navigateur rend la page
  // telle qu'on l'a quittée : la recherche est encore ouverte, avec ses
  // résultats, et l'on peut choisir une autre affiche.
}
