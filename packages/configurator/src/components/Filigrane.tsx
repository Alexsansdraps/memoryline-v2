/// <reference lib="dom" />
import { createUniqueId } from "solid-js";

/**
 * Filigrane posé PAR-DESSUS l'affiche : le logo de la boutique, en blanc,
 * répété en diagonale.
 *
 * Il est DANS l'aperçu, pas autour : une capture d'écran de l'affiche emporte
 * le filigrane avec elle. C'est toute la raison d'être de cette couche — un
 * bandeau posé à côté de l'image ne protégerait rien.
 *
 * Le logo est une silhouette blanche (logo-filigrane.png, la même image que
 * celle que le serveur brûle dans les aperçus IA — un seul fichier, un seul
 * rendu). Un blanc seul disparaîtrait sur un ciel de neige : une ombre sombre
 * très légère, décalée d'un rien, le garde lisible sur un fond clair sans
 * peser sur un fond de nuit.
 *
 * Le repère du SVG suit l'affiche (viewBox au ratio A4 portrait) : le motif
 * garde la même densité sur la vignette de 80 px du panier comme sur l'aperçu
 * plein écran du configurateur.
 */

/** Chemin public du logo, servi par le site depuis apps/web/public. */
const LOGO_FILIGRANE = "/logo-filigrane.png";

/** Le logo fait 500×222 : on garde son rapport. */
const LOGO_LARGEUR = 260;
const LOGO_HAUTEUR = Math.round((LOGO_LARGEUR * 222) / 500);

export function Filigrane() {
  // Un motif SVG est référencé par id : deux aperçus sur la même page (le
  // panier en aligne un par ligne) doivent avoir des ids distincts.
  const uid = createUniqueId();
  const idMotif = `ml-filigrane-${uid}`;
  const idOmbre = `ml-filigrane-ombre-${uid}`;

  return (
    <svg
      viewBox="0 0 1000 1414"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        "pointer-events": "none",
        "user-select": "none",
        // Au-dessus de TOUTES les couches de l'affiche, textes compris (z=200).
        "z-index": "300",
      }}
    >
      <defs>
        {/* Rend la silhouette blanche noire, alpha conservé : c'est l'ombre. */}
        <filter id={idOmbre} color-interpolation-filters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
          />
        </filter>
        <pattern
          id={idMotif}
          width="420"
          height="250"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-30)"
        >
          <image
            href={LOGO_FILIGRANE}
            x="2"
            y="2"
            width={LOGO_LARGEUR}
            height={LOGO_HAUTEUR}
            opacity="0.16"
            filter={`url(#${idOmbre})`}
          />
          <image
            href={LOGO_FILIGRANE}
            x="0"
            y="0"
            width={LOGO_LARGEUR}
            height={LOGO_HAUTEUR}
            opacity="0.22"
          />
        </pattern>
      </defs>
      {/* Le rectangle déborde largement : une fois le motif tourné de 30°, un
          rectangle à la taille exacte laissait les coins nus. */}
      <rect
        x="-400"
        y="-400"
        width="1800"
        height="2214"
        fill={`url(#${idMotif})`}
      />
    </svg>
  );
}
