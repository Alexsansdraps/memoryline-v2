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
 * pour tous les écrans qui rangent (collections, pages, affiches) :
 *
 *   <form id="f"> <input data-rangement-champ> <button data-rangement-bouton> </form>
 *   <tbody data-rangement="f">
 *     <tr data-rang-id="12" data-rang-nom="Amiens"> … <span class="ml-poignee">⠿</span>
 *       <span data-rang>1</span> <button data-monter> <button data-descendre> …
 *
 * Le champ reçoit les identifiants dans l'ordre, séparés par des virgules.
 *
 * Facultatifs, pour les longues listes (cent soixante affiches) :
 *   - <button data-en-tete> et <button data-a-la-fin> sur une ligne l'envoient
 *     d'un coup en tête ou à la fin, au lieu de cent clics sur ↑ ;
 *   - un élément [data-rangement-annonce] DANS le formulaire (aria-live) dit
 *     au lecteur d'écran où la ligne est arrivée : « Amiens, 3e sur 40 ». Le
 *     nom lu est `data-rang-nom`, à défaut le texte de la ligne.
 * Une page qui ne les pose pas se comporte exactement comme avant.
 */

function brancher(liste: HTMLElement): void {
  const formulaire = document.getElementById(liste.dataset.rangement ?? "");
  const champ = formulaire?.querySelector<HTMLInputElement>("[data-rangement-champ]");
  const bouton = formulaire?.querySelector<HTMLButtonElement>("[data-rangement-bouton]");
  const annonce = formulaire?.querySelector<HTMLElement>("[data-rangement-annonce]");
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
      const premiere = i === 0;
      const derniere = i === toutes.length - 1;
      for (const b of l.querySelectorAll<HTMLButtonElement>("[data-monter], [data-en-tete]"))
        b.disabled = premiere;
      for (const b of l.querySelectorAll<HTMLButtonElement>("[data-descendre], [data-a-la-fin]"))
        b.disabled = derniere;
    });
  }

  /** « Amiens, 3e sur 40 » — seulement si la page a prévu où le dire. */
  function annoncer(ligne: HTMLElement): void {
    if (!annonce) return;
    const toutes = lignes();
    const place = toutes.indexOf(ligne) + 1;
    const nom = ligne.dataset.rangNom ?? (ligne.textContent ?? "").replace(/\s+/g, " ").trim();
    annonce.textContent = `${nom}, ${place === 1 ? "1re" : `${place}e`} sur ${toutes.length}.`;
  }

  liste.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-monter], [data-descendre], [data-en-tete], [data-a-la-fin]",
    );
    if (!b || !liste.contains(b)) return;
    e.preventDefault();
    const ligne = b.closest<HTMLElement>("[data-rang-id]");
    if (!ligne) return;
    if (b.hasAttribute("data-monter")) {
      const avant = ligne.previousElementSibling as HTMLElement | null;
      if (avant?.dataset.rangId !== undefined) liste.insertBefore(ligne, avant);
    } else if (b.hasAttribute("data-descendre")) {
      const apres = ligne.nextElementSibling as HTMLElement | null;
      if (apres?.dataset.rangId !== undefined) liste.insertBefore(apres, ligne);
    } else if (b.hasAttribute("data-en-tete")) {
      const premiere = lignes()[0];
      if (premiere && premiere !== ligne) liste.insertBefore(ligne, premiere);
    } else {
      const toutes = lignes();
      const derniere = toutes[toutes.length - 1];
      if (derniere && derniere !== ligne) liste.insertBefore(ligne, derniere.nextSibling);
    }
    verifier();
    annoncer(ligne);
    // Le focus suit la ligne : on peut enchaîner les clics sur la même flèche
    // — sauf arrivé au bout, où elle s'éteint ; il passe alors au bouton d'en
    // face de la même ligne, plutôt que de retomber en haut de la page.
    if (!b.disabled) b.focus();
    else
      ligne
        .querySelector<HTMLButtonElement>(
          "[data-monter]:not(:disabled), [data-descendre]:not(:disabled)",
        )
        ?.focus();
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
      annoncer(tenue);
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
