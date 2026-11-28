/// <reference lib="dom" />
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, For, Show } from "solid-js";
import {
  bornerPlacement,
  CHAR_BASE_WIDTH,
  placementsAffiche,
  policeDefautLigne,
  type CharacterDTO,
  type ConfiguratorState,
  type LigneTexte,
  type PlacementPersonnage,
  type SlotsDTO,
  type SvgCache,
  type WorkingCharacter,
  variantesDeVue,
} from "../store";
import { placesTexteEnBas } from "../mise-en-page-motif";
import {
  espaceAvantLigne,
  espacementDeLigne,
  familleCss,
  HAUT_DU_TEXTE,
  interligneDeLigne,
  INTERLIGNE_LIGNE_POSEE,
  MARGE_DU_TEXTE,
  morceauxDeTexte,
  policeParId,
  sousLignes,
  tailleDeLigneCqw,
  facteurTailleLigne,
  urlAsset,
  aLaLargeur,
} from "@memoryline/types";
import { CharacterStack } from "./CharacterLayer";
import { enFormeEmoji } from "./emojis-imprimables";
import { Filigrane } from "./Filigrane";
import { createReductionDesLignes } from "./ReductionTexte";
import {
  messagesAvecDefauts,
  type MessagesConfigurateur,
} from "../messages";

/**
 * Couleur de repli d'un cadre dont le back-office n'a pas fixé la teinte :
 * un bois clair, le cadre le plus vendu. Mieux vaut un cadre approximatif
 * qu'une affiche nue là où le client vient d'en choisir un.
 */
const COULEUR_CADRE_DEFAUT = "#b07d42";

/**
 * Épaisseur du cadre, en proportion de la largeur de l'aperçu.
 *
 * En proportion plutôt qu'en pixels : l'aperçu fait quatre cents pixels de
 * large sur la fiche produit et le double en plein écran, un cadre fixe y
 * paraîtrait deux fois plus fin. La valeur correspond à peu près à la
 * baguette de trois centimètres d'un cadre vendu pour un A3.
 */
const PART_CADRE = 0.045;
/** En dessous, la baguette n'est plus qu'un trait ; au-dessus, elle mange l'affiche. */
const CADRE_MIN_PX = 7;
const CADRE_MAX_PX = 34;

/**
 * Pas d'un déplacement au clavier, en fraction de l'affiche.
 *
 * Une flèche déplace d'un centième d'affiche : assez pour se voir, assez fin
 * pour caler un personnage contre un autre en quelques appuis.
 */
const PAS_CLAVIER = 0.01;

/** Ratio largeur/hauteur d'affichage selon le format (portrait). */
function aspectFor(format: string): string {
  // A4 / A3 partagent le même ratio papier ~ 1:1.4142 (portrait).
  return format === "A4" || format === "A3" ? "1 / 1.4142" : "1 / 1.4142";
}

/**
 * Aperçu de l'affiche, espace de coordonnées normalisé 0..1.
 * Couches : fond -> personnages -> titre/sous-titre.
 *
 * Dans le configurateur (`recomposer`), les personnages se placent
 * AUTOMATIQUEMENT : en rangée le long du muret sur une affiche de dos, en
 * groupe — les petits devant — sur une affiche de face. Le panier et la
 * commande montrent la même affiche aux places enregistrées : on n'y compose
 * plus rien.
 */
export function PosterPreview(props: {
  state: ConfiguratorState;
  characterById: (id: string | number) => CharacterDTO | undefined;
  slots: SlotsDTO;
  cache: SvgCache;
  /**
   * Décor d'avant-plan (muret, banc…), posé devant le fond et derrière les
   * personnages. Déjà résolu par l'appelant : décor du produit, sinon décor
   * de son type d'affiche. Absent = pas de décor.
   */
  foregroundUrl?: string;
  /** Préfixe des assets, ajouté à l'affichage seulement. */
  assetBaseUrl?: string;
  /**
   * Filigrane « MEMORY LINE » sur l'affiche. ACTIF par défaut : tout ce qu'on
   * montre au client avant paiement en porte un. Seul un rendu destiné à
   * l'impression — qui n'existe qu'une fois la commande payée — le coupe.
   */
  filigrane?: boolean;
  /**
   * L'affiche accrochée au mur (« Voir sur un mur », ApercuAuMur.tsx, 27/11) :
   * coins droits — un papier n'a pas les coins arrondis d'une vignette — et
   * pas d'ombre propre : c'est le mur qui la porte.
   */
  auMur?: boolean;
  /**
   * Aperçu SANS texte : ni la couche des lignes, ni la roue qui attend leurs
   * polices, ni « Memory Line » à leur place (20/11). Absent : le texte, comme
   * toujours.
   *
   * Pour l'affiche tirée d'une photo (apps/web, AfficheIA) : son écran pose
   * lui-même ses textes au-dessus de cet aperçu, chacun à la place (x/y) où
   * le client l'a mis, ce que la couche de texte d'ici ne sait pas faire. Au
   * panier, sa vignette se montre sans texte, comme avant les personnages.
   */
  sansTexte?: boolean;
  /**
   * Cadre choisi, dessiné autour de l'affiche. Absent ou nul = affiche nue.
   *
   * On ne prend que ce qui se dessine : la couleur d'aperçu et le nom, pour
   * que le lecteur d'écran dise ce que l'œil voit.
   */
  cadre?: { name?: string; previewColor?: string | null } | null;
  /**
   * Compose la place des personnages (rangée de dos, groupe de face) à
   * chaque changement. VRAI dans le configurateur seulement.
   *
   * Partout ailleurs — panier, commande —, l'affiche se dessine aux places
   * ENREGISTRÉES dans la configuration (x, y, échelle, `position`), celles
   * que le fichier d'impression relit. Recomposer ici montrerait, pour une
   * affiche mise au panier avant un changement des règles de composition,
   * une autre affiche que celle qui sortira de l'imprimante.
   */
  recomposer?: boolean;
  /**
   * L'étalon de la composition (etalonDeLaVue) : la hauteur du plus grand
   * personnage proposé pour ce type d'affiche. Sert avec `recomposer`.
   */
  etalon?: number | null;
  /**
   * Autorise le client à déplacer les personnages du doigt ou à la souris.
   *
   * FAUX par défaut : partout ailleurs que dans le configurateur — panier,
   * commande — l'affiche n'est plus qu'une image de ce qui a été validé, et
   * on ne doit pas pouvoir la remanier d'un glissement involontaire.
   */
  deplacable?: boolean;
  /**
   * Le client vient de poser un personnage. La position est donnée en
   * fractions (0..1) de la zone d'affiche, déjà bornée à l'intérieur du cadre.
   */
  onDeplace?: (index: number, position: { x: number; y: number }) => void;
  /**
   * Libellés traduits. Facultatifs : le panier et la commande montrent la
   * même affiche que le configurateur, et un appelant qui ne passe rien
   * garde le français.
   */
  messages?: Partial<MessagesConfigurateur>;
  /**
   * Le motif d'une affiche à motifs (28/11, stand de Mulhouse), dans le
   * module : dessiné comme un personnage, à la place que la mise en page lui
   * donne (mise-en-page-motif.ts), devant le décor et derrière les
   * personnages. Au panier, il n'arrive pas par ici : c'est la première
   * entrée de `characters`, à sa place enregistrée.
   */
  motif?: {
    character: WorkingCharacter;
    base: CharacterDTO | undefined;
    place: { x: number; y: number; scale: number };
  } | null;
  /**
   * Où s'arrête le texte posé EN BAS d'une affiche à motifs, dans le module
   * (28/11) : au-dessus des têtes des personnages assis sur le muret
   * (miseEnPageDuMotif). Absent : au bas de l'affiche. Le panier n'en a pas
   * besoin : ses lignes portent leur place.
   */
  basDuTexteEnBas?: number;
}) {
  const m = () => messagesAvecDefauts(props.messages);

  /**
   * Texte montré tant que le client n'a rien saisi. Mémorisé : `<For>`
   * retrouve les mêmes lignes d'une lecture à l'autre, comme avec la
   * constante d'avant, et ne les redessine pas.
   */
  const lignesExemple = createMemo<LigneTexte[]>(() => [
    { value: "Memory Line", font: policeDefautLigne(0) },
    { value: m().exempleAffiche, font: policeDefautLigne(1) },
  ]);

  /** Les lignes remplies, dans l'ordre ; à défaut, le texte d'exemple. */
  const remplies = () => props.state.lignes.filter((l) => l.value.trim() !== "");
  const texteVide = () => remplies().length === 0;
  const lignesADessiner = () => (texteVide() ? lignesExemple() : remplies());

  /*
   * Les polices de l'affiche, chargées AVANT que le texte se montre
   * (Alexandra, 17/11 : le texte apparaissait dans une autre police, puis
   * changeait — « ça fait vraiment un effet bizarre »). Tant que la police
   * d'une ligne n'est pas là, le texte reste caché (sa place est gardée) et
   * une roue tourne à sa place. Une police déjà chargée ne fait rien
   * attendre : changer de police une seconde fois est immédiat. Au pire,
   * quatre secondes, puis le texte se montre quand même.
   */
  const [policesPretes, setPolicesPretes] = createSignal(true);
  createEffect(() => {
    // Sans texte, aucune police à attendre : rien ne les montrera, inutile
    // de les faire venir (au stand, en 4G).
    if (props.sansTexte) return;
    if (typeof document === "undefined" || !document.fonts) return;
    const familles = new Set<string>();
    lignesADessiner().forEach((ligne, rang) => {
      const police = policeParId(ligne.font, policeDefautLigne(rang));
      familles.add(police.famille);
      for (const sousLigne of sousLignes(ligne.value))
        for (const morceau of morceauxDeTexte(sousLigne, police)) familles.add(morceau.police.famille);
    });
    const manquantes = [...familles].filter((f) => !document.fonts.check(`1em '${f}'`));
    if (!manquantes.length) {
      setPolicesPretes(true);
      return;
    }
    setPolicesPretes(false);
    let fini = false;
    const finir = () => {
      if (fini) return;
      fini = true;
      setPolicesPretes(true);
    };
    void Promise.all(manquantes.map((f) => document.fonts.load(`1em '${f}'`))).then(finir, finir);
    const garde = window.setTimeout(finir, 4000);
    onCleanup(() => {
      fini = true;
      window.clearTimeout(garde);
    });
  });

  /**
   * Les lignes POSÉES (28/11, affiche à motifs) : une ligne qui porte sa place
   * enregistrée (panier, commande) se dessine là ; dans le module, le texte
   * mis en bas pose chaque ligne à la place que la mise en page lui donne
   * (placesTexteEnBas, la même que celle qui part dans la configuration).
   * Les autres s'empilent en haut, comme toujours : une affiche classique
   * n'a jamais de ligne posée, et son aperçu ne change pas.
   */
  const placesEnBas = createMemo(() =>
    props.state.texteEnBas ? placesTexteEnBas(lignesADessiner(), props.basDuTexteEnBas) : [],
  );
  const placeDeLigne = (ligne: LigneTexte, rang: number): { x: number; y: number } | null =>
    typeof ligne.x === "number" && typeof ligne.y === "number"
      ? { x: ligne.x, y: ligne.y }
      : (placesEnBas()[rang] ?? null);

  /** Les calques des lignes de texte (empilées, posées), que mesure la réduction ci-dessous. */
  let coucheTexte: HTMLDivElement | undefined;
  let couchePosee: HTMLDivElement | undefined;
  /** Une ligne trop longue pour le bloc est réduite, comme à l'impression. */
  const reductionDeLigne = createReductionDesLignes(
    () => [coucheTexte, couchePosee],
    // La taille choisie compte (27/11) : passer en « grand » peut faire
    // déborder une ligne qui tenait, il faut alors la remesurer. Une ligne
    // qui passe d'un calque à l'autre aussi (28/11).
    () =>
      lignesADessiner()
        .map((l, rang) => `${l.font}\u0000${l.value}\u0000${l.taille ?? "m"}\u0000${placeDeLigne(l, rang) ? "posee" : ""}`)
        .join("\n"),
  );

  /** La couleur du cadre, ou rien du tout s'il n'y en a pas. */
  const couleurCadre = () =>
    props.cadre ? props.cadre.previewColor || COULEUR_CADRE_DEFAUT : null;

  /**
   * Largeur réelle de l'aperçu, suivie à la trace.
   *
   * L'affiche est tantôt bridée par la largeur de la colonne, tantôt par la
   * hauteur de la modale : aucune règle CSS ne sait dire d'avance laquelle
   * gagne. On regarde donc.
   */
  const [largeurAffiche, setLargeurAffiche] = createSignal(0);
  let bloc: HTMLDivElement | undefined;
  onMount(() => {
    if (!bloc || typeof ResizeObserver === "undefined") return;
    const observateur = new ResizeObserver(() => {
      // La largeur EXTÉRIEURE : elle ne bouge pas quand la bordure change,
      // sans quoi la mesure et le cadre se poursuivraient sans fin.
      setLargeurAffiche(bloc?.getBoundingClientRect().width ?? 0);
    });
    observateur.observe(bloc);
    setLargeurAffiche(bloc.getBoundingClientRect().width);
    onCleanup(() => observateur.disconnect());
  });

  /** L'épaisseur de la baguette, en pixels, pour la largeur du moment. */
  const epaisseurCadre = () =>
    Math.round(
      Math.min(
        CADRE_MAX_PX,
        Math.max(CADRE_MIN_PX, largeurAffiche() * PART_CADRE),
      ),
    );
  /**
   * Fond affichable : le chemin stocké est brut, on le préfixe ici.
   *
   * Une valeur MÉMORISÉE (21/11) : le chargement ci-dessous ne doit revenir
   * que si l'ADRESSE du fond change. L'aperçu des personnages de l'affiche
   * tirée d'une photo (PersonnagesIA.tsx) reçoit un état recalculé — un objet
   * neuf, même fond — à chaque format choisi ou « Valider » : le chargement
   * revenait, l'image, inchangée, ne se rechargeait pas, et l'aperçu restait
   * sur « Chargement de l'affiche… », sans fin. Le module, le panier et la
   * commande, eux, ne changent pas d'état sans changer de fond : rien n'y
   * bouge.
   */
  const srcFond = createMemo(() =>
    props.state.backgroundUrl
      ? aLaLargeur(urlAsset(props.assetBaseUrl ?? "", props.state.backgroundUrl), 1400)
      : undefined,
  );

  /**
   * Le fond est-il arrivé ? Tant qu'il ne l'est pas, l'aperçu montre un
   * chargement (17/11) : sans lui, on voyait une affiche grise avec le texte
   * blanc posé dessus, comme cassée. Revient à faux à chaque nouveau fond ;
   * une image en erreur arrête aussi le chargement, pour ne pas tourner sans
   * fin.
   */
  const [fondCharge, setFondCharge] = createSignal(false);

  /**
   * La version LÉGÈRE du fond (400 px, une trentaine de Ko), montrée d'abord :
   * au stand, en 4G, l'affiche apparaît tout de suite, et la version nette
   * (1400 px) la remplace dès qu'elle est arrivée (17/11). C'est la même
   * image que la vignette du fond qu'on vient de toucher : le navigateur l'a
   * souvent déjà.
   */
  const srcFondLeger = createMemo(() =>
    props.state.backgroundUrl
      ? aLaLargeur(urlAsset(props.assetBaseUrl ?? "", props.state.backgroundUrl), 400)
      : undefined,
  );
  const [legerCharge, setLegerCharge] = createSignal(false);
  createEffect(
    on(
      srcFond,
      () => {
        setFondCharge(false);
        setLegerCharge(false);
      },
      { defer: true },
    ),
  );

  /** Bas réel du dessin d'un personnage, pour aligner ses pieds au sol. */
  const basDuDessin = (id: string | number): number =>
    props.characterById(id)?.bottomPct ?? 1;

  /**
   * Où se pose chaque personnage. Dans le configurateur : la composition
   * automatique, ou la place que le client lui a donnée — une seule fois
   * pour toute l'affiche, puisqu'elle dépend de tous les personnages.
   * Ailleurs : la place enregistrée, telle que le PDF la relit (voir
   * `recomposer`), avec son ordre de dessin.
   */
  const placements = createMemo<PlacementPersonnage[]>(() =>
    props.recomposer
      ? placementsAffiche(props.state, props.characterById, props.etalon)
      : props.state.characters.map((c) => ({
          x: c.x,
          y: c.y,
          scale: c.scale,
          plan: c.position,
        })),
  );

  /** Index du personnage en cours de glissement, sinon rien. */
  const [glisse, setGlisse] = createSignal<number | null>(null);

  /**
   * Dimensions en pixels de la zone utile : l'INTÉRIEUR du cadre. Ce sont
   * elles qui convertissent les pixels parcourus par le doigt en fractions
   * d'affiche.
   *
   * La baguette est dessinée en bordure et mange sur l'affiche. Compter sur la
   * boîte extérieure fausserait la conversion, et un personnage lâché tout en
   * bas irait se ranger sous la baguette, là où le client ne le reverrait
   * jamais.
   */
  function tailleZone(): { largeur: number; hauteur: number } | null {
    if (!bloc) return null;
    const boite = bloc.getBoundingClientRect();
    const baguette = couleurCadre() ? epaisseurCadre() : 0;
    const largeur = boite.width - 2 * baguette;
    const hauteur = boite.height - 2 * baguette;
    if (largeur <= 0 || hauteur <= 0) return null;
    return { largeur, hauteur };
  }

  /**
   * Fin du geste en cours, gardée sous la main : un aperçu démonté au beau
   * milieu d'un glissement (changement d'étape, fermeture de la modale)
   * laisserait sinon ses écouteurs sur `window` et le texte de la page
   * insélectionnable.
   */
  let finDuGeste: (() => void) | null = null;
  onCleanup(() => finDuGeste?.());

  /**
   * Étouffe le clic qui suit un glissement.
   *
   * Lâcher le personnage à côté de l'affiche produit un clic dont la cible est
   * l'ancêtre commun du départ et de l'arrivée : le fond de la modale, qui se
   * referme dessus et emporte l'affiche en cours de composition. Ce geste
   * n'était pas un clic, il n'a rien à déclencher.
   *
   * Le filet de sécurité : si aucun clic ne suit (geste annulé par le
   * système), l'écoute se retire d'elle-même au tour de boucle suivant, sans
   * quoi elle avalerait le prochain vrai clic du client.
   */
  function avalerLeProchainClic(): void {
    const avaler = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", avaler, { capture: true, once: true });
    setTimeout(
      () => window.removeEventListener("click", avaler, { capture: true }),
      0,
    );
  }

  function demarrerGlissement(
    evenement: PointerEvent,
    index: number,
    depart: PlacementPersonnage,
    bas: number,
  ) {
    if (!props.deplacable || evenement.button !== 0) return;
    const zone = tailleZone();
    if (!zone) return;
    evenement.preventDefault();
    finDuGeste?.();

    const departX = evenement.clientX;
    const departY = evenement.clientY;
    // Sans ça, glisser sur l'affiche surligne le titre au lieu de déplacer.
    const selectionAvant = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    setGlisse(index);
    let aBouge = false;

    const suivre = (e: PointerEvent) => {
      aBouge = true;
      props.onDeplace?.(
        index,
        bornerPlacement(
          {
            x: depart.x + (e.clientX - departX) / zone.largeur,
            y: depart.y + (e.clientY - departY) / zone.hauteur,
          },
          depart.scale,
          bas,
        ),
      );
    };
    const terminer = () => {
      window.removeEventListener("pointermove", suivre);
      window.removeEventListener("pointerup", terminer);
      window.removeEventListener("pointercancel", terminer);
      document.body.style.userSelect = selectionAvant;
      setGlisse(null);
      finDuGeste = null;
      if (aBouge) avalerLeProchainClic();
    };

    // Sur `window`, jamais sur le personnage : chaque déplacement redessine
    // l'affiche et le moteur peut recréer l'élément sous le doigt. Une écoute
    // posée sur lui — capture du pointeur comprise — se romprait au premier
    // pixel parcouru.
    window.addEventListener("pointermove", suivre);
    window.addEventListener("pointerup", terminer);
    window.addEventListener("pointercancel", terminer);
    finDuGeste = terminer;
  }

  /** Déplacement aux flèches : le glisser-déposer sans souris ni écran tactile. */
  function deplacerAuClavier(
    evenement: KeyboardEvent,
    index: number,
    depart: PlacementPersonnage,
    bas: number,
  ) {
    if (!props.deplacable) return;
    const pas: Record<string, { dx: number; dy: number } | undefined> = {
      ArrowLeft: { dx: -PAS_CLAVIER, dy: 0 },
      ArrowRight: { dx: PAS_CLAVIER, dy: 0 },
      ArrowUp: { dx: 0, dy: -PAS_CLAVIER },
      ArrowDown: { dx: 0, dy: PAS_CLAVIER },
    };
    const vers = pas[evenement.key];
    if (!vers) return;
    evenement.preventDefault();
    props.onDeplace?.(
      index,
      bornerPlacement(
        { x: depart.x + vers.dx, y: depart.y + vers.dy },
        depart.scale,
        bas,
      ),
    );
  }

  return (
    <div
      ref={bloc}
      class="ml-cfg-poster"
      role={props.cadre ? "img" : undefined}
      aria-label={
        props.cadre
          ? props.cadre.name == null
            ? m().apercuCadreSansNom
            : m().apercuCadre.replace("{cadre}", props.cadre.name)
          : undefined
      }
      style={{
        position: "relative",
        // Les calques de l'aperçu (personnages z 10+, texte z 200, filigrane
        // z 300) restent ENTRE EUX : sans cette isolation ils remontaient au
        // niveau de la page, et passaient par-dessus l'en-tête collant et
        // le menu du téléphone sur le panier et la commande. L'ordre des
        // calques à l'intérieur de l'affiche ne change pas.
        isolation: "isolate",
        width: "100%",
        "aspect-ratio": aspectFor(props.state.format),
        background: "#f3f4f6",
        overflow: "hidden",
        // Un vrai cadre n'a pas les coins arrondis, et la baguette mange sur
        // l'affiche au lieu de s'ajouter autour : c'est ce que fait une
        // bordure en « border-box », comme un passe-partout.
        "border-radius": props.auMur ? "0" : props.cadre ? "2px" : "8px",
        ...(couleurCadre()
          ? {
              border: `${epaisseurCadre()}px solid ${couleurCadre()}`,
              // Deux traits fins : l'un creuse la feuillure côté affiche,
              // l'autre détache la baguette du fond de la page. Sans eux, un
              // cadre blanc sur fond blanc ne se voit pas.
              "box-shadow":
                "inset 0 0 0 1px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.14), 0 6px 18px rgba(0,0,0,.22)",
            }
          : props.auMur
            ? {}
            : { "box-shadow": "0 1px 4px rgba(0,0,0,.15)" }),
      }}
    >
      {/* Couche fond, en deux temps : la version légère d'abord, la nette
          par-dessus dès qu'elle est arrivée (fondu). */}
      <Show when={srcFondLeger() !== srcFond() ? srcFondLeger() : undefined}>
        {(url) => (
          <img
            ref={(el) => {
              if (el.complete && el.naturalWidth > 0) setLegerCharge(true);
            }}
            src={url()}
            alt=""
            draggable={false}
            onLoad={() => setLegerCharge(true)}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "cover",
              "pointer-events": "none",
              "user-select": "none",
            }}
          />
        )}
      </Show>
      <Show when={srcFond()}>
        {(url) => (
          <img
            ref={(el) => {
              // Déjà dans le cache du navigateur : « load » est peut-être
              // passé avant que l'écouteur ne soit posé.
              if (el.complete && el.naturalWidth > 0) setFondCharge(true);
            }}
            src={url()}
            alt=""
            draggable={false}
            onLoad={() => setFondCharge(true)}
            onError={() => setFondCharge(true)}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "cover",
              "pointer-events": "none",
              "user-select": "none",
              opacity: fondCharge() ? "1" : "0",
              transition: "opacity .25s ease",
            }}
          />
        )}
      </Show>

      {/* Le chargement, par-dessus tout le reste, tant que RIEN du fond n'est
          là (ml-cfg-chargement, global.css) : la version légère suffit à le
          retirer. */}
      <Show when={srcFond() && !fondCharge() && !legerCharge()}>
        <div class="ml-cfg-chargement" role="status" aria-live="polite">
          <span class="ml-cfg-chargement-roue" aria-hidden="true" />
          <span class="ml-cfg-chargement-texte">{m().chargementApercu}</span>
        </div>
      </Show>

      {/* Le motif d'une affiche à motifs (28/11), dans le module : la même
          boîte qu'un personnage (cadre 1:2, largeur 0,22 × échelle), centrée
          sur sa place, comme le fichier d'impression la pose. Devant le décor
          (z 5), derrière les personnages (z 10 et plus). */}
      <Show when={props.motif}>
        {(motif) => {
          const largeurPct = () => CHAR_BASE_WIDTH * motif().place.scale * 100;
          const descentePct = () => (1 - (motif().base?.bottomPct ?? 1)) * largeurPct() * Math.SQRT2;
          return (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: `${motif().place.x * 100}%`,
                top: `${motif().place.y * 100 + descentePct()}%`,
                width: `${largeurPct()}%`,
                transform: "translate(-50%, -50%)",
                "aspect-ratio": "1 / 2",
                "z-index": "9",
                "pointer-events": "none",
              }}
            >
              <CharacterStack
                character={motif().character}
                base={motif().base}
                slots={variantesDeVue(props.slots, motif().base?.orientation)}
                cache={props.cache}
                assetBaseUrl={props.assetBaseUrl}
              />
            </div>
          );
        }}
      </Show>

      {/* Couche personnages — composition automatique, ou places enregistrées */}
      <For each={props.state.characters}>
        {(c, i) => {
          const place = (): PlacementPersonnage =>
            placements()[i()] ?? { x: 0.5, y: 0.74, scale: 0.6, plan: c.position };
          // Largeur effective = largeur de base × échelle (rangée centrée).
          const widthPct = () => CHAR_BASE_WIDTH * place().scale * 100;
          // Alignement des pieds : un perso dont le contenu s'arrête à bottomPct
          // de son cadre a du vide dessous ; on DESCEND le cadre de TOUT ce vide
          // pour que le bas du contenu tombe à y + h/2 quel que soit bottomPct.
          // Hauteur du cadre en % de la HAUTEUR d'affiche : largeur × 2 (aspect
          // 1:2) ÷ 1.4142 (affiche portrait W:H = 1:√2) = widthPct × √2.
          const bp = () => basDuDessin(c.characterId);
          const dropPct = () => (1 - bp()) * widthPct() * Math.SQRT2;
          const nom = () =>
            props.characterById(c.characterId)?.name ?? m().personnage;
          return (
            <div
              onPointerDown={(e) =>
                demarrerGlissement(e, i(), place(), bp())
              }
              onKeyDown={(e) => deplacerAuClavier(e, i(), place(), bp())}
              tabindex={props.deplacable ? 0 : undefined}
              role={props.deplacable ? "button" : undefined}
              aria-label={
                props.deplacable
                  ? m().deplacerAide.replace("{nom}", nom())
                  : undefined
              }
              style={{
                position: "absolute",
                left: `${place().x * 100}%`,
                top: `${place().y * 100 + dropPct()}%`,
                width: `${widthPct()}%`,
                transform: "translate(-50%, -50%)",
                "aspect-ratio": "1 / 2",
                // ≥10 : les personnages passent DEVANT le muret (z=5). Le
                // plan est celui que le PDF suit pour empiler : de face, les
                // petits devant les grands.
                "z-index": String(10 + place().plan),
                "pointer-events": props.deplacable ? "auto" : "none",
                // Le doigt doit déplacer le personnage, pas faire défiler la
                // page : sans ça le navigateur s'approprie le geste.
                "touch-action": props.deplacable ? "none" : undefined,
                "user-select": props.deplacable ? "none" : undefined,
                cursor: props.deplacable
                  ? glisse() === i()
                    ? "grabbing"
                    : "grab"
                  : undefined,
              }}
            >
              <CharacterStack
                character={c}
                base={props.characterById(c.characterId)}
                slots={
                  // Chaque perso utilise SON orientation native (dos/face,
                  // ou tout type créé au back-office), sinon la vue globale
                  // de l'affiche.
                  variantesDeVue(
                    props.slots,
                    props.characterById(c.characterId)?.orientation ??
                      props.state.view,
                  )
                }
                cache={props.cache}
                assetBaseUrl={props.assetBaseUrl}
              />
            </div>
          );
        }}
      </For>

      {/* Couche décor — DERRIÈRE les personnages (les persos passent devant),
          mais devant le fond. Affichée dès que le type d'affiche en a un et
          qu'il y a au moins un personnage : sans personne à asseoir, le banc
          n'a pas de raison d'être et masquerait le bas du visuel. Ancré en
          bas, pleine largeur, hauteur auto. */}
      <Show
        when={
          props.state.characters.length > 0 ? props.foregroundUrl : undefined
        }
      >
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              bottom: "0",
              left: "0",
              width: "100%",
              height: "auto",
              "pointer-events": "none",
              "user-select": "none",
              "z-index": "5",
            }}
          />
        )}
      </Show>

      {/* Couche texte — EN HAUT de l'affiche (charte Memory Line). Les lignes
          remplies se suivent, chacune dans sa police, toutes dans la couleur
          commune. Si aucune n'est saisie : placeholder de marque.
          Toute la mise en page — haut du bloc, marges, tailles, interlignes,
          espace avant chaque ligne, espacement des lettres — vient de
          packages/types (mise-en-page-texte.ts) : le fichier d'impression
          lit les mêmes nombres et refait le calcul du navigateur.
          Avec `sansTexte`, ni cette couche ni sa roue (20/11). */}
      <Show when={!props.sansTexte}>
        <div
          ref={coucheTexte}
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
            visibility: policesPretes() ? "visible" : "hidden",
          }}
        >
          <For each={lignesADessiner()}>
            {(ligne, rang) => {
              const police = () => policeParId(ligne.font, policeDefautLigne(rang()));
              // Une ligne posée (28/11) sort de l'empilement, qui continue
              // sans elle ; son rang reste le sien, comme dans pdf.ts.
              return (
                <Show when={!placeDeLigne(ligne, rang())}>
                <div
                  data-rang-texte={rang()}
                  style={{
                    "font-family": familleCss(police()),
                    color: props.state.textStyle.color,
                    // Ce qui distingue la ligne de tête, c'est sa TAILLE, et
                    // l'air entre ses capitales. Pas de gras : aucune des
                    // polices d'affiche n'a de graisse, et le gras qu'imitait
                    // le navigateur n'avait pas l'épaisseur de celui
                    // qu'imitait le PDF.
                    // 27/11 : × la taille choisie sur la ligne (1 si moyen/absente).
                    "font-size": `${tailleDeLigneCqw(rang()) * reductionDeLigne(rang()) * facteurTailleLigne(ligne.taille)}cqw`,
                    "line-height": String(interligneDeLigne(rang())),
                    "letter-spacing": `${espacementDeLigne(rang())}em`,
                    "margin-top": `${espaceAvantLigne(rang())}em`,
                    // Jamais repliée : trop longue, la ligne est réduite
                    // (reductionDeLigne), comme à l'impression.
                    "white-space": "nowrap",
                    opacity: texteVide() ? "0.5" : "1",
                  }}
                >
                  {/* Un retour à la ligne tapé par le client (touche Entrée)
                      coupe la ligne ici comme à l'impression ; les morceaux
                      vides ne laissent pas de trou (sousLignes). Chaque bout
                      s'écrit dans la police qui sait l'écrire : la manuscrite
                      ne connaît pas les chiffres, ils s'écrivent alors en
                      Caveat — ici comme à l'impression. ♥ ☀ ❄ et les autres
                      symboles écrits en texte par défaut se montrent en
                      emoji, en couleur, comme sur le papier (enFormeEmoji,
                      28/11) ; le texte enregistré ne change pas. */}
                  <For each={sousLignes(ligne.value)}>
                    {(sousLigne) => (
                      <div data-sous-ligne>
                        <For each={morceauxDeTexte(sousLigne, police())}>
                          {(morceau) => (
                            <span style={{ "font-family": familleCss(morceau.police) }}>
                              {enFormeEmoji(morceau.texte)}
                            </span>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
                </Show>
              );
            }}
          </For>
        </div>

        {/* Les lignes POSÉES (28/11, texte en bas d'une affiche à motifs) :
            chacune centrée sur sa place (x/y), comme le fichier d'impression
            la pose (pdf.ts, buildTextSvg) — même largeur de bloc, même unité
            de taille que l'empilement, interligne d'une ligne posée. Calque
            vide sur toutes les autres affiches. Calqué sur AfficheIA. */}
        <div
          ref={couchePosee}
          style={{
            position: "absolute",
            inset: "0",
            "pointer-events": "none",
            padding: `0 ${MARGE_DU_TEXTE * 100}%`,
            "container-type": "inline-size",
            "z-index": "200",
            visibility: policesPretes() ? "visible" : "hidden",
          }}
        >
          <For each={lignesADessiner()}>
            {(ligne, rang) => {
              const police = () => policeParId(ligne.font, policeDefautLigne(rang()));
              return (
                <Show when={placeDeLigne(ligne, rang())}>
                  {(place) => (
                    <div
                      data-rang-texte={rang()}
                      style={{
                        position: "absolute",
                        left: `${place().x * 100}%`,
                        top: `${place().y * 100}%`,
                        transform: "translate(-50%, -50%)",
                        // Les morceaux d'une ligne coupée à la main, centrés
                        // l'un sous l'autre, comme à l'impression.
                        "text-align": "center",
                        "white-space": "nowrap",
                        "font-family": familleCss(police()),
                        color: props.state.textStyle.color,
                        "font-size": `${tailleDeLigneCqw(rang()) * reductionDeLigne(rang()) * facteurTailleLigne(ligne.taille)}cqw`,
                        "line-height": String(INTERLIGNE_LIGNE_POSEE),
                        "letter-spacing": `${espacementDeLigne(rang())}em`,
                        opacity: texteVide() ? "0.5" : "1",
                      }}
                    >
                      <For each={sousLignes(ligne.value)}>
                        {(sousLigne) => (
                          <div data-sous-ligne>
                            <For each={morceauxDeTexte(sousLigne, police())}>
                              {(morceau) => (
                                <span style={{ "font-family": familleCss(morceau.police) }}>
                                  {enFormeEmoji(morceau.texte)}
                                </span>
                              )}
                            </For>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>
              );
            }}
          </For>
        </div>

        {/* La police de l'affiche arrive : une roue à la place du texte —
            en bas quand le texte y est posé (28/11). */}
        <Show when={!policesPretes()}>
          <div
            role="status"
            aria-label="Chargement de la police"
            style={{
              position: "absolute",
              left: "0",
              right: "0",
              top: `${(lignesADessiner().map((l, rang) => placeDeLigne(l, rang)).find(Boolean)?.y ?? HAUT_DU_TEXTE) * 100}%`,
              display: "flex",
              "justify-content": "center",
              "padding-top": lignesADessiner().some((l, rang) => placeDeLigne(l, rang)) ? "0" : "4%",
              "pointer-events": "none",
              "z-index": "201",
            }}
          >
            <span class="ml-spinner" aria-hidden="true" />
          </div>
        </Show>
      </Show>

      {/* Pas de signature de la boutique ici : elle n'est posée que sur le
          fichier d'impression (apps/api/src/pdf.ts, signaturePosee). La
          boutique la veut sur le papier, pas sur l'écran où l'on compose.
          Avec le filigrane, qui fait l'inverse, ce sont les deux seules
          différences voulues entre cet aperçu et le PDF. */}

      {/* Filigrane — dernière couche, au-dessus de tout le reste. */}
      <Show when={props.filigrane !== false}>
        <Filigrane />
      </Show>
    </div>
  );
}
