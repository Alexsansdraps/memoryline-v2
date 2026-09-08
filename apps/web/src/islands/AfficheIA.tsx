/// <reference lib="dom" />
import { t, lien, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import {
  createSignal,
  createMemo,
  onCleanup,
  For,
  Show,
  type JSX,
} from "solid-js";
import type { PosterConfig } from "@memoryline/types";
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
        texts: {},
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

  return (
    <div class="mt-8">
      <div class="grid gap-6 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)] items-start">
        {/* ------------------------------ Aperçu ------------------------- */}
        <div>
          <div
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
          <h2 class="text-xl">{tr("ia.titre")}</h2>
          <p class="mt-2 text-sm text-ink-soft">{tr("ia.intro")}</p>

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

          <Show when={chemin()}>
            <p class="mt-2 text-xs text-ink-soft">{tr("ia.regenerer_aide")}</p>
          </Show>

          <p class="mt-4 text-xs text-ink-soft">
            {tr("ia.poids_max").replace(
              "{n}",
              String(Math.round(POIDS_PHOTO_MAX / (1024 * 1024))),
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
