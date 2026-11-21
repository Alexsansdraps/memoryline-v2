/// <reference lib="dom" />
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { t, LANGUE_DEFAUT, type CleUi, type Langue } from "../i18n/utils.ts";
import {
  ErreurEnvoiTelephone,
  envoyerPhotoTelephone,
  verifierCodeRelais,
  type EchecEnvoiTelephone,
  type OrigineRelais,
} from "../lib/ia.ts";

/**
 * La page du téléphone : le client a scanné le QR code de la tablette du
 * stand, ou tapé l'adresse courte. Un seul geste à faire — prendre ou choisir
 * une photo — et elle part vers la tablette.
 *
 * Rien d'autre sur cette page : ni prix, ni menu, ni panier. Le client est
 * debout devant un stand, son téléphone dans une main ; tout ce qui n'est pas
 * le bouton le détourne de ce qu'il est venu faire.
 *
 * Depuis le 21/11, le code peut aussi venir d'un écran du site (un
 * ordinateur, le plus souvent). L'API dit d'où vient le relais en vérifiant
 * le code : les phrases parlent alors de « l'écran où vous créez votre
 * affiche », et plus de la tablette ni du stand. Tant qu'on ne le sait pas
 * (code inconnu, API d'avant le 21/11), ce sont les phrases du stand.
 */

type Etat =
  | "verification"
  | "pret"
  | "preparation"
  | "envoi"
  | "envoye"
  | "inconnu"
  | "expire"
  | "injoignable";

export default function EnvoiPhotoTelephone(props: {
  langue?: Langue;
  code: string;
}): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  /** D'où vient le relais ; inconnue tant que l'API ne l'a pas dit. */
  const [origine, setOrigine] = createSignal<OrigineRelais | undefined>();
  /** La phrase du site pour un relais du site, celle du stand sinon. */
  const trOrigine = (cle: CleUi, cleSite: CleUi) => tr(origine() === "site" ? cleSite : cle);

  const [etat, setEtat] = createSignal<Etat>("verification");
  const [pourcent, setPourcent] = createSignal(0);
  const [erreur, setErreur] = createSignal<string | null>(null);
  /** La vignette de la photo choisie : le client voit que c'est la bonne. */
  const [vignette, setVignette] = createSignal<string | null>(null);
  /**
   * Le rang de la dernière photo partie sur ce code. La première s'affiche
   * d'elle-même sur la tablette ; une fois celle-ci reçue, la tablette cesse
   * d'écouter, et la suivante attend que le stand la remette à l'écoute : le
   * message le dit. Le rang vient du serveur, pour rester juste après un
   * rechargement de la page ; à défaut, on compte ici.
   */
  const [envoyees, setEnvoyees] = createSignal(0);

  function changerVignette(url: string | null) {
    const ancienne = vignette();
    if (ancienne) URL.revokeObjectURL(ancienne);
    setVignette(url);
  }
  onCleanup(() => changerVignette(null));

  /**
   * Le code est vérifié DÈS L'OUVERTURE : un code expiré doit se dire avant
   * que le client ait fouillé ses albums, pas après.
   */
  onMount(async () => {
    const { etat: reponse, origine: venue } = await verifierCodeRelais(props.code);
    setOrigine(venue);
    if (reponse === "valide") setEtat("pret");
    else if (reponse === "inconnu" || reponse === "expire") setEtat(reponse);
    else {
      // Trop d'essais ou pas de réseau : le bouton reste proposé. L'envoi
      // dira lui-même, au besoin, ce qui ne va pas.
      setErreur(tr(reponse === "rafale" ? "photo.err.rafale" : "photo.err.reseau"));
      setEtat("pret");
    }
  });

  function messageDe(cause: EchecEnvoiTelephone): string {
    switch (cause) {
      case "format":
        return tr("ia.err.format");
      case "trop_lourde":
        return tr("ia.err.trop_lourde");
      case "rafale":
        return tr("photo.err.rafale");
      default:
        return tr("photo.err.reseau");
    }
  }

  async function envoyer(fichier: File) {
    setErreur(null);
    changerVignette(URL.createObjectURL(fichier));
    setPourcent(0);
    try {
      const rang = await envoyerPhotoTelephone(props.code, fichier, (etape, p) => {
        setEtat(etape);
        setPourcent(p);
      });
      setEnvoyees((n) => Math.max(n + 1, rang));
      setEtat("envoye");
    } catch (e) {
      const cause = e instanceof ErreurEnvoiTelephone ? e.code : "reseau";
      // La vignette part avec l'échec : laissée là, elle ferait croire que
      // cette photo-là est arrivée — ou montrerait une image cassée.
      changerVignette(null);
      // Le code est mort entre-temps (la tablette a annulé, ou le quart
      // d'heure est passé) : plus rien à proposer ici, seulement la marche à
      // suivre.
      if (cause === "inconnu" || cause === "expire") {
        setEtat(cause);
        return;
      }
      setErreur(messageDe(cause));
      setEtat("pret");
    }
  }

  const occupe = () => etat() === "preparation" || etat() === "envoi";
  const choixPossible = () => etat() === "pret" || etat() === "envoye";

  return (
    <div class="mt-8 flex flex-1 flex-col">
      <h1 class="text-center text-3xl">{tr("photo.titre")}</h1>

      <Show when={etat() === "verification"}>
        <p class="mt-8 flex items-center justify-center text-ink-soft" aria-live="polite">
          <span class="ml-spinner mr-3" aria-hidden="true" />
          {tr("photo.verification")}
        </p>
      </Show>

      <Show when={etat() === "inconnu" || etat() === "expire"}>
        <p role="alert" class="mt-8 bg-terracotta/10 px-5 py-4 text-center text-terracotta-deep">
          {etat() === "expire"
            ? trOrigine("photo.code_expire", "photo.code_expire_site")
            : tr("photo.code_inconnu")}
        </p>
      </Show>

      <Show when={etat() !== "verification" && etat() !== "inconnu" && etat() !== "expire"}>
        <Show when={etat() !== "envoye"}>
          <p class="mt-3 text-center text-ink-soft">
            {trOrigine("photo.intro", "photo.intro_site")}
          </p>
        </Show>

        <Show when={vignette()}>
          <div class="relative mx-auto mt-6 w-full max-w-xs overflow-hidden border border-ink/10 bg-paper-deep">
            <img
              src={vignette()!}
              alt={tr("photo.apercu_alt")}
              class={`block max-h-72 w-full object-contain ${occupe() ? "opacity-60" : ""}`}
            />
            <Show when={etat() === "envoye"}>
              <span
                aria-hidden="true"
                class="absolute right-2 top-2 flex h-9 w-9 items-center justify-center bg-ink text-lg text-paper"
              >
                ✓
              </span>
            </Show>
          </div>
        </Show>

        {/* Où en est l'envoi : une barre qui avance retient de réessayer
            pendant que la photo monte. */}
        <Show when={occupe()}>
          <div class="mt-6" aria-live="polite">
            <p class="text-center font-medium">
              {etat() === "preparation"
                ? tr("photo.preparation")
                : tr("photo.envoi").replace("{pourcent}", String(pourcent()))}
            </p>
            <div class="mt-3 h-2 w-full bg-ink/10">
              <div
                class="h-full bg-ink transition-[width] duration-200"
                style={{ width: `${etat() === "preparation" ? 3 : Math.max(3, pourcent())}%` }}
              />
            </div>
          </div>
        </Show>

        <Show when={etat() === "envoye"}>
          <p class="mt-6 text-center text-2xl" role="status">
            {envoyees() > 1
              ? trOrigine("photo.envoyee_autre", "photo.envoyee_autre_site")
              : trOrigine("photo.envoyee", "photo.envoyee_site")}
          </p>
        </Show>

        <Show when={erreur()}>
          <p role="alert" class="mt-6 bg-terracotta/10 px-5 py-4 text-center text-terracotta-deep">
            {erreur()}
          </p>
        </Show>

        {/* UN bouton, grand, JUSTE SOUS LE TEXTE (20/11, Alexandra : « le
            bouton est trop bas, il faut le mettre juste en dessous du
            texte ») : tout en bas de l'écran, sous le pouce, on le cherchait.
            `image/*` sans `capture` : le téléphone propose lui-même l'appareil
            photo OU la galerie — la photo à mettre en affiche est le plus
            souvent déjà prise, pendant les vacances. */}
        <Show when={choixPossible()}>
          <div class="mt-6">
            <label
              class={`flex w-full cursor-pointer items-center justify-center gap-3 px-6 py-5 text-center text-lg font-medium transition-colors ${
                etat() === "envoye"
                  ? "border-2 border-ink hover:bg-ink hover:text-paper"
                  : "bg-ink text-paper hover:bg-ink/85"
              }`}
            >
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  // Remise à zéro : renvoyer LA MÊME photo doit fonctionner.
                  e.currentTarget.value = "";
                  if (f) void envoyer(f);
                }}
              />
              {etat() === "envoye" ? tr("photo.autre") : tr("photo.choisir")}
            </label>
            <Show when={etat() === "envoye"}>
              <p class="mt-2 text-center text-sm text-ink-soft">
                {trOrigine("photo.autre_aide", "photo.autre_aide_site")}
              </p>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
