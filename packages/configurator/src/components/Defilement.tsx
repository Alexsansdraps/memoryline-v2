/// <reference lib="dom" />
import {
  createSignal,
  onCleanup,
  onMount,
  Show,
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
 * Là où la RÈGLE DE LA DEMI-RANGÉE s'applique (plus bas dans ce fichier), cet
 * indice est retiré : le fondu recouvrirait justement la moitié de vignette
 * qui, elle, se voit. Il reste sur les étapes qui n'ont pas d'items à couper.
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
 * `indice: false` là où le bord bas tombe déjà au milieu d'un item : le fondu
 * effacerait la demi-vignette qui sert d'indice.
 *
 * `bottom: 0` est un minimum : un conteneur qui défile avec une marge
 * intérieure arrête la barre au bord de cette marge, et c'est l'hôte qui sait
 * de combien la repousser (`.ml-cfg-pied`, cf. global.css du site).
 */
export function BarreActions(props: {
  children: JSX.Element;
  /** Fondu + flèche au-dessus de la barre. Vrai par défaut. */
  indice?: boolean;
}) {
  const [resteDessous, setResteDessous] = createSignal(false);
  let repere: HTMLDivElement | undefined;

  // L'observateur est posé dans tous les cas, même là où l'indice ne paraît
  // pas : `indice` change en cours de route (on entre dans l'éditeur, on en
  // ressort) alors que `onMount` ne s'exécute qu'une fois. Y tester `indice`
  // figeait `resteDessous` à faux pour le reste de la visite, et les étapes
  // « Fond & texte » et « Format » perdaient leur fondu définitivement.
  // C'est le `<Show>` plus bas qui décide de l'afficher ou non.
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
        <Show when={props.indice !== false}>
          <IndiceDefilement
            visible={resteDessous()}
            // Juste au-dessus du trait qui borde la barre : le fondu le
            // recouvrirait, et c'est lui qui sépare les boutons du contenu.
            style={{ bottom: "calc(100% + 1px)" }}
          />
        </Show>
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

/* -------------------------------------------------------------------------- */
/*  La règle de la demi-rangée                                                 */
/* -------------------------------------------------------------------------- */

/**
 * « Il faudrait que le dernier item soit de moitié. »
 *
 * Le fondu et la flèche ne suffisaient pas : on ne voyait toujours pas qu'on
 * pouvait descendre pour habiller son personnage (retour cliente). Ce qui se
 * voit, en revanche, c'est un dessin COUPÉ EN DEUX au ras du bord : une
 * moitié de vignette dit, sans un mot, que la suite est dessous. Le rail des
 * cadres s'en sert déjà (StepFormat, largeurPourApercu).
 *
 * Trois outils, un par sens de lecture :
 *  - {@link hauteurDemiRangee} : la hauteur d'une zone qui défile toute
 *    seule, pour qu'elle s'arrête au milieu d'une rangée (grille des
 *    personnages) ;
 *  - {@link largeurDemiVignette} : la largeur des vignettes d'une galerie
 *    horizontale, pour qu'elle s'arrête au milieu de l'une d'elles ;
 *  - {@link createCaleDuBord} : la cale posée en haut d'une colonne de choix,
 *    qui décale ce qui suit juste assez pour que le bord bas de la FENÊTRE
 *    tombe au milieu d'un item, et non dans une marge.
 *
 * Les items se DÉCLARENT, avec l'attribut `data-item` : le calcul ne devine
 * pas ce qui est un choix (vignette, pastille, ligne de personnage) et ce qui
 * est un titre, une flèche ou une marge.
 */

/**
 * Part visible de l'item coupé. Un filet de deux pixels ne se remarque pas ;
 * un item visible à 95 % a l'air entier — c'était tout le problème.
 *
 * On VISE toujours la moitié. Ces bornes-là disent seulement à partir de quand
 * la coupe se voit assez pour qu'on n'ait pas à déplacer le contenu : un quart
 * de vignette au ras du bord se lit déjà comme coupé, et vaut mieux qu'une
 * cale de quatre-vingt-dix pixels ouverte en haut de la colonne pour gagner
 * les vingt-cinq pour cent qui manquent.
 */
const COUPE_MIN = 0.25;
const COUPE_MAX = 0.75;

/**
 * Cale maximale. Au-delà, le blanc qu'elle ouvre en haut de la colonne se
 * verrait plus que le service rendu : on renonce, et l'écran garde alors le
 * bord bas que la fenêtre lui donne — sans demi-item, et sans fondu non plus,
 * puisque les écrans personnages s'en passent (`indice={false}`).
 *
 * En pratique on ne renonce jamais dans les tailles mesurées (téléphone,
 * tablette, bureau) : les rangées se suivent d'assez près — quarante pixels
 * pour une rangée de pastilles, quatre-vingt-huit pour une de vignettes —
 * pour qu'il s'en trouve toujours une à couper à moins de soixante-douze
 * pixels de décalage.
 */
const CALE_MAX = 72;

/**
 * En dessous de quoi il n'y a rien à annoncer : quelques pixels de marge qui
 * dépassent ne sont pas des choix cachés, et déplacer le contenu pour les
 * montrer reviendrait à creuser un trou pour rien.
 */
const RESTE_MINI = 24;

/** Une rangée d'items : sa place dans le contenu, sa hauteur, ce qui la rogne. */
interface Rangee {
  /** Distance au haut du contenu qui défile. */
  haut: number;
  hauteur: number;
  /**
   * Jusqu'où cette rangée reste visible : le bas d'une zone qui défile
   * d'elle-même au milieu du contenu (la grille des personnages) rogne ce
   * qu'il y a dessous. `Infinity` quand rien ne la rogne.
   */
  limite: number;
}

/** Le premier parent qui défile verticalement, ou rien. */
function ancetreDefilant(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const debord = getComputedStyle(p).overflowY;
    if (
      (debord === "auto" || debord === "scroll" || debord === "overlay") &&
      p.scrollHeight > p.clientHeight + 1
    )
      return p;
  }
  return null;
}

/**
 * Les rangées d'items d'une zone, de haut en bas.
 *
 * Deux items au même niveau font UNE rangée : les quatre pastilles d'une
 * couleur, les six personnages d'une ligne de la grille. La tolérance de
 * quelques pixels absorbe les positions fractionnaires d'une fenêtre qui ne
 * tombe pas sur un pixel entier.
 */
function rangeesDe(
  zone: HTMLElement,
  /** Haut du contenu qui défile, en coordonnées de l'écran. */
  origine: number,
  /** Ce que la zone elle-même rogne, le cas échéant. */
  limiteDeLItem: (el: HTMLElement) => number,
): Rangee[] {
  const rangees: Rangee[] = [];
  const items = Array.from(zone.querySelectorAll<HTMLElement>("[data-item]"))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((o) => o.r.height > 1)
    .sort((a, b) => a.r.top - b.r.top);
  for (const { el, r } of items) {
    const haut = r.top - origine;
    const derniere = rangees[rangees.length - 1];
    if (derniere && haut - derniere.haut < 4) {
      derniere.hauteur = Math.max(derniere.hauteur, r.height);
      derniere.limite = Math.min(derniere.limite, limiteDeLItem(el));
    } else {
      rangees.push({ haut, hauteur: r.height, limite: limiteDeLItem(el) });
    }
  }
  return rangees;
}

/**
 * Hauteur à donner à une zone qui défile pour qu'elle se termine AU MILIEU
 * d'une rangée : « k rangées entières, et une moitié ».
 *
 * Le plafond vient de la feuille de style (`max-height`) : c'est la boutique
 * qui décide de la place que la grille peut prendre, ce calcul-ci ne fait que
 * choisir, en dessous, la hauteur qui coupe net.
 *
 * Rend `null` quand tout tient — rien n'est caché, il n'y a rien à annoncer —
 * ou qu'aucune hauteur ne laisse au moins une rangée entière au-dessus de la
 * moitié : une zone qui ne montrerait qu'une demi-rangée ne se lit plus.
 */
function hauteurDemiRangee(zone: HTMLElement): number | null {
  const plafond = Number.parseFloat(getComputedStyle(zone).maxHeight);
  if (!Number.isFinite(plafond) || plafond <= 0) return null;
  const origine = zone.getBoundingClientRect().top - zone.scrollTop;
  const rangees = rangeesDe(zone, origine, () => Number.POSITIVE_INFINITY);
  if (rangees.length < 2) return null;
  const derniere = rangees[rangees.length - 1]!;
  if (derniere.haut + derniere.hauteur <= plafond + 1) return null;
  for (let i = rangees.length - 1; i >= 1; i--) {
    const r = rangees[i]!;
    const hauteur = r.haut + r.hauteur / 2;
    if (hauteur <= plafond) return hauteur;
  }
  return null;
}

/**
 * Pose la règle de la demi-rangée sur une zone qui défile : à brancher en
 * `ref`. On remesure quand la zone change de taille et quand son contenu
 * change — passer des « Femmes » aux « Animaux » remplace les vignettes sans
 * que la grille, plafonnée, change de taille.
 */
export function brancherDemiRangee(zone: HTMLElement): void {
  let image = 0;
  const mesurer = () => {
    cancelAnimationFrame(image);
    // Une mesure par image au plus : les observateurs en envoient davantage.
    image = requestAnimationFrame(() => {
      const hauteur = hauteurDemiRangee(zone);
      const voulue = hauteur === null ? "" : `${Math.round(hauteur)}px`;
      // On n'écrit que si ça change : écrire relance l'observateur de taille.
      if (zone.style.height !== voulue) zone.style.height = voulue;
    });
  };
  mesurer();
  const taille =
    typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(mesurer);
  taille?.observe(zone);
  const contenu = new MutationObserver(mesurer);
  contenu.observe(zone, { childList: true });
  // Le plafond est en `vh` : une fenêtre qui grandit ne change pas la hauteur
  // qu'on a posée, et l'observateur de taille ne dirait rien.
  window.addEventListener("resize", mesurer);
  onCleanup(() => {
    cancelAnimationFrame(image);
    taille?.disconnect();
    contenu.disconnect();
    window.removeEventListener("resize", mesurer);
  });
}

/**
 * Largeur des vignettes d'une galerie horizontale pour qu'elle se termine au
 * milieu de l'une d'elles : « k vignettes entières, et une moitié ».
 *
 * Même raisonnement que le rail des cadres (StepFormat) : la largeur décroît
 * quand `k` grandit, le premier `k` acceptable donne donc la vignette la plus
 * large. Sous le plancher, on renonce et on garde la largeur normale : des
 * vignettes minuscules coûteraient plus que la moitié ne rapporte.
 */
export function largeurDemiVignette(
  dispo: number,
  nb: number,
  espace: number,
  mini: number,
  maxi: number,
): number {
  if (dispo <= 0 || nb <= 0) return maxi;
  // Tout tient : la galerie ne défile pas, rien à couper.
  if (nb * maxi + (nb - 1) * espace <= dispo) return maxi;
  for (let k = 1; k < nb; k++) {
    const largeur = (dispo - k * espace) / (k + 0.5);
    if (largeur > maxi) continue;
    return largeur >= mini ? largeur : maxi;
  }
  return maxi;
}

/**
 * La cale du bord bas : de combien décaler une colonne de choix pour que le
 * bord bas de ce qu'on voit tombe au milieu d'un item.
 *
 * Le bord bas, c'est le haut de la barre d'actions — elle est opaque et
 * collée en bas, c'est là que s'arrête ce qu'on lit. Rien ne dit que la
 * fenêtre du client s'arrête sur une vignette : elle tombe le plus souvent
 * dans une marge, entre deux rangées, et alors la page a l'air finie. Une
 * cale de quelques dizaines de pixels en haut de la colonne pousse la suite
 * d'autant, et le bord retombe sur un item, coupé.
 *
 * La mesure se fait COMME SI l'on était en haut de la page, jamais à la
 * position du moment : une cale qui changerait pendant qu'on fait défiler
 * ferait sauter le contenu sous le doigt. Elle se recalcule quand la fenêtre
 * change de taille et quand les choix changent (un personnage à quatre
 * galeries, puis un à une seule).
 */
export function createCaleDuBord(): {
  cale: () => number;
  brancher: (el: HTMLElement) => void;
} {
  const [cale, setCale] = createSignal(0);
  let debrancher: (() => void) | undefined;

  const brancher = (colonne: HTMLElement) => {
    // La colonne peut être remplacée (on passe de la liste à l'éditeur) :
    // on lâche les observateurs de la précédente avant d'en poser d'autres.
    debrancher?.();
    let image = 0;
    const mesurer = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => setCale(caleDuBord(colonne, cale())));
    };
    mesurer();
    const taille =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(mesurer);
    taille?.observe(colonne);
    const contenu = new MutationObserver(mesurer);
    contenu.observe(colonne, { childList: true, subtree: true });
    // La hauteur de la fenêtre décide du bord bas : elle change sans que la
    // colonne, elle, change de taille.
    window.addEventListener("resize", mesurer);
    debrancher = () => {
      cancelAnimationFrame(image);
      taille?.disconnect();
      contenu.disconnect();
      window.removeEventListener("resize", mesurer);
    };
    onCleanup(() => debrancher?.());
  };

  return { cale, brancher };
}

/** Le calcul de {@link createCaleDuBord}, à cale posée (`caleActuelle`). */
function caleDuBord(colonne: HTMLElement, caleActuelle: number): number {
  const defilante = ancetreDefilant(colonne);
  if (!defilante) return 0;
  // Sans la cale, resterait-il vraiment des choix dessous ? Si tout tient, la
  // question ne se pose pas — et la cale d'avant s'en va.
  if (
    defilante.scrollHeight - caleActuelle - defilante.clientHeight <
    RESTE_MINI
  )
    return 0;

  const cadre = defilante.getBoundingClientRect();
  const barre = defilante.querySelector<HTMLElement>(".ml-cfg-pied");
  const bordEcran = barre ? barre.getBoundingClientRect().top : cadre.bottom;
  // Tout en coordonnées du CONTENU, vu du haut de la page (défilement nul).
  const bord = bordEcran - cadre.top;
  const origine = cadre.top - defilante.scrollTop;
  const limiteDeLItem = (el: HTMLElement): number => {
    const rogneuse = ancetreDefilant(el);
    if (!rogneuse || rogneuse === defilante) return Number.POSITIVE_INFINITY;
    const r = rogneuse.getBoundingClientRect();
    return r.top - origine + rogneuse.clientHeight - caleActuelle;
  };

  let meilleure: number | null = null;
  for (const r of rangeesDe(colonne, origine, limiteDeLItem)) {
    // Sans la cale déjà posée : le calcul repart toujours de zéro, sinon il
    // dériverait d'une mesure à l'autre.
    const haut = r.haut - caleActuelle;
    // La cale qui coupe l'item par la MOITIÉ, et celles qui le coupent encore
    // assez franchement pour que ça se voie.
    const moitie = bord - haut - r.hauteur / 2;
    const mini = bord - haut - COUPE_MAX * r.hauteur;
    const maxi = bord - haut - COUPE_MIN * r.hauteur;
    // Le plancher : pas de cale négative, et pas de bord cherché là où une
    // zone qui défile a déjà rogné l'item.
    const plancher = Math.max(0, mini, bord - r.limite);
    if (plancher > maxi) continue;
    // La moitié si elle est atteignable, sinon la cale la plus petite qui
    // reste dans les clous.
    const c = Math.min(Math.max(moitie, plancher), maxi);
    if (c > CALE_MAX) continue;
    if (meilleure === null || c < meilleure) meilleure = c;
  }
  return meilleure === null ? 0 : Math.round(meilleure);
}
