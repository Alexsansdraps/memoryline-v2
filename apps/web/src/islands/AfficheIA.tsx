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
  onCleanup,
  onMount,
  For,
  Index,
  Show,
  type JSX,
} from "solid-js";
import {
  COULEURS_TEXTE_AFFICHE,
  COULEUR_TEXTE_DEFAUT,
  NB_LIGNES_AFFICHE,
  POLICE_SOUSTITRE_DEFAUT,
  POLICE_TITRE_DEFAUT,
  familleCss,
  ligneEnMajuscules,
  policeParId,
  limiterRetours,
  MORCEAUX_PAR_LIGNE,
  policesDeLaLigne,
  sousLignes,
  type PosterConfig,
  type TextBlock,
} from "@memoryline/types";
import { assetUrl, browserApi, formatPrice, getCartId } from "../lib/api.ts";
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
 */
export interface AfficheIAProps {
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
   * (RelaisPhoto.tsx). Sur le site, rien ne change — le visiteur a sa photo
   * sous la main, dans l'appareil qui affiche la page.
   */
  stand?: boolean;
}

/** Étapes du parcours, dans l'ordre où le client les traverse. */
type Etape = "depot" | "envoi" | "generation" | "pret";

/**
 * Le numéro d'une étape, devant son titre.
 *
 * Il ne s'affiche que lorsque le parcours en compte vraiment plusieurs —
 * style, puis photo : c'est lui qui dit, sans une phrase de plus, dans quel
 * ordre les faire.
 */
function Numero(props: { n: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class="inline-flex h-6 w-6 shrink-0 items-center justify-center bg-ink text-xs font-medium text-paper"
    >
      {props.n}
    </span>
  );
}

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
function AttenteAffiche(props: { paysage: boolean; texte: string }): JSX.Element {
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
            <>
              <rect x="13" y="5" width="38" height="54" rx="1.5" />
              <path d="M24 12h16" />
              <rect x="18" y="17" width="28" height="34" rx="1" />
              <circle cx="37.5" cy="25" r="3.5" />
              <path d="M18 45l8-9 6 6 4-4 10 8" />
            </>
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

export default function AfficheIA(props: AfficheIAProps): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  const locale = LOCALE_COMPLETE[props.langue ?? LANGUE_DEFAUT];

  const [etape, setEtape] = createSignal<Etape>("depot");
  const [echec, setEchec] = createSignal<EchecIA | null>(null);
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
  /** Un style reste à choisir avant d'envoyer la photo ou de créer. */
  const styleManquant = () => choixDuStyle() && styleChoisi() === null;

  /**
   * Les trois lignes de texte, « comme sur les autres affiches » : mêmes
   * polices, mêmes deux couleurs, même rendu. L'affiche IA n'est pas un autre
   * produit, c'est une affiche dont le fond vient d'une photo — le texte se
   * compose par-dessus exactement comme sur un fond du catalogue, à l'écran
   * comme à l'impression.
   */
  type Ligne = { value: string; font: string; x?: number; y?: number };
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
   * Taille des lignes en cqw, par rang parmi les lignes REMPLIES : la même
   * échelle que l'aperçu des affiches classiques (PosterPreview), pour que
   * les deux se ressemblent trait pour trait.
   */
  const TAILLES_LIGNES = [8, 5.5, 4.6];

  // Les clés de traduction sont un type fermé : on les énumère au lieu de les
  // fabriquer par interpolation, sinon le compilateur ne peut plus garantir
  // qu'elles existent dans les cinq langues.
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
   * Gardées aussi dans la mémoire de l'onglet (sessionStorage) : un
   * rechargement par erreur sur la tablette ne doit pas les faire perdre.
   * La clé porte le PANIER : au stand, « Client suivant » repart d'un panier
   * neuf, et le client suivant ne voit donc rien de celles du précédent.
   * Chacune garde la photo dont elle vient, pour pouvoir la relancer.
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
  };
  /** Lue dans le navigateur seulement : le panier n'existe pas au rendu serveur. */
  let cleCreations = "";
  const [creations, setCreations] = createSignal<Creation[]>([]);
  /** Les créations cochées pour le panier, par leur identifiant. */
  const [aAjouter, setAAjouter] = createSignal<string[]>([]);
  onMount(() => {
    try {
      cleCreations = `ml_ia_creations_${getCartId()}_${props.product.id}`;
      const lues = JSON.parse(sessionStorage.getItem(cleCreations) ?? "[]") as Creation[];
      if (Array.isArray(lues)) setCreations(lues.filter((c) => c?.publicId && c?.apercu));
    } catch {
      /* mémoire indisponible (navigation privée…) : la séance repart de zéro */
    }
  });
  function memoriserCreations(liste: Creation[]) {
    setCreations(liste);
    try {
      if (cleCreations) sessionStorage.setItem(cleCreations, JSON.stringify(liste));
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
  function basculerAjout(id: string) {
    setAAjouter((liste) =>
      liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id],
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
      case "plafond":
        return tr("ia.err.plafond");
      case "generation":
        return tr("ia.err.generation");
      case "attente":
        return tr("ia.err.attente");
      case "inconnu":
        return tr("ia.err.inconnu");
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
    // Le style d'abord : la zone de dépôt est déjà éteinte tant qu'il manque,
    // ceci ne couvre qu'un fichier lâché dessus malgré tout.
    if (styleManquant()) return;
    const refus = verifierFormatPhoto(fichier);
    if (refus) {
      setEchec(refus);
      return;
    }
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
        { publicId: gen.publicId, apercuChemin: gen.apercuUrl, apercu: prete, sens, source },
      ]);
    } catch (e) {
      setEchec(causeDe(e));
      // On garde la photo ET l'affiche déjà obtenue : un essai raté ne doit
      // ni effacer l'aperçu retenu, ni obliger à rechoisir le fichier.
      setEtape(apercu() ? "pret" : "depot");
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
      window.location.href = lien(props.langue ?? LANGUE_DEFAUT, "/panier");
    } catch {
      setEchec("inconnu");
      setAjout(false);
    }
  }

  /** Une ligne de panier pour UNE affiche obtenue. */
  async function ajouterUneAffiche(a: {
    publicId: string;
    apercuChemin: string | null;
    sens: "portrait" | "paysage";
  }) {
    const config: PosterConfig = {
      schemaVersion: 1,
      productId: props.product.id,
      format: format() === "A3" ? "A3" : "A4",
      ...(a.sens === "paysage" ? { orientation: "paysage" as const } : {}),
      view: "front",
      // Compacte, sans trou : l'API refuse une entrée vide au milieu, et
      // le rendu ne lit de toute façon que la suite des lignes remplies.
      texts: {
        lines: lignesRemplies().map(
          (l): TextBlock => ({
            value: l.value.trim(),
            font: l.font,
            color: couleur(),
            ...(typeof l.x === "number" && typeof l.y === "number"
              ? { x: l.x, y: l.y }
              : {}),
          }),
        ),
      },
      characters: [],
      // C'est CE champ qui rattache la ligne à la génération retenue : le
      // serveur y retrouve le fichier sans filigrane à imprimer une fois la
      // commande payée.
      aiPublicId: a.publicId,
      aiApercuUrl: a.apercuChemin ?? undefined,
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
    if (e.key === "Escape" && ouverte()) fermer();
  }
  onMount(() => window.addEventListener("keydown", surTouche));
  onCleanup(() => {
    window.removeEventListener("keydown", surTouche);
    verrouillerDefilement(false);
  });

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        class="mt-8 inline-block rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
      >
        {tr("produit.personnaliser")}
      </button>
      <p class="mt-3 text-sm text-ink-soft">{tr("ia.intro")}</p>

      <Show when={ouverte()}>
    <div
      class="ml-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={tr("ia.titre")}
      onClick={(e) => {
        if (e.target === e.currentTarget) fermer();
      }}
    >
    <div class="ml-modal-panel">
      <header class="ml-modal-head">
        <h2 class="text-xl sm:text-2xl">{tr("ia.titre")}</h2>
        <button type="button" class="ml-modal-close" aria-label={tr("cfg.fermer")} onClick={fermer}>
          ✕
        </button>
      </header>
    <div class="ml-modal-body">
      {/* Dans la modale (1040 px au plus) : l'aperçu à gauche à une taille où
          l'on juge une affiche, les réglages à droite. */}
      <div class="grid gap-8 items-start md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
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
                      texte={tr("ia.apercu_vide")}
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
              <img
                src={apercu()!}
                alt={tr("ia.apercu_alt")}
                class="absolute inset-0 h-full w-full object-contain"
              />
            </Show>

            {/* Le texte, posé sur l'affiche comme sur les autres : même
                position (en haut), mêmes tailles, mêmes polices. Ce que le
                client voit ici est ce que le PDF imprimera. */}
            <Show when={lignesRemplies().length > 0}>
              {/* Deux calques de texte, même largeur, même unité de taille :
                  les lignes non touchées s'empilent en haut (calque 1), les
                  lignes déplacées sont posées à leur point (calque 2). Une
                  ligne passe de l'un à l'autre au premier geste. */}
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  right: "0",
                  top: "5%",
                  "text-align": "center",
                  "pointer-events": "none",
                  padding: "0 6%",
                  "container-type": "inline-size",
                  "z-index": "200",
                }}
              >
                <Index each={lignesRemplies()}>
                  {(ligne, rang) => (
                    <Show when={typeof ligne().x !== "number"}>
                      <div
                        title={tr("ia.deplacer_ligne")}
                        onPointerDown={(e) => attraperLigne(e, ligne().rang)}
                        style={{
                          "pointer-events": "auto",
                          cursor: "move",
                          "touch-action": "none",
                          "user-select": "none",
                          "font-family": familleCss(
                            policeParId(
                              ligne().font,
                              rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT,
                            ),
                          ),
                          color: couleur(),
                          "font-size": `${(TAILLES_LIGNES[rang] ?? TAILLES_LIGNES.at(-1)!) * echelleTexte()}cqw`,
                          "line-height": rang === 0 ? "1.05" : "1.15",
                          "letter-spacing": rang === 0 ? "0.04em" : "normal",
                          "margin-top": rang === 0 ? "0" : "0.1em",
                          "word-break": "break-word",
                          // Un retour à la ligne tapé coupe la ligne ici comme
                          // à l'impression.
                          "white-space": "pre-line",
                        }}
                      >
                        {sousLignes(ligne().value).join("\n")}
                      </div>
                    </Show>
                  )}
                </Index>
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: "0",
                  "pointer-events": "none",
                  padding: "0 6%",
                  "container-type": "inline-size",
                  "z-index": "201",
                }}
              >
                <Index each={lignesRemplies()}>
                  {(ligne, rang) => (
                    <Show when={typeof ligne().x === "number"}>
                      <div
                        title={tr("ia.deplacer_ligne")}
                        onPointerDown={(e) => attraperLigne(e, ligne().rang)}
                        style={{
                          position: "absolute",
                          left: `${(ligne().x ?? 0.5) * 100}%`,
                          top: `${(ligne().y ?? 0.1) * 100}%`,
                          transform: "translate(-50%, -50%)",
                          // « pre » et non « nowrap » : une ligne coupée à la main
                          // garde ses retours, sans jamais se replier seule.
                          "white-space": "pre",
                          "pointer-events": "auto",
                          cursor: "move",
                          "touch-action": "none",
                          "user-select": "none",
                          "font-family": familleCss(
                            policeParId(
                              ligne().font,
                              rang === 0 ? POLICE_TITRE_DEFAUT : POLICE_SOUSTITRE_DEFAUT,
                            ),
                          ),
                          color: couleur(),
                          "font-size": `${(TAILLES_LIGNES[rang] ?? TAILLES_LIGNES.at(-1)!) * echelleTexte()}cqw`,
                          "line-height": "1.1",
                          "letter-spacing": rang === 0 ? "0.04em" : "normal",
                        }}
                      >
                        {sousLignes(ligne().value).join("\n")}
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
          <Show when={creations().length > 1}>
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
                    return (
                      <li class="relative">
                        <button
                          type="button"
                          disabled={occupe()}
                          onClick={() => revoir(c)}
                          aria-label={nom()}
                          aria-current={vue() ? "true" : undefined}
                          class={`relative block w-full overflow-hidden border-2 bg-paper-deep transition-colors disabled:opacity-60 ${
                            vue() ? "border-ink" : "border-ink/15 hover:border-ink/45"
                          }`}
                          style={{ "aspect-ratio": c.sens === "paysage" ? "1.4142 / 1" : "1 / 1.4142" }}
                        >
                          <img src={c.apercu} alt="" loading="lazy" class="h-full w-full object-contain" />
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
        <div>

          {/* 1. Le style, EN PREMIER quand la boutique en propose : c'est lui
              qui fait la première génération, pas seulement les suivantes.
              Une carte par style — sa première image, son nom —, assez
              grande pour le doigt sur la tablette du stand. */}
          <Show when={choixDuStyle()}>
            <div class="mt-5">
              <p class="flex items-center gap-2 font-medium">
                <Numero n={1} />
                {tr("ia.style_titre")}
              </p>
              <p class="mt-1 text-sm text-ink-soft">{tr("ia.style_aide")}</p>
              <div class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
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
                        onClick={() => setStyleChoisi(st.id)}
                        // Le choix fait se dessine par `ml-choix` (global.css),
                        // comme tous les choix du site : cadre et coche
                        // rouges. Rien n'est rogné : la coche déborde du coin
                        // de la carte.
                        class="ml-choix flex flex-col border border-ink/15 text-left hover:border-ink/45 disabled:opacity-60"
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
              </div>
            </div>

            <p class="mt-6 flex items-center gap-2 font-medium">
              <Numero n={2} />
              {tr("ia.photo_titre")}
            </p>
          </Show>

          {/* Zone de dépôt : clic OU glisser-déposer. Le champ fichier reste
              un vrai <input>, donc utilisable au clavier et aux lecteurs
              d'écran ; le cadre n'est que sa décoration. Éteinte tant qu'un
              style reste à choisir, et elle dit pourquoi. */}
          <label
            class={`${choixDuStyle() ? "mt-3" : "mt-5"} flex flex-col items-center justify-center gap-1 border-2 border-dashed p-6 text-center transition-colors ${
              styleManquant()
                ? "cursor-not-allowed border-ink/15 opacity-60"
                : survol()
                  ? "cursor-pointer border-terracotta bg-terracotta/5"
                  : "cursor-pointer border-ink/25 hover:border-ink/50"
            } ${occupe() ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={(e) => {
              // Toujours retenu, même éteinte : une photo lâchée à côté du
              // but ne doit pas remplacer la boutique par l'image seule.
              e.preventDefault();
              if (!styleManquant()) setSurvol(true);
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
              disabled={occupe() || styleManquant()}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                // Remise à zéro : rechoisir LE MÊME fichier doit relancer.
                e.currentTarget.value = "";
                if (f) void choisirPhoto(f);
              }}
            />
            <span class="text-sm font-medium">
              {styleManquant()
                ? tr("ia.style_manquant")
                : nomPhoto()
                  ? tr("ia.changer_photo")
                  : tr("ia.depot")}
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

          {/* Au stand, la photo est souvent dans le téléphone du client : la
              tablette montre un QR code, la photo arrive ici. Même règle que
              la zone de dépôt — éteinte tant qu'un style reste à choisir. */}
          <Show when={props.stand}>
            <RelaisPhoto
              langue={props.langue}
              disponible={!styleManquant()}
              occupe={occupe()}
              interrompre={etape() === "generation"}
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

          {/* Tant qu'aucune affiche n'est obtenue, l'action suivante est ICI,
              juste sous la photo, et non tout en bas après les textes et le
              format : sur la tablette, « Créer mon affiche » tombait à plus
              d'un écran de la photo qu'il concerne, et l'aperçu qui montre la
              création en cours sortait de la vue au moment de toucher. */}
          <Show when={!apercu()}>
            <Show when={messageEchec()}>
              <p
                role="status"
                class="mt-4 border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
              >
                {messageEchec()}
              </p>
            </Show>
            <div class="mt-5 flex flex-wrap items-center gap-3">
              <Show
                when={chemin()}
                fallback={
                  <button
                    type="button"
                    disabled={occupe() || styleManquant()}
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
                  disabled={occupe() || styleManquant()}
                  onClick={() => void lancerGeneration()}
                  class="rounded-full bg-ink px-8 py-3 text-paper font-medium hover:bg-ink/85 transition-colors disabled:opacity-60"
                >
                  {tr("ia.generer")}
                </button>
                <button
                  type="button"
                  disabled={occupe()}
                  onClick={reprendreDepart}
                  class="text-sm text-ink-soft underline underline-offset-4 hover:text-terracotta transition-colors disabled:opacity-60"
                >
                  {tr("ia.recommencer")}
                </button>
              </Show>
            </div>
            {/* La photo est partie avant que la liste des styles réponde : le
                bouton est éteint, et il faut dire pourquoi. */}
            <Show when={chemin() && styleManquant()}>
              <p class="mt-2 text-sm text-ink-soft">{tr("ia.style_manquant")}</p>
            </Show>
          </Show>

          {/* Les trois lignes, avec les règles des affiches personnalisables
              (packages/types/src/fonts.ts) : chaque ligne ne propose que SES
              polices — `policesDeLaLigne` —, et la première s'écrit en
              capitales. Chaque police est montrée DANS la police, sous son
              nom, comme au configurateur ; la couleur est commune aux trois. */}
          <div class="mt-5 space-y-3">
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
                      onClick={() => setCouleur(c.hex)}
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

          <Show when={formats().length > 1}>
            <div class="mt-4">
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

          {/* Une fois l'affiche obtenue, les actions se regroupent en bas :
              on a lu ses textes et choisi son format, reste à recommencer ou
              à la garder. */}
          <Show when={apercu()}>
            <Show when={messageEchec()}>
              <p
                role="status"
                class="mt-4 border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
              >
                {messageEchec()}
              </p>
            </Show>

            <div class="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={occupe() || styleManquant()}
                onClick={() => void lancerGeneration()}
                class="rounded-full border border-ink px-6 py-3 text-sm font-medium hover:bg-ink hover:text-paper transition-colors disabled:opacity-60"
              >
                {tr("ia.regenerer")}
              </button>
              {/* Les mêmes boutons qu'ailleurs dans la boutique : deux
                  touches plutôt qu'un champ seul, parce que sur un
                  téléphone passer de 1 à 3 se fait au pouce sans ouvrir le
                  clavier. */}
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
              <button
                type="button"
                disabled={ajout() || occupe()}
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
              <button
                type="button"
                disabled={occupe()}
                onClick={reprendreDepart}
                class="text-sm text-ink-soft underline underline-offset-4 hover:text-terracotta transition-colors disabled:opacity-60"
              >
                {tr("ia.recommencer")}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
    </div>
    </div>
      </Show>
    </>
  );
}
