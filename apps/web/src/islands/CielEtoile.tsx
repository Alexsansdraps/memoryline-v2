/// <reference lib="dom" />
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import { LOCALE_COMPLETE, t, type Langue } from "../i18n/utils.ts";
import { PUBLIC_API_URL, getCartId } from "../lib/api.ts";
import { apercuAbsolu } from "../lib/ia.ts";
import { saisonDeNoel } from "../lib/saison-noel.ts";

/**
 * Le ciel étoilé d'un soir (26/11) — page cachée /ciel-etoile, à montrer à
 * Margaux avant de l'ouvrir aux clients.
 *
 * Une date, une heure, une ville : l'API calcule le ciel (apps/api/src/ciel.ts)
 * et le range comme une affiche tirée d'une photo. On le montre ici, puis
 * « Personnaliser » ouvre l'écran de l'affiche photo sur cette création —
 * textes, personnages, format et panier y sont déjà.
 */

/** Un thème de couleurs du ciel (API /ia/ciel/themes). */
interface ThemeCiel {
  id: string;
  nom: string;
  fond: string;
  etoiles: string;
  dorures: string;
  haut: string;
  horizon: string;
}

/** Une ville trouvée par l'API (GeoNames, apps/api/src/ciel.ts). */
interface Ville {
  nom: string;
  pays: string;
  region: string;
  lat: number;
  lon: number;
  fuseau: string;
}

const MULHOUSE: Ville = {
  nom: "Mulhouse",
  pays: "FR",
  region: "Grand Est",
  lat: 47.75,
  lon: 7.336,
  fuseau: "Europe/Paris",
};

/*
 * Les styles du ciel (27/11, Alexandra : « peut-être choisir un style de
 * constellation (double donc couple, simple, etc) », « pas de drag and drop
 * par les clients surtout, ils vont faire n'imp ça doit être simple »). Un
 * seul choix en tête du formulaire, en vignettes ; le style décide de la mise
 * en page. Mêmes noms que l'API (apps/api/src/ciel.ts, STYLES_CIEL).
 */
export type StyleCiel = "nuit" | "signe" | "couple" | "libre";
const STYLES: StyleCiel[] = ["nuit", "signe", "couple", "libre"];
export type PlaceTexte = "haut" | "bas";

/** Les douze signes, par leur sigle (apps/api/src/ciel-signes.ts). */
export const IDS_SIGNES = ["Ari", "Tau", "Gem", "Cnc", "Leo", "Vir", "Lib", "Sco", "Sgr", "Cap", "Aqr", "Psc"] as const;
export type IdSigne = (typeof IDS_SIGNES)[number];
/** Premier jour de chaque signe (« MM-JJ »), comme l'API. */
const DEBUTS: Record<IdSigne, string> = {
  Ari: "03-21", Tau: "04-20", Gem: "05-21", Cnc: "06-21", Leo: "07-23", Vir: "08-23",
  Lib: "09-23", Sco: "10-23", Sgr: "11-22", Cap: "12-22", Aqr: "01-20", Psc: "02-19",
};
/** Le signe d'une date de naissance « AAAA-MM-JJ » (dates habituelles du zodiaque). */
export function signeDeLaDate(date: string): IdSigne | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const mmjj = `${m[1]}-${m[2]}`;
  let trouve: IdSigne = "Cap";
  let meilleur = "";
  for (const id of IDS_SIGNES)
    if (DEBUTS[id] <= mmjj && DEBUTS[id] > meilleur) {
      meilleur = DEBUTS[id];
      trouve = id;
    }
  return trouve;
}

/** Ce qu'un ciel dessiné porte : de quoi y poser les lignes de texte (AfficheIA). */
export interface MiseDuCiel {
  style: StyleCiel;
  texte: PlaceTexte;
  /** La ville est écrite sous le cercle (ciel de cette nuit). */
  ville: boolean;
  signes: IdSigne[];
  /** Des ombres chinoises sont posées sur la colline (27/11) : le texte en bas s'arrête au-dessus. */
  personnages?: boolean;
  /** Le fond du thème est clair (« Crème ») : le texte passe en anthracite (27/11). */
  clair?: boolean;
  /**
   * Le ciel est dessiné EN PAYSAGE (le couple, depuis le 27/11 au soir). Absent
   * sur les couples créés avant : ils gardent leur mise en page de portrait.
   */
  paysage?: boolean;
  /**
   * La hauteur du bloc de texte au moment du dessin, en fraction de la
   * hauteur (27/11 au soir) : présente, le dessin est placé par la mise en
   * page centrée. Absente (ciels d'avant), la mise en page d'avant.
   */
  hauteurTexte?: number;
}

/*
 * La mise en page CENTRÉE (27/11 au soir, Alexandra : « elle doit être au
 * milieu au début, puis poussée si on ajoute du texte […] et le texte entier
 * on doit pouvoir le centrer au milieu de la place dispo ») : MÊMES calculs
 * que dispositionCentree (apps/api/src/ciel.ts) — si l'un change, changer
 * l'autre. La place va de MARGE_HAUT_CIEL à basDeLaPlace (85 %, 70 % avec
 * des personnages, qui ont leur bande dessous).
 */
export const MARGE_HAUT_CIEL = 0.035;
export const ECART_TEXTE_CIEL = 0.03;
/**
 * Le bas de la place du dessin et du texte : FIXE, avec ou sans personnages
 * (27/11 au soir, Alexandra : « quand j'ajoute un perso ça décale la
 * constellation ça devrait pas »). La bande des personnages, dessous, est
 * toujours gardée ; seul le texte pousse le dessin. 0,72 : un cheval debout,
 * la plus haute scène, tient dessous.
 */
export const basDeLaPlace = (_personnages?: boolean): number => 0.72;
function dispositionCentree(
  m: Pick<MiseDuCiel, "style" | "texte" | "ville" | "personnages" | "paysage">,
  hauteurTexte: number,
): { haut: number; bas: number } {
  const paysage = m.style === "couple" && !!m.paysage;
  const W = paysage ? 3508 : 2480;
  const H = paysage ? 2480 : 3508;
  const e =
    m.style === "nuit"
      ? { a: 2, b: 93 + (m.ville ? 257 : 192) }
      : m.style === "couple"
        ? { a: 2.14, b: 12 }
        : m.style === "libre"
          ? { a: 1.76, b: 0 }
          : { a: 2, b: 48 };
  const Rdefaut = m.style === "couple" ? W * 0.17 : W * 0.34;
  const A = MARGE_HAUT_CIEL * H;
  const B = basDeLaPlace(!!m.personnages && m.style === "nuit") * H;
  const h = Math.max(0, hauteurTexte) * H;
  const g = h > 0 ? ECART_TEXTE_CIEL * H : 0;
  const dispo = B - A - h - g;
  const R = Math.max(Rdefaut * 0.6, Math.min(Rdefaut, (dispo - e.b) / e.a));
  const D = e.a * R + e.b;
  // Le vide se partage 1.0 au-dessus, le reste dessous (27/11 au soir,
  // Alexandra : « naturellement il est trop haut le cercle constellation ») :
  // centré pile, le dessin paraissait flotter haut au-dessus des collines.
  const debut = A + Math.max(0, dispo - D) * 1.0;
  const haut = m.texte === "haut" ? debut + h + g : debut;
  return { haut: haut / H, bas: (haut + D) / H };
}

/**
 * La bande qu'occupe le dessin, en fraction de la hauteur de l'affiche : les
 * lignes de texte se posent au-dessus de `haut` (texte en haut) ou sous
 * `bas` (texte en bas). MÊMES calculs que dispositionDuCiel
 * (apps/api/src/ciel.ts) : si l'un change, changer l'autre.
 */
export function zoneDuDessin(
  m: Pick<MiseDuCiel, "style" | "texte" | "ville" | "personnages" | "paysage" | "hauteurTexte">,
): { haut: number; bas: number } {
  if (typeof m.hauteurTexte === "number") return dispositionCentree(m, m.hauteurTexte);
  // Le couple en paysage (27/11 au soir) : feuille couchée, 3508 × 2480.
  // MÊMES valeurs que dispositionDuCiel (apps/api/src/ciel.ts).
  if (m.style === "couple" && m.paysage) {
    const Wp = 3508;
    const Hp = 2480;
    const cy = Hp * (m.texte === "haut" ? 0.6 : 0.36);
    const R = Wp * 0.17;
    return { haut: (cy - R * 1.14) / Hp, bas: (cy + R + 12) / Hp };
  }
  const W = 2480;
  const H = 3508;
  // Texte en haut, le dessin remonte et rapetisse un peu (27/11, Alexandra :
  // « trop bas la constellation quand c'est en mode texte en haut ») ; le ciel
  // de cette nuit seulement s'il y a des personnages.
  if (m.style === "nuit") {
    const remonte = m.texte === "haut" && !!m.personnages;
    const cy = m.texte === "haut" ? (remonte ? H * 0.49 : H * 0.55) : H * 0.31;
    const R = m.texte === "haut" && !remonte ? W * 0.34 : W * 0.31;
    return { haut: (cy - R - 93) / H, bas: (cy + R + (m.ville ? 257 : 192)) / H };
  }
  if (m.style === "couple") {
    const cy = H * (m.texte === "haut" ? 0.46 : 0.36);
    const R = W * 0.205;
    return { haut: (cy - R * 1.14) / H, bas: (cy + R + 12) / H };
  }
  const cy = H * (m.texte === "haut" ? 0.48 : 0.33);
  const R = W * (m.texte === "haut" ? 0.32 : 0.34);
  if (m.style === "libre") return { haut: (cy - R * 0.78) / H, bas: (cy + R * 0.98) / H };
  return { haut: (cy - R - 24) / H, bas: (cy + R + 24) / H };
}

/**
 * Texte en bas : le plus bas où descend le bloc de lignes, en fraction de la
 * hauteur (27/11, relecture : « les silhouettes coupent Passion •
 * Détermination • Magnétisme »). Sans personnage, le bas de la feuille ; avec,
 * la place gardée aux lignes sous le dessin (3 % d'écart puis 18 %) : l'API
 * garde les têtes 1,5 % plus bas (plafondDesSilhouettes, apps/api/src/ciel.ts).
 * Si l'un change, changer l'autre.
 */
export function basDuTexte(m: Pick<MiseDuCiel, "style" | "texte" | "ville" | "personnages" | "paysage">): number {
  if (m.texte !== "bas" || !m.personnages) return 0.97;
  return zoneDuDessin({ ...m, texte: "bas" }).bas + 0.03 + 0.18;
}

/** Un fond clair, comme l'API le juge (teintesDuTheme, apps/api/src/ciel.ts). */
function fondClair(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.55;
}

/** Une petite image de chaque mise en page, pour les vignettes des styles. */
function VignetteStyle(props: { style: StyleCiel }): JSX.Element {
  // Trois traits de texte : en haut pour le ciel de cette nuit, en bas sinon.
  const traits = (y: number) => (
    <>
      <path d={`M13 ${y}h14`} stroke-width="2" />
      <path d={`M15 ${y + 4}h10M16 ${y + 7.5}h8`} stroke-width="1.2" />
    </>
  );
  return (
    <svg viewBox="0 0 40 56" class="h-full w-full" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="1" y="1" width="38" height="54" rx="1.5" stroke-width="1" />
      <Show when={props.style === "nuit"}>
        {traits(7)}
        <circle cx="20" cy="31" r="11" stroke-width="1.2" />
        <path d="M15 27l.01 0M23 25l.01 0M19 32l.01 0M25 34l.01 0M14 35l.01 0" stroke-width="2" />
        <path d="M1 49c10-3 22-2 38-4" stroke-width="1" />
      </Show>
      <Show when={props.style === "signe"}>
        <circle cx="20" cy="20" r="13" stroke-width="1.2" />
        <path d="M12 22l5-5 4 3 6-7M21 20l1 6" stroke-width="1" stroke-dasharray="1.6 1.4" />
        {traits(40)}
      </Show>
      <Show when={props.style === "couple"}>
        <circle cx="12.5" cy="21" r="8" stroke-width="1.2" />
        <circle cx="27.5" cy="21" r="8" stroke-width="1.2" />
        <path d="M8 23l4-4 3 2M24 18l3 4 3-3" stroke-width="1" stroke-dasharray="1.4 1.2" />
        {traits(38)}
      </Show>
      <Show when={props.style === "libre"}>
        <path d="M9 25l6-7 5 4 7-9 4 6M20 22l2 8" stroke-width="1" stroke-dasharray="1.6 1.4" />
        <path d="M30 9l.01 0M8 12l.01 0M33 26l.01 0M11 31l.01 0" stroke-width="1.6" />
        {traits(40)}
      </Show>
    </svg>
  );
}

export interface CielEtoileProps {
  langue: Langue;
  /** L'affiche « à partir d'une photo » qui accueille le ciel. */
  productId: number;
  /** Son adresse, dans la langue de la page (page /ciel-etoile seule). */
  adresseAffiche?: string;
  /**
   * Intégré à la fiche de l'affiche (AfficheIA, `?ciel=1`, 26/11) : le
   * formulaire seul, et le ciel dessiné lui est rendu — elle le montre et
   * enchaîne sur ses textes, ses personnages, son format.
   */
  onCree?: (c: { publicId: string; apercuChemin: string; apercu: string; mise: MiseDuCiel }) => void;
  /** La fiche est occupée (création, composition) : le bouton s'éteint. */
  occupe?: boolean;
  /**
   * La place du texte, réglée à l'étape Texte de la fenêtre (27/11) ; à
   * défaut, en haut pour le ciel de cette nuit, en bas pour un signe. La
   * changer redessine le ciel déjà dessiné.
   */
  texte?: PlaceTexte;
  /** Les ombres chinoises posées (étape Personnages, 27/11) ; les changer redessine le ciel. */
  silhouettes?: readonly string[];
  /**
   * La hauteur du bloc de texte, en fraction de la hauteur de l'affiche
   * (27/11 au soir) : le dessin se place autour d'elle ; quand elle change
   * nettement, le ciel se redessine (après la frappe).
   */
  hauteurTexte?: number;
  /** Dit à la fenêtre le style et les signes choisis, à chaque changement. */
  onReglage?: (r: { style: StyleCiel; signes: IdSigne[] }) => void;
  /**
   * Le redessin attend une date ou un signe (un couple à une seule date) :
   * la fenêtre le redit à l'étape Personnages (27/11).
   */
  onIncomplet?: (oui: boolean) => void;
}

export default function CielEtoile(props: CielEtoileProps): JSX.Element {
  const tr = t(props.langue);
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const [date, setDate] = createSignal(aujourdHui);
  const [heure, setHeure] = createSignal("21:00");
  /*
   * La nuit de Noël (27/11, Alexandra : « Le ciel de la nuit de Noël. Un
   * bouton "Nuit de Noël 2026" sur la fiche Ciel étoilé règle la date sur le
   * 24 décembre à minuit, dans la ville de la cliente. On y ajoute un thème
   * rouge et or. C'est idéal pour "le premier Noël de…" », « avec un btn
   * original »). De saison seulement, du 1er novembre au 31 janvier : en
   * janvier, c'est le Noël de l'année d'avant. 23:59 plutôt que 00:00 : le
   * champ garde le 24, et le ciel est le même à une minute près.
   */
  const { enSaison, annee: anneeDeNoel } = saisonDeNoel(new Date());
  const DATE_NOEL = `${anneeDeNoel}-12-24`;
  const HEURE_NOEL = "23:59";
  const noelRegle = () => date() === DATE_NOEL && heure() === HEURE_NOEL;
  const [annonceNoel, setAnnonceNoel] = createSignal("");
  function reglerNoel() {
    setDate(DATE_NOEL);
    setHeure(HEURE_NOEL);
    if (themes().some((t) => t.id === "noel")) setTheme("noel");
    setAnnonceNoel(tr("ciel.noel.regle"));
    // Un ciel déjà dessiné prend aussitôt la date et le thème de Noël, comme
    // après un clic sur une pastille (27/11, relecture) : un seul dessin.
    redessinerSiDessine();
  }
  const [ville, setVille] = createSignal<Ville | null>(MULHOUSE);
  const [saisie, setSaisie] = createSignal(MULHOUSE.nom);
  const [proposees, setProposees] = createSignal<Ville[]>([]);
  const [ouverte, setOuverte] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [aucune, setAucune] = createSignal(false);
  const [manque, setManque] = createSignal(false);

  /** « France », « Allemagne »… dans la langue de la page. */
  let noms: Intl.DisplayNames | null = null;
  try {
    noms = new Intl.DisplayNames([LOCALE_COMPLETE[props.langue]], { type: "region" });
  } catch {
    noms = null;
  }
  const pays = (code: string) => {
    try {
      return noms?.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const precision = (v: Ville) => [v.region, pays(v.pays)].filter(Boolean).join(", ");

  // Recherche au fil de la frappe, 200 ms après la dernière touche ; une
  // réponse arrivée après une plus récente est ignorée.
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  let tour = 0;
  onCleanup(() => clearTimeout(minuterie));
  function taper(valeur: string) {
    setSaisie(valeur);
    setVille(null);
    setManque(false);
    clearTimeout(minuterie);
    const q = valeur.trim();
    if (q.length < 2) {
      setProposees([]);
      setOuverte(false);
      setAucune(false);
      return;
    }
    const ce = ++tour;
    minuterie = setTimeout(async () => {
      try {
        const r = await fetch(`${PUBLIC_API_URL}/ia/ciel/villes?q=${encodeURIComponent(q)}`);
        const data = (await r.json()) as { villes?: Ville[] };
        if (ce !== tour) return;
        const liste = Array.isArray(data.villes) ? data.villes : [];
        setProposees(liste);
        setAucune(liste.length === 0);
        setActive(liste.length ? 0 : -1);
        setOuverte(true);
      } catch {
        /* réseau : on réessaiera à la prochaine touche */
      }
    }, 200);
  }
  function choisir(v: Ville) {
    setVille(v);
    setSaisie(v.nom);
    setOuverte(false);
    setManque(false);
  }
  function clavier(e: KeyboardEvent) {
    const n = proposees().length;
    if (!ouverte() || !n) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + n) % n);
    } else if (e.key === "Enter" && active() >= 0) {
      e.preventDefault();
      choisir(proposees()[active()]!);
    } else if (e.key === "Escape") {
      setOuverte(false);
    }
  }
  const [occupe, setOccupe] = createSignal(false);

  /**
   * Les couleurs du ciel (27/11) : les thèmes réglés au BO › Ciel étoilé.
   * Chaque pastille montre le dégradé du fond, une étoile et l'anneau doré.
   */
  const [themes, setThemes] = createSignal<ThemeCiel[]>([]);
  const [theme, setTheme] = createSignal<string | null>(null);
  onMount(async () => {
    try {
      const r = await fetch(`${PUBLIC_API_URL}/ia/ciel/themes`);
      const data = (await r.json()) as { themes?: ThemeCiel[] };
      const liste = Array.isArray(data.themes) ? data.themes : [];
      setThemes(liste);
      if (liste[0]) setTheme(liste[0].id);
    } catch {
      /* sans la liste, le serveur prend le premier thème */
    }
  });
  /**
   * Le message d'un échec. Un refus pour trop de demandes (429) dit de
   * patienter une minute (27/11) : il disait « vérifiez la date », ce qui
   * était faux. Tout autre échec garde ciel.erreur.
   */
  const [erreur, setErreur] = createSignal<"ciel.erreur" | "ia.err.rafale" | null>(null);
  const [creation, setCreation] = createSignal<{ publicId: string; apercuChemin: string; apercu: string } | null>(null);

  /**
   * Un ciel a déjà été dessiné : changer de couleur le redessine aussitôt
   * (27/11, Alexandra : « quand on choisit les couleurs ça doit corriger
   * direct la couleur »). Un ciel ne coûte rien (pas d'OpenAI). Une couleur
   * touchée pendant un dessin en cours relance un dessin juste après.
   */
  const [dejaDessine, setDejaDessine] = createSignal(false);
  let aRedessiner = false;
  /**
   * Redessine le ciel déjà montré (couleur, ville, style, place du texte,
   * personnages) ; rien avant le premier dessin. Plusieurs changements du
   * même instant — un style qui change aussi la place du texte — ne font
   * qu'un dessin (27/11).
   */
  let redessinPrevu = false;
  function redessinerSiDessine() {
    if (!dejaDessine() || redessinPrevu) return;
    redessinPrevu = true;
    queueMicrotask(() => {
      redessinPrevu = false;
      if (occupe()) aRedessiner = true;
      else void dessiner(undefined, true);
    });
  }
  function choisirTheme(id: string) {
    if (id === theme()) return;
    setTheme(id);
    redessinerSiDessine();
  }
  /**
   * La ville écrite sous le cercle (27/11, Alexandra : « afficher la ville
   * case à cocher, faut l'afficher à un endroit sympa joliment »). Décochée
   * par défaut : le ciel reste tel qu'il était.
   */
  const [afficherVille, setAfficherVille] = createSignal(false);

  /*
   * Le style, et pour un signe ou un couple les dates de naissance (27/11,
   * Alexandra : « dans le principe les dates avec constellation, noms, et une
   * phrase »). Le signe se DÉDUIT de la date ; la liste ne sert qu'à le
   * corriger (« corrige » reste tant que la date ne change pas). Date, heure
   * et ville du ciel de cette nuit restent en mémoire quand on passe à un
   * signe, et reviennent avec lui.
   */
  const [style, setStyle] = createSignal<StyleCiel>("nuit");
  const [naissances, setNaissances] = createSignal<[string, string]>(["", ""]);
  const [corriges, setCorriges] = createSignal<[IdSigne | "", IdSigne | ""]>(["", ""]);
  const [signeManque, setSigneManque] = createSignal(false);
  const nbSignes = () => (style() === "couple" ? 2 : style() === "nuit" ? 0 : 1);
  /** Le signe de chaque date : corrigé à la main, sinon déduit, sinon aucun. */
  const signeN = (i: 0 | 1): IdSigne | null => corriges()[i] || signeDeLaDate(naissances()[i]);
  const signesEffectifs = (): IdSigne[] =>
    ([0, 1] as const).slice(0, nbSignes()).map(signeN).filter((s): s is IdSigne => !!s);
  function changerNaissance(i: 0 | 1, valeur: string) {
    setNaissances((n) => (i === 0 ? [valeur, n[1]] : [n[0], valeur]));
    // Une nouvelle date : le signe redevient celui de la date.
    setCorriges((c) => (i === 0 ? ["", c[1]] : [c[0], ""]));
    setSigneManque(false);
  }
  function corrigerSigne(i: 0 | 1, valeur: string) {
    const v = (IDS_SIGNES as readonly string[]).includes(valeur) ? (valeur as IdSigne) : "";
    setCorriges((c) => (i === 0 ? [v, c[1]] : [c[0], v]));
    setSigneManque(false);
  }
  /** La place du texte demandée : celle de la fenêtre, sinon celle du style. */
  const placeTexte = (): PlaceTexte => props.texte ?? (style() === "nuit" ? "haut" : "bas");
  // La fenêtre suit le style et les signes (place du texte par défaut, qualités).
  // Hors suivi : ce que la fenêtre lit et écrit alors (ses lignes de texte)
  // ne doit pas relancer cet effet.
  createEffect(() => {
    const r = { style: style(), signes: signesEffectifs() };
    untrack(() => props.onReglage?.(r));
  });
  createEffect(() => {
    const oui = signeManque();
    untrack(() => props.onIncomplet?.(oui));
  });
  // Un style, une place du texte, des personnages, une date de naissance ou un
  // signe changés : le ciel déjà
  // dessiné se redessine aussitôt, comme pour une couleur.
  createEffect(
    on(
      [style, placeTexte, () => (props.silhouettes ?? []).join(","), () => signesEffectifs().join(","), () => naissances().join(",")],
      () => redessinerSiDessine(),
      { defer: true },
    ),
  );

  /*
   * Le texte grandit ou rapetisse (une ligne ajoutée, une taille changée) :
   * le dessin doit se pousser (27/11 au soir). On attend la fin de la frappe
   * (0,9 s), et seulement si l'écart se voit (plus de 0,4 % de la hauteur).
   */
  let hauteurDessinee = 0;
  let minuteurTexte: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(minuteurTexte));
  createEffect(
    on(
      () => props.hauteurTexte ?? 0,
      (h) => {
        clearTimeout(minuteurTexte);
        if (Math.abs(h - hauteurDessinee) < 0.004) return;
        minuteurTexte = setTimeout(() => redessinerSiDessine(), 900);
      },
      { defer: true },
    ),
  );

  async function dessiner(e?: Event, auto = false) {
    e?.preventDefault();
    if (occupe()) return;
    const s = style();
    const v = ville();
    if (s === "nuit" && !v) {
      setManque(true);
      return;
    }
    if (s !== "nuit" && signesEffectifs().length < nbSignes()) {
      // Redessin compris (27/11, relecture : « l'aperçu n'a pas changé, le
      // bouton est désactivé et aucun message n'apparaît ») : on dit ce qui
      // manque, ici et à l'étape Personnages.
      setSigneManque(true);
      return;
    }
    const mise: MiseDuCiel = {
      style: s,
      texte: placeTexte(),
      ville: s === "nuit" && afficherVille(),
      signes: signesEffectifs(),
      personnages: (props.silhouettes ?? []).length > 0,
      clair: fondClair(themes().find((t) => t.id === theme())?.fond ?? ""),
      // Le couple se dessine en paysage (27/11, Alexandra : « pour les couples
      // il faut impérativement avoir le format paysage sinon c'est laid »).
      ...(s === "couple" ? { paysage: true } : {}),
      hauteurTexte: Math.round((props.hauteurTexte ?? 0) * 10000) / 10000,
    };
    hauteurDessinee = mise.hauteurTexte ?? 0;
    setOccupe(true);
    setErreur(null);
    try {
      const communs = {
        productId: props.productId,
        cartId: getCartId(),
        theme: theme() ?? undefined,
        style: s,
        texte: mise.texte,
        // La mise en page centrée (27/11 au soir) : l'API place le dessin
        // autour du bloc de texte.
        hauteurTexte: mise.hauteurTexte,
        silhouettes: [...(props.silhouettes ?? [])],
        langue: props.langue,
      };
      const r = await fetch(`${PUBLIC_API_URL}/ia/ciel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          s === "nuit" && v
            ? {
                ...communs,
                date: date(),
                heure: heure(),
                fuseau: v.fuseau,
                lat: v.lat,
                lon: v.lon,
                lieu: [v.nom, v.region, v.pays].filter(Boolean).join(", "),
                afficherVille: afficherVille(),
                ville: v.nom,
              }
            : {
                ...communs,
                signes: mise.signes,
                dates: naissances().slice(0, nbSignes()),
              },
        ),
      });
      const data = (await r.json().catch(() => null)) as { publicId?: string; apercu?: string } | null;
      if (r.status === 429) {
        setErreur("ia.err.rafale");
        return;
      }
      if (!r.ok || !data?.publicId || !data.apercu) throw new Error(String(r.status));
      const cree = { publicId: data.publicId, apercuChemin: data.apercu, apercu: apercuAbsolu(data.apercu), mise };
      if (props.onCree) props.onCree(cree);
      else setCreation(cree);
      setDejaDessine(true);
    } catch {
      setErreur("ciel.erreur");
    } finally {
      setOccupe(false);
      if (aRedessiner) {
        aRedessiner = false;
        void dessiner(undefined, true);
      }
    }
  }

  /** Range la création avec celles de la séance (AfficheIA les relit) et y va. */
  function personnaliser() {
    const c = creation();
    if (!c) return;
    try {
      const cle = `ml_ia_creations_${getCartId()}_${props.productId}`;
      const liste = JSON.parse(sessionStorage.getItem(cle) ?? "[]") as { publicId: string }[];
      const autres = Array.isArray(liste) ? liste.filter((x) => x?.publicId !== c.publicId) : [];
      sessionStorage.setItem(
        cle,
        JSON.stringify([...autres, { ...c, sens: "portrait", source: "" }]),
      );
    } catch {
      /* mémoire indisponible : la page de l'affiche s'ouvrira sans le ciel */
    }
    location.href = `${props.adresseAffiche}?creation=${encodeURIComponent(c.publicId)}`;
  }

  const champ = "mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-base";

  return (
    <div class={props.onCree ? "" : "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}>
      {/* Condensé (27/11, Alexandra : « condenser ») : la date et l'heure
          côte à côte, des écarts plus serrés. */}
      <form onSubmit={dessiner} class="space-y-3">
        {/* Le style, en tête (27/11) : une vignette par mise en page. */}
        <div>
          <span class="block text-sm font-medium" id="ciel-style-titre">
            {tr("ciel.style")}
          </span>
          <div role="radiogroup" aria-labelledby="ciel-style-titre" class="mt-1 grid grid-cols-4 gap-2 pr-1 pt-1.5">
            <For each={STYLES}>
              {(s) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={style() === s}
                  onClick={() => {
                    setStyle(s);
                    setSigneManque(false);
                  }}
                  class={`ml-choix flex min-w-0 flex-col items-center gap-1 border px-1 pb-1.5 pt-1.5 text-xs leading-tight ${
                    style() === s ? "border-ink font-semibold" : "border-ink/15 hover:border-ink/45"
                  }`}
                >
                  <span class="block h-14 w-10 text-ink/70">
                    <VignetteStyle style={s} />
                  </span>
                  <span class="text-center">{tr(`ciel.style.${s}`)}</span>
                </button>
              )}
            </For>
          </div>
        </div>
        {/* Un signe, un couple : la date de naissance (deux pour un couple),
            le signe qui s'en déduit, et qu'on peut corriger. */}
        <Show when={style() !== "nuit"}>
          <For each={nbSignes() === 2 ? ([0, 1] as const) : ([0] as const)}>
            {(i) => (
              <div class="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
                <label class="block min-w-0 text-sm font-medium">
                  {nbSignes() === 2 ? tr("ciel.naissance_n").replace("{n}", String(i + 1)) : tr("ciel.naissance")}
                  <input
                    type="date"
                    min="1900-01-01"
                    max="2100-12-31"
                    value={naissances()[i]}
                    onInput={(e) => changerNaissance(i, e.currentTarget.value)}
                    class={champ}
                  />
                </label>
                <label class="block min-w-0 text-sm font-medium">
                  {tr("ciel.signe")}
                  <select value={signeN(i) ?? ""} onChange={(e) => corrigerSigne(i, e.currentTarget.value)} class={champ}>
                    <option value="">—</option>
                    <For each={IDS_SIGNES}>{(id) => <option value={id}>{tr(`ciel.signe.${id}`)}</option>}</For>
                  </select>
                </label>
              </div>
            )}
          </For>
          <Show when={signeManque()}>
            <span role="status" class="block text-sm text-terracotta-deep">{tr("ciel.signe_manque")}</span>
          </Show>
        </Show>
        <Show when={style() === "nuit"}>
        <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
          <label class="block min-w-0 text-sm font-medium">
            {tr("ciel.date")}
            <input type="date" required min="1900-01-01" max="2100-12-31" value={date()} onInput={(e) => setDate(e.currentTarget.value)} class={champ} />
          </label>
          <label class="block min-w-0 text-sm font-medium">
            {tr("ciel.heure")}
            <input type="time" required value={heure()} onInput={(e) => setHeure(e.currentTarget.value)} class={champ} />
          </label>
        </div>
        {/* L'étiquette de cadeau de la nuit de Noël (27/11, voir
            `reglerNoel`) : accrochée au formulaire, penchée comme si elle
            pendait, elle se redresse quand on l'effleure, et reste droite
            tant que la date et l'heure sont celles de la nuit de Noël. La
            forme est un dessin posé DERRIÈRE le texte : le bouton n'est pas
            découpé, son contour de focus reste entier. */}
        <Show when={enSaison}>
          <div>
            <button
              type="button"
              class="ml-etiquette-noel"
              aria-pressed={noelRegle()}
              onClick={reglerNoel}
            >
              <svg aria-hidden="true" viewBox="0 0 240 64" preserveAspectRatio="none" class="absolute inset-0 h-full w-full overflow-visible">
                <path d="M24 32 C 8 28, 6 10, 16 0" fill="none" stroke="#b08d57" stroke-width="2" stroke-linecap="round" />
                <path d="M32 2 H234 a4 4 0 0 1 4 4 V58 a4 4 0 0 1 -4 4 H32 L8 32 Z" fill="#9c1616" />
                <path d="M35 7 H231 V57 H35 L16 32 Z" fill="none" stroke="#e9c56b" stroke-width="1.2" stroke-dasharray="4 3" />
                <circle cx="26" cy="32" r="4.5" fill="#fff" stroke="#e9c56b" stroke-width="1.5" />
              </svg>
              <svg aria-hidden="true" viewBox="0 0 24 24" class="relative h-5 w-5 shrink-0">
                <path
                  d="M12 2 13.8 10.2 22 12 13.8 13.8 12 22 10.2 13.8 2 12 10.2 10.2Z"
                  fill={noelRegle() ? "#e9c56b" : "none"}
                  stroke="#e9c56b"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="relative min-w-0 text-left leading-tight">
                <span class="block truncate text-lg" style={{ "font-family": "'DM Serif Display', serif" }}>
                  {tr("ciel.noel.bouton").replace("{annee}", String(anneeDeNoel))}
                </span>
                <span class="block text-xs opacity-90">{tr("ciel.noel.detail")}</span>
              </span>
            </button>
            <span class="sr-only" aria-live="polite">
              {annonceNoel()}
            </span>
          </div>
        </Show>
        <div class="relative">
          <label for="ciel-ville" class="block text-sm font-medium">
            {tr("ciel.ville")}
          </label>
          <input
            id="ciel-ville"
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            aria-expanded={ouverte()}
            aria-controls="ciel-villes"
            aria-activedescendant={ouverte() && active() >= 0 ? `ciel-ville-${active()}` : undefined}
            value={saisie()}
            onInput={(e) => taper(e.currentTarget.value)}
            onKeyDown={clavier}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setTimeout(() => setOuverte(false), 150)}
            class={champ}
          />
          <Show when={ouverte()}>
            <ul
              id="ciel-villes"
              role="listbox"
              class="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto border border-ink/20 bg-paper shadow-lg"
            >
              <Show when={aucune()}>
                <li class="px-3 py-2 text-sm text-ink-soft">{tr("ciel.ville_aucune")}</li>
              </Show>
              <For each={proposees()}>
                {(v, i) => (
                  <li
                    id={`ciel-ville-${i()}`}
                    role="option"
                    aria-selected={active() === i()}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choisir(v);
                    }}
                    onMouseEnter={() => setActive(i())}
                    class={`cursor-pointer px-3 py-2 ${active() === i() ? "bg-ink/10" : ""}`}
                  >
                    <span class="font-medium">{v.nom}</span>
                    <span class="ml-2 text-sm text-ink-soft">{precision(v)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <span class="mt-1 block text-xs font-normal text-ink-soft">
            {ville() ? precision(ville()!) : tr("ciel.ville_aide")}
          </span>
          <Show when={manque()}>
            <span role="status" class="mt-1 block text-sm text-terracotta-deep">{tr("ciel.ville_choisir")}</span>
          </Show>
        </div>
        </Show>
        <button
          type="submit"
          disabled={occupe() || !!props.occupe}
          class="rounded-full bg-ink px-8 py-3 font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
        >
          {occupe() ? tr("ciel.calcul") : creation() ? tr("ciel.redessiner") : tr("ciel.dessiner")}
        </button>
        <Show when={erreur()}>
          {(cle) => (
            <p role="status" class="border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
              {tr(cle())}
            </p>
          )}
        </Show>
        {/* APRÈS « Dessiner mon ciel », qui ne porte que sur la date, l'heure
            et la ville (27/11, Alexandra : « Dessiner mon ciel ne concerne
            que date heure et ville et la couleur doit pouvoir être choisie
            après le dessin fait ») : la ville sous le ciel et les couleurs
            s'appliquent tout de suite au ciel déjà dessiné. */}
        {/* Le premier dessin prend la première couleur ; on choisit ensuite
            (Alexandra : « dessiner le ciel quand tu cliques ça fait le ciel
            avec la première couleur tu vois, et après tu choisis »). */}
        <Show when={dejaDessine()}>
        <Show when={style() === "nuit"}>
        <label class="flex items-center gap-2 pt-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={afficherVille()}
            onChange={(e) => {
              setAfficherVille(e.currentTarget.checked);
              redessinerSiDessine();
            }}
            class="h-4 w-4 accent-ink"
          />
          {tr("ciel.afficher_ville")}
        </label>
        </Show>
        <Show when={themes().length > 1}>
          <div>
            <span class="block text-sm font-medium" id="ciel-theme-titre">
              {tr("ciel.theme")}
            </span>
            {/* Sur UNE ligne qui défile de côté (27/11, Alexandra : « scroll
                horizontal et tout sur la même ligne »), comme les styles de
                l'affiche photo. Un peu de marge en haut et à droite : la
                coche du choix déborde du coin. */}
            <div
              role="radiogroup"
              aria-labelledby="ciel-theme-titre"
              class="mt-1 flex snap-x flex-nowrap gap-3 overflow-x-auto pb-2 pr-2 pt-2 [&>*]:shrink-0 [&>*]:snap-start"
            >
              <For each={themes()}>
                {(th) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme() === th.id}
                    onClick={() => choisirTheme(th.id)}
                    class={`ml-choix flex w-[4.75rem] flex-col items-center gap-1.5 border px-1 pb-1.5 pt-1 text-xs ${
                      theme() === th.id ? "border-ink font-semibold" : "border-ink/15 hover:border-ink/45"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      class="relative block aspect-[1/1.4142] w-full"
                      style={{ background: `linear-gradient(${th.haut}, ${th.fond} 75%, ${th.horizon})` }}
                    >
                      <span
                        class="absolute left-1/2 top-[55%] block h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                        style={{ "border-color": th.dorures }}
                      >
                        <span class="absolute left-[30%] top-[35%] block h-1 w-1 rounded-full" style={{ background: th.etoiles }} />
                        <span class="absolute left-[60%] top-[55%] block h-1.5 w-1.5 rounded-full" style={{ background: th.etoiles }} />
                        <span class="absolute left-[45%] top-[70%] block h-0.5 w-0.5 rounded-full" style={{ background: th.etoiles }} />
                      </span>
                    </span>
                    <span class="leading-tight">{th.nom}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        </Show>
      </form>

      <Show when={!props.onCree}>
      <div>
        <Show
          when={creation()}
          fallback={
            <div class="flex aspect-[1/1.4142] w-full max-w-[460px] items-center justify-center bg-[#16243d] p-8 text-center text-sm text-[#d9c38f]">
              {tr("ciel.attente")}
            </div>
          }
        >
          {(c) => (
            <>
              <img src={c().apercu} alt={tr("ciel.alt")} class="w-full max-w-[460px] border border-ink/10 shadow-sm" />
              <button
                type="button"
                onClick={personnaliser}
                class="mt-4 rounded-full bg-ink px-8 py-3 font-medium text-paper transition-colors hover:bg-ink/85"
              >
                {tr("ciel.personnaliser")}
              </button>
              {/* Plus de phrase d'aide sous le bouton (27/11, Alexandra : « supprimer
                  les phrases côté client qui sont inutiles ») : le bouton suffit. */}
            </>
          )}
        </Show>
      </div>
      </Show>
    </div>
  );
}
