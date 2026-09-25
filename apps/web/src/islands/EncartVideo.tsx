/// <reference lib="dom" />
import { onMount, Show, type JSX } from "solid-js";
import type { SourceVideo } from "@memoryline/types";
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import { assetUrl, type EncartVideoDTO } from "../lib/api.ts";

/**
 * L'encart vidéo explicative du configurateur — DEUX SURFACES, jamais une.
 *
 * 1. `EncartVideo` : la fente posée en tête de l'étape 1. Une façade, un
 *    titre, une ligne, un bouton. Elle ne lit JAMAIS la vidéo elle-même.
 * 2. `LecteurVideo` : la couche par-dessus la fenêtre, ouverte seulement par
 *    un clic délibéré. C'est la seule chose qui fabrique un <iframe> ou un
 *    <video>.
 *
 * Cette séparation n'est pas une élégance : c'est elle qui garantit que
 * l'encart NE CHANGE JAMAIS DE HAUTEUR. Un lecteur qui se déplierait dans le
 * flux déplacerait la cale du bord calculée par Defilement.tsx pendant qu'une
 * cliente fait défiler, et le contenu sauterait sous son doigt — ce que le
 * commentaire Defilement.tsx:410-414 interdit explicitement.
 *
 * Et l'encart ne porte AUCUN `data-item` : cet attribut désigne les CHOIX
 * qu'on coupe de moitié au bord de l'écran pour montrer qu'on peut faire
 * défiler. Un encart marqué deviendrait « l'item coupé » et l'indice ne
 * voudrait plus rien dire.
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

export function EncartVideo(props: {
  video: EncartVideoDTO;
  /** Le tri déjà fait par la fiche produit / l'île. `null` = placeholder. */
  source: SourceVideo;
  langue?: Langue;
  /** Ouvre la couche du lecteur. L'élément sert à rendre le focus ensuite. */
  onLancer: (declencheur: HTMLElement) => void;
}): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  const dispo = () => props.source !== null;

  const titre = () => props.video.titre || tr("cfg.video.titre");
  const texte = () =>
    props.video.texte ||
    (dispo() ? tr("cfg.video.intro") : tr("cfg.video.bientot"));
  const action = () =>
    dispo() ? tr("cfg.video.lancer") : tr("cfg.video.indisponible");

  return (
    <div class="ml-cfg-video-encart">
      {/* UN SEUL contrôle réel : la carte entière EST le bouton. Le « bouton »
          sous le texte est un <span> habillé, pour ne pas doubler la
          tabulation avec deux commandes qui font la même chose. */}
      <button
        type="button"
        class="ml-cfg-video-jouer"
        disabled={!dispo()}
        aria-disabled={dispo() ? undefined : "true"}
        aria-label={`${titre()} — ${action()}`}
        onClick={(e) => props.onLancer(e.currentTarget)}
      >
        <span class="ml-cfg-video-facade-boite">
          <img
            class="ml-cfg-video-facade"
            src={facadeDeLaBoutique(props.video.poster)}
            alt=""
            /* Pas de `loading="lazy"` : la façade EST l'encart. Différée, elle
               laisse un rectangle vide en tête de l'étape 1 — au mieux le
               temps d'un aller-retour, au pire tant que la fenêtre n'a pas
               été touchée. C'est notre SVG de 1,5 ko, ou une vignette de 400
               pixels : il n'y a rien à économiser. */
            decoding="async"
          />
          <span class="ml-cfg-video-pastille" aria-hidden="true">
            ▶
          </span>
        </span>
        <span class="ml-cfg-video-texte">
          <span class="ml-cfg-video-titre">{titre()}</span>
          <span class="ml-cfg-video-ligne">{texte()}</span>
          <span class="ml-cfg-video-action">{action()}</span>
        </span>
      </button>
    </div>
  );
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
