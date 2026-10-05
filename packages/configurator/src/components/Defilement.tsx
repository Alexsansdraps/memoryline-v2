/// <reference lib="dom" />
import {
  createEffect,
  createSignal,
  createUniqueId,
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
/*  Le sommaire des réglages : y descendre, et savoir où l'on est              */
/* -------------------------------------------------------------------------- */

/*
 * Il y avait ici une bulle « Personnaliser ce personnage ↓ », posée au-dessus
 * de la barre du bas, qui sautillait à chaque personnage choisi. Elle n'a pas
 * suffi (retour cliente, octobre 2026), et le sommaire des réglages, à côté de
 * l'aperçu du personnage (CharacterEditor), l'a remplacée : il dit QUOI se
 * règle, pas seulement qu'il y a quelque chose, et il reste à l'écran. Gardée
 * à côté de lui, la bulle répétait les mêmes mots une troisième fois sur
 * l'écran d'arrivée — sommaire, bulle, titre des réglages au ras de la barre —
 * et cachait, sur un petit téléphone (320 × 640), la seule rangée de
 * personnages encore visible.
 *
 * Ce qui en reste sert au sommaire : descendre jusqu'à un titre, le focus
 * avec, et le même respect des animations réduites.
 */

/** Écart laissé au-dessus du titre visé, une fois descendu. */
const MARGE_ARRIVEE = 12;

/** L'appareil demande moins d'animations. */
export function moinsDAnimations(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Où mène un défilement. */
export interface Destination {
  /** La zone qui défile, ou le document quand c'est la page entière. */
  zone: HTMLElement | Document;
  /** La position visée, ramenée dans ce que la zone peut faire défiler. */
  but: number;
}

/** Position de défilement d'une zone, ou de la page pour le document. */
function position(zone: HTMLElement | Document): number {
  return zone === document ? window.scrollY : (zone as HTMLElement).scrollTop;
}

/** Une position dans ce qu'une zone peut faire défiler, de 0 à `max`. */
function borner(voulue: number, max: number): number {
  return Math.round(Math.min(Math.max(0, voulue), Math.max(0, max)));
}

/**
 * Fait défiler jusqu'à un titre et y pose le focus.
 *
 * Le titre s'arrête SOUS ce qui colle en haut de la zone qui défile
 * (`masqueHaut` : l'aperçu du personnage, sur téléphone), pas derrière : on
 * doit le lire en arrivant. Le focus suit, pour que le clavier et le lecteur
 * d'écran repartent de là et non du bouton qui a mené ici.
 *
 * Défilement doux, sauf si l'appareil demande moins d'animations : alors on
 * saute d'un coup.
 *
 * Rend la destination — bornée : une partie trop basse pour monter jusque-là
 * s'arrête en bas de page —, pour qui doit savoir quand on y est arrivé
 * (cf. createPartieALEcran).
 */
export function defilerJusqua(cible: HTMLElement, masqueHaut = 0): Destination {
  const comportement: ScrollBehavior = moinsDAnimations() ? "auto" : "smooth";
  const haut = cible.getBoundingClientRect().top;
  const trouvee = ancetreDefilant(cible);
  // Une page qui pose `overflow` sur <html> ou <body> défile quand même par
  // la fenêtre : leur cadre, lui, part avec le défilement, et le calcul
  // ci-dessous compterait celui-ci deux fois.
  const defilante =
    trouvee === document.documentElement || trouvee === document.body
      ? null
      : trouvee;
  let destination: Destination;
  if (defilante) {
    // Ce qui colle en haut s'arrête au bord INTÉRIEUR de la marge de la
    // zone qui défile : le titre doit s'arrêter sous la marge ET sous lui.
    const cadre = defilante.getBoundingClientRect();
    const marge = Number.parseFloat(getComputedStyle(defilante).paddingTop) || 0;
    const but = borner(
      defilante.scrollTop + haut - (cadre.top + marge + masqueHaut + MARGE_ARRIVEE),
      defilante.scrollHeight - defilante.clientHeight,
    );
    defilante.scrollTo({ top: but, behavior: comportement });
    destination = { zone: defilante, but };
  } else {
    const but = borner(
      window.scrollY + haut - (masqueHaut + MARGE_ARRIVEE),
      document.documentElement.scrollHeight - window.innerHeight,
    );
    window.scrollTo({ top: but, behavior: comportement });
    destination = { zone: document, but };
  }
  // Sans faire défiler une seconde fois : le défilement doux est en route.
  cible.focus({ preventScroll: true });
  return destination;
}

/**
 * Le premier parent qui POURRAIT défiler verticalement, qu'il déborde ou non
 * — la fenêtre de personnalisation, même quand tout y tient. Rien quand c'est
 * la page entière qui défile.
 */
function conteneurDefilant(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p === document.body || p === document.documentElement) return null;
    const debord = getComputedStyle(p).overflowY;
    if (debord === "auto" || debord === "scroll" || debord === "overlay")
      return p;
  }
  return null;
}

/**
 * Combien d'une colonne de choix reste sous le bord bas — le haut de la
 * barre d'actions collée — quand la page est tout en haut. Zéro quand tout
 * tient à l'écran.
 *
 * Mesuré comme si l'on n'avait pas défilé, et pas à la position du moment :
 * ce qui en dépend (le sommaire des réglages) ne doit ni paraître ni
 * disparaître pendant qu'on fait défiler.
 *
 * Le décalage se lit sur la zone qui défile ; quand rien ne déborde, sur le
 * conteneur qui POURRAIT défiler : la fenêtre de personnalisation est posée
 * par-dessus la page, et le défilement de la page derrière elle ne la déplace
 * pas.
 */
function resteSousLeBord(colonne: HTMLElement): number {
  const conteneur = ancetreDefilant(colonne) ?? conteneurDefilant(colonne);
  const decalage = conteneur ? conteneur.scrollTop : window.scrollY;
  const barre = (conteneur ?? document).querySelector<HTMLElement>(".ml-cfg-pied");
  const bord = barre
    ? barre.getBoundingClientRect().top
    : conteneur
      ? conteneur.getBoundingClientRect().bottom
      : window.innerHeight;
  return Math.max(0, colonne.getBoundingClientRect().bottom + decalage - bord);
}

/**
 * Toute une colonne de choix tient-elle à l'écran, page en haut ? Alors un
 * sommaire n'apporte rien : tout se voit déjà. Quelques pixels qui dépassent
 * ne comptent pas — ce sont des marges, pas des choix cachés (RESTE_MINI).
 *
 * À brancher en `ref` sur la colonne. On remesure quand elle change de taille
 * (un autre personnage, d'autres galeries) et quand la fenêtre en change : sa
 * hauteur décide du bord bas sans que la colonne bouge.
 */
export function createToutTient(): {
  toutTient: () => boolean;
  brancher: (colonne: HTMLElement) => void;
} {
  const [toutTient, setToutTient] = createSignal(false);
  const brancher = (colonne: HTMLElement) => {
    let image = 0;
    const mesurer = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() =>
        setToutTient(resteSousLeBord(colonne) < RESTE_MINI),
      );
    };
    mesurer();
    const taille =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(mesurer);
    taille?.observe(colonne);
    window.addEventListener("resize", mesurer);
    onCleanup(() => {
      cancelAnimationFrame(image);
      taille?.disconnect();
      window.removeEventListener("resize", mesurer);
    });
  };
  return { toutTient, brancher };
}

/** Ce qu'il reste à faire défiler sous ce qu'on voit, en pixels. */
function resteADefiler(el: HTMLElement): number {
  const trouvee = ancetreDefilant(el);
  if (trouvee && trouvee !== document.documentElement && trouvee !== document.body)
    return trouvee.scrollHeight - trouvee.clientHeight - trouvee.scrollTop;
  return document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
}

/**
 * À deux pixels près, on est arrivé : une page sur un écran à haute densité
 * s'arrête volontiers sur une position fractionnaire.
 */
const TOLERANCE_ARRIVEE = 2;

/**
 * Quelle partie d'une page est à l'écran, pendant qu'on la fait défiler :
 * c'est ce qu'un sommaire de page met en évidence.
 *
 * Une partie est « à l'écran » dès que son titre a passé la LIGNE DE LECTURE,
 * au tiers haut de ce qu'on voit — sous ce qui colle en haut, au-dessus de la
 * barre collée en bas. Avant le premier titre, aucune : on est encore dans ce
 * qui précède les parties (le choix du personnage).
 *
 * Tout en bas, les dernières parties n'ont plus assez de page sous elles pour
 * monter jusqu'à la ligne : la dernière dont le titre se voit prend alors le
 * relais, sinon on n'allumerait jamais la dernière pastille.
 *
 * Un toucher du sommaire DÉSIGNE sa partie ({@link designer}) : elle reste
 * allumée pendant tout le voyage, puis une fois arrivée, tant que la page ne
 * bouge plus. Sans cela, le surlignage défilerait de pastille en pastille
 * pendant la descente, et une partie trop basse pour monter jusqu'à la ligne
 * laisserait allumée sa voisine — pas celle qu'on vient de toucher.
 *
 * L'arrivée se lit sur la POSITION, et non sur un délai : la page est arrivée
 * quand elle a atteint la destination. Un délai sans événement de défilement
 * se trompait dès qu'une image tardait — une tablette occupée, un écran caché
 * —, et rendait la main au calcul avant la fin du voyage. Un geste pendant le
 * voyage (le doigt, la molette, une touche) l'interrompt : on rend la main.
 *
 * Comme pour la bulle d'avant, les mesures passent par la page elle-même : un
 * `scroll` écouté en capture sur le document entend toutes les zones qui
 * défilent, la fenêtre de personnalisation comme la page entière.
 */
export function createPartieALEcran(opts: {
  /** Le titre de chaque partie, dans l'ordre de la page (absent : pas encore là). */
  ancres: () => (HTMLElement | null | undefined)[];
  /** Le haut de ce qu'on lit, en coordonnées de l'écran : sous ce qui colle. */
  hautLecture: () => number;
  /** Le bas de ce qu'on lit : le haut de la barre collée en bas. */
  basLecture: () => number;
}): {
  /** Rang de la partie à l'écran, ou `null` avant la première. */
  active: () => number | null;
  /**
   * Une pastille vient d'être touchée : sa partie reste allumée jusqu'à
   * `destination` (cf. defilerJusqua), puis tant qu'on n'en bouge pas.
   */
  designer: (rang: number, destination: Destination) => void;
} {
  const [active, setActive] = createSignal<number | null>(null);
  /** La partie désignée, où mène son défilement, et si l'on y est. */
  let designee: (Destination & { arrivee: boolean }) | null = null;
  let image = 0;

  const calculer = (): number | null => {
    const ancres = opts.ancres();
    const haut = opts.hautLecture();
    const bas = opts.basLecture();
    // Jamais au ras du haut : un titre posé par le sommaire s'arrête
    // MARGE_ARRIVEE pixels plus bas, et doit compter comme passé.
    const ligne = haut + Math.max(MARGE_ARRIVEE + 4, (bas - haut) / 3);
    let rang: number | null = null;
    let derniereVue: number | null = null;
    let premiere: HTMLElement | undefined;
    for (let i = 0; i < ancres.length; i++) {
      const a = ancres[i];
      if (!a || !a.isConnected) continue;
      if (!premiere) premiere = a;
      const r = a.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.top <= ligne) rang = i;
      if (r.top < bas) derniereVue = i;
    }
    if (!premiere) return null;
    if (
      derniereVue !== null &&
      (rang === null || derniereVue > rang) &&
      resteADefiler(premiere) <= TOLERANCE_ARRIVEE
    )
      rang = derniereVue;
    return rang;
  };

  const mesurer = () => {
    cancelAnimationFrame(image);
    // Une mesure par image au plus : un défilement envoie bien davantage.
    image = requestAnimationFrame(() => {
      if (!designee) setActive(calculer());
    });
  };

  const surDefilement = (e: Event) => {
    if (designee) {
      // Une galerie qu'on pousse du doigt, la grille des personnages qui
      // défile dans sa case : ni l'une ni l'autre ne déplace les parties.
      if (e.target !== designee.zone) return;
      const ecart = Math.abs(position(designee.zone) - designee.but);
      if (!designee.arrivee) {
        if (ecart <= TOLERANCE_ARRIVEE) designee.arrivee = true;
        return;
      }
      // Arrivée : la partie touchée reste allumée tant qu'on n'en bouge pas.
      if (ecart <= TOLERANCE_ARRIVEE) return;
      designee = null;
    }
    mesurer();
  };

  /** Un geste pendant le voyage l'interrompt : le calcul reprend la main. */
  const surGeste = () => {
    if (designee && !designee.arrivee) designee = null;
  };

  onMount(() => {
    const options = { capture: true, passive: true } as const;
    document.addEventListener("scroll", surDefilement, options);
    for (const geste of ["wheel", "touchstart", "pointerdown", "keydown"] as const)
      document.addEventListener(geste, surGeste, options);
    window.addEventListener("resize", mesurer);
    onCleanup(() => {
      cancelAnimationFrame(image);
      document.removeEventListener("scroll", surDefilement, options);
      for (const geste of ["wheel", "touchstart", "pointerdown", "keydown"] as const)
        document.removeEventListener(geste, surGeste, options);
      window.removeEventListener("resize", mesurer);
    });
  });

  // Les titres bougent aussi SANS défilement : un autre personnage, avec
  // d'autres parties ; une vignette qui arrive et allonge sa galerie. On
  // remesure quand la colonne qui les porte change de taille.
  createEffect(() => {
    const ancres = opts.ancres();
    // Autre personnage, autres parties : la désignation d'avant ne vaut plus.
    designee = null;
    mesurer();
    const colonne = ancres.find((a) => a?.isConnected)?.parentElement;
    if (!colonne || typeof ResizeObserver === "undefined") return;
    const taille = new ResizeObserver(mesurer);
    taille.observe(colonne);
    onCleanup(() => taille.disconnect());
  });

  const designer = (rang: number, destination: Destination) => {
    cancelAnimationFrame(image);
    setActive(rang);
    // Déjà en place — moins d'animations demandées, ou rien à faire défiler :
    // on est arrivé avant même de partir.
    designee = {
      ...destination,
      arrivee:
        Math.abs(position(destination.zone) - destination.but) <= TOLERANCE_ARRIVEE,
    };
  };

  return { active, designer };
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
 * change de taille et quand les choix changent (un personnage de plus dans
 * la liste).
 *
 * L'éditeur de personnage ne s'en sert plus : sous l'aperçu collé du
 * téléphone, elle ouvrait un blanc qui avait l'air d'un oubli, et c'est
 * désormais son sommaire des réglages qui dit que la suite est dessous.
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

/* -------------------------------------------------------------------------- */
/*  Les listes qui défilent : une barre qu'on voit, des boutons qu'on touche   */
/* -------------------------------------------------------------------------- */

/*
 * « SCROLLE > que ce soit en horizontal et en vertical, bouton et barres :
 * trop discret, penser aux vieux » (retour cliente, octobre 2026).
 *
 * Une liste qui défile ne se devinait pas : sur une tablette, la barre de
 * défilement n'apparaît qu'au premier geste, et sur un ordinateur elle était
 * réglée fine et pâle ; les flèches des galeries faisaient 26 px. Une liste
 * qui déborde montre désormais trois choses :
 *   - deux BOUTONS, ‹ › pour une liste horizontale, ˄ ˅ pour une verticale :
 *     44 px, cerclés de noir, la taille d'une cible au doigt. Celui du bout où
 *     l'on est arrivé s'estompe et se désactive ; les deux disparaissent quand
 *     tout tient — il n'y a alors rien à faire défiler ;
 *   - la barre du navigateur, épaissie et contrastée (`.ml-defil-zone`,
 *     global.css du site), là où il la montre en permanence ;
 *   - là où il la cache — tablettes, téléphones, certains ordinateurs —, une
 *     barre DESSINÉE à sa place, aux mêmes couleurs. Pour le savoir, on mesure
 *     la place que la barre du navigateur prend : aucune, c'est qu'elle se
 *     superpose au contenu et n'apparaîtra qu'au premier geste. Ni Safari sur
 *     iPad ni Chrome sur Android ne laissent une page la forcer visible.
 *
 * La barre dessinée n'est qu'un repère : elle ne capte pas le doigt, c'est la
 * liste qu'on pousse — ou les boutons.
 */

/** Gris des barres : un curseur foncé sur un rail clair, lisible de loin. */
const RAIL = "#e5e7eb";
const CURSEUR = "#4b5563";
/** Épaisseur de la barre dessinée. */
const EPAISSEUR = 8;
/** Longueur minimale du curseur : un curseur minuscule ne se voit plus. */
const CURSEUR_MIN = 28;

/** L'état d'une zone qui défile, tel que ses boutons et sa barre le lisent. */
interface EtatDefilement {
  /** Elle cache quelque chose : boutons et barre ont une raison d'être. */
  deborde: boolean;
  auDebut: boolean;
  aLaFin: boolean;
  /** La barre du navigateur ne prend pas de place : on dessine la nôtre. */
  dessinee: boolean;
  /** La part visible (0..1) et la position (0..1), pour le curseur. */
  part: number;
  position: number;
}

/** Mesure une zone qui défile dans un sens. */
function etatDe(zone: HTMLElement, horizontal: boolean): EtatDefilement {
  const total = horizontal ? zone.scrollWidth : zone.scrollHeight;
  const vue = horizontal ? zone.clientWidth : zone.clientHeight;
  const pos = horizontal ? zone.scrollLeft : zone.scrollTop;
  const reste = total - vue;
  // Deux pixels de marge : une position fractionnaire n'est pas un débord.
  const deborde = reste > 2;
  const style = getComputedStyle(zone);
  const bords = horizontal
    ? (Number.parseFloat(style.borderTopWidth) || 0) +
      (Number.parseFloat(style.borderBottomWidth) || 0)
    : (Number.parseFloat(style.borderLeftWidth) || 0) +
      (Number.parseFloat(style.borderRightWidth) || 0);
  const placeDeLaBarre = horizontal
    ? zone.offsetHeight - zone.clientHeight - bords
    : zone.offsetWidth - zone.clientWidth - bords;
  return {
    deborde,
    auDebut: pos <= 2,
    aLaFin: pos >= reste - 2,
    dessinee: deborde && placeDeLaBarre < 1,
    part: total > 0 ? Math.min(1, vue / total) : 1,
    position: reste > 0 ? Math.min(1, Math.max(0, pos / reste)) : 0,
  };
}

/**
 * Le premier choix de la liste, pour régler le pas des boutons : celui qui se
 * déclare (`data-item`), sinon le premier enfant — en descendant tant qu'il
 * est plus grand que ce qu'on voit (une liste `<ul>` posée dans la zone).
 */
function premierChoix(zone: HTMLElement, horizontal: boolean): HTMLElement | null {
  const vue = horizontal ? zone.clientWidth : zone.clientHeight;
  let el =
    zone.querySelector<HTMLElement>("[data-item]") ??
    (zone.firstElementChild as HTMLElement | null);
  while (el) {
    const r = el.getBoundingClientRect();
    if ((horizontal ? r.width : r.height) <= vue || !el.firstElementChild) break;
    el = el.firstElementChild as HTMLElement;
  }
  return el;
}

/**
 * Fait défiler d'une « page » moins une demi-vignette : ce que le bord coupait
 * en deux (la règle de la demi-rangée) arrive entier, et rien ne passe sans
 * avoir été vu. Doucement, sauf si l'appareil demande moins d'animations.
 */
function defilerDUnePage(zone: HTMLElement, horizontal: boolean, sens: -1 | 1): void {
  const vue = horizontal ? zone.clientWidth : zone.clientHeight;
  const choix = premierChoix(zone, horizontal);
  const taille = choix
    ? horizontal
      ? choix.getBoundingClientRect().width
      : choix.getBoundingClientRect().height
    : 0;
  const pas = Math.max(vue * 0.5, vue - taille / 2 - 8);
  const comportement: ScrollBehavior = moinsDAnimations() ? "auto" : "smooth";
  if (horizontal) zone.scrollBy({ left: sens * pas, behavior: comportement });
  else zone.scrollBy({ top: sens * pas, behavior: comportement });
}

/** Chevron dessiné : net à toute taille, et le même sur tous les appareils. */
function Chevron(props: { vers: "gauche" | "droite" | "haut" | "bas" }) {
  const points = {
    gauche: "10 3.5 5.5 8 10 12.5",
    droite: "6 3.5 10.5 8 6 12.5",
    haut: "3.5 10 8 5.5 12.5 10",
    bas: "3.5 6 8 10.5 12.5 6",
  }[props.vers];
  return (
    <svg
      viewBox="0 0 16 16"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points={points} />
    </svg>
  );
}

/**
 * Un bouton de défilement : 44 px, fond blanc cerclé de noir, chevron épais.
 * Le survol, l'appui et le focus clavier vivent dans la feuille de l'hôte
 * (`.ml-defil-btn`) ; sans elle, le bouton reste entier et utilisable.
 */
function BoutonDefilement(props: {
  vers: "gauche" | "droite" | "haut" | "bas";
  libelle: string;
  /** Arrivé au bout de ce côté : estompé et désactivé. */
  bout: boolean;
  controle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="ml-defil-btn"
      aria-label={props.libelle}
      title={props.libelle}
      aria-controls={props.controle}
      disabled={props.bout}
      onClick={() => props.onClick()}
      style={{
        flex: "0 0 auto",
        width: "44px",
        height: "44px",
        padding: "0",
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        "border-radius": "9999px",
        border: "2px solid #1f2937",
        background: "#ffffff",
        color: "#111827",
        "box-shadow": props.bout ? "none" : "0 1px 3px rgba(17, 24, 39, 0.2)",
        opacity: props.bout ? "0.3" : "1",
        cursor: props.bout ? "default" : "pointer",
      }}
    >
      <Chevron vers={props.vers} />
    </button>
  );
}

/**
 * Une liste qui défile, horizontalement ou verticalement, avec ses boutons et
 * sa barre (voir plus haut).
 *
 * - Horizontale : ‹ à gauche, › à droite, la barre dessinée sous la liste.
 * - Verticale : à droite de la liste, ˄ en haut, ˅ en bas, et la barre
 *   dessinée entre les deux — une barre de défilement aux grosses flèches.
 *
 * La zone qui défile garde la classe, le style et le `ref` qu'on lui donne :
 * la règle de la demi-rangée (brancherDemiRangee) et les mesures des galeries
 * s'y branchent comme avant. Les enfants y sont posés directement : un
 * sélecteur de l'hôte comme `.ml-cfg-rail > button` les trouve toujours.
 */
export function ZoneDefilante(props: {
  sens: "horizontal" | "vertical";
  /** Noms traduits des deux boutons : vers le début, vers la fin. */
  versDebut: string;
  versFin: string;
  children: JSX.Element;
  /** Classe et style de la zone qui défile elle-même. */
  class?: string;
  style?: JSX.CSSProperties;
  ref?: (el: HTMLDivElement) => void;
  /** Rappelé à chaque défilement (le rail des cadres suit son débord). */
  onScroll?: () => void;
}): JSX.Element {
  const horizontal = props.sens === "horizontal";
  const id = createUniqueId();
  const [etat, setEtat] = createSignal<EtatDefilement>(
    {
      deborde: false,
      auDebut: true,
      aLaFin: true,
      dessinee: false,
      part: 1,
      position: 0,
    },
    {
      // Une mesure identique ne redessine rien : la grille des personnages
      // remesure à chaque vignette recolorée.
      equals: (a, b) =>
        a.deborde === b.deborde &&
        a.auDebut === b.auDebut &&
        a.aLaFin === b.aLaFin &&
        a.dessinee === b.dessinee &&
        Math.abs(a.part - b.part) < 0.001 &&
        Math.abs(a.position - b.position) < 0.001,
    },
  );
  let zone: HTMLDivElement | undefined;
  let image = 0;

  const mesurer = () => {
    cancelAnimationFrame(image);
    // Une mesure par image au plus : un défilement envoie bien davantage.
    image = requestAnimationFrame(() => {
      if (zone) setEtat(etatDe(zone, horizontal));
    });
  };

  const brancher = (el: HTMLDivElement) => {
    zone = el;
    props.ref?.(el);
    mesurer();
    // La zone change de taille (l'écran, les boutons qui paraissent), son
    // contenu change (une autre catégorie, des vignettes recalculées), les
    // polices finissent de charger : chaque fois, on remesure.
    const taille =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(mesurer);
    taille?.observe(el);
    const contenu = new MutationObserver(mesurer);
    contenu.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", mesurer);
    void document.fonts?.ready.then(mesurer);
    onCleanup(() => {
      cancelAnimationFrame(image);
      taille?.disconnect();
      contenu.disconnect();
      window.removeEventListener("resize", mesurer);
    });
  };

  const surDefilement = () => {
    mesurer();
    props.onScroll?.();
  };

  const defiler = (sens: -1 | 1) => {
    if (zone) defilerDUnePage(zone, horizontal, sens);
  };

  /** Le curseur : sa longueur dit la part visible, sa place où l'on en est. */
  const curseur = (): JSX.CSSProperties => {
    const part = `${(etat().part * 100).toFixed(2)}%`;
    const longueur = `max(${CURSEUR_MIN}px, ${part})`;
    const decalage = `calc((100% - ${longueur}) * ${etat().position.toFixed(4)})`;
    return horizontal
      ? { position: "absolute", top: "0", bottom: "0", width: longueur, left: decalage }
      : { position: "absolute", left: "0", right: "0", height: longueur, top: decalage };
  };

  const laZone = (
    <div
      ref={brancher}
      id={id}
      class={`ml-defil-zone ${props.class ?? ""}`}
      style={props.style}
      onScroll={surDefilement}
    >
      {props.children}
    </div>
  );

  const barreDessinee = (
    <div
      class="ml-defil-piste"
      aria-hidden="true"
      style={{
        position: "relative",
        "border-radius": "9999px",
        background: RAIL,
        ...(horizontal
          ? { height: `${EPAISSEUR}px`, "margin-top": "6px" }
          : { width: `${EPAISSEUR}px`, flex: "1 1 auto", "min-height": "24px" }),
      }}
    >
      <div
        class="ml-defil-curseur"
        style={{ ...curseur(), "border-radius": "9999px", background: CURSEUR }}
      />
    </div>
  );

  if (horizontal)
    return (
      <div
        class="ml-defil ml-defil-h"
        style={{ display: "flex", "align-items": "center", gap: "6px", "min-width": "0" }}
      >
        <Show when={etat().deborde}>
          <BoutonDefilement
            vers="gauche"
            libelle={props.versDebut}
            bout={etat().auDebut}
            controle={id}
            onClick={() => defiler(-1)}
          />
        </Show>
        <div style={{ flex: "1 1 auto", "min-width": "0" }}>
          {laZone}
          <Show when={etat().dessinee}>{barreDessinee}</Show>
        </div>
        <Show when={etat().deborde}>
          <BoutonDefilement
            vers="droite"
            libelle={props.versFin}
            bout={etat().aLaFin}
            controle={id}
            onClick={() => defiler(1)}
          />
        </Show>
      </div>
    );

  return (
    <div
      class="ml-defil ml-defil-v"
      style={{ display: "flex", "align-items": "stretch", gap: "6px", "min-width": "0" }}
    >
      <div style={{ flex: "1 1 auto", "min-width": "0" }}>{laZone}</div>
      <Show when={etat().deborde}>
        <div
          class="ml-defil-rail"
          style={{
            flex: "0 0 auto",
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "6px",
          }}
        >
          <BoutonDefilement
            vers="haut"
            libelle={props.versDebut}
            bout={etat().auDebut}
            controle={id}
            onClick={() => defiler(-1)}
          />
          {/* Entre les deux boutons : la barre dessinée, ou rien quand le
              navigateur montre déjà la sienne au bord de la liste. */}
          <Show when={etat().dessinee} fallback={<div style={{ flex: "1 1 auto" }} />}>
            {barreDessinee}
          </Show>
          <BoutonDefilement
            vers="bas"
            libelle={props.versFin}
            bout={etat().aLaFin}
            controle={id}
            onClick={() => defiler(1)}
          />
        </div>
      </Show>
    </div>
  );
}

/**
 * La barre de la FENÊTRE de personnalisation, dessinée sur les appareils qui
 * cachent la leur.
 *
 * Toute la fenêtre défile — le choix du personnage, puis ses vêtements, ses
 * couleurs… — et, sur une tablette, rien ne le montrait avant le premier
 * geste. Même principe que pour les listes : si la barre du navigateur prend
 * de la place, elle se voit déjà (et global.css l'épaissit) ; sinon, on en
 * pose une, en position fixe le long du bord droit de la zone qui défile,
 * dans sa marge — jamais par-dessus un choix.
 *
 * À brancher en `ref` sur la racine du configurateur ; ne fait rien quand
 * c'est la page entière qui défile (le configurateur posé hors fenêtre).
 */
export function brancherBarreDeLaFenetre(racine: HTMLElement): void {
  // On attend que la racine soit dans la page : avant, elle n'a pas d'ancêtre.
  onMount(() => {
    const zone = conteneurDefilant(racine);
    if (!zone || !zone.parentElement) return;
    const piste = document.createElement("div");
    piste.className = "ml-defil-piste ml-defil-piste-fenetre";
    piste.setAttribute("aria-hidden", "true");
    piste.style.cssText =
      `position:fixed;width:${EPAISSEUR}px;border-radius:9999px;` +
      `background:${RAIL};pointer-events:none;z-index:4;display:none`;
    const curseur = document.createElement("div");
    curseur.className = "ml-defil-curseur";
    curseur.style.cssText =
      `position:absolute;left:0;right:0;border-radius:9999px;background:${CURSEUR}`;
    piste.append(curseur);
    zone.parentElement.append(piste);

    let image = 0;
    const placer = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        const e = etatDe(zone, false);
        if (!e.dessinee) {
          piste.style.display = "none";
          return;
        }
        const r = zone.getBoundingClientRect();
        const hauteur = Math.max(0, r.height - 16);
        piste.style.display = "block";
        piste.style.top = `${r.top + 8}px`;
        piste.style.height = `${hauteur}px`;
        // Dans la marge de droite : la marge de la fenêtre fait 14 px au moins.
        piste.style.left = `${r.right - EPAISSEUR - 3}px`;
        const longueur = Math.max(CURSEUR_MIN, hauteur * e.part);
        curseur.style.height = `${longueur}px`;
        curseur.style.top = `${(hauteur - longueur) * e.position}px`;
      });
    };
    placer();
    zone.addEventListener("scroll", placer, { passive: true });
    window.addEventListener("resize", placer);
    const taille =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(placer);
    taille?.observe(zone);
    taille?.observe(racine);
    onCleanup(() => {
      cancelAnimationFrame(image);
      zone.removeEventListener("scroll", placer);
      window.removeEventListener("resize", placer);
      taille?.disconnect();
      piste.remove();
    });
  });
}
