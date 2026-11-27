/// <reference lib="dom" />
import {
  t,
  lien,
  LANGUE_DEFAUT,
  LOCALE_COMPLETE,
  type CleUi,
  type Langue,
} from "../i18n/utils.ts";
import {
  createSignal,
  createMemo,
  createEffect,
  ErrorBoundary,
  onCleanup,
  onMount,
  For,
  Index,
  Show,
  Suspense,
  untrack,
  type JSX,
} from "solid-js";
import {
  COULEURS_TEXTE_AFFICHE,
  COULEUR_TEXTE_DEFAUT,
  NB_LIGNES_AFFICHE,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_TITRE_DEFAUT,
  espaceAvantLigne,
  espacementDeLigne,
  familleCss,
  HAUT_DU_TEXTE,
  interligneDeLigne,
  INTERLIGNE_LIGNE_POSEE,
  ligneEnMajuscules,
  MARGE_DU_TEXTE,
  morceauxDeTexte,
  policeParId,
  limiterRetours,
  MORCEAUX_PAR_LIGNE,
  policesDeLaLigne,
  sousLignes,
  tailleDeLigneCqw,
  facteurTailleLigne,
  type Character,
  type PoliceAffiche,
  type PosterConfig,
  type TextBlock,
} from "@memoryline/types";
import { createReductionDesLignes, ZoneDefilante } from "@memoryline/configurator";
import { PUBLIC_API_URL, assetUrl, browserApi, formatPrice, getCartId, versLePanier } from "../lib/api.ts";
import {
  apercuAbsolu,
  attendreApercu,
  envoyerPhoto,
  lireStyles,
  verifierFormatPhoto,
  type StyleIA,
  genererAffiche,
  ErreurIA,
  TYPES_PHOTO,
  type EchecIA,
} from "../lib/ia.ts";
import RelaisPhoto from "./RelaisPhoto.tsx";
import CielEtoile, {
  zoneDuDessin,
  basDuTexte,
  type IdSigne,
  type MiseDuCiel,
  type PlaceTexte,
  type StyleCiel,
} from "./CielEtoile.tsx";
import type { CompositionIA } from "./PersonnagesIA.tsx";

/*
 * Les personnages et le muret (20/11) : leur écran ne vient qu'au besoin,
 * comme le configurateur sur les autres fiches (ProductConfigurator.tsx) —
 * la plupart des clients n'en ajoutent pas, et ni ce code ni la
 * bibliothèque des personnages n'ont à partir avec la fiche. Ils sont
 * demandés au repos dès la première création prête (voir
 * `personnagesDemandes`) : à l'ouverture, ils sont presque toujours là.
 *
 * Le module est gardé une fois arrivé, et redemandé à chaque besoin tant
 * qu'il n'est pas là (21/11). lazy() de solid-js gardait son PREMIER import
 * pour toute la vie de la page, échec compris : un morceau qui n'arrivait pas
 * (4G du marché) rendait « Les personnages n'ont pas pu être chargés » à
 * chaque nouvel essai, réseau revenu ou pas, jusqu'à un rechargement — qui
 * perd les textes tapés. Le navigateur, lui, redemande un module qui a échoué
 * (vérifié sur Chrome 156 et 158) : rouvrir suffit désormais. Et le grand
 * aperçu montre les personnages dès que le module arrive, par quelque chemin
 * que ce soit.
 */
type ModulePersonnages = typeof import("./PersonnagesIA.tsx");
const [modulePersonnages, setModulePersonnages] = createSignal<ModulePersonnages>();
const chargerPersonnages = (): Promise<ModulePersonnages> =>
  import("./PersonnagesIA.tsx").then((m) => {
    setModulePersonnages(() => m);
    return m;
  });

/**
 * Les refus du panier pour une affiche AVEC personnages (20/11) : le serveur
 * revérifie la création avant d'accepter la ligne, et répond par l'un de ces
 * codes (400 { error }). Une ligne sans personnage n'en reçoit jamais.
 */
const REFUS_PANIER = ["ia_indisponible", "ia_autre_affiche", "ia_personnages_paysage"] as const;
type RefusPanier = (typeof REFUS_PANIER)[number];

/**
 * Le code d'un refus du panier, lu dans l'erreur levée par l'ajout
 * (api-navigateur.ts : « API POST … -> 400 {"error":"ia_indisponible"} »).
 * Null pour toute autre panne.
 */
function refusDuPanier(e: unknown): RefusPanier | null {
  const texte = String(e);
  return REFUS_PANIER.find((code) => texte.includes(`"${code}"`)) ?? null;
}

/**
 * Parcours des affiches IA : le client choisit un style (quand la boutique en
 * propose), envoie une photo, lance la création, voit l'affiche générée,
 * recommence autant de fois qu'il le souhaite, puis met au panier celle qu'il
 * garde.
 *
 * AUCUN quota côté client — décision de la cliente, prise en connaissance du
 * coût. Le seul frein possible vient du serveur (anti-rafale, plafond de
 * dépense) et se lit ici comme un message d'attente, pas comme un refus sec.
 *
 * Les routes /ia/* peuvent ne pas encore répondre : chaque échec se termine
 * par une phrase en français et un geste à faire, jamais par une page cassée.
 *
 * Une affiche obtenue en portrait peut recevoir des personnages, de dos sur
 * un muret ou debout de face (20/11) : composés avec le module des affiches
 * personnalisables (PersonnagesIA.tsx), gardés avec leur création, envoyés
 * avec elle au panier. Sans personnage, rien ne change, ligne de panier
 * comprise.
 */
export interface AfficheIAProps {
  /**
   * Affiche « ciel étoilé » (26/11, case du BO) : la photo cède la place à
   * une date, une heure et un lieu.
   */
  ciel?: boolean;
  langue?: Langue;
  product: { id: number; name: string; basePriceCents: number };
  /** Formats vendus et leur prix, dans l'ordre du catalogue. */
  formats?: { format: string; priceCents: number }[];
  /**
   * Au stand : aucun montant sous les formats.
   *
   * L'affiche tirée d'une photo se vend au stand comme les autres, et comme
   * les autres sans prix : c'est la vendeuse qui les annonce. Le prix reste
   * calculé et enregistré avec la ligne du panier.
   */
  sansPrix?: boolean;
  /**
   * La tablette du stand : la photo peut alors venir du téléphone du client
   * (RelaisPhoto.tsx), avec le code du stand. Sur le site, le même relais
   * existe depuis le 21/11, sans code, mais sur un grand écran seulement
   * (voir `grandEcran`) : sur un téléphone, le visiteur a sa photo sous la
   * main, dans l'appareil qui affiche la page.
   */
  stand?: boolean;
}

/** Étapes du parcours, dans l'ordre où le client les traverse. */
type Etape = "depot" | "envoi" | "generation" | "pret";

/* --------------------------------------------------------------------------
 * Les dessins d'attente
 *
 * Une case grise vide se lit comme une image qui n'a pas chargé (retour du
 * 6/10) : celle d'un style sans image d'exemple, comme le grand aperçu avant
 * la première création. On y pose un dessin simple, au trait, dans la couleur
 * du texte adoucie : il dit ce qui viendra là, sans faire croire à une image.
 * ------------------------------------------------------------------------ */

/** Ce que montre le dessin d'attente d'un style. */
type SujetStyle = "personnes" | "paysage" | "maison" | "image";

/**
 * Le sujet d'un style, deviné d'après son nom — dans la langue de la page :
 * le nom arrive traduit. Un nom qu'on ne reconnaît pas reçoit une image en
 * général : la boutique peut créer d'autres styles, ils auront leur dessin.
 */
function sujetDuStyle(titre: string): SujetStyle {
  const nom = titre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/person|people|mensch|gens|famil|anima|tier|pet|mascota|portrait|couple/.test(nom)) return "personnes";
  if (/maison|house|haus|casa|batiment|building|gebaude|edific|ville|city|stadt|citta|ciudad/.test(nom))
    return "maison";
  if (/paysage|landscape|landschaft|paesagg|paisaj|nature|natur/.test(nom)) return "paysage";
  return "image";
}

/**
 * Le trait des dessins d'attente, sur une grille de 48 × 48.
 *
 * Des FONCTIONS, pas des éléments : un élément Solid est un nœud du document,
 * et deux styles au même sujet se seraient disputé le même dessin — le
 * second l'aurait arraché au premier.
 */
const TRAITS_STYLE: Record<SujetStyle, () => JSX.Element> = {
  personnes: () => (
    <>
      <circle cx="18" cy="17" r="5" />
      <path d="M8 36c0-6 4.5-10 10-10s10 4 10 10" />
      <circle cx="32.5" cy="20" r="4" />
      <path d="M28.5 29.5c1.2-1 2.6-1.5 4-1.5 4.4 0 7.5 3.4 7.5 8" />
    </>
  ),
  paysage: () => (
    <>
      <circle cx="33" cy="15" r="4" />
      <path d="M6 36l11-13 8 9 5-5 12 9" />
      <path d="M6 36h36" />
    </>
  ),
  maison: () => (
    <>
      <path d="M8 23L24 10l16 13" />
      <path d="M12.5 20v16h23V20" />
      <path d="M21 36v-9h6v9" />
    </>
  ),
  image: () => (
    <>
      <rect x="8" y="10" width="32" height="28" rx="2" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8 32l10-9 7 6 5-4 10 8" />
    </>
  ),
};

/**
 * Le dessin des deux boutons des personnages (20/11), au même trait et sur
 * la même grille : deux bustes vus de dos derrière le muret, ou deux
 * silhouettes debout, de face. Des fonctions, pour la même raison.
 */
const TRAITS_PERSONNAGES: Record<"back" | "front", () => JSX.Element> = {
  back: () => (
    <>
      <circle cx="17" cy="14" r="4.5" />
      <path d="M10 31v-4c0-4 3.1-7 7-7s7 3 7 7v4" />
      <circle cx="31" cy="16.5" r="4" />
      <path d="M25 31v-3.5c0-3.4 2.7-6.2 6-6.2s6 2.8 6 6.2V31" />
      <rect x="5" y="31" width="38" height="10" rx="1" />
      <path d="M5 36h38M17 31v5M31 36v5" />
    </>
  ),
  front: () => (
    <>
      <circle cx="18" cy="11" r="4.5" />
      <path d="M11 41V26c0-4 3.1-7 7-7s7 3 7 7v15" />
      <circle cx="32" cy="15" r="3.8" />
      <path d="M26.5 41V28.5c0-3.2 2.5-5.8 5.5-5.8s5.5 2.6 5.5 5.8V41" />
      <path d="M6 41h36" />
    </>
  ),
};

/** La case d'un style qui n'a pas encore d'image d'exemple. */
function AttenteStyle(props: { titre: string }): JSX.Element {
  return (
    <span class="flex aspect-[4/5] w-full items-center justify-center bg-paper-deep text-ink/40">
      <svg
        viewBox="0 0 48 48"
        class="h-16 w-16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        {TRAITS_STYLE[sujetDuStyle(props.titre)]()}
      </svg>
    </span>
  );
}

/**
 * Le grand aperçu, tant qu'il n'y a ni photo ni création : une affiche
 * esquissée — dans le sens choisi — au-dessus de la phrase qui dit ce qui
 * viendra là.
 */
function AttenteAffiche(props: { paysage: boolean; texte: string; ciel?: boolean }): JSX.Element {
  return (
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-sm text-ink-soft">
      <svg
        viewBox="0 0 64 64"
        class="h-24 w-24 text-ink/30"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <Show
          when={props.paysage}
          fallback={
            <Show
              when={!props.ciel}
              fallback={
                // Le ciel étoilé (27/11) : une affiche, sa carte ronde, des étoiles.
                <>
                  <rect x="13" y="5" width="38" height="54" rx="1.5" />
                  <path d="M24 12h16" />
                  <circle cx="32" cy="35" r="12" />
                  <path d="M28 31.5l.01 0M35 30l.01 0M31 38l.01 0M37 37l.01 0M26 37l.01 0" stroke-width="2.5" />
                  <path d="M28 31.5L35 30 37 37" stroke-width="0.8" />
                </>
              }
            >
            <>
              <rect x="13" y="5" width="38" height="54" rx="1.5" />
              <path d="M24 12h16" />
              <rect x="18" y="17" width="28" height="34" rx="1" />
              <circle cx="37.5" cy="25" r="3.5" />
              <path d="M18 45l8-9 6 6 4-4 10 8" />
            </>
            </Show>
          }
        >
          <rect x="5" y="13" width="54" height="38" rx="1.5" />
          <path d="M24 19h16" />
          <rect x="11" y="24" width="42" height="22" rx="1" />
          <circle cx="44" cy="30" r="3" />
          <path d="M11 42l10-8 7 5 6-4 19 9" />
        </Show>
      </svg>
      <span>{props.texte}</span>
    </div>
  );
}

/**
 * Le texte d'une ligne de l'affiche, tel que l'écrit le fichier d'impression :
 * un bloc par morceau coupé à la main (touche Entrée), sans trou pour les
 * morceaux vides, et chaque bout dans la police qui sait l'écrire — la
 * manuscrite ne connaît pas les chiffres, ils s'écrivent en Caveat.
 * `data-sous-ligne` : c'est ce que mesure la réduction des lignes trop
 * longues (createReductionDesLignes).
 */
function MorceauxDeLigne(props: { valeur: string; police: PoliceAffiche }): JSX.Element {
  return (
    <For each={sousLignes(props.valeur)}>
      {(sousLigne) => (
        <div data-sous-ligne>
          <For each={morceauxDeTexte(sousLigne, props.police)}>
            {(morceau) => (
              <span style={{ "font-family": familleCss(morceau.police) }}>{morceau.texte}</span>
            )}
          </For>
        </div>
      )}
    </For>
  );
}

export default function AfficheIA(props: AfficheIAProps): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  const locale = LOCALE_COMPLETE[props.langue ?? LANGUE_DEFAUT];

  const [etape, setEtape] = createSignal<Etape>("depot");
  const [echec, setEchec] = createSignal<EchecIA | RefusPanier | null>(null);
  const [survol, setSurvol] = createSignal(false);
  const [precision, setPrecision] = createSignal("");
  /**
   * Le sens de l'affiche : celui que le client CHOISIT pour la prochaine
   * génération, et celui de l'aperçu À L'ÉCRAN — les deux divergent le temps
   * qu'il change d'avis et relance. C'est le second qui part au panier : on
   * imprime l'affiche qu'il a vue, pas celle qu'il s'apprêtait à demander.
   */
  const [orientation, setOrientation] = createSignal<"portrait" | "paysage">("portrait");
  /**
   * Le client a-t-il choisi le sens lui-même ? Tant que non, la photo le
   * propose : une photo prise en largeur donne une affiche en paysage, sans
   * qu'il ait à y penser. Dès qu'il touche un des deux boutons, c'est son
   * choix qui compte, pour cette photo comme pour la suivante.
   */
  let sensChoisiALaMain = false;
  const [orientationApercu, setOrientationApercu] =
    createSignal<"portrait" | "paysage">("portrait");
  /** Le sens du cadre d'aperçu : celui de l'affiche montrée, sinon celui choisi. */
  const sensAffiche = () => (apercu() ? orientationApercu() : orientation());
  /**
   * Les tailles de texte sont en cqw (largeur du cadre). En paysage, le cadre
   * est 1,41 fois plus large pour la même feuille : on les ramène au petit
   * côté, exactement comme le PDF (voir pdf.ts, buildTextSvg).
   */
  const echelleTexte = () => (sensAffiche() === "paysage" ? 1 / Math.SQRT2 : 1);

  /**
   * Le nombre d'exemplaires.
   *
   * Il apparaît seulement une fois l'affiche obtenue, et c'est la différence
   * avec les deux autres parcours : ici, on ne sait pas encore ce qu'on
   * achète avant de l'avoir vu. Demander « combien ? » avant la génération
   * reviendrait à faire choisir une quantité d'une chose qui n'existe pas.
   *
   * Borné entre 1 et 20, comme ailleurs.
   */
  const [quantite, setQuantite] = createSignal(1);
  const bornerQuantite = (n: number) =>
    Math.min(20, Math.max(1, Math.trunc(n) || 1));

  /*
   * Les styles proposés par la boutique, et celui que la cliente a choisi.
   *
   * Lus une fois à l'ouverture. Une liste vide — boutique qui n'en a pas
   * encore créé, ou API muette — fait simplement disparaître le bloc : la
   * photo part sans style, avec la seule consigne générale.
   *
   * Dès qu'il y en a un, le style se choisit AVANT la photo. La création,
   * elle, attend toujours le bouton « Créer mon affiche » (voir choisirPhoto) :
   * la première génération, payée comme les suivantes, ne part jamais sans
   * le style ni le sens que la cliente a choisis.
   */
  const [styles, setStyles] = createSignal<StyleIA[]>([]);
  const [styleChoisi, setStyleChoisi] = createSignal<number | null>(null);
  onMount(() => void lireStyles(props.langue).then(setStyles));
  /** La boutique propose des styles : il faut en choisir un. */
  const choixDuStyle = () => styles().length > 0;
  /** Un style reste à choisir avant de créer l'affiche. */
  const styleManquant = () => choixDuStyle() && styleChoisi() === null;
  /*
   * Le rappel du style (20/11, une vente manquée au stand : la photo
   * restait grisée tant qu'aucun genre n'était choisi, et l'on touchait le
   * bouton sans que rien ne se passe). La photo — sur la tablette ou par le
   * téléphone — se choisit désormais à tout moment ; seul « Créer » attend le
   * style, et un appui sans lui AMÈNE au choix et le dit en rouge.
   */
  const [rappelStyle, setRappelStyle] = createSignal(false);
  /** Le bloc des styles, en haut de l'étape 1 : le rappel l'amène en vue. */
  let blocStyle: HTMLDivElement | undefined;
  const rappelerLeStyle = () => {
    setRappelStyle(true);
    // Les styles sont à l'étape 1 depuis le 27/11 : elle doit être montrée
    // AVANT de faire défiler jusqu'à eux.
    allerA("source", true);
    requestAnimationFrame(() => blocStyle?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  /**
   * Les trois lignes de texte, « comme sur les autres affiches » : mêmes
   * polices, mêmes deux couleurs, même rendu. L'affiche IA n'est pas un autre
   * produit, c'est une affiche dont le fond vient d'une photo — le texte se
   * compose par-dessus exactement comme sur un fond du catalogue, à l'écran
   * comme à l'impression.
   */
  /**
   * `taille` (27/11, Alexandra : « 3 tailles de texte à chaque fois sur chaque
   * ligne […] pour toutes les affiches », puis devant le ciel : « la taille des
   * textes sur les lignes ça se met où je vois rien ») : petit / moyen / grand.
   * Absente = moyen = la taille d'avant ; « m » n'est jamais envoyé, une ligne
   * d'avant garde donc son empreinte d'impression.
   */
  type Ligne = { value: string; font: string; x?: number; y?: number; taille?: "s" | "m" | "l" };
  const [lignes, setLignes] = createSignal<Ligne[]>(
    Array.from({ length: NB_LIGNES_AFFICHE }, (_, i) => ({
      value: "",
      font: i === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT,
    })),
  );
  const [couleur, setCouleur] = createSignal(COULEUR_TEXTE_DEFAUT);
  const modifierLigne = (rang: number, patch: Partial<Ligne>) =>
    setLignes((l) => l.map((x, i) => (i === rang ? { ...x, ...patch } : x)));

  /**
   * La frappe dans une ligne, avec la règle des affiches personnalisables :
   * la première ligne passe en capitales À LA SAISIE (voir
   * `ligneEnMajuscules`). Le texte enregistré est ainsi celui que l'aperçu
   * montre et que le fichier d'impression écrira — le moteur d'impression ne
   * transforme rien, il imprime ce que la ligne contient.
   *
   * Le champ est réécrit ici, curseur compris : sans cela, taper au milieu
   * d'un mot renverrait le curseur en fin de ligne à chaque lettre.
   */
  function saisirLigne(rang: number, champ: HTMLTextAreaElement) {
    // Trois morceaux au plus : les retours à la ligne en trop deviennent des
    // espaces (limiterRetours), sans perdre un mot.
    const brut = champ.value;
    const limite = limiterRetours(brut);
    const value = ligneEnMajuscules(rang) ? limite.toLocaleUpperCase() : limite;
    if (value !== brut) {
      const debut = champ.selectionStart;
      const fin = champ.selectionEnd;
      champ.value = value;
      // `ß` devient `SS` : la longueur change, l'ancienne position ne veut
      // plus rien dire, et le curseur reste alors où le navigateur le met.
      if (value.length === brut.length && debut !== null && fin !== null)
        champ.setSelectionRange(debut, fin);
    }
    modifierLigne(rang, { value });
  }

  /**
   * Déplacement d'une ligne à la souris (ou au doigt).
   *
   * Tant qu'une ligne n'a pas été touchée, elle suit la mise en page
   * automatique. Au premier geste, on relève où elle se trouve, on la détache,
   * et elle suit le pointeur. Sa position se garde en fractions de l'affiche :
   * la même valeur sert à l'aperçu, quelle que soit sa taille à l'écran, et au
   * PDF d'impression — c'est ce qui garantit que l'affiche livrée est celle
   * que le client a composée.
   */
  let boiteAffiche: HTMLDivElement | undefined;
  function attraperLigne(e: PointerEvent, rangDansLignes: number) {
    if (!boiteAffiche) return;
    e.preventDefault();
    const cadre = boiteAffiche.getBoundingClientRect();
    const cible = e.currentTarget as HTMLElement;
    const boite = cible.getBoundingClientRect();
    // Le pointeur n'est pas forcément au centre de la ligne : on retient
    // l'écart pour que la ligne ne saute pas sous le doigt au premier pixel.
    const ecartX = e.clientX - (boite.left + boite.width / 2);
    const ecartY = e.clientY - (boite.top + boite.height / 2);
    const poser = (ev: PointerEvent) => {
      const x = (ev.clientX - ecartX - cadre.left) / cadre.width;
      const y = (ev.clientY - ecartY - cadre.top) / cadre.height;
      modifierLigne(rangDansLignes, {
        x: Math.min(0.97, Math.max(0.03, x)),
        y: Math.min(0.97, Math.max(0.03, y)),
      });
    };
    // Les mouvements s'ecoutent sur la FENETRE, pas sur la ligne : au premier
    // deplacement la ligne quitte l'empilement pour le calque des positions
    // libres, donc son element est recree — une capture de pointeur posee
    // dessus se perdrait en route, et la ligne resterait plantee la ou on
    // l'a attrapee.
    poser(e);
    const selectionAvant = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const finir = () => {
      window.removeEventListener("pointermove", poser);
      window.removeEventListener("pointerup", finir);
      window.removeEventListener("pointercancel", finir);
      document.body.style.userSelect = selectionAvant;
    };
    window.addEventListener("pointermove", poser);
    window.addEventListener("pointerup", finir);
    window.addEventListener("pointercancel", finir);
  }

  /** Les lignes réellement écrites, dans l'ordre — celles qu'on dessine. */
  const lignesRemplies = () =>
    lignes()
      .map((l, rang) => ({ ...l, rang }))
      .filter((l) => l.value.trim() !== "");

  /**
   * Les deux calques de texte de l'aperçu (lignes empilées, lignes posées),
   * et la réduction des lignes trop longues pour la largeur du bloc : la
   * même règle que l'aperçu des affiches classiques et que le fichier
   * d'impression — réduite, jamais repliée.
   */
  let calqueEmpile: HTMLDivElement | undefined;
  let calquePose: HTMLDivElement | undefined;
  const reductionDeLigne = createReductionDesLignes(
    () => [calqueEmpile, calquePose],
    () =>
      lignesRemplies()
        .map((l) => `${l.font}\u0000${l.value}\u0000${typeof l.x === "number"}\u0000${l.taille ?? "m"}`)
        .join("\n") + sensAffiche(),
  );
  /** La police d'une ligne, par son rang parmi les lignes remplies. */
  const policeDeLigne = (font: string | undefined, rang: number) =>
    policeParId(font, rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT);

  // Les clés de traduction sont un type fermé : on les énumère au lieu de les
  // fabriquer par interpolation, sinon le compilateur ne peut plus garantir
  // qu'elles existent dans les cinq langues.
  /** Les trois tailles d'une ligne, petite à grande (27/11). */
  const TAILLES_LIGNE = [
    { id: "s", cle: "cfg.taille_s", px: 12 },
    { id: "m", cle: "cfg.taille_m", px: 15 },
    { id: "l", cle: "cfg.taille_l", px: 19 },
  ] as const;
  const CLES_LIGNES = [
    { champ: "cfg.ligne1_champ", exemple: "cfg.ligne1_exemple" },
    { champ: "cfg.ligne2_champ", exemple: "cfg.ligne2_exemple" },
    { champ: "cfg.ligne3_champ", exemple: "cfg.ligne3_exemple" },
  ] as const;

  /*
   * Le nom des polices et des couleurs : la liste partagée
   * (@memoryline/types) ne le connaît qu'en français. La traduction se choisit
   * d'après l'identifiant, le même que celui du configurateur ; un
   * identifiant sans clé garde son nom français plutôt que de rester sans nom.
   */
  const CLES_POLICES: Record<string, CleUi> = {
    serif: "cfg.police.serif",
    abril: "cfg.police.abril",
    shabby: "cfg.police.shabby",
  };
  const CLES_COULEURS: Record<string, CleUi> = {
    blanc: "cfg.couleur.blanc",
    anthracite: "cfg.couleur.anthracite",
  };
  const nomTraduit = (
    cles: Record<string, CleUi>,
    choix: { id: string; libelle: string },
  ) => {
    const cle = cles[choix.id];
    return cle ? tr(cle) : choix.libelle;
  };
  const [ajout, setAjout] = createSignal(false);

  /** Chemin de la photo côté serveur, réutilisé à chaque nouvel essai. */
  const [chemin, setChemin] = createSignal<string | null>(null);
  /** Vignette locale de la photo choisie — affichée sans attendre le serveur. */
  const [photoLocale, setPhotoLocale] = createSignal<string | null>(null);
  const [nomPhoto, setNomPhoto] = createSignal<string | null>(null);

  const [publicId, setPublicId] = createSignal<string | null>(null);
  /** Adresse affichée (elle peut porter un paramètre anti-cache). */
  const [apercu, setApercu] = createSignal<string | null>(null);
  /**
   * Adresse BRUTE renvoyée par l'API, telle qu'elle part au panier. Comme le
   * fond d'une affiche, cette valeur reste des années dans la commande : y
   * figer le préfixe de l'API ou un paramètre anti-cache la rendrait caduque.
   */
  const [apercuChemin, setApercuChemin] = createSignal<string | null>(null);

  /**
   * Toutes les affiches obtenues pendant la séance, dans l'ordre.
   *
   * Une nouvelle création REMPLAÇAIT la précédente : au stand, une famille
   * qui en essayait trois ne pouvait plus revoir la première, ni en garder
   * deux — alors que chacune a été payée. Elles restent donc toutes ici, en
   * vignettes sous l'aperçu : on en revoit une d'un toucher, on coche celles
   * qu'on garde, et elles partent ensemble au panier.
   *
   * Gardées aussi en mémoire (memoireDesCreations : l'onglet au stand, le
   * navigateur sur le site, depuis le 27/11) : un rechargement par erreur
   * sur la tablette ne doit pas les faire perdre. La clé porte le PANIER :
   * au stand, « Terminé » repart d'un panier neuf, et le client suivant ne
   * voit donc rien de celles du précédent. Chacune garde la photo dont elle
   * vient, pour pouvoir la relancer.
   */
  type Creation = {
    publicId: string;
    /** Adresse brute de l'aperçu, celle qui part au panier. */
    apercuChemin: string;
    /** Adresse affichée. */
    apercu: string;
    sens: "portrait" | "paysage";
    /** La photo côté serveur dont elle est tirée. */
    source: string;
    /**
     * Ses personnages et son muret (20/11), en portrait seulement. Absente :
     * l'affiche part au panier exactement comme avant. Gardée avec la
     * création, elle survit au retour sur une autre création et au
     * rechargement de la page.
     */
    compo?: CompositionIA;
    /** Quand elle a été créée (ms) : au-delà de JOURS_DES_CREATIONS, elle n'est plus proposée. */
    le?: number;
    /** Un ciel étoilé (27/11) : son style et la place de son texte, d'où se posent les lignes. */
    mise?: MiseDuCiel;
  };
  /** Lue dans le navigateur seulement : le panier n'existe pas au rendu serveur. */
  let cleCreations = "";
  const [creations, setCreations] = createSignal<Creation[]>([]);
  /** Les créations cochées pour le panier, par leur identifiant. */
  const [aAjouter, setAAjouter] = createSignal<string[]>([]);
  /**
   * Où vivent les créations (relecture du 27/11). Sur le site, dans le
   * NAVIGATEUR (localStorage) : depuis la limite de trois essais par jour,
   * une cliente qui fermait l'onglet, ou rouvrait la fiche dans un autre,
   * perdait ses créations ET ne pouvait plus en refaire — plus rien à mettre
   * au panier. Au stand, dans l'ONGLET, comme avant (sessionStorage) : la
   * tablette passe d'un client à l'autre.
   */
  const memoireDesCreations = (): Storage => (props.stand ? sessionStorage : localStorage);
  /** Une création plus vieille ne se propose plus : son image a pu être effacée du serveur. */
  const JOURS_DES_CREATIONS = 7;
  onMount(() => {
    try {
      cleCreations = `ml_ia_creations_${getCartId()}_${props.product.id}`;
      const lire = (m: Storage) => {
        const l = JSON.parse(m.getItem(cleCreations) ?? "[]") as Creation[];
        return Array.isArray(l) ? l : [];
      };
      // Sur le site, aussi celles qu'un onglet d'avant ce changement avait
      // gardées pour lui seul.
      const lues = props.stand ? lire(sessionStorage) : [...lire(localStorage), ...lire(sessionStorage)];
      const limite = Date.now() - JOURS_DES_CREATIONS * 86_400_000;
      const vues = new Set<string>();
      setCreations(
        lues.filter((c) => {
          if (!c?.publicId || !c?.apercu || vues.has(c.publicId)) return false;
          vues.add(c.publicId);
          return !c.le || c.le >= limite;
        }),
      );
    } catch {
      /* mémoire indisponible (navigation privée…) : la séance repart de zéro */
    }
    // Arrivée du ciel étoilé (26/11, /ciel-etoile) : la page du ciel a rangé
    // sa création parmi celles de la séance et l'ouvre ici, où l'on pose
    // textes, personnages, format, comme sur une affiche tirée d'une photo.
    try {
      const adresse = new URL(location.href);
      const id = adresse.searchParams.get("creation");
      const venue = id ? creations().find((c) => c.publicId === id) : undefined;
      if (venue) revoir(venue);
      if (id) {
        adresse.searchParams.delete("creation");
        history.replaceState(history.state, "", adresse.pathname + adresse.search + adresse.hash);
      }
    } catch {
      /* adresse illisible : la page s'ouvre comme d'habitude */
    }
  });
  function memoriserCreations(liste: Creation[]) {
    // Datées à leur arrivée (27/11), pour ne plus proposer, des jours plus
    // tard, une création dont l'image a été effacée du serveur.
    const datees = liste.map((c) => (c.le ? c : { ...c, le: Date.now() }));
    setCreations(datees);
    try {
      if (cleCreations) memoireDesCreations().setItem(cleCreations, JSON.stringify(datees));
    } catch {
      /* mémoire pleine ou interdite : la liste vit au moins dans la page */
    }
  }
  /** Montre une création dans le grand aperçu, comme si elle venait d'arriver. */
  function revoir(c: Creation) {
    setPublicId(c.publicId);
    setApercuChemin(c.apercuChemin);
    setApercu(c.apercu);
    setOrientationApercu(c.sens);
    setChemin(c.source);
    setEchec(null);
    setEtape("pret");
  }
  /**
   * Le ciel étoilé (26/11, Alexandra : « fais moi en fiche produit
   * personnalisable avec texte comme pour les affiches » ; « c'est 2 produits
   * différents ») : sur l'affiche « Ciel étoilé » (case du BO, `ciel`), la
   * photo cède la place à une date, une heure et une ville ; le ciel dessiné
   * (API /ia/ciel) devient l'affiche montrée, et la suite — textes,
   * personnages, format, panier — est celle de cette fiche.
   */
  const modeCiel = () => props.ciel === true;
  function cielCree(c: { publicId: string; apercuChemin: string; apercu: string; mise: MiseDuCiel }) {
    // Le couple arrive en paysage (27/11 au soir) : l'aperçu se couche, et la
    // ligne de panier part en paysage (orientation de la config), comme une
    // affiche photo en paysage.
    const sens = c.mise.paysage ? "paysage" : "portrait";
    setEchec(null);
    setChemin(null);
    setPublicId(c.publicId);
    setApercuChemin(c.apercuChemin);
    setOrientationApercu(sens);
    setApercu(c.apercu);
    setEtape("pret");
    memoriserCreations([
      ...creations().filter((x) => x.publicId !== c.publicId),
      { ...c, sens, source: "" },
    ]);
  }

  /*
   * La mise en page du ciel (27/11, Alexandra : « pas de drag and drop par
   * les clients surtout, ils vont faire n'imp ça doit être simple », « genre
   * "texte en haut, texte en bas" », « texte trop collé aussi », « ensemble
   * mais trop de place entre tête et cercle »).
   *
   * Dans la fenêtre du ciel, les lignes ne se déplacent plus : elles se
   * POSENT d'office, en un bloc rapproché du dessin — au-dessus de lui (texte
   * en haut) ou dessous (texte en bas) —, avec un vrai écart entre elles,
   * mesuré sur les polices (une Manuscrite déborde de sa ligne, elle ne mord
   * plus sur la voisine). Ces places partent avec chaque ligne, comme celles
   * d'une ligne déplacée sur l'affiche photo : le moteur commun (aperçu,
   * fichier d'impression) n'en sait pas plus, et les autres affiches ne
   * bougent pas.
   */
  const [texteCiel, setTexteCiel] = createSignal<PlaceTexte>("haut");
  /** Le style du formulaire, pour la place du texte par défaut. */
  let styleCielVu: StyleCiel | null = null;
  /** Le même, à suivre : l'étape Personnages n'existe que pour « nuit » (27/11). */
  const [styleCiel, setStyleCiel] = createSignal<StyleCiel | null>(null);
  /** Les qualités posées d'office sur la dernière ligne, tant qu'on n'y touche pas. */
  let qualitesPosees = "";
  /**
   * Le style ou les signes changent dans le formulaire : la place du texte
   * revient à celle du style (en haut pour le ciel de cette nuit, en bas pour
   * un signe) ; un seul signe remplit la dernière ligne de ses trois qualités
   * (27/11, Alexandra : « pas mal du tout l'idée des qualités ! ») si elle est
   * vide — ou si elle porte encore celles posées d'office pour un autre signe.
   * Pour un couple, rien d'automatique.
   */
  function reglageCiel(r: { style: StyleCiel; signes: IdSigne[] }) {
    if (r.style !== styleCielVu) {
      styleCielVu = r.style;
      setStyleCiel(r.style);
      setTexteCiel(r.style === "nuit" ? "haut" : "bas");
      // Les personnages ne vont que sur le ciel de cette nuit (27/11,
      // Alexandra : « et si on modifie le style ça doit les supp ») : un
      // autre style les retire, et le ciel se redessine sans eux.
      if (r.style !== "nuit") {
        clearTimeout(minuteurSilhouettes);
        setChoixSilhouettes([]);
        setSilhouettesCiel([]);
      }
    }
    const derniere = NB_LIGNES_AFFICHE - 1;
    const actuelle = lignes()[derniere]?.value ?? "";
    const unSigne = (r.style === "signe" || r.style === "libre") && r.signes.length === 1;
    const qualites = unSigne ? tr(`ciel.qualites.${r.signes[0]!}`) : "";
    if (qualites && (actuelle.trim() === "" || actuelle === qualitesPosees)) {
      modifierLigne(derniere, { value: qualites });
      qualitesPosees = qualites;
    } else if (!qualites && qualitesPosees && actuelle === qualitesPosees) {
      // Plus un seul signe (couple, ciel de cette nuit) : les qualités posées
      // d'office s'en vont ; une ligne retouchée par la cliente reste (27/11,
      // relecture : « la ligne 3 garde les qualités de la Vierge sur le couple »).
      modifierLigne(derniere, { value: "" });
      qualitesPosees = "";
    }
  }
  /** La mise du ciel montré (celle de sa création), à défaut celle d'avant les styles. */
  const miseMontree = (): MiseDuCiel =>
    creations().find((c) => c.publicId === publicId())?.mise ?? { style: "nuit", texte: "haut", ville: false, signes: [] };
  /*
   * Sur un fond clair (« Crème »), le texte passe en gris anthracite tant que
   * la cliente n'a pas choisi sa couleur ; sur un fond sombre, il revient au
   * blanc (27/11, relecture : « les lignes sont blanches sur beige »).
   */
  let couleurChoisie = false;
  const ANTHRACITE = COULEURS_TEXTE_AFFICHE.find((c) => c.id === "anthracite")?.hex ?? COULEUR_TEXTE_DEFAUT;
  createEffect(() => {
    if (!modeCiel()) return;
    const clair = miseMontree().clair === true;
    if (!couleurChoisie) setCouleur(clair ? ANTHRACITE : COULEUR_TEXTE_DEFAUT);
  });
  /** Le redessin attend une date ou un signe (CielEtoile, `onIncomplet`). */
  const [cielIncomplet, setCielIncomplet] = createSignal(false);

  /**
   * Les places des lignes remplies sur le ciel montré : x au milieu, y au
   * centre de chaque ligne (en fraction de la hauteur), comme une ligne posée.
   */
  const placesDuCiel = createMemo(() => {
    const remplies = lignesRemplies();
    const mise = miseMontree();
    const zone = zoneDuDessin(mise);
    // Taille d'une ligne en fraction de la HAUTEUR : en portrait, la largeur
    // est 1/√2 de la hauteur ; en paysage (le couple, 27/11), la ligne se
    // mesure sur le petit côté, qui EST la hauteur (comme le fichier
    // d'impression, pdf.ts : Math.min(width, height)).
    const taille = (rang: number) =>
      ((tailleDeLigneCqw(rang) / 100) * (1 - 2 * MARGE_DU_TEXTE)) / (mise.paysage ? 1 : Math.SQRT2);
    const boites = remplies.map((l, rang) => {
      const police = policeDeLigne(l.font, rang);
      // × la taille choisie sur la ligne (27/11) : une grande ligne pousse
      // les suivantes, comme à l'impression.
      const t = taille(rang) * facteurTailleLigne(l.taille);
      const n = Math.max(1, sousLignes(l.value).length);
      // Ce qui dépasse de la boîte de ligne, en haut et en bas : les grandes
      // hampes de la Manuscrite (et de sa police de secours pour les chiffres).
      const polices = [police, ...morceauxDeTexte(l.value, police).map((m) => m.police)];
      const deborde = Math.max(0, ...polices.map((p) => (p.ascendante + p.descendante - INTERLIGNE_LIGNE_POSEE) / 2)) * t;
      return { t, boite: n * t * INTERLIGNE_LIGNE_POSEE, deborde };
    });
    // Entre deux lignes : leurs débords, plus un tiers de la plus petite.
    const ecarts = boites.slice(1).map((b, i) => boites[i]!.deborde + b.deborde + 0.33 * Math.min(b.t, boites[i]!.t));
    const hauteur =
      boites.reduce((s, b) => s + b.boite, 0) +
      ecarts.reduce((s, e) => s + e, 0) +
      (boites[0]?.deborde ?? 0) +
      (boites[boites.length - 1]?.deborde ?? 0);
    // Le bloc se tient à 3 % de la hauteur du dessin, sans sortir de la feuille.
    const haut =
      mise.texte === "haut"
        ? Math.max(0.045, zone.haut - 0.03 - hauteur)
        : // Avec des personnages, le bloc s'arrête au-dessus de leurs têtes (27/11).
          Math.min(zone.bas + 0.03, basDuTexte(mise) - hauteur);
    const places = new Map<number, { x: number; y: number }>();
    let y = haut + (boites[0]?.deborde ?? 0);
    remplies.forEach((l, i) => {
      const b = boites[i]!;
      places.set(l.rang, { x: 0.5, y: Math.round((y + b.boite / 2) * 10000) / 10000 });
      y += b.boite + (ecarts[i] ?? 0);
    });
    return places;
  });
  /** Les lignes remplies telles qu'on les dessine : posées d'office sur un ciel. */
  const lignesAffichees = () =>
    modeCiel() ? lignesRemplies().map((l) => ({ ...l, ...placesDuCiel().get(l.rang) })) : lignesRemplies();

  /*
   * Les ombres chinoises du ciel (27/11, Alexandra : « les personnages tu
   * mets uniquement les ombres chinoises hein ! ») : de 0 à 4, de gauche à
   * droite, posées par l'API dans l'image même. `choixSilhouettes` : ce qui
   * est coché ; `silhouettesCiel` : ce qui est sur le ciel (« Mettre sur mon
   * ciel » le redessine).
   */
  /*
   * Les scènes proposées, rangées par groupe (27/11 au soir, Alexandra :
   * « faudrait que ça soit plus logique y'a trop de possibilités », « ça fait
   * bcp de possibilités le client va se prendre la tête ») : on choisit QUI,
   * puis UNE scène — plus de mélange à huit ni de glisser-déposer. Les tracés
   * viennent de la 2e planche d'ombres d'Alexandra (apps/api/src/ciel-ombres-2.ts) ;
   * les dix d'avant restent connues de l'API pour les ciels déjà créés.
   */
  const GROUPES_SILHOUETTES = {
    seul: [
      "femme-ondulee",
      "femme-longs",
      "femme-carre",
      "femme-tres-longs-boucles",
      "femme-bouclee-courte",
      "femme-chignon-haut",
      "homme-court",
      "homme-boucle",
      "homme-capuche",
      "homme-casquette",
      "enfant-boucle",
    ],
    couple: [
      "couple-homme-femme",
      "couple-frises",
      "couple-femmes-queue",
      "couple-femmes-chignon",
      "couple-hommes-epaule",
      "couple-hommes-front",
    ],
    famille: [
      "famille-homme-bebe-femme",
      "famille-epaules-bebe",
      "famille-femme-enfant",
      "famille-homme-deux-bebes",
      "famille-deux-hommes-enfant",
    ],
    animal: ["femme-chien", "enfant-chien", "homme-chat", "femme-lapin", "homme-cheval", "homme-deux-lapins"],
  } as const;
  type GroupeSilhouettes = keyof typeof GROUPES_SILHOUETTES;
  type SceneSilhouette = (typeof GROUPES_SILHOUETTES)[GroupeSilhouettes][number];
  const [groupeSilhouettes, setGroupeSilhouettes] = createSignal<GroupeSilhouettes>("seul");
  const [choixSilhouettes, setChoixSilhouettes] = createSignal<string[]>([]);
  const [silhouettesCiel, setSilhouettesCiel] = createSignal<string[]>([]);
  /*
   * Plus de bouton « Mettre sur mon ciel » (27/11, Alexandra : « pas de
   * bouton mettre sur mon ciel ça doit agir direct ») : chaque ajout, retrait
   * ou déplacement redessine, après 400 ms pour regrouper les clics.
   */
  let minuteurSilhouettes: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const choix = [...choixSilhouettes()];
    clearTimeout(minuteurSilhouettes);
    if (choix.join(",") === untrack(silhouettesCiel).join(",")) return;
    minuteurSilhouettes = setTimeout(() => setSilhouettesCiel(choix), 400);
  });
  onCleanup(() => clearTimeout(minuteurSilhouettes));
  function basculerAjout(id: string) {
    setAAjouter((liste) =>
      liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id],
    );
  }

  /**
   * Les personnages d'une création, s'il y en a. Une composition vide n'en
   * est pas une : jamais de muret sans personnage (décision du 20/11), ni à
   * l'écran ni au panier.
   */
  const compoDe = (id: string | null | undefined): CompositionIA | undefined => {
    const compo = id ? creations().find((c) => c.publicId === id)?.compo : undefined;
    return compo && Array.isArray(compo.personnages) && compo.personnages.length > 0
      ? compo
      : undefined;
  };
  /** Ceux de la création montrée — en portrait seulement (décision du 20/11). */
  const compoMontree = () =>
    orientationApercu() === "portrait" ? compoDe(publicId()) : undefined;
  /** Pose (ou retire, sans personnage) la composition d'une création. */
  function poserCompo(id: string, compo: CompositionIA | null) {
    memoriserCreations(
      creations().map((c) => {
        if (c.publicId !== id) return c;
        const { compo: _ancienne, ...sansCompo } = c;
        return compo && compo.personnages.length > 0 ? { ...sansCompo, compo } : sansCompo;
      }),
    );
  }

  /** Secondes écoulées : une attente muette laisse croire à un blocage. */
  const [secondes, setSecondes] = createSignal(0);
  let chrono: ReturnType<typeof setInterval> | undefined;
  function demarrerChrono() {
    setSecondes(0);
    clearInterval(chrono);
    chrono = setInterval(() => setSecondes((s) => s + 1), 1000);
  }
  function arreterChrono() {
    clearInterval(chrono);
    chrono = undefined;
  }

  const formats = () =>
    props.formats?.length
      ? props.formats
      : [{ format: "A4", priceCents: props.product.basePriceCents }];
  const [format, setFormat] = createSignal(
    props.formats?.[0]?.format ?? "A4",
  );
  const prixCourant = createMemo(
    () =>
      formats().find((f) => f.format === format())?.priceCents ??
      props.product.basePriceCents,
  );

  onCleanup(() => {
    arreterChrono();
    const url = photoLocale();
    if (url) URL.revokeObjectURL(url);
  });

  /** Message français de l'échec en cours. */
  const messageEchec = () => {
    switch (echec()) {
      case "indisponible":
        return tr("ia.err.indisponible");
      case "format":
        return tr("ia.err.format");
      case "trop_lourde":
        return tr("ia.err.trop_lourde");
      case "rafale":
        return tr("ia.err.rafale");
      // Trois essais par jour sur le site (27/11) ; la tablette du stand n'a
      // pas de limite.
      case "quota":
        return tr("ia.err.quota");
      case "plafond":
        return tr("ia.err.plafond");
      // Plus de crédit chez OpenAI (25/11). Jamais dit à la cliente (Alexandra :
      // « faut pas le dire au client ») : au stand, elle est invitée à voir le
      // vendeur ; sur le site, à réessayer plus tard. La boutique, elle, est
      // prévenue par courrier (alerterCreditEpuise, côté API).
      case "credit":
        return tr(props.stand ? "ia.err.credit_stand" : "ia.err.credit");
      case "generation":
        return tr("ia.err.generation");
      case "attente":
        return tr("ia.err.attente");
      case "inconnu":
        return tr("ia.err.inconnu");
      // Une affiche avec personnages que le panier refuse (20/11).
      case "ia_indisponible":
        return tr("ia.refus.indisponible");
      case "ia_autre_affiche":
        return tr("ia.refus.autre_affiche");
      case "ia_personnages_paysage":
        return tr("ia.refus.personnages_paysage");
      default:
        return null;
    }
  };

  /** Ramène une exception, quelle qu'elle soit, à une cause affichable. */
  function causeDe(e: unknown): EchecIA {
    return e instanceof ErreurIA ? e.code : "inconnu";
  }

  /**
   * Le sens que la photo suggère : en largeur, nettement plus large que haute,
   * elle donne une affiche en paysage. Lu sur l'image telle que le navigateur
   * l'affiche — la rotation d'une photo de téléphone (EXIF) comprise.
   */
  function sensDeLaPhoto(url: string): Promise<"portrait" | "paysage" | null> {
    return new Promise((resoudre) => {
      const img = new Image();
      img.onload = () =>
        resoudre(
          img.naturalWidth && img.naturalHeight
            ? img.naturalWidth > img.naturalHeight * 1.1
              ? "paysage"
              : "portrait"
            : null,
        );
      img.onerror = () => resoudre(null);
      img.src = url;
    });
  }

  /**
   * Une photo arrive — du disque, d'un glisser-déposer ou du téléphone.
   *
   * Elle part sur le serveur, mais la création, elle, attend TOUJOURS le
   * bouton « Créer mon affiche ». Elle partait autrefois d'elle-même quand la
   * boutique ne proposait pas de style : le client n'avait alors pas le temps
   * de choisir le sens de l'affiche, rangé juste sous la photo, et recevait un
   * portrait qu'il n'avait pas demandé — une création qui se paie. Le temps de
   * relire son style, son sens, de changer de photo ou d'ajouter une
   * précision, c'est lui qui décide.
   */
  async function choisirPhoto(fichier: File) {
    /*
     * On ne contrôle plus le POIDS ici : `envoyerPhoto` réduit la photo avant
     * de l'envoyer, et une photo de téléphone de 20 Mo devient 400 Ko. La
     * refuser ici reviendrait à refuser ce qui, une seconde plus tard, serait
     * parfaitement acceptable. Le format, lui, se vérifie toujours — un PDF
     * n'est pas une photo, et aucune réduction n'y changera rien.
     */
    // La photo n'attend plus le style (20/11) : elle s'envoie, et c'est
    // « Créer » qui le demande.
    const refus = verifierFormatPhoto(fichier);
    if (refus) {
      setEchec(refus);
      // Le refus se lit à l'étape de la photo (27/11), même quand elle
      // arrive du téléphone pendant qu'on regarde une autre étape.
      signalerEchec("source");
      return;
    }
    // Une photo choisie, ou arrivée du téléphone pendant qu'on regarde une
    // autre étape : on revient à l'étape 1, où elle se crée (27/11).
    allerA("source");
    const ancienne = photoLocale();
    if (ancienne) URL.revokeObjectURL(ancienne);
    const locale = URL.createObjectURL(fichier);
    setPhotoLocale(locale);
    setNomPhoto(fichier.name);
    // Le sens suit la photo tant que le client ne l'a pas choisi lui-même.
    if (!sensChoisiALaMain)
      void sensDeLaPhoto(locale).then((sens) => {
        if (sens && !sensChoisiALaMain && photoLocale() === locale) setOrientation(sens);
      });
    setEchec(null);
    setPublicId(null);
    setApercu(null);
    setApercuChemin(null);
    setEtape("envoi");
    demarrerChrono();
    try {
      const distant = await envoyerPhoto(fichier);
      setChemin(distant);
      arreterChrono();
      setEtape("depot");
      // Le bouton est sous le sens et la précision : sur la tablette, juste
      // sous le bord de l'écran. On l'amène au bord, sans plus — la cliente
      // garde sous les yeux la zone où elle vient de toucher.
      boutonCreer?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (e) {
      arreterChrono();
      setEchec(causeDe(e));
      setEtape("depot");
      signalerEchec("source");
    }
  }

  /** Lance (ou relance) une génération sur la photo déjà envoyée. */
  async function lancerGeneration(cheminPhoto?: string) {
    const source = cheminPhoto ?? chemin();
    // Jamais de génération sans le style quand la boutique en propose : le
    // bouton est éteint, ceci garde la règle si un autre chemin y menait.
    if (!source || styleManquant()) return;
    setEchec(null);
    setEtape("generation");
    demarrerChrono();
    // Le sens demandé À CE MOMENT : s'il change pendant la génération,
    // l'aperçu garde celui dans lequel il a été fabriqué.
    const sens = orientation();
    // « Générer une autre version » reprend les personnages de la création
    // montrée, si la nouvelle est en portrait (décision du 20/11) : c'est
    // gratuit, et ils se retirent d'un geste. Leurs places ne dépendent pas
    // de l'image, elles valent telles quelles sur la nouvelle.
    const compoAReprendre = sens === "portrait" ? compoDe(publicId()) : undefined;
    try {
      const gen = await genererAffiche({
        productId: props.product.id,
        photo: source,
        cartId: getCartId(),
        precision: precision(),
        promptId: styleChoisi(),
        orientation: sens,
      });
      const url = apercuAbsolu(gen.apercuUrl);
      // « en_cours » : l'image n'existe pas encore, on attend qu'elle réponde.
      const prete = gen.status === "prete" ? url : await attendreApercu(url);
      setPublicId(gen.publicId);
      setApercuChemin(gen.apercuUrl);
      setOrientationApercu(sens);
      setApercu(prete);
      setEtape("pret");
      // Elle rejoint les précédentes au lieu de les effacer.
      memoriserCreations([
        ...creations().filter((c) => c.publicId !== gen.publicId),
        {
          publicId: gen.publicId,
          apercuChemin: gen.apercuUrl,
          apercu: prete,
          sens,
          source,
          ...(compoAReprendre ? { compo: compoAReprendre } : {}),
        },
      ]);
      // L'affiche est là : on reste à l'étape 1, où « Continuer » devient
      // le bouton plein (barreDesEtapes) — on peut encore en refaire une.
    } catch (e) {
      setEchec(causeDe(e));
      // On garde la photo ET l'affiche déjà obtenue : un essai raté ne doit
      // ni effacer l'aperçu retenu, ni obliger à rechoisir le fichier.
      setEtape(apercu() ? "pret" : "depot");
      // Les trois essais du jour, une création qui n'aboutit pas… : le
      // message est à l'étape de la photo, sous ce qui relance (27/11).
      signalerEchec("source");
    } finally {
      arreterChrono();
    }
  }

  function reprendreDepart() {
    const url = photoLocale();
    if (url) URL.revokeObjectURL(url);
    setPhotoLocale(null);
    setNomPhoto(null);
    setChemin(null);
    setPublicId(null);
    setApercu(null);
    setApercuChemin(null);
    setEchec(null);
    setEtape("depot");
    // « Recommencer » ramène à l'étape 1, où tout repart (27/11).
    allerA("source");
  }

  /**
   * Les affiches qui partiront au panier : celles qu'on a cochées, dans
   * l'ordre où elles ont été créées ; sans coche, celle qu'on regarde.
   */
  const affichesAAjouter = (): { publicId: string; apercuChemin: string | null; sens: "portrait" | "paysage" }[] => {
    const cochees = creations().filter((c) => aAjouter().includes(c.publicId));
    if (cochees.length) return cochees;
    const id = publicId();
    return id ? [{ publicId: id, apercuChemin: apercuChemin(), sens: orientationApercu() }] : [];
  };

  /** Les affiches déjà parties au panier pendant cet ajout (voir plus bas). */
  const dejaAuPanier = new Set<string>();

  async function ajouterAuPanier() {
    const affiches = affichesAAjouter();
    if (!affiches.length || ajout()) return;
    setAjout(true);
    setEchec(null);
    try {
      // Les mêmes textes, le même format et le même nombre d'exemplaires pour
      // chacune : c'est le réglage qu'on voit à l'écran au moment d'ajouter.
      // L'une après l'autre, pour que le panier les garde dans cet ordre ; si
      // le réseau lâche au milieu, un nouvel essai ne remet pas en double
      // celles qui sont déjà passées.
      for (const a of affiches) {
        if (dejaAuPanier.has(a.publicId)) continue;
        await ajouterUneAffiche(a);
        dejaAuPanier.add(a.publicId);
      }
      window.location.href = versLePanier(
        lien(props.langue ?? LANGUE_DEFAUT, "/commande"),
        lien(props.langue ?? LANGUE_DEFAUT, "/panier"),
      );
    } catch (e) {
      // Une affiche avec personnages refusée par le serveur (20/11) reçoit
      // sa phrase ; toute autre panne, le message d'avant.
      setEchec(refusDuPanier(e) ?? "inconnu");
      // À l'étape du format, sous « Ajouter au panier » (27/11).
      signalerEchec("format");
      setAjout(false);
    }
  }

  /** Une ligne de panier pour UNE affiche obtenue. */
  async function ajouterUneAffiche(a: {
    publicId: string;
    apercuChemin: string | null;
    sens: "portrait" | "paysage";
  }) {
    // Les personnages de CETTE création (20/11), en portrait seulement. Sans
    // eux, la ligne est exactement celle d'avant, au caractère près : vue de
    // face, aucun personnage, aucun décor.
    const compo = a.sens === "portrait" ? (compoDe(a.publicId) ?? null) : null;
    const config: PosterConfig = {
      schemaVersion: 1,
      productId: props.product.id,
      format: format() === "A3" ? "A3" : "A4",
      ...(a.sens === "paysage" ? { orientation: "paysage" as const } : {}),
      view: compo ? compo.vue : "front",
      // Le muret, de dos seulement, et jamais sans personnage : c'est le
      // décor que le fichier d'impression pose derrière eux.
      ...(compo && compo.vue === "back" && compo.decor ? { foregroundUrl: compo.decor } : {}),
      // Compacte, sans trou : l'API refuse une entrée vide au milieu, et
      // le rendu ne lit de toute façon que la suite des lignes remplies.
      texts: {
        lines: lignesAffichees().map(
          (l): TextBlock => ({
            value: l.value.trim(),
            font: l.font,
            color: couleur(),
            // Petit ou grand seulement : « moyen » n'écrit rien (27/11).
            ...(l.taille && l.taille !== "m" ? { taille: l.taille } : {}),
            ...(typeof l.x === "number" && typeof l.y === "number"
              ? { x: l.x, y: l.y }
              : {}),
          }),
        ),
      },
      // Tels que le module les a rendus : places, échelles, tenues,
      // couleurs. Le fichier d'impression les pose à ces places-là.
      characters: compo ? compo.personnages : [],
      // C'est CE champ qui rattache la ligne à la génération retenue : le
      // serveur y retrouve le fichier sans filigrane à imprimer une fois la
      // commande payée.
      aiPublicId: a.publicId,
      // Avec personnages, l'adresse de l'aperçu telle que le serveur la
      // contrôle (20/11) ; sans, celle d'avant, inchangée.
      aiApercuUrl: compo ? `/ia/apercu/${a.publicId}` : (a.apercuChemin ?? undefined),
    };
    await browserApi.addCartItem(getCartId(), {
      productId: props.product.id,
      unitPriceCents: prixCourant(),
      quantity: quantite(),
      title: props.product.name,
      config,
      langue: props.langue ?? LANGUE_DEFAUT,
    });
  }

  let champFichier: HTMLInputElement | undefined;
  let boutonCreer: HTMLButtonElement | undefined;

  const occupe = () => etape() === "envoi" || etape() === "generation";

  /**
   * L'outil vit dans une MODALE, comme le configurateur des autres affiches :
   * la fiche produit garde sa mise en page (galerie, titre, prix, formats), un
   * seul bouton « Personnaliser », et tout le travail se fait par-dessus.
   * Même coquille CSS (.ml-modal-*), même verrou du défilement, même touche
   * Échap — le client ne doit pas sentir qu'il change de produit.
   */
  const [ouverte, setOuverte] = createSignal(false);
  function verrouillerDefilement(verrou: boolean) {
    document.body.style.overflow = verrou ? "hidden" : "";
  }
  function ouvrir() {
    setOuverte(true);
    verrouillerDefilement(true);
  }
  function fermer() {
    // Une génération en cours continue côté serveur : on ne la perd pas, on
    // ferme juste la fenêtre ; rouvrir retrouve l'état tel quel.
    setOuverte(false);
    verrouillerDefilement(false);
  }
  function surTouche(e: KeyboardEvent) {
    if (e.key !== "Escape" || !ouverte()) return;
    // Pendant la composition des personnages, Échap vaut « Retour » (20/11) :
    // il ramène à l'affiche sans rien garder, et ne ferme pas la fenêtre.
    if (composer()) {
      fermerComposition();
      return;
    }
    fermer();
  }
  onMount(() => window.addEventListener("keydown", surTouche));
  onCleanup(() => {
    window.removeEventListener("keydown", surTouche);
    verrouillerDefilement(false);
  });

  /* ------------------------------------------------------------------------
   * Les personnages (20/11 : « faut pouvoir ajouter personnages et murets si
   * les gens veulent pour les images à partir de leurs photos ! »).
   *
   * La composition se fait dans la même fenêtre : l'écran de l'affiche est
   * masqué — pas démonté : ses calques de texte et le relais de photo restent
   * tels quels —, et le module de personnalisation prend sa place, sur sa
   * seule étape « Personnages » (PersonnagesIA.tsx). « Retour », Échap et la
   * croix ramènent à l'affiche sans rien garder ; un clic à côté de la
   * fenêtre ne fait rien, comme sur les affiches personnalisables.
   * ---------------------------------------------------------------------- */

  /**
   * La composition en cours : la création qui reçoit les personnages, la vue
   * choisie et les personnages de départ (ceux de « Modifier »). Null hors
   * composition.
   */
  const [composer, setComposer] = createSignal<{
    publicId: string;
    vue: "back" | "front";
    personnages: Character[];
  } | null>(null);
  /** La boîte qui défile dans la fenêtre : on y retrouve sa place au retour. */
  let corpsModale: HTMLDivElement | undefined;
  let hautAvantComposition = 0;

  /*
   * Une entrée d'historique pendant la composition : sur la tablette, le
   * geste « retour » d'Android quitterait sinon la fiche, et l'affiche en
   * cours avec elle. Il ne fait que « Retour ». Même procédé que la fenêtre
   * des affiches personnalisables (ProductConfigurator.tsx).
   */
  const MARQUE_COMPOSITION = "mlPersoIA";
  const entreeComposition = () =>
    typeof history !== "undefined" &&
    Boolean((history.state as Record<string, unknown> | null)?.[MARQUE_COMPOSITION]);
  /**
   * Les reculs dans l'historique que fermerComposition a demandés et dont
   * l'événement n'est pas encore arrivé : ceux-là ne sont pas un geste du
   * client, surPopstate les laisse passer.
   */
  let reculsAttendus = 0;

  /**
   * Ouvre la composition sur la création montrée : « Assis sur le muret »
   * (vue de dos), « Debout, de face », ou « Modifier » (la même vue, ses
   * personnages). Jamais en paysage, ni pendant une création ou un ajout.
   */
  function ouvrirComposition(vue: "back" | "front") {
    const id = publicId();
    if (!id || orientationApercu() !== "portrait" || occupe() || ajout() || composer()) return;
    const deja = compoDe(id);
    hautAvantComposition = corpsModale?.scrollTop ?? 0;
    setComposer({
      publicId: id,
      vue,
      personnages: deja && deja.vue === vue ? deja.personnages : [],
    });
    corpsModale?.scrollTo({ top: 0 });
    // Le second coup d'un double appui tomberait sur le module, qui vient de
    // prendre la place des boutons.
    avalerLesClicsUnInstant();
    if (!entreeComposition())
      history.pushState(
        { ...((history.state as object | null) ?? {}), [MARQUE_COMPOSITION]: true },
        "",
      );
  }

  /**
   * Referme la composition — « Retour », Échap, la croix, le geste retour du
   * téléphone, ou après « Valider ». L'écran de l'affiche revient où on
   * l'avait laissé, sur le bloc des personnages.
   */
  function fermerComposition() {
    if (!composer()) return;
    setComposer(null);
    // L'entrée posée à l'ouverture s'en va avec elle : le geste retour
    // suivant ramène à la page d'avant, comme sans composition.
    if (entreeComposition()) {
      reculsAttendus++;
      history.back();
    }
    avalerLesClicsUnInstant();
    const haut = hautAvantComposition;
    requestAnimationFrame(() => corpsModale?.scrollTo({ top: haut }));
  }

  /**
   * Un double appui sur « Valider les personnages » (au doigt, sur la
   * tablette) tomberait, au second coup, sur ce qui revient à sa place sous
   * le doigt : « Ajouter au panier », ou « Générer une autre version » — une
   * création payée que personne n'a demandée. Les clics du court instant qui
   * suit l'ouverture ou la fermeture de la composition sont donc avalés.
   */
  function avalerLesClicsUnInstant() {
    const avaler = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", avaler, true);
    window.setTimeout(() => window.removeEventListener("click", avaler, true), 400);
  }

  /** « Valider les personnages » : la composition rejoint SA création. */
  function validerComposition(compo: CompositionIA) {
    const encours = composer();
    if (!encours) return;
    // Validée sans personnage, elle n'existe plus : c'est « Retirer ».
    poserCompo(encours.publicId, compo);
    // Un refus du panier visait peut-être les personnages d'avant.
    setEchec(null);
    fermerComposition();
  }

  /** « Retirer » : la création repart sans personnage ni muret. */
  function retirerComposition() {
    const id = publicId();
    if (!id || occupe() || ajout()) return;
    poserCompo(id, null);
    setEchec(null);
  }

  function surPopstate() {
    if (reculsAttendus > 0) {
      reculsAttendus--;
      return;
    }
    // Le geste retour du téléphone pendant la composition : comme « Retour ».
    if (composer() && !entreeComposition()) fermerComposition();
  }
  onMount(() => {
    window.addEventListener("popstate", surPopstate);
    // Une marque retrouvée au chargement (page rechargée en pleine
    // composition) : on la retire, sinon la prochaine fermeture reculerait
    // d'une page de trop.
    if (entreeComposition()) {
      const reste = { ...(history.state as Record<string, unknown>) };
      delete reste[MARQUE_COMPOSITION];
      history.replaceState(reste, "");
    }
  });
  onCleanup(() => window.removeEventListener("popstate", surPopstate));

  /** « 3 personnages, assis sur le muret » : leur nombre, puis la vue. */
  const resumeCompo = (compo: CompositionIA): string => {
    const n = compo.personnages.length;
    return tr("ia.perso.resume")
      .replace("{nombre}", () => `${n} ${n > 1 ? tr("panier.personnages") : tr("panier.personnage")}`)
      .replace("{vue}", () =>
        tr(compo.vue === "back" ? "ia.perso.resume_muret" : "ia.perso.resume_face"),
      );
  };

  /**
   * Le module des personnages et leur bibliothèque, demandés au repos dès la
   * première création prête : sur la tablette du stand, en 4G, la première
   * ouverture attendait sinon tout cela d'un coup. Une seule fois ; un échec
   * se rattrape à l'ouverture.
   */
  let personnagesDemandes = false;
  createEffect(() => {
    if (etape() !== "pret" || personnagesDemandes) return;
    personnagesDemandes = true;
    const auRepos =
      window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 2000));
    auRepos(() => {
      void chargerPersonnages()
        .then((m) => m.chargerBibliotheque(props.langue))
        .catch(() => {});
    });
  });

  /**
   * Le relais du téléphone sur le site (21/11, Alexandra : « le module de QR
   * code […] sur le site classique aussi ») : seulement sur un écran d'au
   * moins 768 px de large, un ordinateur ou une tablette. Sur un téléphone,
   * la photo se choisit directement — un QR code à scanner avec le téléphone
   * même qui l'affiche n'aurait pas de sens. Un téléphone tourné à
   * l'horizontale dépasse pourtant 768 px : il se reconnaît à son écran
   * tactile de moins de 600 px de petit côté.
   *
   * Suivi en direct : une fenêtre rétrécie sous 768 px retire le relais, qui
   * se ferme alors comme à « Annuler ». Au stand, rien de tout cela n'est lu :
   * le relais y est toujours là, comme avant.
   */
  const largeurRelais = window.matchMedia("(min-width: 768px)");
  const estGrandEcran = () =>
    largeurRelais.matches &&
    !(
      window.matchMedia("(pointer: coarse)").matches &&
      Math.min(window.screen.width, window.screen.height) < 600
    );
  const [grandEcran, setGrandEcran] = createSignal(estGrandEcran());
  const suivreLargeur = () => setGrandEcran(estGrandEcran());
  largeurRelais.addEventListener("change", suivreLargeur);
  onCleanup(() => largeurRelais.removeEventListener("change", suivreLargeur));

  /** L'image seule dans le grand aperçu : sans personnage, ou en les attendant. */
  const imageApercu = () => (
    <img
      src={apercu()!}
      alt={tr("ia.apercu_alt")}
      class="absolute inset-0 h-full w-full object-contain"
    />
  );

  /* ------------------------------------------------------------------------
   * Les étapes de la fenêtre (27/11).
   *
   * Alexandra, devant la colonne des réglages — styles, photo, sens,
   * précision, lignes et polices, couleur, formats : « J'aimerais des steps
   * pour ça, avec des petits onglets », « où on peut retourner modifier
   * évidemment » ; puis, sur le ciel étoilé : « pareil ici on met des steps
   * car la page est trop longue », « quand on ouvre c'est trop long faut des
   * steps ». Tout s'y empilait, sur plus de deux écrans de la tablette.
   *
   * Quatre étapes, comme le module des affiches personnalisables (ses
   * pastilles, sa barre du bas) : 1. la Photo — le style, la photo, le
   * relais, le sens, la précision, « Créer mon affiche » — ou le Ciel — son
   * formulaire ; 2. le Texte ; 3. les Personnages ; 4. le Format et le
   * panier. Chaque pastille se touche à tout moment, en arrière pour
   * modifier comme en avant ; « Retour » et « Continuer » font de même au
   * bas de la fenêtre.
   *
   * Rien d'autre ne change : mêmes états, mêmes appels, même aperçu, mêmes
   * « Vos créations », même panier. Les étapes cachées restent MONTÉES
   * (attribut `hidden`, jamais de <Show>) : le relais du téléphone continue
   * d'attendre la photo, le formulaire du ciel garde sa date et sa ville, et
   * rien de ce qui est tapé ne se perd d'une étape à l'autre.
   * ---------------------------------------------------------------------- */
  type Onglet = "source" | "texte" | "personnages" | "format";
  const TOUS_LES_ONGLETS: Onglet[] = ["source", "texte", "personnages", "format"];
  /*
   * Les étapes montrées : sur un ciel, Personnages seulement pour « Ciel de
   * cette nuit » (27/11, Alexandra : « donc tu mets pas l'étape 3 pour les
   * autres styles ») ; les pastilles se renumérotent.
   */
  const ongletsVisibles = createMemo<Onglet[]>(() =>
    modeCiel() && styleCiel() !== null && styleCiel() !== "nuit"
      ? TOUS_LES_ONGLETS.filter((o) => o !== "personnages")
      : TOUS_LES_ONGLETS,
  );
  /** Le nom d'une étape : la première est la Photo, ou le Ciel. */
  const nomOnglet = (o: Onglet): string =>
    tr(
      o === "source"
        ? modeCiel()
          ? "ia.etape.ciel"
          : "ia.etape.photo"
        : o === "texte"
          ? "ia.etape.texte"
          : o === "personnages"
            ? "cfg.etape.personnages"
            : "cfg.etape.format",
    );
  /** L'étape montrée. Pas `etape`, qui dit autre chose (depot, envoi, generation, pret). */
  const [volet, setVolet] = createSignal<Onglet>("source");
  const idEtape = (o: Onglet) => `ml-ia-${props.product.id}-etape-${o}`;
  let rangeeOnglets: HTMLDivElement | undefined;

  /**
   * Montre une étape. `auDoigt` : c'est un appui du client — une pastille,
   * « Continuer », « Retour ». L'étape qui arrive prend la place de celle où
   * il touchait, et le second coup d'un double appui, sur la tablette,
   * tomberait sur ce qui vient d'arriver sous son doigt : comme à l'ouverture
   * des personnages, les clics de l'instant qui suit sont avalés.
   *
   * Le focus qui était dans l'étape qui se cache — « Continuer » excepté,
   * qui reste —, retomberait au début de la page : il passe à la pastille de
   * la nouvelle étape, dans la fenêtre.
   */
  function allerA(o: Onglet, auDoigt = false) {
    if (o === volet()) return;
    const quittee = document.getElementById(idEtape(volet()));
    const focusDedans = !!quittee && quittee.contains(document.activeElement);
    setVolet(o);
    if (focusDedans)
      rangeeOnglets
        ?.querySelector<HTMLButtonElement>(`[data-etape="${o}"]`)
        ?.focus({ preventScroll: true });
    if (auDoigt) avalerLesClicsUnInstant();
    // Le haut de l'étape en vue : « Continuer » se touche au bas de la
    // fenêtre, et l'étape suivante commencerait sinon au-dessus de son bord.
    queueMicrotask(montrerLesOnglets);
  }

  /**
   * La rangée des pastilles, ramenée en haut de la fenêtre : passée au-dessus
   * du bord, ou loin en dessous — au téléphone, sous le grand aperçu, où
   * l'étape nouvelle commençait derrière la barre du bas. Sur un grand écran,
   * elle est déjà en haut de sa colonne : rien ne bouge.
   */
  function montrerLesOnglets() {
    if (!corpsModale || !rangeeOnglets) return;
    const ecart =
      rangeeOnglets.getBoundingClientRect().top - corpsModale.getBoundingClientRect().top;
    if (ecart < 0 || ecart > corpsModale.clientHeight * 0.4)
      corpsModale.scrollTo({ top: Math.max(0, corpsModale.scrollTop + ecart - 12) });
  }

  /**
   * L'étape où se lit l'échec en cours : celle du geste qui l'a causé — la
   * photo (son envoi, la création) ou le format (le panier). Un échec arrivé
   * pendant qu'on regarde une autre étape y ramène, et son message se met en
   * vue, même au bas de l'étape : il doit se voir.
   */
  const [ongletEchec, setOngletEchec] = createSignal<"source" | "format">("source");
  let messagePhoto: HTMLParagraphElement | undefined;
  let messageFormat: HTMLParagraphElement | undefined;
  function signalerEchec(o: "source" | "format") {
    setOngletEchec(o);
    allerA(o);
    requestAnimationFrame(() =>
      (o === "source" ? messagePhoto : messageFormat)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      }),
    );
  }

  /**
   * La barre du bas, collée au bord de la fenêtre comme celle du module
   * (`.ml-cfg-pied`) : « Retour », sauf à la première étape ; « Continuer »,
   * sauf à la dernière, où « Ajouter au panier » tient ce rôle. À la
   * première étape, tant qu'aucune affiche n'existe, « Continuer » n'est
   * qu'un contour : l'action principale y reste « Créer mon affiche ».
   */
  const barreDesEtapes = () => {
    const rang = () => ongletsVisibles().indexOf(volet());
    const precedente = () => ongletsVisibles()[rang() - 1];
    const suivante = () => ongletsVisibles()[rang() + 1];
    const enContour = () => volet() === "source" && !apercu();
    return (
      <div
        class="ml-cfg-pied sticky bottom-0 z-[3] mt-6 flex items-center justify-between gap-3 border-t border-ink/10 bg-paper py-3"
      >
        <Show when={precedente()} fallback={<span />}>
          {(p) => (
            <button
              type="button"
              onClick={() => allerA(p(), true)}
              class="inline-flex items-center gap-2 border border-ink/30 px-5 py-2.5 text-sm font-medium transition-colors hover:border-ink"
            >
              <span aria-hidden="true">←</span>
              {tr("cfg.retour")}
            </button>
          )}
        </Show>
        <Show when={suivante()}>
          {(s) => (
            <button
              type="button"
              onClick={() => allerA(s(), true)}
              class={`inline-flex items-center gap-2 rounded-full border border-ink px-6 py-2.5 text-sm font-medium transition-colors ${
                enContour() ? "hover:bg-ink hover:text-paper" : "bg-ink text-paper hover:bg-ink/85"
              }`}
            >
              {tr("cfg.continuer")}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </Show>
      </div>
    );
  };

  /* ------------------------------------------------------------------------
   * Les morceaux de la colonne qui servent deux fois depuis le 27/11 : dans
   * les étapes, et dans la colonne du ciel étoilé, restée d'un seul tenant.
   * Rangés ici tels qu'ils étaient écrits dans la colonne.
   * ---------------------------------------------------------------------- */

  /*
   * Les trois lignes, avec les règles des affiches personnalisables
   * (packages/types/src/fonts.ts) : chaque ligne ne propose que SES
   * polices — `policesDeLaLigne` —, et la première s'écrit en capitales.
   * Chaque police est montrée DANS la police, sous son nom, comme au
   * configurateur ; la couleur est commune aux trois. L'étape « Textes ».
   */
  const blocTextes = () => (
    <div class="mt-5 space-y-3">
      {/* Sur le ciel (27/11, Alexandra : « genre "texte en haut, texte en
          bas" ») : deux boutons, comme les choix de police. Le dessin passe
          de l'autre côté et les lignes se replacent d'office. */}
      <Show when={modeCiel()}>
        <div role="group" aria-label={tr("ciel.texte_place")} class="flex flex-wrap gap-2.5">
          <For each={["haut", "bas"] as const}>
            {(place) => (
              <button
                type="button"
                aria-pressed={texteCiel() === place}
                onClick={() => setTexteCiel(place)}
                class="ml-choix inline-flex items-center gap-2 border border-ink/20 px-3 py-1.5 text-sm hover:border-ink/45"
              >
                <svg viewBox="0 0 16 22" class="h-5 w-4 text-ink/70" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
                  <rect x="0.65" y="0.65" width="14.7" height="20.7" rx="1" />
                  <path d={place === "haut" ? "M4.5 4h7M5.5 6.5h5" : "M4.5 16h7M5.5 18.5h5"} />
                  <circle cx="8" cy={place === "haut" ? 13 : 8.5} r="3.6" />
                </svg>
                {tr(place === "haut" ? "ciel.texte_haut" : "ciel.texte_bas")}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Index each={lignes()}>
        {(ligne, rang) => (
          <label class="block text-sm">
            <span class="font-medium">{tr(CLES_LIGNES[rang]!.champ)}</span>
            {/* Une zone de texte : la touche Entrée coupe la ligne,
                trois morceaux au plus, comme au configurateur — qui
                ne l'écrit plus sous les champs, ici non plus. */}
            <textarea
              rows={Math.min(MORCEAUX_PAR_LIGNE, ligne().value.split("\n").length)}
              value={ligne().value}
              maxLength={60}
              placeholder={tr(CLES_LIGNES[rang]!.exemple)}
              onInput={(e) => saisirLigne(rang, e.currentTarget)}
              class="mt-1 w-full resize-none border border-ink/20 bg-paper px-3 py-2 text-sm leading-snug focus:border-ink focus:outline-none"
            />
            {/* Écarts de 10 px : la coche du choix fait (`ml-choix`)
                déborde de son coin d'autant, et ne doit pas mordre sur
                le champ au-dessus ni sur la police voisine. */}
            <div class="mt-2.5 flex flex-wrap gap-2.5">
              <For each={policesDeLaLigne(rang)}>
                {(police) => (
                  <button
                    type="button"
                    aria-pressed={ligne().font === police.id}
                    title={nomTraduit(CLES_POLICES, police)}
                    onClick={() => modifierLigne(rang, { font: police.id })}
                    class="ml-choix border border-ink/20 px-3 py-1.5 text-lg leading-snug hover:border-ink/45"
                    style={{ "font-family": familleCss(police) }}
                  >
                    {nomTraduit(CLES_POLICES, police)}
                  </button>
                )}
              </For>
            </div>
            {/* Trois « A » de tailles croissantes, comme sous les lignes des
                affiches personnalisables (27/11) ; moyen = la taille d'avant. */}
            <div role="group" aria-label={tr("cfg.taille_ligne")} class="mt-2.5 flex items-end gap-2.5">
              <For each={TAILLES_LIGNE}>
                {(t) => (
                  <button
                    type="button"
                    aria-pressed={(ligne().taille ?? "m") === t.id}
                    aria-label={tr(t.cle)}
                    title={tr(t.cle)}
                    onClick={() => modifierLigne(rang, { taille: t.id })}
                    class="ml-choix min-w-[2.25rem] border border-ink/20 px-2 py-1 leading-none hover:border-ink/45"
                    style={{ "font-size": `${t.px}px` }}
                  >
                    A
                  </button>
                )}
              </For>
            </div>
          </label>
        )}
      </Index>

      <div>
        <p class="text-sm font-medium">{tr("cfg.couleur_texte")}</p>
        <div class="mt-2.5 flex gap-3">
          <For each={COULEURS_TEXTE_AFFICHE}>
            {(c) => (
              <button
                type="button"
                aria-pressed={couleur() === c.hex}
                aria-label={nomTraduit(CLES_COULEURS, c)}
                title={nomTraduit(CLES_COULEURS, c)}
                onClick={() => {
                  couleurChoisie = true;
                  setCouleur(c.hex);
                }}
                // La couleur garde son fond (style en ligne) ; le choix
                // fait reçoit les marques communes (`ml-choix`).
                class="ml-choix h-9 w-9 border border-ink/30 hover:border-ink/60"
                style={{ background: c.hex }}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );

  /**
   * Les formats, sans montant au stand : l'étape « Format ». `marge` :
   * l'écart au-dessus, celui de la colonne où ils se posent.
   */
  const blocFormats = (marge: string) => (
    <Show when={formats().length > 1}>
      <div class={marge}>
        <p class="text-sm font-medium">{tr("produit.format")}</p>
        {/* Les mêmes cases que le format de la fiche, et le même choix
            fait (`ml-choix`) : plus de noir plein, qu'on prenait pour un
            bouton à presser. */}
        <div class="mt-3 flex gap-3">
          <For each={formats()}>
            {(f) => (
              <button
                type="button"
                onClick={() => setFormat(f.format)}
                aria-pressed={format() === f.format}
                class="ml-choix border border-ink/20 px-4 py-3 text-left text-sm hover:border-ink/45"
              >
                <span class="block font-semibold">{f.format}</span>
                <Show when={!props.sansPrix}>
                  <span class="block font-semibold text-ink-soft">
                    {formatPrice(f.priceCents, locale)}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );

  /**
   * Les personnages (20/11), facultatifs, une fois l'affiche obtenue : sous
   * la couleur du texte, à l'étape « Textes » depuis le 27/11. En portrait
   * seulement : en paysage, l'aperçu et l'impression ne savent pas les
   * placer, une phrase le dit à la place des boutons. Ils ne changent pas le
   * prix : aucun montant ici, au stand comme sur le site.
   */
  const blocPersonnages = () => (
    <div class="mt-5">
      <p class="text-sm font-medium">{tr("ia.perso.titre")}</p>
      <Show
        when={orientationApercu() === "portrait"}
        fallback={<p class="mt-1 text-sm text-ink-soft">{tr("ia.perso.paysage")}</p>}
      >
        {/* Avec des personnages : ce qu'il y a, et les deux gestes.
            Pour passer de dos à face, on retire puis on rechoisit :
            on ne mélange jamais les deux sur une affiche. */}
        <Show
          when={compoMontree()}
          fallback={
            <>
              {/* Deux gros boutons, le muret d'abord (décision du
                  20/11) : assez grands pour le doigt, et l'on voit
                  d'un coup d'œil ce que chacun donne. Plus de phrase
                  d'aide au-dessus (27/11, Alexandra : « supprimer les
                  phrases côté client qui sont inutiles ») : le titre et
                  les deux cartes suffisent. */}
              <div class="mt-2 grid grid-cols-2 gap-3">
                <For each={["back", "front"] as const}>
                  {(vue) => (
                    <button
                      type="button"
                      disabled={occupe() || ajout()}
                      onClick={() => ouvrirComposition(vue)}
                      class="flex flex-col items-center justify-center gap-1 border border-ink/15 px-3 py-3.5 text-center transition-colors hover:border-ink/45 disabled:opacity-60"
                    >
                      <svg
                        viewBox="0 0 48 48"
                        class="h-10 w-10 text-ink/60"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        {TRAITS_PERSONNAGES[vue]()}
                      </svg>
                      <span class="text-sm font-semibold">
                        {tr(vue === "back" ? "ia.perso.muret" : "ia.perso.face")}
                      </span>
                      <span class="text-xs text-ink-soft">
                        {tr(vue === "back" ? "ia.perso.muret_detail" : "ia.perso.face_detail")}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </>
          }
        >
          {(compo) => (
            <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>{resumeCompo(compo())}</span>
              <span aria-hidden="true" class="text-ink-soft">
                ·
              </span>
              <button
                type="button"
                disabled={occupe() || ajout()}
                onClick={() => ouvrirComposition(compo().vue)}
                class="underline underline-offset-4 transition-colors hover:text-terracotta disabled:opacity-60"
              >
                {tr("ia.perso.modifier")}
              </button>
              <span aria-hidden="true" class="text-ink-soft">
                ·
              </span>
              <button
                type="button"
                disabled={occupe() || ajout()}
                onClick={retirerComposition}
                class="underline underline-offset-4 transition-colors hover:text-terracotta disabled:opacity-60"
              >
                {tr("ia.perso.retirer")}
              </button>
            </p>
          )}
        </Show>
      </Show>
    </div>
  );

  /**
   * Les ombres chinoises du ciel (27/11), à la place des personnages de
   * l'affiche photo : leurs tracés viennent de l'API (les mêmes que ceux
   * posés dans l'image), lus à la première ouverture de l'étape.
   */
  const [formesSilhouettes, setFormesSilhouettes] = createSignal<
    Record<string, { d: string; gauche: number; droite: number; haut: number }>
  >({});
  createEffect(() => {
    if (!modeCiel() || volet() !== "personnages" || Object.keys(formesSilhouettes()).length) return;
    // `?v=assises` (27/11, Alexandra : les vignettes montraient encore les
    // silhouettes debout) : la réponse reste une heure en cache, l'adresse
    // neuve passe outre l'ancienne liste.
    void fetch(`${PUBLIC_API_URL}/ia/ciel/silhouettes?v=ombres-image`)
      .then((r) => r.json())
      .then((data: { silhouettes?: { id: string; d: string; gauche: number; droite: number; haut: number }[] }) =>
        setFormesSilhouettes(Object.fromEntries((data.silhouettes ?? []).map((s) => [s.id, s]))),
      )
      .catch(() => {
        /* sans tracés, les vignettes gardent leur nom */
      });
  });
  const dessinSilhouette = (id: string, classe: string) => {
    const f = formesSilhouettes()[id];
    return (
      <Show when={f} fallback={<span class={classe} />}>
        {(s) => (
          <svg
            viewBox={`${s().gauche - 4} ${s().haut - 4} ${s().droite - s().gauche + 8} ${-s().haut + 8}`}
            class={classe}
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={s().d} />
          </svg>
        )}
      </Show>
    );
  };
  const nomSilhouette = (id: SceneSilhouette) => tr(`ciel.silh.${id}`);
  /** La scène posée sur le ciel, sans son « :m » de miroir ; null : aucune. */
  const sceneChoisie = () => (choixSilhouettes()[0]?.split(":")[0] ?? null) as SceneSilhouette | null;
  const enMiroir = () => !!choixSilhouettes()[0]?.endsWith(":m");
  const choisirScene = (id: SceneSilhouette | null) => setChoixSilhouettes(id ? [id] : []);
  const blocSilhouettes = () => (
    <div class="mt-5">
      <p class="text-sm font-medium">{tr("ia.perso.titre")}</p>
      {/* 1. Qui : quatre onglets. */}
      <div role="tablist" aria-label={tr("ia.perso.titre")} class="mt-2 flex flex-wrap gap-2">
        <For each={Object.keys(GROUPES_SILHOUETTES) as GroupeSilhouettes[]}>
          {(g) => (
            <button
              type="button"
              role="tab"
              aria-selected={groupeSilhouettes() === g}
              onClick={() => setGroupeSilhouettes(g)}
              class={`border px-3 py-1.5 text-sm transition-colors ${
                groupeSilhouettes() === g ? "border-ink bg-ink text-paper" : "border-ink/20 hover:border-ink/45"
              }`}
            >
              {tr(`ciel.groupe.${g}`)}
            </button>
          )}
        </For>
      </div>
      {/* 2. Une scène, ou aucune (un toucher la pose, le ciel se redessine). */}
      <div role="radiogroup" aria-label={tr(`ciel.groupe.${groupeSilhouettes()}`)} class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        <button
          type="button"
          role="radio"
          aria-checked={sceneChoisie() === null}
          onClick={() => choisirScene(null)}
          class="ml-choix flex min-w-0 flex-col items-center justify-center gap-1 border border-ink/15 px-1 pb-1.5 pt-2 text-center text-[11px] leading-tight hover:border-ink/45"
        >
          <span aria-hidden="true" class="flex h-14 items-center text-2xl text-ink/30">∅</span>
          <span>{tr("ciel.silh.aucun")}</span>
        </button>
        <For each={GROUPES_SILHOUETTES[groupeSilhouettes()] as readonly SceneSilhouette[]}>
          {(id) => (
            <button
              type="button"
              role="radio"
              aria-checked={sceneChoisie() === id}
              onClick={() => choisirScene(id)}
              class="ml-choix flex min-w-0 flex-col items-center gap-1 border border-ink/15 px-1 pb-1.5 pt-2 text-center text-[11px] leading-tight hover:border-ink/45"
            >
              {dessinSilhouette(id, "h-14 w-full text-ink/80")}
              <span>{nomSilhouette(id)}</span>
            </button>
          )}
        </For>
      </div>
      {/* Retourner la scène (27/11, Alexandra : « pouvoir inverser le sens des personnages »). */}
      <Show when={sceneChoisie()}>
        <button
          type="button"
          aria-pressed={enMiroir()}
          onClick={() =>
            setChoixSilhouettes((l) => (l[0] ? [l[0].endsWith(":m") ? l[0].slice(0, -2) : `${l[0]}:m`] : l))
          }
          class="mt-3 inline-flex items-center gap-2 border border-ink/20 px-3 py-1.5 text-sm hover:border-ink/45"
        >
          <span aria-hidden="true">⇄</span>
          {tr("ciel.silh.inverser")}
        </button>
      </Show>
      {/* Le ciel ne peut pas se redessiner (un couple à une seule date) :
          on le dit ici aussi (27/11, relecture). */}
      <Show when={cielIncomplet()}>
        <p role="status" class="mt-2 text-sm text-terracotta-deep">
          {tr("ciel.signe_manque")}
        </p>
      </Show>
    </div>
  );

  /**
   * Le nombre d'exemplaires : les mêmes boutons qu'ailleurs dans la
   * boutique, deux touches plutôt qu'un champ seul, parce que sur un
   * téléphone passer de 1 à 3 se fait au pouce sans ouvrir le clavier.
   */
  const blocQuantite = () => (
    <div class="inline-flex items-center border border-ink/20">
      <button
        type="button"
        onClick={() => setQuantite((q) => bornerQuantite(q - 1))}
        disabled={ajout() || occupe() || quantite() <= 1}
        aria-label={tr("panier.moins")}
        class="px-3 py-2.5 text-lg leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        min="1"
        max="20"
        value={quantite()}
        onInput={(e) =>
          setQuantite(bornerQuantite(Number(e.currentTarget.value)))
        }
        disabled={ajout() || occupe()}
        aria-label={tr("panier.quantite")}
        class="w-12 border-x border-ink/20 bg-transparent py-2.5 text-center text-sm focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setQuantite((q) => bornerQuantite(q + 1))}
        disabled={ajout() || occupe() || quantite() >= 20}
        aria-label={tr("panier.plus")}
        class="px-3 py-2.5 text-lg leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
      >
        +
      </button>
    </div>
  );

  /** « Ajouter au panier », ou « Ajouter les 3 affiches au panier » quand on en a coché plusieurs. */
  const boutonAjouter = () => (
    <button
      type="button"
      // Éteint tant qu'aucune affiche n'existe : l'étape « Format » se
      // montre à tout moment depuis le 27/11 (étapes de la fenêtre).
      disabled={ajout() || occupe() || !apercu()}
      aria-busy={ajout()}
      onClick={() => void ajouterAuPanier()}
      class="rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
    >
      {/* Pendant l'ajout, un rond qui tourne et ce qui se passe en
          toutes lettres : le « … » seul se lisait comme une panne. */}
      <Show
        when={!ajout()}
        fallback={
          <>
            <span class="ml-spinner ml-spinner-clair mr-2" aria-hidden="true" />
            {tr("produit.ajout_en_cours")}
          </>
        }
      >
        {affichesAAjouter().length > 1
          ? tr("ia.ajouter_n").replace("{n}", String(affichesAAjouter().length))
          : tr("produit.ajouter")}
      </Show>
    </button>
  );

  /** « Repartir de zéro » : ni photo ni affiche, les créations de la séance restent. */
  const boutonRecommencer = () => (
    <button
      type="button"
      disabled={occupe()}
      onClick={reprendreDepart}
      class="text-sm text-ink-soft underline underline-offset-4 hover:text-terracotta transition-colors disabled:opacity-60"
    >
      {tr("ia.recommencer")}
    </button>
  );

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        class="mt-8 inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
      >
        {tr("produit.personnaliser")}
      </button>
      {/* Plus de phrase sous le bouton : « Envoyez une photo : nous en tirons
          une affiche… » est l'un des textes que la boutique a barrés comme
          inutiles (carte Trello « IA photo »), et la description de la fiche,
          juste en dessous, dit déjà la même chose. */}

      <Show when={ouverte()}>
    <div
      class="ml-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={modeCiel() ? tr("ciel.titre_fenetre") : tr("ia.titre")}
      onClick={(e) => {
        // Pendant la composition des personnages, un clic à côté ne ferme
        // rien (20/11) : un doigt qui glisse hors de la fenêtre, sur la
        // tablette, emporterait sinon les personnages en cours.
        if (e.target === e.currentTarget && !composer()) fermer();
      }}
    >
    {/* Toute la hauteur permise, d'une étape à l'autre (27/11) : la fenêtre
        se centre sur sa hauteur, et une étape plus courte — le style, le
        format — la faisait rapetisser et descendre de 70 px sur un grand
        écran, petits onglets compris, qui fuyaient sous la souris. La colonne
        d'un seul tenant d'avant la remplissait de toute façon. Au téléphone
        et sur la tablette en portrait, elle est déjà plein écran. */}
    <div class="ml-modal-panel md:h-[92vh]">
      <header class="ml-modal-head">
        <h2 class="text-xl sm:text-2xl">{modeCiel() ? tr("ciel.titre_fenetre") : tr("ia.titre")}</h2>
        {/* Pendant la composition, la croix vaut « Retour » : elle ramène à
            l'affiche, sans rien garder. */}
        <button
          type="button"
          class="ml-modal-close"
          aria-label={tr("cfg.fermer")}
          onClick={() => (composer() ? fermerComposition() : fermer())}
        >
          ✕
        </button>
      </header>
    <div class="ml-modal-body" ref={corpsModale}>
      {/* La composition des personnages (20/11), à la place de l'écran de
          l'affiche, qui reste monté mais masqué. Le module qui n'arrive pas
          (réseau du marché) ou qui casse ne fait pas tomber la fenêtre : une
          phrase, et « Retour » ramène à l'affiche, intacte. */}
      <Show when={composer()} keyed>
        {(c) => {
          // Chaque ouverture redemande le module s'il n'est pas là (21/11) :
          // après un échec, « Retour » puis un nouvel appui réessaie vraiment.
          const [moduleManquant, setModuleManquant] = createSignal(false);
          if (!modulePersonnages())
            chargerPersonnages().catch(() => setModuleManquant(true));
          const erreur = () => (
            <div class="py-12 text-center">
              <p role="alert" class="text-terracotta-deep">
                {tr("ia.perso.erreur")}
              </p>
              <button
                type="button"
                onClick={fermerComposition}
                class="mt-5 rounded-full border border-ink px-6 py-3 text-sm font-medium hover:bg-ink hover:text-paper transition-colors"
              >
                {tr("cfg.retour")}
              </button>
            </div>
          );
          const attente = () => (
            <p class="flex items-center justify-center gap-2 py-16 text-ink-soft" role="status">
              <span class="ml-spinner" aria-hidden="true" />
              {tr("ia.perso.chargement")}
            </p>
          );
          return (
            <ErrorBoundary fallback={erreur()}>
              <Suspense fallback={attente()}>
                <Show
                  when={modulePersonnages()}
                  fallback={moduleManquant() ? erreur() : attente()}
                >
                  {(m) => {
                    const ComposerPersonnages = m().default;
                    return (
                      <ComposerPersonnages
                        langue={props.langue}
                        product={props.product}
                        publicId={c.publicId}
                        format={format() === "A3" ? "A3" : "A4"}
                        vue={c.vue}
                        personnages={c.personnages}
                        onValider={validerComposition}
                        onRetour={fermerComposition}
                      />
                    );
                  }}
                </Show>
              </Suspense>
            </ErrorBoundary>
          );
        }}
      </Show>
      {/* Dans la modale (1040 px au plus) : l'aperçu à gauche à une taille où
          l'on juge une affiche, les réglages à droite. */}
      <div
        class="grid gap-8 items-start md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"
        style={{ display: composer() ? "none" : undefined }}
      >
        {/* ------------------------------ Aperçu ------------------------- */}
        {/* Collé en haut dès qu'il y a deux colonnes : sur la tablette, la
            colonne des réglages dépasse l'écran, et l'aperçu — la photo, la
            création en cours, les textes qu'on tape — sortait de la vue au
            moment précis où l'on touchait ce qui le change. */}
        <div class="md:sticky md:top-0">
          <div
            ref={boiteAffiche}
            class="relative w-full overflow-hidden border border-ink/10 bg-paper-deep"
            style={{ "aspect-ratio": sensAffiche() === "paysage" ? "1.4142 / 1" : "1 / 1.4142" }}
          >
            <Show
              when={apercu()}
              fallback={
                <Show
                  when={photoLocale()}
                  fallback={
                    <AttenteAffiche
                      paysage={sensAffiche() === "paysage"}
                      ciel={modeCiel()}
                      texte={modeCiel() ? tr("ciel.attente") : tr("ia.apercu_vide")}
                    />
                  }
                >
                  {/* La photo du client, en attendant l'affiche : il voit tout
                      de suite que c'est bien la bonne qui part. */}
                  <img
                    src={photoLocale()!}
                    alt=""
                    class="absolute inset-0 h-full w-full object-cover opacity-40"
                  />
                </Show>
              }
            >
              {/* Pas de filigrane SVG ici : celui de /ia/apercu est CUIT dans
                  les pixels de l'image. Il protège donc mieux que le nôtre —
                  qui disparaîtrait si on enregistrait l'image seule — et deux
                  filigranes superposés rendaient l'affiche illisible. */}
              {/* Avec des personnages (20/11) : l'image, le muret et les
                  personnages, dessinés par l'aperçu du module — sans son
                  filigrane ni son texte. Les calques de texte ci-dessous
                  restent par-dessus, déplaçables comme avant. En attendant
                  le module, ou s'il ne vient pas, l'image seule. */}
              <Show when={compoMontree()} fallback={imageApercu()}>
                {(compo) => {
                  // Le module, s'il n'est pas là, est redemandé (21/11) : les
                  // personnages paraissent dès qu'il arrive, par ce chemin ou
                  // par un autre (préchargement, composition).
                  if (!modulePersonnages()) void chargerPersonnages().catch(() => {});
                  return (
                    <ErrorBoundary fallback={imageApercu()}>
                      <Suspense fallback={imageApercu()}>
                        <Show when={modulePersonnages()} fallback={imageApercu()}>
                          {(m) => {
                            const ApercuPersonnages = m().ApercuPersonnages;
                            return (
                              <ApercuPersonnages
                                langue={props.langue}
                                publicId={publicId()!}
                                format={format() === "A3" ? "A3" : "A4"}
                                compo={compo()}
                                alt={tr("ia.apercu_alt")}
                                repli={imageApercu}
                              />
                            );
                          }}
                        </Show>
                      </Suspense>
                    </ErrorBoundary>
                  );
                }}
              </Show>
            </Show>

            {/* Le texte, posé sur l'affiche comme sur les autres : même
                position (en haut), mêmes tailles, mêmes polices. Ce que le
                client voit ici est ce que le PDF imprimera. */}
            <Show when={lignesRemplies().length > 0}>
              {/* Deux calques de texte, même largeur, même unité de taille :
                  les lignes non touchées s'empilent en haut (calque 1), les
                  lignes déplacées sont posées à leur point (calque 2). Une
                  ligne passe de l'un à l'autre au premier geste. */}
              {/* Toute la mise en page — haut du bloc, marges, tailles,
                  interlignes, espaces, espacement des lettres — vient de
                  packages/types (mise-en-page-texte.ts), comme pour l'aperçu
                  des affiches classiques et pour le fichier d'impression. Une
                  ligne n'est jamais repliée : trop longue, elle est réduite
                  (reductionDeLigne), comme à l'impression. */}
              <div
                ref={calqueEmpile}
                style={{
                  position: "absolute",
                  left: "0",
                  right: "0",
                  top: `${HAUT_DU_TEXTE * 100}%`,
                  "text-align": "center",
                  "pointer-events": "none",
                  padding: `0 ${MARGE_DU_TEXTE * 100}%`,
                  "container-type": "inline-size",
                  "z-index": "200",
                }}
              >
                <Index each={lignesAffichees()}>
                  {(ligne, rang) => (
                    <Show when={typeof ligne().x !== "number"}>
                      <div
                        data-rang-texte={rang}
                        title={modeCiel() ? undefined : tr("ia.deplacer_ligne")}
                        onPointerDown={(e) => !modeCiel() && attraperLigne(e, ligne().rang)}
                        style={{
                          "pointer-events": modeCiel() ? "none" : "auto",
                          cursor: modeCiel() ? "default" : "move",
                          "touch-action": "none",
                          "user-select": "none",
                          "font-family": familleCss(policeDeLigne(ligne().font, rang)),
                          color: couleur(),
                          "font-size": `${tailleDeLigneCqw(rang) * echelleTexte() * reductionDeLigne(rang) * facteurTailleLigne(ligne().taille)}cqw`,
                          "line-height": String(interligneDeLigne(rang)),
                          "letter-spacing": `${espacementDeLigne(rang)}em`,
                          "margin-top": `${espaceAvantLigne(rang)}em`,
                          "white-space": "nowrap",
                        }}
                      >
                        <MorceauxDeLigne
                          valeur={ligne().value}
                          police={policeDeLigne(ligne().font, rang)}
                        />
                      </div>
                    </Show>
                  )}
                </Index>
              </div>
              <div
                ref={calquePose}
                style={{
                  position: "absolute",
                  inset: "0",
                  "pointer-events": "none",
                  padding: `0 ${MARGE_DU_TEXTE * 100}%`,
                  "container-type": "inline-size",
                  "z-index": "201",
                }}
              >
                <Index each={lignesAffichees()}>
                  {(ligne, rang) => (
                    <Show when={typeof ligne().x === "number"}>
                      <div
                        data-rang-texte={rang}
                        title={modeCiel() ? undefined : tr("ia.deplacer_ligne")}
                        onPointerDown={(e) => !modeCiel() && attraperLigne(e, ligne().rang)}
                        style={{
                          position: "absolute",
                          left: `${(ligne().x ?? 0.5) * 100}%`,
                          top: `${(ligne().y ?? 0.1) * 100}%`,
                          transform: "translate(-50%, -50%)",
                          // Les morceaux d'une ligne coupée à la main, centrés
                          // l'un sous l'autre, comme le fichier d'impression
                          // les pose.
                          "text-align": "center",
                          "white-space": "nowrap",
                          "pointer-events": modeCiel() ? "none" : "auto",
                          cursor: modeCiel() ? "default" : "move",
                          "touch-action": "none",
                          "user-select": "none",
                          "font-family": familleCss(policeDeLigne(ligne().font, rang)),
                          color: couleur(),
                          "font-size": `${tailleDeLigneCqw(rang) * echelleTexte() * reductionDeLigne(rang) * facteurTailleLigne(ligne().taille)}cqw`,
                          "line-height": String(INTERLIGNE_LIGNE_POSEE),
                          "letter-spacing": `${espacementDeLigne(rang)}em`,
                        }}
                      >
                        <MorceauxDeLigne
                          valeur={ligne().value}
                          police={policeDeLigne(ligne().font, rang)}
                        />
                      </div>
                    </Show>
                  )}
                </Index>
              </div>
            </Show>

            {/* Pas de signature de la boutique sur l'aperçu : comme pour
                toutes les créations, elle n'est posée que sur le fichier
                d'impression (apps/api/src/pdf.ts, signaturePosee). */}

            <Show when={occupe()}>
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper/70 p-6 text-center">
                <span class="ml-spinner" aria-hidden="true" />
                <p class="text-sm font-medium">
                  {etape() === "envoi" ? tr("ia.envoi") : tr("ia.generation")}
                </p>
                <p class="text-xs text-ink-soft">{tr("ia.generation_duree")}</p>
                <p class="text-xs tabular-nums text-ink-soft">{secondes()} s</p>
              </div>
            </Show>
          </div>

          <Show when={apercu()}>
            <p class="mt-2 text-xs text-ink-soft">{tr("ia.filigrane_note")}</p>
          </Show>

          {/* Les affiches de la séance, dès qu'il y en a deux : un toucher
              sur une vignette la remet dans le grand aperçu ; la case la
              garde pour le panier. Vignettes assez grandes pour le doigt,
              sur la tablette du stand. */}
          {/* Pas sur le ciel étoilé (26/11, Alexandra : « supprime ça pour ce
              produit ») : on redessine son ciel, on ne collectionne pas les
              versions ; seule l'affiche montrée part au panier. */}
          <Show when={!modeCiel() && creations().length > 1}>
            <div class="mt-4">
              <p class="text-sm font-medium">
                {tr("ia.creations_titre").replace("{n}", String(creations().length))}
              </p>
              <p class="mt-0.5 text-xs text-ink-soft">{tr("ia.creations_aide")}</p>
              <ul class="mt-2 grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                <For each={creations()}>
                  {(c, i) => {
                    const vue = () => publicId() === c.publicId;
                    const gardee = () => aAjouter().includes(c.publicId);
                    const nom = () => tr("ia.creation_n").replace("{n}", String(i() + 1));
                    /**
                     * Ses personnages (20/11) : cochée avec d'autres, chacune
                     * part avec les siens, ou sans. Le nombre se lit sur la
                     * vignette, pour qu'on sache lesquelles en ont.
                     */
                    const nbPersonnages = () => compoDe(c.publicId)?.personnages.length ?? 0;
                    return (
                      <li class="relative">
                        <button
                          type="button"
                          disabled={occupe()}
                          onClick={() => revoir(c)}
                          aria-label={
                            nbPersonnages()
                              ? `${nom()} — ${nbPersonnages()} ${
                                  nbPersonnages() > 1 ? tr("panier.personnages") : tr("panier.personnage")
                                }`
                              : nom()
                          }
                          aria-current={vue() ? "true" : undefined}
                          class={`relative block w-full overflow-hidden border-2 bg-paper-deep transition-colors disabled:opacity-60 ${
                            vue() ? "border-ink" : "border-ink/15 hover:border-ink/45"
                          }`}
                          style={{ "aspect-ratio": c.sens === "paysage" ? "1.4142 / 1" : "1 / 1.4142" }}
                        >
                          <img src={c.apercu} alt="" loading="lazy" class="h-full w-full object-contain" />
                          <Show when={nbPersonnages()}>
                            <span
                              aria-hidden="true"
                              class="absolute bottom-1 right-1 inline-flex items-center gap-0.5 bg-ink px-1 py-0.5 text-[10px] font-medium leading-none text-paper"
                            >
                              <svg viewBox="0 0 12 12" class="h-2.5 w-2.5" fill="currentColor">
                                <circle cx="6" cy="3.5" r="2.3" />
                                <path d="M1.6 11.5c0-2.7 2-4.8 4.4-4.8s4.4 2.1 4.4 4.8z" />
                              </svg>
                              {nbPersonnages()}
                            </span>
                          </Show>
                        </button>
                        <label class="mt-1 flex cursor-pointer items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={gardee()}
                            disabled={ajout()}
                            onChange={() => basculerAjout(c.publicId)}
                            class="h-5 w-5 accent-ink"
                            aria-label={`${tr("ia.garder")} — ${nom()}`}
                          />
                          {tr("ia.garder")}
                        </label>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </div>
          </Show>
        </div>

        {/* ---------------------------- Commandes ------------------------ */}
        {/* Les étapes (27/11, voir `volet`) : les pastilles en haut, une étape
            à la fois, la barre « Retour / Continuer » collée au bas de la
            fenêtre. `min-w-0` : la rangée des pastilles ne passe jamais à la
            ligne ; sans lui, sa largeur minimale élargissait la colonne, et
            la fenêtre défilait de côté sur un téléphone de 320 px. */}
        <div class="min-w-0">
          {/* Les pastilles, comme celles du module des affiches
              personnalisables (`.ml-cfg-etapes`) : sur une ligne, numérotées,
              celle de l'étape montrée pleine (`aria-current`). Chacune se
              touche à tout moment, pour revenir modifier comme pour aller
              plus loin. */}
          <div
            ref={rangeeOnglets}
            class="ml-cfg-etapes mt-1 flex flex-nowrap gap-1.5"
            role="group"
            aria-label={tr("ia.etapes")}
          >
            <For each={ongletsVisibles()}>
              {(o, i) => {
                const vu = () => volet() === o;
                return (
                  <button
                    type="button"
                    data-etape={o}
                    aria-controls={idEtape(o)}
                    aria-current={vu() ? "step" : undefined}
                    onClick={() => allerA(o, true)}
                    class={`ml-cfg-etape inline-flex min-h-8 min-w-0 flex-auto items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold leading-tight transition-colors ${
                      vu() ? "bg-ink text-paper" : "bg-ink/10 text-ink hover:bg-ink/15"
                    }`}
                  >
                    <span class="min-w-0 overflow-hidden text-ellipsis">
                      {i() + 1}. {nomOnglet(o)}
                    </span>
                  </button>
                );
              }}
            </For>
          </div>

          {/* 1. Photo — le style, la photo, ce qui en fait une affiche — ou
              Ciel — son formulaire. « Générer une autre version » et
              « Recommencer » sont ici, près de ce qu'ils refont. */}
          <div id={idEtape("source")} hidden={volet() !== "source"}>
            <Show when={modeCiel()}>
              <div class="mt-5">
                <CielEtoile
                  langue={props.langue ?? LANGUE_DEFAUT}
                  productId={Number(props.product.id)}
                  occupe={occupe() || !!composer()}
                  onCree={cielCree}
                  texte={texteCiel()}
                  silhouettes={silhouettesCiel()}
                  onReglage={reglageCiel}
                  onIncomplet={setCielIncomplet}
                />
              </div>
            </Show>
            <Show when={!modeCiel()}>
              {/* Le style, EN PREMIER quand la boutique en propose : c'est
                  lui qui fait la première génération. Une carte par style —
                  sa première image, son nom —, assez grande pour le doigt
                  sur la tablette du stand. */}
              <Show when={choixDuStyle()}>
                <div ref={blocStyle}>
                  {/* Le titre seul, sans phrase d'aide (27/11, Alexandra :
                      « supprimer les phrases côté client qui sont inutiles »). */}
                  <p class="mt-5 font-medium">{tr("ia.style_titre")}</p>
                  <Show when={rappelStyle() && styleManquant()}>
                    <p role="alert" class="mt-2 bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta-deep">
                      {tr("ia.style_manquant")}
                    </p>
                  </Show>
                  {/* TOUJOURS une rangée qui défile de côté (27/11, Alexandra :
                      « ça doit tjs rester scroll horizontal ») : autant de styles
                      qu'elle en ajoute, la fenêtre ne s'allonge plus. Les flèches
                      et la barre sont celles de toutes les listes du site
                      (ZoneDefilante). Un peu de marge en haut et à droite : la
                      coche du style choisi déborde du coin de sa carte. */}
                  <ZoneDefilante
                    sens="horizontal"
                    versDebut={tr("cfg.precedent")}
                    versFin={tr("cfg.suivant")}
                    class="mt-1 flex snap-x gap-3 overflow-x-auto pb-1 pr-2 pt-2"
                  >
                    <For each={styles()}>
                      {(st) => {
                        const actif = () => styleChoisi() === st.id;
                        const image = assetUrl(st.images[0], 400);
                        return (
                          <button
                            type="button"
                            aria-pressed={actif()}
                            disabled={occupe()}
                            // Toucher le style déjà choisi le GARDE : il est
                            // obligatoire, et un second appui involontaire sur
                            // la tablette ne doit pas éteindre la suite.
                            // Même étape que la photo depuis le 27/11 : rien ne
                            // change d'étape au choix d'un style.
                            onClick={() => {
                              setStyleChoisi(st.id);
                              setRappelStyle(false);
                            }}
                            // Le choix fait se dessine par `ml-choix` (global.css),
                            // comme tous les choix du site : cadre et coche
                            // rouges. Rien n'est rogné : la coche déborde du coin
                            // de la carte.
                            class="ml-choix flex w-[8.5rem] shrink-0 snap-start flex-col border border-ink/15 text-left hover:border-ink/45 disabled:opacity-60 sm:w-[9.5rem]"
                          >
                            <Show when={image} fallback={<AttenteStyle titre={st.titre} />}>
                              <img
                                src={image!}
                                alt=""
                                loading="lazy"
                                class="aspect-[4/5] w-full object-cover"
                              />
                            </Show>
                            {/* Le nom ne se remplit plus de noir : un bandeau noir
                                se lisait comme un bouton à presser, pas comme un
                                choix fait. */}
                            <span
                              class={`px-3 py-2.5 text-sm ${actif() ? "font-semibold" : ""}`}
                            >
                              {st.titre}
                            </span>
                          </button>
                        );
                      }}
                    </For>
                  </ZoneDefilante>
                </div>
              </Show>

              <p class="mt-5 font-medium">{tr("ia.photo_titre")}</p>

              {/* Zone de dépôt : clic OU glisser-déposer. Le champ fichier reste
                  un vrai <input>, donc utilisable au clavier et aux lecteurs
                  d'écran ; le cadre n'est que sa décoration. Éteinte tant qu'un
                  style reste à choisir, et elle dit pourquoi. */}
              {/* `relative` (21/11) : le champ masqué (sr-only) est en position
                  absolue. Sans ancêtre positionné, il se plaçait par rapport au
                  fond grisé de la fenêtre (.ml-modal-overlay, en position fixe),
                  bien plus bas que son bord : ce fond défilait, surtout quand un
                  toucher sur la zone donnait le focus au champ — jusqu'à plus de
                  800 px sur téléphone, et environ 60 px sur la tablette du stand
                  dès quatre styles —, et emportait l'en-tête et la croix. Rangé
                  dans son cadre, il suit le corps de la fenêtre et n'agrandit
                  plus rien ; le clic, le dépôt et le relais du stand sont
                  inchangés. */}
              {/* Au stand, pas de zone de dépôt (27/11, Alexandra : « enlève ça
                  pour les stands Déposez votre photo ici, ou cliquez pour la
                  choisir / JPEG, PNG ou WebP ») : la photo arrive du téléphone
                  par le relais, juste dessous. Le champ fichier reste, caché et
                  dans son cadre positionné (voir plus haut) : le bouton « Choisir
                  une photo » l'ouvre toujours sur la tablette. */}
              <Show
                when={!props.stand}
                fallback={
                  <div class="relative">
                    <input
                      ref={champFichier}
                      type="file"
                      accept={TYPES_PHOTO.join(",")}
                      class="sr-only"
                      disabled={occupe()}
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (f) void choisirPhoto(f);
                      }}
                    />
                  </div>
                }
              >
                <label
                  class={`relative mt-3 flex flex-col items-center justify-center gap-1 border-2 border-dashed p-6 text-center transition-colors ${
                    survol()
                      ? "cursor-pointer border-terracotta bg-terracotta/5"
                      : "cursor-pointer border-ink/25 hover:border-ink/50"
                  } ${occupe() ? "pointer-events-none opacity-60" : ""}`}
                  onDragOver={(e) => {
                    // Toujours retenu, même éteinte : une photo lâchée à côté du
                    // but ne doit pas remplacer la boutique par l'image seule.
                    e.preventDefault();
                    setSurvol(true);
                  }}
                  onDragLeave={() => setSurvol(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setSurvol(false);
                    const f = e.dataTransfer?.files?.[0];
                    if (f) void choisirPhoto(f);
                  }}
                >
                  <input
                    ref={champFichier}
                    type="file"
                    accept={TYPES_PHOTO.join(",")}
                    class="sr-only"
                    disabled={occupe()}
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      // Remise à zéro : rechoisir LE MÊME fichier doit relancer.
                      e.currentTarget.value = "";
                      if (f) void choisirPhoto(f);
                    }}
                  />
                  <span class="text-sm font-medium">
                    {nomPhoto() ? tr("ia.changer_photo") : tr("ia.depot")}
                  </span>
                  {/* Aucune limite de poids à annoncer : la photo est réduite
                      dans le navigateur avant de partir. « 10 Mo maximum » faisait
                      renoncer à des photos de téléphone parfaitement acceptées. */}
                  <span class="text-xs text-ink-soft">{tr("ia.depot_formats")}</span>
                  <Show when={nomPhoto()}>
                    <span class="mt-1 max-w-full truncate text-xs text-ink-soft">
                      {nomPhoto()}
                    </span>
                  </Show>
                </label>
              </Show>

              {/* Au stand, la photo est souvent dans le téléphone du client : la
                  tablette montre un QR code, la photo arrive ici. Même règle que
                  la zone de dépôt — éteinte tant qu'un style reste à choisir. */}
              {/* Pendant la composition des personnages (20/11), le relais est
                  occupé puis fermé : une photo arrivée du téléphone effacerait
                  l'affiche qu'on est en train de composer (choisirPhoto). */}
              {/* Sur le site aussi depuis le 21/11, sur un grand écran : même
                  place, mêmes règles, sans code du stand. */}
              {/* Dans un autre onglet (27/11), il reste ouvert et à l'écoute :
                  l'étape est cachée, pas démontée. La photo qui arrive se voit
                  dans l'aperçu, toujours en vue sur la tablette. */}
              <Show when={props.stand || grandEcran()}>
                <RelaisPhoto
                  langue={props.langue}
                  stand={!!props.stand}
                  disponible={true}
                  occupe={occupe() || !!composer()}
                  interrompre={etape() === "generation" || !!composer()}
                  onPhoto={(f) => void choisirPhoto(f)}
                />
              </Show>

              {/* UNE consigne, et qu'on la voie : la boutique a retiré les autres
                  (cadrage, « un seul lieu »…) — elles décourageaient les photos de
                  famille, qui donnent justement de belles affiches. */}
              <p class="mt-4 flex items-center gap-2 border-l-4 border-terracotta bg-terracotta/5 px-4 py-3 text-sm font-medium text-ink">
                <span aria-hidden="true">📸</span>
                {tr("ia.photo_nette")}
              </p>

              {/* Le sens de l'affiche, choisi AVANT de créer : il décide du cadrage
                  que l'IA compose. Deux gros boutons plutôt qu'une liste — on doit
                  voir d'un coup d'œil lequel est pris, sur la tablette du stand. */}
              <div class="mt-4">
                <span class="block text-sm font-medium">{tr("ia.orientation")}</span>
                <div class="mt-3 grid grid-cols-2 gap-3" role="radiogroup">
                  <For each={["portrait", "paysage"] as const}>
                    {(sens) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={orientation() === sens}
                        disabled={occupe()}
                        onClick={() => {
                          sensChoisiALaMain = true;
                          setOrientation(sens);
                        }}
                        // Choix fait : `ml-choix` (global.css), plus de noir plein.
                        class={`ml-choix flex items-center justify-center gap-2 border border-ink/15 px-3 py-2.5 text-sm hover:border-ink/45 disabled:opacity-60 ${
                          orientation() === sens ? "font-semibold" : ""
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          class={`inline-block border-2 border-current ${
                            sens === "portrait" ? "h-5 w-3.5" : "h-3.5 w-5"
                          }`}
                        />
                        {tr(sens === "portrait" ? "ia.portrait" : "ia.paysage")}
                      </button>
                    )}
                  </For>
                </div>
                <Show when={apercu() && orientation() !== orientationApercu()}>
                  <p class="mt-2 text-xs text-ink-soft">{tr("ia.orientation_relancer")}</p>
                </Show>
              </div>

              <label class="mt-4 block text-sm">
                <span class="font-medium">{tr("ia.precision")}</span>
                <input
                  type="text"
                  value={precision()}
                  disabled={occupe()}
                  placeholder={tr("ia.precision_exemple")}
                  onInput={(e) => setPrecision(e.currentTarget.value)}
                  class="mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none disabled:opacity-60"
                />
              </label>

              {/* L'action suivante est ICI, juste sous la photo, et non tout en
                  bas après les textes et le format : sur la tablette, « Créer
                  mon affiche » tombait à plus d'un écran de la photo qu'il
                  concerne, et l'aperçu qui montre la création en cours sortait de
                  la vue au moment de toucher. L'affiche obtenue, « Générer une
                  autre version » prend sa place (27/11 : il restait au bas de la
                  colonne, près du panier). */}
              <Show when={messageEchec() && ongletEchec() === "source"}>
                <p
                  ref={messagePhoto}
                  role="status"
                  class="mt-4 border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
                >
                  {messageEchec()}
                </p>
              </Show>
              <div class="mt-5 flex flex-wrap items-center gap-3">
                <Show
                  when={!apercu()}
                  fallback={
                    <button
                      type="button"
                      disabled={occupe()}
                      onClick={() => (styleManquant() ? rappelerLeStyle() : void lancerGeneration())}
                      class="rounded-full border border-ink px-6 py-3 text-sm font-medium hover:bg-ink hover:text-paper transition-colors disabled:opacity-60"
                    >
                      {tr("ia.regenerer")}
                    </button>
                  }
                >
                  <Show
                    when={chemin()}
                    fallback={
                      <button
                        type="button"
                        disabled={occupe()}
                        onClick={() => champFichier?.click()}
                        class="rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
                      >
                        {tr("ia.depot_bouton")}
                      </button>
                    }
                  >
                    <button
                      ref={boutonCreer}
                      type="button"
                      disabled={occupe()}
                      onClick={() => (styleManquant() ? rappelerLeStyle() : void lancerGeneration())}
                      class="rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
                    >
                      {tr("ia.generer")}
                    </button>
                  </Show>
                </Show>
                <Show when={apercu() || chemin()}>{boutonRecommencer()}</Show>
              </div>
              {/* La photo est partie avant que la liste des styles réponde : le
                  bouton est éteint, et il faut dire pourquoi. */}
              <Show when={!apercu() && chemin() && styleManquant()}>
                <p class="mt-2 text-sm text-ink-soft">{tr("ia.style_manquant")}</p>
              </Show>
            </Show>
          </div>

          {/* 2. Le texte : les trois lignes, leurs polices, la couleur. */}
          <div id={idEtape("texte")} hidden={volet() !== "texte"}>
            {blocTextes()}
          </div>

          {/* 3. Les personnages, une fois l'affiche obtenue. */}
          <div id={idEtape("personnages")} hidden={volet() !== "personnages"}>
            <Show
              when={apercu()}
              fallback={<p class="mt-5 text-sm text-ink-soft">{tr("ia.etape.creer_dabord")}</p>}
            >
              {modeCiel() ? blocSilhouettes() : blocPersonnages()}
            </Show>
          </div>

          {/* 4. Le format, puis le panier : « Ajouter au panier » reste
              éteint tant qu'aucune affiche n'existe, et une phrase dit
              pourquoi. Un refus du panier se lit juste au-dessus. */}
          <div id={idEtape("format")} hidden={volet() !== "format"}>
            {blocFormats("mt-5")}
            <Show when={!apercu()}>
              <p class="mt-5 text-sm text-ink-soft">{tr("ia.etape.creer_dabord")}</p>
            </Show>
            <Show when={messageEchec() && ongletEchec() === "format"}>
              <p
                ref={messageFormat}
                role="status"
                class="mt-4 border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
              >
                {messageEchec()}
              </p>
            </Show>
            <div class="mt-6 flex flex-wrap items-center gap-3">
              <Show when={apercu()}>{blocQuantite()}</Show>
              {boutonAjouter()}
            </div>
          </div>

          {barreDesEtapes()}
        </div>
      </div>
    </div>
    </div>
    </div>
      </Show>
    </>
  );
}
