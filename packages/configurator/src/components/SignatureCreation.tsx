/// <reference lib="dom" />

/**
 * La signature de la boutique, posée en bas à droite de l'affiche.
 *
 * C'est la MÊME que celle du fichier d'impression (apps/api/src/pdf.ts,
 * `signaturePosee`), au même endroit et à la même taille. L'aperçu est ce que
 * la cliente valide : une signature qui n'apparaîtrait qu'à l'impression se
 * découvrirait une fois l'affiche livrée, et une signature plus grosse ou plus
 * haute à l'écran qu'au papier se découvrirait de la même façon.
 *
 * LE CALCUL EST CELUI DU PDF, TRADUIT EN CSS. L'impression pose une image de
 * `largeur × petitCôté` de large, à `marge × petitCôté` des bords droit et
 * bas — le PETIT côté, pour qu'une affiche en paysage ne soit pas signée plus
 * gros qu'un portrait. `container-type: size` fait du calque l'unité de
 * mesure : `100cqmin` vaut alors exactement le petit côté de l'affiche, et la
 * même fraction donne la même signature sur la vignette de 80 pixels du
 * panier comme sur l'aperçu plein écran du configurateur.
 *
 * UN SEUL COMPOSANT POUR TOUS LES ÉCRANS (configurateur, panier, commande,
 * affiche tirée d'une photo) : trois calques recopiés auraient fini par
 * diverger, et c'est précisément ce qu'on cherche à empêcher ici.
 *
 * Décoratif pour un lecteur d'écran : c'est le logo de la boutique, déjà lu
 * dans l'en-tête de chaque page, et il ne dit rien de l'affiche composée.
 * Rien à traduire, donc, dans les cinq langues du site.
 */
import { Show } from "solid-js";

/**
 * La signature telle que l'aperçu la dessine.
 *
 * Les deux tailles sont des FRACTIONS du petit côté de l'affiche (0,12 =
 * 12 %), comme les réglages du back-office les donnent à l'impression. Côté
 * boutique, c'est `signatureDesCreations()` (apps/web/src/lib/signature.ts)
 * qui lit les réglages et remplit cet objet.
 */
export interface SignatureApercu {
  /** Adresse de l'image, prête pour le navigateur. */
  url: string;
  /** Largeur, en fraction du petit côté de l'affiche. */
  largeur: number;
  /** Marge depuis les bords droit et bas, même unité. */
  marge: number;
  /** Opacité, de 0 à 1. */
  opacite: number;
}

export function SignatureCreation(props: {
  /**
   * Absente ou nulle : la boutique a éteint l'interrupteur « Signer chaque
   * création », et rien n'est dessiné — pas même un calque vide. Le reste de
   * l'affiche ne bouge pas d'un pixel pour autant : ce calque est posé par
   * -dessus, en absolu, il ne prend aucune place dans la mise en page.
   */
  signature?: SignatureApercu | null;
}) {
  return (
    <Show when={props.signature}>
      {(s) => (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "0",
            // L'unité de mesure de la signature : sans cette ligne, `cqmin`
            // irait chercher un conteneur plus haut dans la page — la colonne
            // du panier, la fenêtre du configurateur — et la signature
            // changerait de taille d'un écran à l'autre.
            "container-type": "size",
            // Le calque couvre toute l'affiche : il ne doit pas intercepter
            // le doigt qui vient déplacer un personnage dessous.
            "pointer-events": "none",
            // Au-dessus des textes de l'affiche (z=200), comme à l'impression
            // où la signature est la dernière couche posée ; sous le filigrane
            // (z=300), qui doit rester au-dessus de tout ce qu'il protège.
            "z-index": "250",
          }}
        >
          <img
            src={s().url}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              right: `calc(${s().marge} * 100cqmin)`,
              bottom: `calc(${s().marge} * 100cqmin)`,
              width: `calc(${s().largeur} * 100cqmin)`,
              // L'impression redimensionne par la LARGEUR et laisse la hauteur
              // suivre : une signature écrasée ne serait plus le logo.
              height: "auto",
              opacity: String(s().opacite),
              "user-select": "none",
            }}
          />
        </div>
      )}
    </Show>
  );
}
