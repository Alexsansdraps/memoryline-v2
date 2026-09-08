/// <reference lib="dom" />
import { createUniqueId } from "solid-js";

/**
 * Filigrane « MEMORY LINE » posé PAR-DESSUS l'affiche.
 *
 * Il est DANS l'aperçu, pas autour : une capture d'écran de l'affiche emporte
 * le filigrane avec elle. C'est toute la raison d'être de cette couche — un
 * bandeau posé à côté de l'image ne protégerait rien.
 *
 * Deux passes de texte, une sombre décalée puis une claire par-dessus : le
 * motif reste lisible aussi bien sur un ciel blanc que sur une nuit noire,
 * sans qu'on ait à connaître le fond choisi par le client.
 *
 * Le repère du SVG suit l'affiche (viewBox au ratio A4 portrait) : le motif
 * garde la même densité sur la vignette de 80 px du panier comme sur l'aperçu
 * plein écran du configurateur.
 */
export function Filigrane() {
  // Un motif SVG est référencé par id : deux aperçus sur la même page (le
  // panier en aligne un par ligne) doivent avoir des ids distincts.
  const idMotif = `ml-filigrane-${createUniqueId()}`;

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
        <pattern
          id={idMotif}
          width="430"
          height="260"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-30)"
        >
          <text
            x="0"
            y="60"
            font-family="Inter, system-ui, sans-serif"
            font-size="42"
            font-weight="700"
            letter-spacing="7"
            fill="#000000"
            opacity="0.20"
            transform="translate(2 2)"
          >
            MEMORY LINE
          </text>
          <text
            x="0"
            y="60"
            font-family="Inter, system-ui, sans-serif"
            font-size="42"
            font-weight="700"
            letter-spacing="7"
            fill="#ffffff"
            opacity="0.55"
          >
            MEMORY LINE
          </text>
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
