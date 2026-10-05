/**
 * Ranger une liste à la main : on attrape la poignée ⠿ et on fait glisser,
 * ou l'on clique les flèches ↑ ↓ — les deux font la même chose, et les
 * flèches marchent au clavier et sur une tablette où le glisser accroche mal.
 *
 * Rien n'est enregistré pendant qu'on range : le bouton « Enregistrer
 * l'ordre » s'allume dès que l'ordre diffère de celui de départ, et c'est lui
 * qui envoie. Quitter la page avec un ordre non enregistré le fait demander,
 * pour qu'un rangement de vingt lignes ne se perde pas sur un clic de travers.
 *
 * Le même geste que l'écran « Ordre d'affichage » des affiches, écrit une fois
 * pour les écrans qui rangent des LIGNES (collections, pages) :
 *
 *   <form id="f"> <input data-rangement-champ> <button data-rangement-bouton> </form>
 *   <tbody data-rangement="f">
 *     <tr data-rang-id="12"> … <span class="ml-poignee">⠿</span>
 *       <span data-rang>1</span> <button data-monter> <button data-descendre> …
 *
 * Le champ reçoit les identifiants dans l'ordre, séparés par des virgules.
 */

function brancher(liste: HTMLElement): void {
  const formulaire = document.getElementById(liste.dataset.rangement ?? "");
  const champ = formulaire?.querySelector<HTMLInputElement>("[data-rangement-champ]");
  const bouton = formulaire?.querySelector<HTMLButtonElement>("[data-rangement-bouton]");
  const lignes = () =>
    Array.from(liste.children).filter(
      (n): n is HTMLElement => n instanceof HTMLElement && n.dataset.rangId !== undefined,
    );
  const ordre = () => lignes().map((l) => l.dataset.rangId).join(",");
  const depart = ordre();
  let envoye = false;

  /** Après chaque déplacement : numéros, flèches aux bouts, bouton. */
  function verifier(): void {
    const actuel = ordre();
    if (champ) champ.value = actuel;
    if (bouton) bouton.disabled = actuel === depart;
    const toutes = lignes();
    toutes.forEach((l, i) => {
      const rang = l.querySelector("[data-rang]");
      if (rang) rang.textContent = String(i + 1);
      const monter = l.querySelector<HTMLButtonElement>("[data-monter]");
      const descendre = l.querySelector<HTMLButtonElement>("[data-descendre]");
      if (monter) monter.disabled = i === 0;
      if (descendre) descendre.disabled = i === toutes.length - 1;
    });
  }

  liste.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-monter], [data-descendre]",
    );
    if (!b || !liste.contains(b)) return;
    e.preventDefault();
    const ligne = b.closest<HTMLElement>("[data-rang-id]");
    if (!ligne) return;
    if (b.hasAttribute("data-monter")) {
      const avant = ligne.previousElementSibling as HTMLElement | null;
      if (avant?.dataset.rangId !== undefined) liste.insertBefore(ligne, avant);
    } else {
      const apres = ligne.nextElementSibling as HTMLElement | null;
      if (apres?.dataset.rangId !== undefined) liste.insertBefore(apres, ligne);
    }
    verifier();
    // Le focus suit la ligne : on peut enchaîner les clics sur la même flèche
    // — sauf arrivé au bout, où elle s'éteint et le rendrait à la page.
    if (!b.disabled) b.focus();
  });

  // Le glisser s'écoute sur la FENÊTRE : la ligne change de place pendant le
  // geste, et une ligne déplacée perdrait le suivi du pointeur.
  liste.addEventListener("pointerdown", (e) => {
    const poignee = (e.target as HTMLElement).closest(".ml-poignee");
    if (!poignee || !liste.contains(poignee)) return;
    const tenue = poignee.closest<HTMLElement>("[data-rang-id]");
    if (!tenue) return;
    e.preventDefault();
    tenue.classList.add("ml-tenue");
    document.body.style.userSelect = "none";

    const bouger = (ev: PointerEvent) => {
      const sous = document.elementFromPoint(ev.clientX, ev.clientY);
      const cible = sous?.closest<HTMLElement>("[data-rang-id]");
      if (!cible || cible === tenue || cible.parentElement !== liste) return;
      const apres = cible.compareDocumentPosition(tenue) & Node.DOCUMENT_POSITION_PRECEDING;
      liste.insertBefore(tenue, apres ? cible.nextSibling : cible);
      verifier();
    };
    const lacher = () => {
      tenue.classList.remove("ml-tenue");
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      window.removeEventListener("pointercancel", lacher);
      verifier();
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    window.addEventListener("pointercancel", lacher);
  });

  formulaire?.addEventListener("submit", () => {
    envoye = true;
  });
  window.addEventListener("beforeunload", (e) => {
    if (envoye || ordre() === depart) return;
    e.preventDefault();
    // Les navigateurs plus anciens ne demandent confirmation que si
    // `returnValue` est posé.
    e.returnValue = "";
  });

  verifier();
}

document.querySelectorAll<HTMLElement>("[data-rangement]").forEach(brancher);
