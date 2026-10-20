/**
 * Un nuancier qui se compose ET se range : ajouter une couleur, la retirer,
 * et changer sa place — à la souris (poignée ⠿) comme au clavier (← →).
 *
 * « Il faut que je puisse modifier l'ordre d'apparition, là je peux que
 * supprimer, sinon je vais devoir tout supprimer à chaque fois que j'en
 * ajoute une » (Margaux, carte Trello). Une pastille se retirait d'un clic, et
 * une couleur ajoutée arrivait toujours en dernier : pour en glisser une au
 * milieu, il fallait tout défaire. L'ordre ici est EXACTEMENT celui que la
 * cliente voit dans le module : l'API le garde tel quel, le configurateur
 * l'affiche sans le trier.
 *
 * Rien n'est enregistré pendant qu'on range : le formulaire qui contient le
 * nuancier l'envoie, avec son bouton habituel. Quitter la page avec un
 * nuancier changé et non envoyé le fait demander.
 *
 * Le balisage (rendu par la page, que ce module redessine à l'identique) :
 *
 *   <div data-pastilles data-libelle="Vêtements">
 *     <ul data-pastilles-liste> <li data-hex="#B8551D">…</li> … </ul>
 *     <input type="color" data-pastilles-choix> <button data-pastilles-ajouter>
 *     <textarea name="colors" data-pastilles-champ hidden>#FFFFFF↵#B8551D</textarea>
 *     <p aria-live="polite" data-pastilles-annonce class="sr-only"></p>
 *   </div>
 *
 * Le champ texte, une couleur par ligne, est ce que le serveur lit : il reste
 * lisible, et c'est lui qui fait foi au chargement. La page peut écouter
 * « pastilles:change » ({ couleurs }) pour suivre le nuancier.
 *
 * Le sélecteur et « + Ajouter » sont HORS de la liste, à côté : le glisser ne
 * peut pas les déplacer, et une couleur ajoutée va toujours à la fin.
 *
 * Facultatifs, sur la racine ou à côté du sélecteur :
 *   - <input data-pastilles-code> : le code d'une couleur (« #B8551D »), pour
 *     reprendre exactement celle d'une charte ; il suit le sélecteur, et
 *     Entrée ajoute la couleur sans envoyer le formulaire ;
 *   - data-pastilles-max="40" : au-delà, « + Ajouter » s'éteint ;
 *   - data-pastilles-aussitot : la page enregistre elle-même chaque
 *     changement (« pastilles:change ») — rien à rappeler en quittant.
 *
 * Les écrans qui dessinent leurs lignes dans le navigateur (les couleurs
 * d'une pièce, GroupesCouleurs) fabriquent le même nuancier par
 * {@link creerNuancier} : même balisage, mêmes gestes.
 */
import { couleurHexPropre } from "@memoryline/types/couleurs";

/** « #b8551d » ou « b8551d » → « #B8551D » ; null si ce n'est pas une couleur. */
const hexPropre = (brut: string): string | null => couleurHexPropre(brut);

/** « 1re », « 2e »… pour annoncer une place. */
function rang(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

const CLASSE_BOUTON =
  "flex h-6 w-6 items-center justify-center rounded text-xs text-bo-muted hover:bg-bo-bg disabled:cursor-default disabled:opacity-30";

export function brancherNuancier(racine: HTMLElement): void {
  // Un nuancier ne se branche qu'une fois : la page peut en fabriquer après
  // le chargement de ce module (creerNuancier), qui les branche lui-même.
  if (racine.dataset.pastillesBranche) return;
  racine.dataset.pastillesBranche = "1";
  const liste = racine.querySelector<HTMLElement>("[data-pastilles-liste]");
  const champ = racine.querySelector<HTMLTextAreaElement>("[data-pastilles-champ]");
  const choix = racine.querySelector<HTMLInputElement>("[data-pastilles-choix]");
  const code = racine.querySelector<HTMLInputElement>("[data-pastilles-code]");
  const ajouter = racine.querySelector<HTMLButtonElement>("[data-pastilles-ajouter]");
  const annonce = racine.querySelector<HTMLElement>("[data-pastilles-annonce]");
  if (!liste || !champ) return;
  const libelle = racine.dataset.libelle ?? "ce nuancier";
  const max = Number(racine.dataset.pastillesMax) || Infinity;
  const aussitot = racine.hasAttribute("data-pastilles-aussitot");

  const lues = champ.value
    .split(/[\s,;]+/)
    .map(hexPropre)
    .filter((h): h is string => h !== null);
  let couleurs = lues.filter((h, i) => lues.indexOf(h) === i);
  const depart = couleurs.join("\n");
  let envoye = false;

  const dire = (texte: string) => {
    if (annonce) annonce.textContent = texte;
  };

  /** Une ligne de la liste : poignée, pastille, ← →, ×. */
  function element(hex: string, i: number, n: number): HTMLLIElement {
    const li = document.createElement("li");
    li.dataset.hex = hex;
    li.className =
      "flex items-center gap-0.5 rounded border border-bo-border bg-bo-surface px-1 py-0.5";

    const poignee = document.createElement("span");
    poignee.className = "ml-poignee cursor-grab select-none px-0.5 text-bo-muted";
    poignee.textContent = "⠿";
    poignee.title = "Glissez pour changer la place";
    poignee.setAttribute("aria-hidden", "true");

    const pastille = document.createElement("span");
    pastille.className = "h-6 w-6 shrink-0 rounded-full border border-bo-border";
    pastille.style.background = hex;
    pastille.title = hex;
    pastille.setAttribute("role", "img");
    pastille.setAttribute("aria-label", `${hex}, couleur ${i + 1} sur ${n}`);

    const bouton = (attr: string, texte: string, aide: string, inactif: boolean) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = CLASSE_BOUTON;
      b.setAttribute(attr, "");
      b.textContent = texte;
      b.title = aide;
      b.setAttribute("aria-label", `${aide.split(" ")[0]} ${hex}`);
      b.disabled = inactif;
      return b;
    };
    li.append(
      poignee,
      pastille,
      bouton("data-avancer", "←", "Avancer d'une place", i === 0),
      bouton("data-reculer", "→", "Reculer d'une place", i === n - 1),
      bouton("data-retirer", "×", "Retirer du nuancier", false),
    );
    return li;
  }

  /** Redessine la liste et réécrit le champ ; rend le focus là où il doit aller. */
  function rendre(focus?: { hex: string; quoi: string } | null) {
    liste!.textContent = "";
    couleurs.forEach((hex, i) => liste!.append(element(hex, i, couleurs.length)));
    champ!.value = couleurs.join("\n");
    const compte = racine.querySelector("[data-pastilles-compte]");
    if (compte) compte.textContent = String(couleurs.length);
    if (ajouter) {
      const plein = couleurs.length >= max;
      ajouter.disabled = plein;
      ajouter.title = plein
        ? `${max} couleurs au plus : retirez-en une pour en ajouter une autre`
        : "";
    }
    racine.dispatchEvent(
      new CustomEvent("pastilles:change", { detail: { couleurs: [...couleurs] } }),
    );
    if (!focus) return;
    const li = liste!.querySelector<HTMLElement>(`[data-hex="${focus.hex}"]`);
    const voulu = li?.querySelector<HTMLButtonElement>(`[${focus.quoi}]`);
    // Arrivé au bout, la flèche s'éteint : le focus passe à celle d'en face
    // de la même pastille plutôt que de retomber en haut de la page.
    const repli = li?.querySelector<HTMLButtonElement>(
      "[data-avancer]:not(:disabled), [data-reculer]:not(:disabled), [data-retirer]",
    );
    (voulu && !voulu.disabled ? voulu : repli)?.focus();
  }

  function deplacer(hex: string, vers: number, quoi: string) {
    const de = couleurs.indexOf(hex);
    if (de < 0 || vers < 0 || vers >= couleurs.length || vers === de) return;
    couleurs.splice(de, 1);
    couleurs.splice(vers, 0, hex);
    rendre({ hex, quoi });
    dire(`${hex} placée en ${rang(vers + 1)} position sur ${couleurs.length}.`);
  }

  liste.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    const li = b?.closest<HTMLElement>("li[data-hex]");
    if (!b || !li || !liste.contains(li)) return;
    e.preventDefault();
    const hex = li.dataset.hex!;
    const i = couleurs.indexOf(hex);
    if (b.hasAttribute("data-avancer")) deplacer(hex, i - 1, "data-avancer");
    else if (b.hasAttribute("data-reculer")) deplacer(hex, i + 1, "data-reculer");
    else if (b.hasAttribute("data-retirer")) {
      couleurs = couleurs.filter((h) => h !== hex);
      // Le focus va à la pastille qui prend sa place, sinon à la précédente,
      // sinon au sélecteur : jamais en haut de la page.
      const voisine = couleurs[i] ?? couleurs[i - 1];
      rendre(voisine ? { hex: voisine, quoi: "data-retirer" } : null);
      if (!voisine) choix?.focus();
      dire(`${hex} retirée. ${couleurs.length} couleur${couleurs.length > 1 ? "s" : ""} dans ${libelle}.`);
    }
  });

  // Le glisser s'écoute sur la FENÊTRE : la pastille change de place pendant
  // le geste, et un élément déplacé perdrait le suivi du pointeur (même
  // mécanique que lib/rangement.ts).
  liste.addEventListener("pointerdown", (e) => {
    const poignee = (e.target as HTMLElement).closest(".ml-poignee");
    const tenue = poignee?.closest<HTMLElement>("li[data-hex]");
    if (!poignee || !tenue || !liste.contains(tenue)) return;
    e.preventDefault();
    tenue.classList.add("opacity-50");
    document.body.style.userSelect = "none";

    const bouger = (ev: PointerEvent) => {
      const sous = document.elementFromPoint(ev.clientX, ev.clientY);
      const cible = sous?.closest<HTMLElement>("li[data-hex]");
      if (!cible || cible === tenue || cible.parentElement !== liste) return;
      const apres = cible.compareDocumentPosition(tenue) & Node.DOCUMENT_POSITION_PRECEDING;
      liste.insertBefore(tenue, apres ? cible.nextSibling : cible);
    };
    const lacher = () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      window.removeEventListener("pointercancel", lacher);
      document.body.style.userSelect = "";
      const avant = couleurs.join("\n");
      couleurs = Array.from(liste.querySelectorAll<HTMLElement>("li[data-hex]")).map(
        (li) => li.dataset.hex!,
      );
      const hex = tenue.dataset.hex!;
      rendre(null);
      if (couleurs.join("\n") !== avant)
        dire(`${hex} placée en ${rang(couleurs.indexOf(hex) + 1)} position sur ${couleurs.length}.`);
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    window.addEventListener("pointercancel", lacher);
  });

  /**
   * Dit, sur le champ même (la bulle du navigateur), pourquoi la couleur
   * n'est pas ajoutée : code mal écrit, couleur déjà là, nuancier plein. Une
   * annonce réservée aux lecteurs d'écran laissait croire, à l'œil, que le
   * clic n'avait rien fait — le code restait dans son champ, sans un mot.
   * Le champ du code s'il y en a un, sinon le sélecteur.
   */
  function refuser(message: string) {
    dire(message);
    const ou = code ?? choix;
    if (!ou) return;
    ou.setCustomValidity(message);
    ou.reportValidity();
    ou.focus();
  }

  /** Ajoute la couleur du code s'il est rempli, sinon celle du sélecteur. */
  function ajouterCouleur() {
    const saisi = code?.value.trim() ?? "";
    const hex = hexPropre(saisi || (choix?.value ?? ""));
    if (!hex) {
      refuser(`« ${saisi} » n'est pas un code couleur : écrivez-le comme #B8551D.`);
      return;
    }
    if (couleurs.includes(hex)) {
      refuser(`${hex} est déjà dans ${libelle}, en ${rang(couleurs.indexOf(hex) + 1)} position.`);
      return;
    }
    if (couleurs.length >= max) {
      refuser(`${max} couleurs au plus dans ${libelle} : retirez-en une pour en ajouter une autre.`);
      return;
    }
    couleurs.push(hex);
    rendre(null);
    if (code) code.value = "";
    dire(`${hex} ajoutée en dernière position (${couleurs.length}e).`);
  }
  ajouter?.addEventListener("click", ajouterCouleur);

  // Le code et le sélecteur disent la même couleur : choisir dans l'un
  // remplit l'autre.
  choix?.addEventListener("input", () => {
    choix.setCustomValidity("");
    if (!code) return;
    code.value = choix.value.toUpperCase();
    code.setCustomValidity("");
  });
  code?.addEventListener("input", () => {
    code.setCustomValidity("");
    const hex = hexPropre(code.value);
    if (hex && choix) choix.value = hex.toLowerCase();
  });
  // Couleur déjà là, nuancier plein : le dire suffisait, et le formulaire
  // autour doit pouvoir partir — un refus resté sur le champ bloquerait son
  // « Enregistrer ». Un code mal écrit, lui, le retient tant qu'il n'est ni
  // corrigé ni effacé : la couleur voulue n'a pas été ajoutée.
  for (const ou of [code, choix]) {
    if (!ou) continue;
    ou.addEventListener("blur", () => {
      if (ou === code && ou.value.trim() && !hexPropre(ou.value)) return;
      ou.setCustomValidity("");
    });
  }
  code?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // Entrée ajoute la couleur : elle n'envoie pas le formulaire autour.
    e.preventDefault();
    ajouterCouleur();
  });

  // La page enregistre elle-même chaque changement : rien à rappeler.
  if (!aussitot) {
    racine.closest("form")?.addEventListener("submit", () => {
      envoye = true;
    });
    window.addEventListener("beforeunload", (e) => {
      if (envoye || couleurs.join("\n") === depart) return;
      e.preventDefault();
      // Les navigateurs plus anciens ne demandent confirmation que si
      // `returnValue` est posé.
      e.returnValue = "";
    });
  }

  rendre(null);
}

/**
 * Un nuancier fabriqué dans le navigateur, au balisage de Nuancier.astro, déjà
 * branché : pour les écrans qui dessinent leurs lignes eux-mêmes. La page
 * écoute « pastilles:change » pour enregistrer.
 */
export function creerNuancier(opts: {
  couleurs: readonly string[];
  /** Ce que lit un lecteur d'écran, après « dans » (« les couleurs de la monture »). */
  libelle: string;
  /** Le texte au-dessus des pastilles, avant le mode d'emploi. */
  etiquette?: string;
  /** Au plus tant de couleurs (« + Ajouter » s'éteint au-delà). */
  max?: number;
  /** La page enregistre chaque changement aussitôt. */
  aussitot?: boolean;
}): HTMLElement {
  const racine = document.createElement("div");
  racine.dataset.pastilles = "";
  racine.dataset.libelle = opts.libelle;
  if (opts.max) racine.dataset.pastillesMax = String(opts.max);
  if (opts.aussitot) racine.dataset.pastillesAussitot = "";

  const id = `nuancier-${Math.random().toString(36).slice(2, 10)}`;
  const etiquette = document.createElement("span");
  etiquette.id = id;
  etiquette.className = "text-bo-muted text-xs";
  etiquette.textContent = `${opts.etiquette ? `${opts.etiquette} ` : ""}Glissez ⠿ ou utilisez les flèches ← → ; × retire la couleur.`;

  const liste = document.createElement("ul");
  liste.dataset.pastillesListe = "";
  liste.className = "mt-1 flex flex-wrap items-center gap-1.5";
  liste.setAttribute("aria-labelledby", id);

  const ajout = document.createElement("div");
  ajout.className = "mt-1.5 flex flex-wrap items-center gap-2";
  const choix = document.createElement("input");
  choix.type = "color";
  choix.dataset.pastillesChoix = "";
  choix.className = "h-7 w-9 cursor-pointer rounded border border-bo-border";
  choix.value = "#b8551d";
  choix.setAttribute("aria-label", `Couleur à ajouter dans ${opts.libelle}`);
  choix.title = "Choisir une couleur à ajouter";
  const code = document.createElement("input");
  code.type = "text";
  code.dataset.pastillesCode = "";
  code.className = "w-24 rounded border border-bo-border bg-bo-surface px-1.5 py-1 font-mono text-xs";
  code.placeholder = "#RRGGBB";
  code.maxLength = 7;
  code.spellcheck = false;
  code.autocomplete = "off";
  code.setAttribute("aria-label", `Code de la couleur à ajouter dans ${opts.libelle} (#RRGGBB)`);
  code.title = "Ou le code de la couleur, par exemple #B8551D";
  const ajouter = document.createElement("button");
  ajouter.type = "button";
  ajouter.dataset.pastillesAjouter = "";
  ajouter.className =
    "rounded border border-bo-border px-2 py-1 text-xs hover:bg-bo-bg disabled:cursor-default disabled:opacity-40";
  ajouter.textContent = "+ Ajouter";
  ajout.append(choix, code, ajouter);

  const champ = document.createElement("textarea");
  champ.dataset.pastillesChamp = "";
  champ.className = "hidden";
  champ.setAttribute("aria-hidden", "true");
  champ.tabIndex = -1;
  champ.value = opts.couleurs.join("\n");

  const annonce = document.createElement("p");
  annonce.className = "sr-only";
  annonce.setAttribute("aria-live", "polite");
  annonce.dataset.pastillesAnnonce = "";

  racine.append(etiquette, liste, ajout, champ, annonce);
  brancherNuancier(racine);
  return racine;
}

// Un module (ses exports le font tel), pas un script global : ses fonctions
// ne croisent pas celles de lib/rangement.ts, chargé sur les mêmes pages.
document.querySelectorAll<HTMLElement>("[data-pastilles]").forEach(brancherNuancier);
