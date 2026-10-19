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
 */

/** « #b8551d » ou « b8551d » → « #B8551D » ; null si ce n'est pas une couleur. */
function hexPropre(brut: string): string | null {
  let h = brut.trim().toUpperCase();
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9A-F]{3}$/.test(h))
    h = `#${h
      .slice(1)
      .split("")
      .map((x) => x + x)
      .join("")}`;
  return /^#[0-9A-F]{6}$/.test(h) ? h : null;
}

/** « 1re », « 2e »… pour annoncer une place. */
function rang(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

const CLASSE_BOUTON =
  "flex h-6 w-6 items-center justify-center rounded text-xs text-bo-muted hover:bg-bo-bg disabled:cursor-default disabled:opacity-30";

function brancherNuancier(racine: HTMLElement): void {
  const liste = racine.querySelector<HTMLElement>("[data-pastilles-liste]");
  const champ = racine.querySelector<HTMLTextAreaElement>("[data-pastilles-champ]");
  const choix = racine.querySelector<HTMLInputElement>("[data-pastilles-choix]");
  const ajouter = racine.querySelector<HTMLButtonElement>("[data-pastilles-ajouter]");
  const annonce = racine.querySelector<HTMLElement>("[data-pastilles-annonce]");
  if (!liste || !champ) return;
  const libelle = racine.dataset.libelle ?? "ce nuancier";

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

  ajouter?.addEventListener("click", () => {
    const hex = hexPropre(choix?.value ?? "");
    if (!hex) return;
    if (couleurs.includes(hex)) {
      dire(`${hex} est déjà dans ${libelle}, en ${rang(couleurs.indexOf(hex) + 1)} position.`);
      return;
    }
    couleurs.push(hex);
    rendre(null);
    dire(`${hex} ajoutée en dernière position (${couleurs.length}e).`);
  });

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

  rendre(null);
}

document.querySelectorAll<HTMLElement>("[data-pastilles]").forEach(brancherNuancier);

// Un module, pas un script global : ses fonctions ne croisent pas celles
// de lib/rangement.ts, chargé sur les mêmes pages.
export {};
