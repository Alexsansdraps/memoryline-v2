/// <reference lib="dom" />
import { onMount, Show, type JSX } from "solid-js";
import type { SourceVideo } from "@memoryline/types";
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import { assetUrl } from "../lib/api.ts";

/**
 * La vidéo explicative du configurateur — la couche qui la lit.
 *
 * La boutique n'a plus d'encart dans l'étape 1 : une petite bulle « Vidéo
 * tuto » dans l'en-tête de la fenêtre (ProductConfigurator.tsx) ouvre
 * `LecteurVideo`, une pop-up par-dessus la fenêtre. C'est la seule chose qui
 * fabrique un <iframe> ou un <video>, et seulement après un clic délibéré.
 *
 * Un lecteur dans le flux de l'étape déplacerait la cale du bord calculée par
 * Defilement.tsx pendant qu'une cliente fait défiler, et le contenu sauterait
 * sous son doigt : la pop-up n'a pas ce défaut.
 */

/**
 * Le visuel d'attente, livré avec le site et servi par la boutique.
 *
 * NE JAMAIS le remplacer par la vignette de YouTube (« img.youtube.com/vi/…
 * »). C'est exactement l'amélioration que quelqu'un ajoutera un jour sans
 * voir qu'elle rompt la promesse faite au bandeau cookies : afficher cette
 * vignette, c'est prévenir YouTube qu'une cliente est là, AVANT qu'elle ait
 * cliqué sur quoi que ce soit.
 */
const VISUEL_ATTENTE = "/video-placeholder.svg";

/**
 * La façade montrée avant le clic : la nôtre, et rien d'autre.
 *
 * Une image téléversée vit sous « /assets/… », donc sur notre origine. Toute
 * autre adresse — une URL collée à la main dans la case, un jour, par
 * mégarde — retombe sur le visuel d'attente : la règle « rien de tiers avant
 * le clic » ne souffre pas d'exception, même bien intentionnée.
 */
function facadeDeLaBoutique(poster: string): string {
  if (!poster.startsWith("/assets/")) return VISUEL_ATTENTE;
  return assetUrl(poster, 400) ?? VISUEL_ATTENTE;
}

/**
 * La couche du lecteur, par-dessus la fenêtre de personnalisation.
 *
 * CE NŒUD N'EXISTE QUE PENDANT LA LECTURE. Tant que la cliente n'a pas
 * cliqué, il n'y a ni iframe, ni <video>, ni preconnect, ni la moindre
 * requête sortante. Le démonter arrête la lecture ET coupe la connexion au
 * tiers : c'est pour cela que l'hôte le monte sous un <Show>, et non en le
 * cachant.
 *
 * Les deux hôtes sont encadrés en amont par `sourceVideo()` :
 * `youtube-nocookie.com` d'un côté, `dnt=1` de l'autre. Le clic autorise à
 * lire une vidéo, pas à être suivie.
 */
export function LecteurVideo(props: {
  source: NonNullable<SourceVideo>;
  /** La façade, réutilisée comme poster du <video> : même image, sans à-coup. */
  poster: string;
  titre: string;
  langue?: Langue;
  onFermer: () => void;
}): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  let croix: HTMLButtonElement | undefined;
  let cadre: HTMLDivElement | undefined;

  // À l'ouverture, le focus va sur la sortie : la première chose qu'on doit
  // pouvoir faire d'une vidéo qu'on n'a pas demandée, c'est la fermer.
  onMount(() => croix?.focus());

  const plein = { width: "100%", height: "100%" } as const;

  return (
    <div
      class="ml-video-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={props.titre}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onFermer();
      }}
    >
      {/* Piège de tabulation minimal, sans bibliothèque : deux sentinelles
          invisibles qui renvoient le focus dans le cadre. La tabulation ne
          peut donc pas repartir dans la fenêtre du dessous, qui est masquée
          par la couche. */}
      <span
        class="ml-video-sentinelle"
        tabindex="0"
        aria-hidden="true"
        onFocus={() => croix?.focus()}
      />
      <div class="ml-video-cadre" ref={cadre} tabindex="-1">
        <button
          type="button"
          class="ml-video-close"
          ref={croix}
          aria-label={tr("cfg.fermer")}
          onClick={props.onFermer}
        >
          ✕
        </button>
        <Show
          when={props.source.genre !== "fichier" ? props.source.embed : null}
        >
          {(embed) => (
            <iframe
              src={embed()}
              title={props.titre}
              allow="autoplay; fullscreen; picture-in-picture"
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen
              loading="lazy"
              style={{ ...plein, border: "0" }}
            />
          )}
        </Show>
        <Show when={props.source.genre === "fichier" ? props.source.src : null}>
          {(src) => (
            <video
              src={assetUrl(src()) ?? undefined}
              poster={props.poster}
              controls
              autoplay
              playsinline
              preload="metadata"
              style={{ ...plein, background: "#000" }}
            />
          )}
        </Show>
      </div>
      <span
        class="ml-video-sentinelle"
        tabindex="0"
        aria-hidden="true"
        onFocus={() => cadre?.focus()}
      />
    </div>
  );
}

/**
 * La façade, exportée pour que l'hôte donne au <video> de la couche EXACTEMENT
 * la même image que celle de l'encart : la vidéo démarre alors sur l'image
 * qu'on vient de cliquer, sans clignotement noir entre les deux.
 */
export function facadeEncart(poster: string): string {
  return facadeDeLaBoutique(poster);
}
