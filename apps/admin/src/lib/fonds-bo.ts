/**
 * « Créer un fond » vu du navigateur (BO › Atelier, 20/11) : les gestes qui
 * coûtent se confirment, ne partent qu'une fois, et la page se met à jour
 * toute seule quand un dessin se termine.
 *
 * Un dessin prend une à deux minutes chez OpenAI : la page ne tient pas de
 * requête ouverte, elle redemande l'état (`data-sondage`, une adresse de
 * l'API) toutes les 3 s, puis toutes les 8 s au-delà de deux minutes, et se
 * recharge dès que plus rien n'est en cours. Le rendu reste celui du serveur :
 * ce script ne dessine rien, il dit seulement « c'est prêt ».
 *
 * Le balisage, posé par pages/fonds.astro et pages/fonds/[id].astro :
 *   - `[data-sondage]` : l'adresse de l'état à redemander ;
 *   - `form[data-confirme]` : la question posée avant d'envoyer ;
 *   - `form[data-lot]` : le formulaire d'un lot, dont la question se calcule
 *     (photos × versions) — `data-cout`, `data-bouchon`, `data-max-photos`,
 *     et `data-reste` : ce qu'il reste pour les fonds ce mois-ci (leur
 *     plafond, à part de celui des affiches des clients) ;
 *   - `[data-noms]` : où ranger un champ de nom par photo choisie.
 */
import {
  confirmationLot,
  encoreEnCours,
  euros,
  nouveauJeton,
  pluriel,
  refusPlafondLot,
} from "./fonds-textes.ts";

/** Ce qu'il reste pour les fonds ce mois-ci, ou null si la page ne le dit pas. */
function resteDuLot(form: HTMLFormElement): number | null {
  const brut = form.dataset.reste;
  const n = brut === undefined || brut === "" ? Number.NaN : Number(brut);
  return Number.isFinite(n) ? n : null;
}

const PAUSE = 3000;
const PAUSE_LONGUE = 8000;

function sonder(zone: HTMLElement): void {
  const adresse = zone.dataset.sondage;
  if (!adresse) return;
  const debut = Date.now();
  const suivante = () =>
    window.setTimeout(tour, Date.now() - debut > 120_000 ? PAUSE_LONGUE : PAUSE);
  async function tour() {
    try {
      const r = await fetch(adresse!, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (r.ok && !encoreEnCours(await r.json())) {
        window.location.reload();
        return;
      }
    } catch {
      // Réseau coupé un instant : on redemandera.
    }
    suivante();
  }
  suivante();
}

/** Un envoi qui coûte : on demande, puis il ne part qu'une fois. */
function brancherEnvois(): void {
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.closest("[data-fonds]")) return;
    if (form.dataset.envoye === "1") {
      e.preventDefault();
      return;
    }
    let question = form.dataset.confirme ?? null;
    if (form.hasAttribute("data-lot")) {
      const photos = form.querySelector<HTMLInputElement>("input[type=file]")?.files?.length ?? 0;
      const max = Number(form.dataset.maxPhotos) || 10;
      const erreur = form.querySelector<HTMLElement>("[data-erreur]");
      const souci = !photos
        ? "Ajoutez au moins une photo du lieu."
        : photos > max
          ? `${max} photos au plus par lot : faites-en deux.`
          : "";
      if (souci) {
        e.preventDefault();
        if (erreur) erreur.textContent = souci;
        return;
      }
      const versions = Number(form.querySelector<HTMLSelectElement>("[name=versions]")?.value) || 1;
      const cout = Number(form.dataset.cout) || 0;
      const bouchon = form.dataset.bouchon === "1";
      const reste = resteDuLot(form);
      // Au-delà de ce qu'il reste pour les fonds, l'API refuserait : on le
      // dit tout de suite, sans envoyer dix photos pour rien.
      const refus = refusPlafondLot(photos * versions, cout, reste, bouchon);
      if (refus) {
        e.preventDefault();
        if (erreur) erreur.textContent = refus;
        return;
      }
      if (erreur) erreur.textContent = "";
      question = confirmationLot(photos, versions, cout, bouchon, reste);
    }
    if (question && !window.confirm(question)) {
      e.preventDefault();
      return;
    }
    form.dataset.envoye = "1";
    // Le bouton cliqué dit qu'il travaille ; les autres ne repartent pas.
    for (const b of form.querySelectorAll<HTMLButtonElement>("button")) {
      b.setAttribute("aria-disabled", "true");
      b.classList.add("opacity-70", "cursor-wait");
    }
    const emetteur = (e as SubmitEvent).submitter;
    if (emetteur instanceof HTMLButtonElement) emetteur.setAttribute("aria-busy", "true");
  });

  // Revenu par « Précédent », le navigateur rend la page telle qu'on l'a
  // quittée : ses boutons doivent redevenir cliquables, et un formulaire
  // déjà parti reçoit un NOUVEAU jeton (relecture du 20/11). Avec l'ancien,
  // d'autres photos — ou un autre message — renvoyées d'ici retombaient sur
  // le lot déjà fait, et partaient à la poubelle sans un mot. Le double clic,
  // lui, reste arrêté plus haut (`data-envoye`), et tout nouvel envoi repasse
  // par la confirmation du coût.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    for (const form of document.querySelectorAll<HTMLFormElement>("form[data-envoye]")) {
      delete form.dataset.envoye;
      const jeton = form.querySelector<HTMLInputElement>("input[name=jeton]");
      if (jeton) jeton.value = nouveauJeton();
      for (const b of form.querySelectorAll("button")) {
        b.removeAttribute("aria-disabled");
        b.removeAttribute("aria-busy");
        b.classList.remove("opacity-70", "cursor-wait");
      }
    }
  });
}

/**
 * Une ligne par photo choisie, avec sa vignette et son nom (vide = le nom du
 * lot) : chaque photo donne son propre fond, elle peut porter son propre nom.
 */
function brancherNoms(form: HTMLFormElement): void {
  const fichiers = form.querySelector<HTMLInputElement>("input[type=file]");
  const zone = form.querySelector<HTMLElement>("[data-noms]");
  const nomLot = form.querySelector<HTMLInputElement>("[name=nomLot]");
  const versions = form.querySelector<HTMLSelectElement>("[name=versions]");
  const resume = form.querySelector<HTMLElement>("[data-resume]");
  const erreur = form.querySelector<HTMLElement>("[data-erreur]");
  if (!fichiers || !zone) return;
  let adresses: string[] = [];

  function resumer() {
    const n = fichiers!.files?.length ?? 0;
    const v = Number(versions?.value) || 1;
    if (!resume) return;
    const reste = resteDuLot(form);
    resume.textContent = n
      ? `${pluriel(n, "photo")} → ${pluriel(n, "fond")}, ${pluriel(n * v, "image")} à dessiner` +
        (form.dataset.bouchon === "1"
          ? " (mode d'essai : rien n'est payé)."
          : `, environ ${euros(n * v * (Number(form.dataset.cout) || 0))}` +
            (reste === null ? "." : ` (il reste ${euros(reste)} pour les fonds ce mois-ci).`))
      : "";
  }

  fichiers.addEventListener("change", () => {
    for (const a of adresses) URL.revokeObjectURL(a);
    adresses = [];
    zone.replaceChildren();
    if (erreur) erreur.textContent = "";
    const liste = [...(fichiers.files ?? [])];
    for (const [i, f] of liste.entries()) {
      const ligne = document.createElement("li");
      ligne.className = "flex items-center gap-3";
      const img = document.createElement("img");
      const adresse = URL.createObjectURL(f);
      adresses.push(adresse);
      img.src = adresse;
      img.alt = "";
      img.className = "h-14 w-14 shrink-0 rounded border border-bo-border object-cover";
      const champ = document.createElement("input");
      champ.type = "text";
      champ.name = "noms";
      champ.maxLength = Number(nomLot?.maxLength) > 0 ? nomLot!.maxLength : 120;
      champ.placeholder = nomLot?.value || "Nom du lieu";
      champ.setAttribute("aria-label", `Nom du fond de la photo ${i + 1} (${f.name})`);
      champ.className = "w-full max-w-md rounded border border-bo-border bg-bo-surface px-2 py-1 text-sm";
      const legende = document.createElement("span");
      legende.className = "hidden truncate text-xs text-bo-muted sm:block sm:w-40";
      legende.textContent = f.name;
      ligne.append(img, legende, champ);
      zone.append(ligne);
    }
    resumer();
  });
  nomLot?.addEventListener("input", () => {
    for (const c of zone.querySelectorAll<HTMLInputElement>("input[name=noms]"))
      c.placeholder = nomLot.value || "Nom du lieu";
  });
  versions?.addEventListener("change", resumer);
  resumer();
}

for (const zone of document.querySelectorAll<HTMLElement>("[data-sondage]")) sonder(zone);
for (const form of document.querySelectorAll<HTMLFormElement>("form[data-lot]")) brancherNoms(form);
brancherEnvois();
