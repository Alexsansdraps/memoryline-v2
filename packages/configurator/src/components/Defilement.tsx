/// <reference lib="dom" />
import {
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

/**
 * Indice « la suite est plus bas » : un fondu et une petite flèche posés au
 * bas d'une zone qui défile, qui s'effacent une fois le bas atteint.
 *
 * Sur une tablette ou un téléphone, la barre de défilement est dessinée
 * PAR-DESSUS le contenu et n'apparaît qu'au premier geste : ni Safari sur iPad
 * ni Chrome sur Android ne laissent une page la forcer visible, quel que soit
 * le style qu'on lui donne. On choisissait son personnage, rien ne disait que
 * les vêtements, les cheveux et les accessoires attendaient dessous, et on
 * validait sans les avoir vus (retour cliente).
 *
 * Il ne capte aucun toucher (`pointer-events: none`) : le doigt posé sur la
 * vignette à demi couverte par le fondu la choisit bel et bien. Le fondu et le
 * petit mouvement de la flèche sont confiés à la feuille de style de l'hôte
 * (`.ml-cfg-indice`), qui les coupe quand l'appareil demande moins
 * d'animations : sans elle, l'indice apparaît et disparaît d'un coup.
 */
export function IndiceDefilement(props: {
  visible: boolean;
  /** Placement dans le parent positionné : au-dessus d'une barre, au fond d'une zone. */
  style: JSX.CSSProperties;
  /** Couleur du fond sur lequel le contenu s'efface. */
  fond?: string;
}) {
  const fond = () => props.fond ?? "#fafafa";
  return (
    <div
      class="ml-cfg-indice"
      classList={{ "est-visible": props.visible }}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "0",
        right: "0",
        height: "44px",
        display: "flex",
        "align-items": "flex-end",
        "justify-content": "center",
        "padding-bottom": "6px",
        "box-sizing": "border-box",
        // Le fondu part d'une version TRANSPARENTE de la même couleur : un
        // `transparent` nu tire vers le gris sur les anciens Safari.
        background: `linear-gradient(to bottom, ${transparente(fond())}, ${fond()} 85%)`,
        "pointer-events": "none",
        opacity: props.visible ? "1" : "0",
        ...props.style,
      }}
    >
      <span
        class="ml-cfg-indice-fleche"
        style={{
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          width: "26px",
          height: "26px",
          "border-radius": "9999px",
          background: "#ffffff",
          border: "1px solid #d1d5db",
          "box-shadow": "0 1px 4px rgba(17, 24, 39, 0.18)",
          color: "#374151",
        }}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3.5 6 8 10.5 12.5 6" />
        </svg>
      </span>
    </div>
  );
}

/** `#rrggbb` → la même couleur, entièrement transparente. */
function transparente(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "rgba(255, 255, 255, 0)";
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, 0)`;
}

/**
 * Barre d'actions du bas — « Retour » à gauche, l'action qui fait avancer à
 * droite —, collée au bas de la fenêtre pendant qu'on fait défiler.
 *
 * Collée, parce qu'une fenêtre de personnalisation est longue : il fallait
 * descendre tout en bas pour trouver « Valider mon personnage », et, pendant
 * ce temps, « Retour » restait en haut, où l'aperçu du personnage finissait
 * par le recouvrir sur téléphone et tablette.
 *
 * Elle porte aussi l'indice de défilement, juste au-dessus d'elle : c'est là
 * que finit ce qu'on voit. Pour savoir s'il reste du contenu dessous, un repère
 * invisible suit la barre dans le flux : tant que la barre est collée, sa
 * vraie place dans la page — et le repère avec elle — reste sous le bord de
 * la fenêtre, et le repère n'entre dans l'écran qu'une fois le bas atteint.
 * Un observateur d'intersection le guette ; il tient compte de toutes les
 * zones qui défilent autour, sans avoir à les connaître.
 *
 * `bottom: 0` est un minimum : un conteneur qui défile avec une marge
 * intérieure arrête la barre au bord de cette marge, et c'est l'hôte qui sait
 * de combien la repousser (`.ml-cfg-pied`, cf. global.css du site).
 */
export function BarreActions(props: { children: JSX.Element }) {
  const [resteDessous, setResteDessous] = createSignal(false);
  let repere: HTMLDivElement | undefined;

  onMount(() => {
    if (!repere || typeof IntersectionObserver === "undefined") return;
    const observateur = new IntersectionObserver((entrees) => {
      const derniere = entrees[entrees.length - 1];
      if (derniere) setResteDessous(!derniere.isIntersecting);
    });
    observateur.observe(repere);
    onCleanup(() => observateur.disconnect());
  });

  return (
    <>
      <div
        class="ml-cfg-pied"
        style={{
          position: "sticky",
          bottom: "0",
          // Au-dessus de l'aperçu collant du personnage (z-index 2) : sur un
          // écran très court, les deux se rejoignent.
          "z-index": "3",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          gap: "12px",
          "margin-top": "18px",
          padding: "12px 0",
          "border-top": "1px solid #e5e7eb",
          background: "#fafafa",
        }}
      >
        <IndiceDefilement
          visible={resteDessous()}
          // Juste au-dessus du trait qui borde la barre : le fondu le
          // recouvrirait, et c'est lui qui sépare les boutons du contenu.
          style={{ bottom: "calc(100% + 1px)" }}
        />
        {props.children}
      </div>
      <div
        ref={repere}
        aria-hidden="true"
        style={{ height: "1px", "margin-top": "-1px" }}
      />
    </>
  );
}

/**
 * Vrai tant qu'une zone qui défile d'elle-même cache encore du contenu sous
 * son bord bas — la grille des personnages, par exemple.
 *
 * On remesure au défilement, quand la zone change de taille, et quand son
 * contenu change : passer des « Femmes » aux « Animaux » remplace les
 * vignettes sans que la grille, plafonnée en hauteur, change de taille.
 */
export function createResteDessous(
  zone: () => HTMLElement | undefined,
): () => boolean {
  const [reste, setReste] = createSignal(false);
  onMount(() => {
    const el = zone();
    if (!el) return;
    let image = 0;
    const mesurer = () => {
      cancelAnimationFrame(image);
      // Une mesure par image au plus : le défilement envoie bien plus
      // d'événements que l'écran n'affiche d'images.
      image = requestAnimationFrame(() =>
        setReste(el.scrollHeight - el.scrollTop - el.clientHeight > 2),
      );
    };
    mesurer();
    el.addEventListener("scroll", mesurer, { passive: true });
    const taille =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(mesurer);
    taille?.observe(el);
    const contenu = new MutationObserver(mesurer);
    contenu.observe(el, { childList: true });
    onCleanup(() => {
      cancelAnimationFrame(image);
      el.removeEventListener("scroll", mesurer);
      taille?.disconnect();
      contenu.disconnect();
    });
  });
  return reste;
}
