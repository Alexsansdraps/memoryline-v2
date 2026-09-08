/// <reference lib="dom" />
import { t, lien, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import {
  createSignal,
  createMemo,
  onCleanup,
  onMount,
  For,
  Index,
  Show,
  type JSX,
} from "solid-js";
import {
  COULEURS_TEXTE_AFFICHE,
  COULEUR_TEXTE_DEFAUT,
  NB_LIGNES_AFFICHE,
  POLICES_AFFICHE,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_TITRE_DEFAUT,
  familleCss,
  policeParId,
  type PosterConfig,
  type TextBlock,
} from "@memoryline/types";
import { browserApi, formatPrice, getCartId } from "../lib/api.ts";
import {
  apercuAbsolu,
  attendreApercu,
  envoyerPhoto,
  genererAffiche,
  verifierPhoto,
  ErreurIA,
  POIDS_PHOTO_MAX,
  TYPES_PHOTO,
  type EchecIA,
} from "../lib/ia.ts";

/**
 * Parcours des affiches IA : le client envoie une photo, voit l'affiche
 * générée, recommence autant de fois qu'il le souhaite, puis met au panier
 * celle qu'il garde.
 *
 * AUCUN quota côté client — décision de la cliente, prise en connaissance du
 * coût. Le seul frein possible vient du serveur (anti-rafale, plafond de
 * dépense) et se lit ici comme un message d'attente, pas comme un refus sec.
 *
 * Les routes /ia/* peuvent ne pas encore répondre : chaque échec se termine
 * par une phrase en français et un geste à faire, jamais par une page cassée.
 */
export interface AfficheIAProps {
  langue?: Langue;
  product: { id: number; name: string; basePriceCents: number };
  /** Formats vendus et leur prix, dans l'ordre du catalogue. */
  formats?: { format: string; priceCents: number }[];
}

/** Étapes du parcours, dans l'ordre où le client les traverse. */
type Etape = "depot" | "envoi" | "generation" | "pret";

export default function AfficheIA(props: AfficheIAProps): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);

  const [etape, setEtape] = createSignal<Etape>("depot");
  const [echec, setEchec] = createSignal<EchecIA | null>(null);
  const [survol, setSurvol] = createSignal(false);
  const [precision, setPrecision] = createSignal("");

  /**
   * Les trois lignes de texte, « comme sur les autres affiches » : mêmes
   * polices, mêmes deux couleurs, même rendu. L'affiche IA n'est pas un autre
   * produit, c'est une affiche dont le fond vient d'une photo — le texte se
   * compose par-dessus exactement comme sur un fond du catalogue, à l'écran
   * comme à l'impression.
   */
  type Ligne = { value: string; font: string; x?: number; y?: number };
  const [lignes, setLignes] = createSignal<Ligne[]>(
    Array.from({ length: NB_LIGNES_AFFICHE }, (_, i) => ({
      value: "",
      font: i === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT,
    })),
  );
  const [couleur, setCouleur] = createSignal(COULEUR_TEXTE_DEFAUT);
  const modifierLigne = (rang: number, patch: Partial<Ligne>) =>
    setLignes((l) => l.map((x, i) => (i === rang ? { ...x, ...patch } : x)));

  /**
   * Déplacement d'une ligne à la souris (ou au doigt).
   *
   * Tant qu'une ligne n'a pas été touchée, elle suit la mise en page
   * automatique. Au premier geste, on relève où elle se trouve, on la détache,
   * et elle suit le pointeur. Sa position se garde en fractions de l'affiche :
   * la même valeur sert à l'aperçu, quelle que soit sa taille à l'écran, et au
   * PDF d'impression — c'est ce qui garantit que l'affiche livrée est celle
   * que le client a composée.
   */
  let boiteAffiche: HTMLDivElement | undefined;
  function attraperLigne(e: PointerEvent, rangDansLignes: number) {
    if (!boiteAffiche) return;
    e.preventDefault();
    const cadre = boiteAffiche.getBoundingClientRect();
    const cible = e.currentTarget as HTMLElement;
    const boite = cible.getBoundingClientRect();
    // Le pointeur n'est pas forcément au centre de la ligne : on retient
    // l'écart pour que la ligne ne saute pas sous le doigt au premier pixel.
    const ecartX = e.clientX - (boite.left + boite.width / 2);
    const ecartY = e.clientY - (boite.top + boite.height / 2);
    const poser = (ev: PointerEvent) => {
      const x = (ev.clientX - ecartX - cadre.left) / cadre.width;
      const y = (ev.clientY - ecartY - cadre.top) / cadre.height;
      modifierLigne(rangDansLignes, {
        x: Math.min(0.97, Math.max(0.03, x)),
        y: Math.min(0.97, Math.max(0.03, y)),
      });
    };
    // Les mouvements s'ecoutent sur la FENETRE, pas sur la ligne : au premier
    // deplacement la ligne quitte l'empilement pour le calque des positions
    // libres, donc son element est recree — une capture de pointeur posee
    // dessus se perdrait en route, et la ligne resterait plantee la ou on
    // l'a attrapee.
    poser(e);
    const selectionAvant = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const finir = () => {
      window.removeEventListener("pointermove", poser);
      window.removeEventListener("pointerup", finir);
      window.removeEventListener("pointercancel", finir);
      document.body.style.userSelect = selectionAvant;
    };
    window.addEventListener("pointermove", poser);
    window.addEventListener("pointerup", finir);
    window.addEventListener("pointercancel", finir);
  }

  /** Les lignes réellement écrites, dans l'ordre — celles qu'on dessine. */
  const lignesRemplies = () =>
    lignes()
      .map((l, rang) => ({ ...l, rang }))
      .filter((l) => l.value.trim() !== "");

  /**
   * Taille des lignes en cqw, par rang parmi les lignes REMPLIES : la même
   * échelle que l'aperçu des affiches classiques (PosterPreview), pour que
   * les deux se ressemblent trait pour trait.
   */
  const TAILLES_LIGNES = [8, 5.5, 4.6];

  // Les clés de traduction sont un type fermé : on les énumère au lieu de les
  // fabriquer par interpolation, sinon le compilateur ne peut plus garantir
  // qu'elles existent dans les cinq langues.
  const CLES_LIGNES = [
    { champ: "cfg.ligne1_champ", exemple: "cfg.ligne1_exemple" },
    { champ: "cfg.ligne2_champ", exemple: "cfg.ligne2_exemple" },
    { champ: "cfg.ligne3_champ", exemple: "cfg.ligne3_exemple" },
  ] as const;
  const [ajout, setAjout] = createSignal(false);

  /** Chemin de la photo côté serveur, réutilisé à chaque nouvel essai. */
  const [chemin, setChemin] = createSignal<string | null>(null);
  /** Vignette locale de la photo choisie — affichée sans attendre le serveur. */
  const [photoLocale, setPhotoLocale] = createSignal<string | null>(null);
  const [nomPhoto, setNomPhoto] = createSignal<string | null>(null);

  const [publicId, setPublicId] = createSignal<string | null>(null);
  /** Adresse affichée (elle peut porter un paramètre anti-cache). */
  const [apercu, setApercu] = createSignal<string | null>(null);
  /**
   * Adresse BRUTE renvoyée par l'API, telle qu'elle part au panier. Comme le
   * fond d'une affiche, cette valeur reste des années dans la commande : y
   * figer le préfixe de l'API ou un paramètre anti-cache la rendrait caduque.
   */
  const [apercuChemin, setApercuChemin] = createSignal<string | null>(null);

  /** Secondes écoulées : une attente muette laisse croire à un blocage. */
  const [secondes, setSecondes] = createSignal(0);
  let chrono: ReturnType<typeof setInterval> | undefined;
  function demarrerChrono() {
    setSecondes(0);
    clearInterval(chrono);
    chrono = setInterval(() => setSecondes((s) => s + 1), 1000);
  }
  function arreterChrono() {
    clearInterval(chrono);
    chrono = undefined;
  }

  const formats = () =>
    props.formats?.length
      ? props.formats
      : [{ format: "A4", priceCents: props.product.basePriceCents }];
  const [format, setFormat] = createSignal(
    props.formats?.[0]?.format ?? "A4",
  );
  const prixCourant = createMemo(
    () =>
      formats().find((f) => f.format === format())?.priceCents ??
      props.product.basePriceCents,
  );

  onCleanup(() => {
    arreterChrono();
    const url = photoLocale();
    if (url) URL.revokeObjectURL(url);
  });

  /** Message français de l'échec en cours. */
  const messageEchec = () => {
    switch (echec()) {
      case "indisponible":
        return tr("ia.err.indisponible");
      case "format":
        return tr("ia.err.format");
      case "trop_lourde":
        return tr("ia.err.trop_lourde");
      case "rafale":
        return tr("ia.err.rafale");
      case "plafond":
        return tr("ia.err.plafond");
      case "generation":
        return tr("ia.err.generation");
      case "attente":
        return tr("ia.err.attente");
      case "inconnu":
        return tr("ia.err.inconnu");
      default:
        return null;
    }
  };

  /** Ramène une exception, quelle qu'elle soit, à une cause affichable. */
  function causeDe(e: unknown): EchecIA {
    return e instanceof ErreurIA ? e.code : "inconnu";
  }

  async function choisirPhoto(fichier: File) {
    const refus = verifierPhoto(fichier);
    if (refus) {
      setEchec(refus);
      return;
    }
    const ancienne = photoLocale();
    if (ancienne) URL.revokeObjectURL(ancienne);
    setPhotoLocale(URL.createObjectURL(fichier));
    setNomPhoto(fichier.name);
    setEchec(null);
    setPublicId(null);
    setApercu(null);
    setApercuChemin(null);
    setEtape("envoi");
    demarrerChrono();
    try {
      const distant = await envoyerPhoto(fichier);
      setChemin(distant);
      await lancerGeneration(distant);
    } catch (e) {
      arreterChrono();
      setEchec(causeDe(e));
      setEtape("depot");
    }
  }

  /** Lance (ou relance) une génération sur la photo déjà envoyée. */
  async function lancerGeneration(cheminPhoto?: string) {
    const source = cheminPhoto ?? chemin();
    if (!source) return;
    setEchec(null);
    setEtape("generation");
    demarrerChrono();
    try {
      const gen = await genererAffiche({
        productId: props.product.id,
        photo: source,
        cartId: getCartId(),
        precision: precision(),
      });
      const url = apercuAbsolu(gen.apercuUrl);
      // « en_cours » : l'image n'existe pas encore, on attend qu'elle réponde.
      const prete = gen.status === "prete" ? url : await attendreApercu(url);
      setPublicId(gen.publicId);
      setApercuChemin(gen.apercuUrl);
      setApercu(prete);
      setEtape("pret");
    } catch (e) {
      setEchec(causeDe(e));
      // On garde la photo ET l'affiche déjà obtenue : un essai raté ne doit
      // ni effacer l'aperçu retenu, ni obliger à rechoisir le fichier.
      setEtape(apercu() ? "pret" : "depot");
    } finally {
      arreterChrono();
    }
  }

  function reprendreDepart() {
    const url = photoLocale();
    if (url) URL.revokeObjectURL(url);
    setPhotoLocale(null);
    setNomPhoto(null);
    setChemin(null);
    setPublicId(null);
    setApercu(null);
    setApercuChemin(null);
    setEchec(null);
    setEtape("depot");
  }

  async function ajouterAuPanier() {
    const id = publicId();
    if (!id || ajout()) return;
    setAjout(true);
    setEchec(null);
    try {
      const config: PosterConfig = {
        schemaVersion: 1,
        productId: props.product.id,
        format: format() === "A3" ? "A3" : "A4",
        view: "front",
        // Compacte, sans trou : l'API refuse une entrée vide au milieu, et
        // le rendu ne lit de toute façon que la suite des lignes remplies.
        texts: {
          lines: lignesRemplies().map(
            (l): TextBlock => ({
              value: l.value.trim(),
              font: l.font,
              color: couleur(),
              ...(typeof l.x === "number" && typeof l.y === "number"
                ? { x: l.x, y: l.y }
                : {}),
            }),
          ),
        },
        characters: [],
        // C'est CE champ qui rattache la ligne à la génération retenue : le
        // serveur y retrouve le fichier sans filigrane à imprimer une fois la
        // commande payée.
        aiPublicId: id,
        aiApercuUrl: apercuChemin() ?? undefined,
      };
      await browserApi.addCartItem(getCartId(), {
        productId: props.product.id,
        unitPriceCents: prixCourant(),
        quantity: 1,
        title: props.product.name,
        config,
      });
      window.location.href = lien(props.langue ?? LANGUE_DEFAUT, "/panier");
    } catch {
      setEchec("inconnu");
      setAjout(false);
    }
  }

  let champFichier: HTMLInputElement | undefined;

  const occupe = () => etape() === "envoi" || etape() === "generation";

  /**
   * L'outil vit dans une MODALE, comme le configurateur des autres affiches :
   * la fiche produit garde sa mise en page (galerie, titre, prix, formats), un
   * seul bouton « Personnaliser », et tout le travail se fait par-dessus.
   * Même coquille CSS (.ml-modal-*), même verrou du défilement, même touche
   * Échap — le client ne doit pas sentir qu'il change de produit.
   */
  const [ouverte, setOuverte] = createSignal(false);
  function verrouillerDefilement(verrou: boolean) {
    document.body.style.overflow = verrou ? "hidden" : "";
  }
  function ouvrir() {
    setOuverte(true);
    verrouillerDefilement(true);
  }
  function fermer() {
    // Une génération en cours continue côté serveur : on ne la perd pas, on
    // ferme juste la fenêtre ; rouvrir retrouve l'état tel quel.
    setOuverte(false);
    verrouillerDefilement(false);
  }
  function surTouche(e: KeyboardEvent) {
    if (e.key === "Escape" && ouverte()) fermer();
  }
  onMount(() => window.addEventListener("keydown", surTouche));
  onCleanup(() => {
    window.removeEventListener("keydown", surTouche);
    verrouillerDefilement(false);
  });

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        class="mt-8 inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
      >
        {tr("produit.personnaliser")}
      </button>
      <p class="mt-3 text-sm text-ink-soft">{tr("ia.intro")}</p>

      <Show when={ouverte()}>
    <div
      class="ml-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={tr("ia.titre")}
      onClick={(e) => {
        if (e.target === e.currentTarget) fermer();
      }}
    >
    <div class="ml-modal-panel">
      <header class="ml-modal-head">
        <h2 class="text-xl sm:text-2xl">{tr("ia.titre")}</h2>
        <button type="button" class="ml-modal-close" aria-label="Fermer" onClick={fermer}>
          ✕
        </button>
      </header>
    <div class="ml-modal-body">
      {/* Dans la modale (1040 px au plus) : l'aperçu à gauche à une taille où
          l'on juge une affiche, les réglages à droite. */}
      <div class="grid gap-8 items-start md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ------------------------------ Aperçu ------------------------- */}
        <div>
          <div
            ref={boiteAffiche}
            class="relative w-full overflow-hidden border border-ink/10 bg-paper-deep"
            style={{ "aspect-ratio": "1 / 1.4142" }}
          >
            <Show
              when={apercu()}
              fallback={
                <Show
                  when={photoLocale()}
                  fallback={
                    <div class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-soft">
                      {tr("ia.apercu_vide")}
                    </div>
                  }
                >
                  {/* La photo du client, en attendant l'affiche : il voit tout
                      de suite que c'est bien la bonne qui part. */}
                  <img
                    src={photoLocale()!}
                    alt=""
                    class="absolute inset-0 h-full w-full object-cover opacity-40"
                  />
                </Show>
              }
            >
              {/* Pas de filigrane SVG ici : celui de /ia/apercu est CUIT dans
                  les pixels de l'image. Il protège donc mieux que le nôtre —
                  qui disparaîtrait si on enregistrait l'image seule — et deux
                  filigranes superposés rendaient l'affiche illisible. */}
              <img
                src={apercu()!}
                alt={tr("ia.apercu_alt")}
                class="absolute inset-0 h-full w-full object-contain"
              />
            </Show>

            {/* Le texte, posé sur l'affiche comme sur les autres : même
                position (en haut), mêmes tailles, mêmes polices. Ce que le
                client voit ici est ce que le PDF imprimera. */}
            <Show when={lignesRemplies().length > 0}>
              {/* Deux calques de texte, même largeur, même unité de taille :
                  les lignes non touchées s'empilent en haut (calque 1), les
                  lignes déplacées sont posées à leur point (calque 2). Une
                  ligne passe de l'un à l'autre au premier geste. */}
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  right: "0",
                  top: "5%",
                  "text-align": "center",
                  "pointer-events": "none",
                  padding: "0 6%",
                  "container-type": "inline-size",
                  "z-index": "200",
                }}
              >
                <Index each={lignesRemplies()}>
                  {(ligne, rang) => (
                    <Show when={typeof ligne().x !== "number"}>
                      <div
                        title={tr("ia.deplacer_ligne")}
                        onPointerDown={(e) => attraperLigne(e, ligne().rang)}
                        style={{
                          "pointer-events": "auto",
                          cursor: "move",
                          "touch-action": "none",
                          "user-select": "none",
                          "font-family": familleCss(
                            policeParId(
                              ligne().font,
                              rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT,
                            ),
                          ),
                          color: couleur(),
                          "font-size": `${TAILLES_LIGNES[rang] ?? TAILLES_LIGNES.at(-1)}cqw`,
                          "line-height": rang === 0 ? "1.05" : "1.15",
                          "letter-spacing": rang === 0 ? "0.04em" : "normal",
                          "margin-top": rang === 0 ? "0" : "0.1em",
                          "word-break": "break-word",
                        }}
                      >
                        {ligne().value}
                      </div>
                    </Show>
                  )}
                </Index>
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: "0",
                  "pointer-events": "none",
                  padding: "0 6%",
                  "container-type": "inline-size",
                  "z-index": "201",
                }}
              >
                <Index each={lignesRemplies()}>
                  {(ligne, rang) => (
                    <Show when={typeof ligne().x === "number"}>
                      <div
                        title={tr("ia.deplacer_ligne")}
                        onPointerDown={(e) => attraperLigne(e, ligne().rang)}
                        style={{
                          position: "absolute",
                          left: `${(ligne().x ?? 0.5) * 100}%`,
                          top: `${(ligne().y ?? 0.1) * 100}%`,
                          transform: "translate(-50%, -50%)",
                          "white-space": "nowrap",
                          "pointer-events": "auto",
                          cursor: "move",
                          "touch-action": "none",
                          "user-select": "none",
                          "font-family": familleCss(
                            policeParId(
                              ligne().font,
                              rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT,
                            ),
                          ),
                          color: couleur(),
                          "font-size": `${TAILLES_LIGNES[rang] ?? TAILLES_LIGNES.at(-1)}cqw`,
                          "line-height": "1.1",
                          "letter-spacing": rang === 0 ? "0.04em" : "normal",
                        }}
                      >
                        {ligne().value}
                      </div>
                    </Show>
                  )}
                </Index>
              </div>
            </Show>

            <Show when={occupe()}>
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper/70 p-6 text-center">
                <span class="ml-spinner" aria-hidden="true" />
                <p class="text-sm font-medium">
                  {etape() === "envoi" ? tr("ia.envoi") : tr("ia.generation")}
                </p>
                <p class="text-xs text-ink-soft">{tr("ia.generation_duree")}</p>
                <p class="text-xs tabular-nums text-ink-soft">{secondes()} s</p>
              </div>
            </Show>
          </div>

          <Show when={apercu()}>
            <p class="mt-2 text-xs text-ink-soft">{tr("ia.filigrane_note")}</p>
          </Show>
        </div>

        {/* ---------------------------- Commandes ------------------------ */}
        <div>
          <p class="text-sm text-ink-soft">{tr("ia.intro")}</p>

          {/* Zone de dépôt : clic OU glisser-déposer. Le champ fichier reste
              un vrai <input>, donc utilisable au clavier et aux lecteurs
              d'écran ; le cadre n'est que sa décoration. */}
          <label
            class={`mt-5 flex cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed p-6 text-center transition-colors ${
              survol()
                ? "border-terracotta bg-terracotta/5"
                : "border-ink/25 hover:border-ink/50"
            } ${occupe() ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setSurvol(true);
            }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSurvol(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) void choisirPhoto(f);
            }}
          >
            <input
              ref={champFichier}
              type="file"
              accept={TYPES_PHOTO.join(",")}
              class="sr-only"
              disabled={occupe()}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                // Remise à zéro : rechoisir LE MÊME fichier doit relancer.
                e.currentTarget.value = "";
                if (f) void choisirPhoto(f);
              }}
            />
            <span class="text-sm font-medium">
              {nomPhoto() ? tr("ia.changer_photo") : tr("ia.depot")}
            </span>
            <span class="text-xs text-ink-soft">{tr("ia.depot_formats")}</span>
            <Show when={nomPhoto()}>
              <span class="mt-1 max-w-full truncate text-xs text-ink-soft">
                {nomPhoto()}
              </span>
            </Show>
          </label>

          <div class="mt-4 border border-ink/10 bg-paper-deep/50 p-4">
            <p class="text-xs font-medium uppercase tracking-[0.08em] text-ink-soft">
              {tr("ia.conseils_titre")}
            </p>
            <ul class="mt-2 space-y-1 text-sm text-ink-soft">
              <li>{tr("ia.conseil_nette")}</li>
              <li>{tr("ia.conseil_lieu")}</li>
              <li>{tr("ia.conseil_cadrage")}</li>
            </ul>
          </div>

          <label class="mt-4 block text-sm">
            <span class="font-medium">{tr("ia.precision")}</span>
            <input
              type="text"
              value={precision()}
              disabled={occupe()}
              placeholder={tr("ia.precision_exemple")}
              onInput={(e) => setPrecision(e.currentTarget.value)}
              class="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none disabled:opacity-60"
            />
          </label>

          {/* Les trois lignes, comme sur les autres affiches. Chaque ligne
              choisit sa police — montrée DANS la police, le client juge un
              rendu, pas un nom — et la couleur est commune aux trois. */}
          <div class="mt-5 space-y-3">
            <Index each={lignes()}>
              {(ligne, rang) => (
                <label class="block text-sm">
                  <span class="font-medium">{tr(CLES_LIGNES[rang]!.champ)}</span>
                  <input
                    type="text"
                    value={ligne().value}
                    maxLength={60}
                    placeholder={tr(CLES_LIGNES[rang]!.exemple)}
                    onInput={(e) => modifierLigne(rang, { value: e.currentTarget.value })}
                    class="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
                  />
                  <div class="mt-1.5 flex flex-wrap gap-1.5">
                    <For each={POLICES_AFFICHE}>
                      {(police) => (
                        <button
                          type="button"
                          aria-pressed={ligne().font === police.id}
                          title={police.libelle}
                          onClick={() => modifierLigne(rang, { font: police.id })}
                          class={`border px-2.5 py-1 text-base leading-none transition-colors ${
                            ligne().font === police.id
                              ? "border-ink bg-ink text-paper"
                              : "border-ink/20 hover:border-ink"
                          }`}
                          style={{ "font-family": familleCss(police) }}
                        >
                          Aa
                        </button>
                      )}
                    </For>
                  </div>
                </label>
              )}
            </Index>

            <div>
              <p class="text-sm font-medium">{tr("cfg.couleur_texte")}</p>
              <div class="mt-1.5 flex gap-2">
                <For each={COULEURS_TEXTE_AFFICHE}>
                  {(c) => (
                    <button
                      type="button"
                      aria-pressed={couleur() === c.hex}
                      aria-label={c.libelle}
                      title={c.libelle}
                      onClick={() => setCouleur(c.hex)}
                      class={`h-9 w-9 border-2 transition-colors ${
                        couleur() === c.hex ? "border-terracotta" : "border-ink/30"
                      }`}
                      style={{ background: c.hex }}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>

          <Show when={formats().length > 1}>
            <div class="mt-4">
              <p class="text-sm font-medium">{tr("produit.format")}</p>
              <div class="mt-2 flex gap-3">
                <For each={formats()}>
                  {(f) => (
                    <button
                      type="button"
                      onClick={() => setFormat(f.format)}
                      aria-pressed={format() === f.format}
                      class={`border px-4 py-3 text-left text-sm transition-colors ${
                        format() === f.format
                          ? "border-ink bg-ink text-paper"
                          : "border-ink/20 hover:border-ink"
                      }`}
                    >
                      <span class="block font-medium">{f.format}</span>
                      <span class="block opacity-80">
                        {formatPrice(f.priceCents)}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={messageEchec()}>
            <p
              role="status"
              class="mt-4 border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
            >
              {messageEchec()}
            </p>
          </Show>

          <div class="mt-6 flex flex-wrap items-center gap-3">
            <Show
              when={chemin()}
              fallback={
                <button
                  type="button"
                  disabled={occupe()}
                  onClick={() => champFichier?.click()}
                  class="rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
                >
                  {tr("ia.depot_bouton")}
                </button>
              }
            >
              <button
                type="button"
                disabled={occupe()}
                onClick={() => void lancerGeneration()}
                class="rounded-full border border-ink px-6 py-3 text-sm font-medium hover:bg-ink hover:text-paper transition-colors disabled:opacity-60"
              >
                {apercu() ? tr("ia.regenerer") : tr("ia.generer")}
              </button>
              <Show when={apercu()}>
                <button
                  type="button"
                  disabled={ajout() || occupe()}
                  onClick={() => void ajouterAuPanier()}
                  class="rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
                >
                  {ajout() ? "…" : tr("produit.ajouter")}
                </button>
              </Show>
              <button
                type="button"
                disabled={occupe()}
                onClick={reprendreDepart}
                class="text-sm text-ink-soft underline underline-offset-4 hover:text-terracotta transition-colors disabled:opacity-60"
              >
                {tr("ia.recommencer")}
              </button>
            </Show>
          </div>


          <p class="mt-4 text-xs text-ink-soft">
            {tr("ia.poids_max").replace(
              "{n}",
              String(Math.round(POIDS_PHOTO_MAX / (1024 * 1024))),
            )}
          </p>
        </div>
      </div>
    </div>
    </div>
    </div>
      </Show>
    </>
  );
}
