/// <reference lib="dom" />
import {
  createEffect,
  createMemo,
  createSignal,
  Show,
  type JSX,
} from "solid-js";
import type {
  PosterConfig,
  PosterFormat,
  BackgroundDTO,
} from "@memoryline/types";
import { unwrap } from "solid-js/store";
import {
  BASE_COLOR_SCOPE,
  colorKey,
  ligneEnMajuscules,
  prixDuCadreCents,
} from "@memoryline/types";
import {
  STEPS,
  SLOTS,
  type Step,
  type Slot,
  type ConfiguratorState,
  type CharacterDTO,
  type SlotsDTO,
  type SlotVariants,
  emptyState,
  stateFromConfig,
  configFromState,
  etalonDeLaVue,
  createConfiguratorStore,
  createSvgCache,
  defaultCharacter,
  couleursAuChangementDePiece,
  findVariant,
  slotsForCharacter,
  variantesDeVue,
  NONE_ASSET,
  type CadreDTO,
  type PieceCategoryDTO,
  type WorkingCharacter,
  type NuanciersPersonnages,
} from "./store";
import { PosterPreview } from "./components/PosterPreview";
import { ApercuAuMur } from "./components/ApercuAuMur";
import { StepBackgroundText } from "./components/StepBackgroundText";
import { StepCharacters } from "./components/StepCharacters";
import { StepFormat } from "./components/StepFormat";
import {
  messagesAvecDefauts,
  type MessagesConfigurateur,
} from "./messages";
import { Button } from "./components/ui";
import { BarreActions, brancherBarreDeLaFenetre } from "./components/Defilement";

/** Produit minimal injecté par l'hôte (pas d'appel réseau interne). */
export interface ConfiguratorProduct {
  id: string | number;
  name: string;
  basePriceCents: number;
}

export interface ConfiguratorProps {
  product: ConfiguratorProduct;
  backgrounds: BackgroundDTO[];
  /** Personnages (bases pré-composées) non archivés, ordonnés category+position. */
  characters: CharacterDTO[];
  /** Variantes génériques de slots, par vue (front / back). */
  slots: SlotsDTO;
  /** Prix par format en centimes (ex. { A4: 2300, A3: 2900 }). Le format
   *  sélectionné met à jour le prix affiché (demande cliente). */
  prices?: Partial<Record<PosterFormat, number>>;
  /**
   * Masque TOUT montant, sans rien retirer des choix (format, cadre).
   *
   * Sur un stand de salon, le tarif n'est pas celui du site — pas de port, des
   * remises, des lots — et c'est la vendeuse qui l'annonce de vive voix : un
   * prix à l'écran la contredirait devant le client. Les prix continuent
   * d'arriver par `prices`, ils servent au panier, plus à l'affichage.
   */
  sansPrix?: boolean;
  /**
   * La boutique tait le supplément de chaque cadre, sans taire le reste
   * (réglage de la page Cadres du back-office) : voir StepFormat.
   */
  sansPrixCadres?: boolean;
  /**
   * Le bouton « Voir sur un mur » sous l'aperçu (26/11). Faux : la boutique
   * l'a coupé (page Cadres du back-office). Absent : proposé.
   */
  apercuMur?: boolean;
  /**
   * Libellés traduits. Le paquet ne connaît pas les langues du site : l'hôte
   * fournit un dictionnaire déjà traduit, complété par le français.
   */
  messages?: Partial<MessagesConfigurateur>;
  /** Cadres proposés en option. */
  cadres?: CadreDTO[];
  /**
   * Catégories de pièces avec leurs nuanciers. Sans elles, le configurateur
   * retombe sur ses nuanciers historiques et laisse la saisie libre.
   */
  pieceCategories?: PieceCategoryDTO[];
  /**
   * Les nuanciers des personnages (peau, cheveux / pelage, vêtements,
   * pantalon) tels que la boutique les a réglés. Absents : leurs couleurs
   * d'origine (@memoryline/types, nuanciers.ts).
   */
  nuanciersBase?: NuanciersPersonnages;
  /**
   * Décor optionnel du produit (muret, banc…). Il se pose DERRIÈRE les
   * personnages et devant le fond — vus de dos, ils sont assis dessus —, et
   * seulement s'il y a au moins un personnage : c'est l'ordre et la règle du
   * fichier d'impression (pdf.ts). URL /assets/… ou absolue.
   */
  foregroundUrl?: string | null;
  /** Réglages par défaut du produit (pré-remplissage à l'ouverture). */
  defaults?: {
    /** Textes pré-remplis, une entrée par ligne, dans l'ordre. */
    lignes?: (string | null)[];
    view?: string | null;
    /**
     * Le format choisi sur la fiche, avant d'ouvrir le configurateur.
     *
     * Sans lui, quelqu'un qui a cliqué « A3 » sur la fiche devait le
     * rechoisir à l'étape 3 : deux fois le même geste, dont un pour rien.
     */
    format?: PosterFormat;
  };
  /** Réouverture (panier "edit" §18.3) : restaure tout l'état. */
  initialConfig?: PosterConfig;
  /** Préfixe pour fetch le texte SVG, ex "http://localhost:3100". */
  assetBaseUrl: string;
  /**
   * L'affiche validée.
   *
   * Le nombre d'exemplaires ne passe PAS par ici : il se choisit sur la fiche
   * produit, avant d'ouvrir le configurateur, au même endroit que pour une
   * affiche prête à imprimer. Une affiche commandée en trois exemplaires est
   * la même affiche — c'est la ligne de panier qui porte le nombre, pas le
   * dessin.
   */
  onSubmit: (config: PosterConfig) => void;
  onBack?: () => void;
  /**
   * Les étapes proposées, dans leur ordre : une partie de STEPS. Absente ou
   * vide, les trois, comme toujours.
   *
   * L'affiche tirée d'une photo (apps/web, AfficheIA) n'ouvre le module que
   * sur « Personnages » (20/11) : son fond est l'image créée, ses textes et
   * son format se choisissent sur son propre écran. Le module part alors de
   * la première étape donnée, et masque le fil des étapes s'il n'y en a
   * qu'une ; « Retour » à la première rend la main (onBack), le bouton de la
   * dernière valide (onSubmit), comme avec les trois.
   */
  etapes?: readonly Step[];
  /**
   * Filigrane de l'aperçu, transmis à PosterPreview. Absent : actif, comme
   * sur tout ce qu'on montre avant paiement. L'affiche tirée d'une photo le
   * coupe (20/11) : son fond, l'aperçu de l'image créée, porte déjà le sien,
   * cuit dans l'image, et un second par-dessus brouillerait la photo.
   */
  filigrane?: boolean;
  /**
   * Aperçu sans la couche de texte ni la roue qui attend ses polices (voir
   * PosterPreview). Absent : le texte, comme toujours. L'affiche tirée d'une
   * photo pose ses textes elle-même, à leur place, sur son propre écran
   * (20/11) : sans cela, l'aperçu du module y montrerait « Memory Line ».
   */
  sansTexte?: boolean;
}

/** Formate un prix en centimes -> "23 €" (FR), « €23 » (EN)… selon la locale. */
function fmtPrice(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function Configurator(props: ConfiguratorProps): JSX.Element {
  /** Libellés traduits, complétés par le français pour les clés absentes. */
  const msg = () => messagesAvecDefauts(props.messages);
  /** Locale d'affichage des montants (« fr-FR » si l'hôte n'en donne pas). */
  const locale = () => msg().locale;
  const STEP_LABELS = (): Record<Step, string> => ({
    background: msg().etapeFond,
    characters: msg().etapePersonnages,
    format: msg().etapeFormat,
  });
  /**
   * Les étapes de cette ouverture : celles de l'hôte (`etapes`), sinon les
   * trois. Une liste vide vaut absente : sans aucune étape, le module ne
   * saurait ni où commencer ni quoi montrer.
   */
  const etapes = (): readonly Step[] =>
    props.etapes && props.etapes.length > 0 ? props.etapes : STEPS;

  const initialState: ConfiguratorState = props.initialConfig
    ? stateFromConfig(props.initialConfig)
    : emptyState();

  // Pré-remplissage depuis les réglages par défaut du produit (lignes de texte
  // et type d'affiche) — seulement en mode AJOUT (pas en réouverture panier).
  if (!props.initialConfig && props.defaults) {
    (props.defaults.lignes ?? []).forEach((texte, i) => {
      const ligne = initialState.lignes[i];
      if (ligne && texte) ligne.value = texte;
    });
    // N'importe quel type d'affiche, y compris ceux créés au back-office :
    // filtrer sur une paire figée aurait ignoré tout nouveau type.
    if (props.defaults.view) initialState.view = props.defaults.view;
    if (props.defaults.format) initialState.format = props.defaults.format;
  }

  // Un état neuf, comme celui d'une réouverture, commence au fond. Le module
  // ouvert sur une partie de ses étapes (20/11 : les personnages seuls, sur
  // l'affiche tirée d'une photo) part de la première qu'on lui donne.
  const premiereEtape = etapes()[0];
  if (premiereEtape && !etapes().includes(initialState.step)) {
    initialState.step = premiereEtape;
  }

  // À l'ouverture, l'affiche est VIDE de personnages (retour cliente) : le
  // client part du fond seul et ajoute ce qu'il veut. Un mix aléatoire était
  // pré-ajouté auparavant « pour que l'affiche ne soit jamais vide » — il
  // imposait des personnages que le client devait d'abord retirer.

  const { state, mutate } = createConfiguratorStore(initialState);
  const { cache, fetchSvg } = createSvgCache(props.assetBaseUrl);

  const characterById = (
    id: string | number,
  ): CharacterDTO | undefined =>
    props.characters.find((c) => String(c.id) === String(id));

  /**
   * Personnages proposés à l'ajout, filtrés par l'orientation de l'AFFICHE :
   * une affiche de dos ne propose que les persos de dos (et inversement). Évite
   * qu'un perso de face apparaisse sur une affiche de dos. Si aucun perso ne
   * correspond à la vue (donnée incomplète), on retombe sur la liste complète.
   *
   * Un personnage MASQUÉ au back-office (`active: false`) n'est plus proposé,
   * sauf s'il est déjà sur l'affiche (panier rouvert, affiche d'avant le
   * masquage) : sa vignette reste alors là où le client l'a choisie.
   */
  const visibleCharacters = createMemo<CharacterDTO[]>(() => {
    const view = state.view;
    const surLAffiche = new Set(state.characters.map((c) => String(c.characterId)));
    const proposes = props.characters.filter(
      (c) => c.active !== false || surLAffiche.has(String(c.id)),
    );
    const matching = proposes.filter(
      (c) => (c.orientation ?? "front") === view,
    );
    return matching.length > 0 ? matching : proposes;
  });

  /**
   * Variantes de slot pour le personnage en cours d'édition : on suit SON
   * orientation native (dos/face), sinon la vue globale, puis on restreint
   * aux variantes AUTORISÉES pour ce perso (slotVariants — un homme ne se
   * voit pas proposer les habits de bébé). Garantit que l'éditeur montre les
   * bonnes pièces et la même chose que l'aperçu de l'affiche.
   */
  const slotVariants = (): SlotVariants => {
    const idx = state.editingIndex;
    const c = idx != null ? state.characters[idx] : undefined;
    const base = c ? characterById(c.characterId) : undefined;
    const all = variantesDeVue(props.slots, base?.orientation ?? state.view);
    return slotsForCharacter(all, base);
  };

  /** Les pièces proposées à un personnage quelconque : celles de sa vue, qu'il a le droit de porter. */
  const slotsDe = (base: CharacterDTO): SlotVariants =>
    slotsForCharacter(variantesDeVue(props.slots, base.orientation ?? state.view), base);

  // Présélection du fond du produit : à l'ouverture, l'aperçu montre déjà
  // l'affiche de la fiche (1er fond renvoyé = fond de la ville du produit).
  createEffect(() => {
    if (state.backgroundUrl === undefined && props.backgrounds.length > 0) {
      selectBackground(props.backgrounds[0]!);
    }
  });

  // Prefetch des SVG nécessaires :
  //  - bases + variantes choisies des personnages présents (aperçu),
  //  - toutes les bases + toutes les variantes du slot quand on édite (galeries).
  createEffect(() => {
    const variants = slotVariants();
    // Personnages présents (base + variantes choisies) : chacun résout ses
    // variantes dans le jeu COMPLET de sa vue (comme PosterPreview), pas dans
    // le jeu filtré du perso en cours d'édition.
    for (const c of state.characters) {
      const base = characterById(c.characterId);
      if (base) void fetchSvg(base.baseSvgUrl);
      const all = variantesDeVue(props.slots, base?.orientation ?? state.view);
      for (const slot of SLOTS) {
        const v = findVariant(all[slot], c.assets[slot]);
        if (v) void fetchSvg(v.svgUrl);
      }
    }
    // En édition : toutes les bases (galerie de personnages) + toutes les
    // variantes du slot courant (galeries vêtements/pantalon/cheveux/accessoires).
    if (state.editingIndex !== null) {
      for (const base of props.characters) {
        void fetchSvg(base.baseSvgUrl);
        // Un personnage livré avec une tenue se montre habillé dans la
        // galerie (cf. tenueDeVignette) : ses pièces viennent avec.
        if (!base.defaultAssets) continue;
        const pieces = slotsDe(base);
        const tenue = defaultCharacter(base, 0, pieces);
        for (const slot of SLOTS) {
          const v = findVariant(pieces[slot], tenue.assets[slot]);
          if (v) void fetchSvg(v.svgUrl);
        }
      }
      for (const slot of SLOTS) {
        for (const v of variants[slot]) void fetchSvg(v.svgUrl);
      }
    }
  });

  const stepIndex = createMemo(() => etapes().indexOf(state.step));

  /* --------------------------- navigation --------------------------------- */
  function goToStep(step: Step) {
    // Quitter l'étape par le fil des étapes ou « Continuer » garde le
    // personnage en cours, même tout juste ajouté (cf. quitterEditeur).
    ajoutNonValide = null;
    mutate((s) => {
      s.step = step;
      s.editingIndex = null;
    });
  }
  function next() {
    const i = stepIndex();
    const target = etapes()[i + 1];
    if (target) goToStep(target);
    else submit();
  }
  function prev() {
    const i = stepIndex();
    if (i <= 0) {
      props.onBack?.();
      return;
    }
    const target = etapes()[i - 1];
    if (target) goToStep(target);
  }
  /**
   * L'étalon de la composition : le plus grand personnage proposé pour ce
   * type d'affiche. C'est à lui qu'elle mesure qui est petit (cf.
   * etalonDeLaVue) ; l'aperçu et l'enregistrement lisent le même.
   */
  const etalon = createMemo(() => etalonDeLaVue(props.characters, state.view));

  function submit() {
    // La même composition qu'à l'écran part dans la commande — places, échelles
    // (taille propre de chacun comprise), décalages du back-office et ordre de
    // dessin : c'est ce que le PDF d'impression relit, sans rien recalculer.
    // L'affiche imprimée ne peut donc pas différer de celle que le client a
    // composée.
    props.onSubmit(
      configFromState(state, props.product.id, characterById, etalon()),
    );
  }

  /* --------------------------- étape 1 ------------------------------------ */
  function selectBackground(bg: BackgroundDTO) {
    mutate((s) => {
      s.backgroundId = bg.id;
      // On stocke le chemin BRUT (« /assets/… ») : cette valeur part dans la
      // commande et y reste des annees. Y figer le prefixe de l'API la
      // rendrait caduque au moindre changement d'hebergement. Le prefixe est
      // ajoute a l'affichage, par urlAsset().
      s.backgroundUrl = bg.url;
    });
  }
  /**
   * Met à jour SEULEMENT le texte d'une ligne.
   *
   * La première passe en capitales à la frappe, et pas seulement à l'écran :
   * c'est la ligne du lieu — AMIENS, MERS-LES-BAINS — et la charte la veut
   * ainsi partout. Transformer à l'affichage seulement laisserait le texte
   * enregistré différer du fichier d'impression, et personne ne saurait
   * lequel des deux fait foi. `toLocaleUpperCase` et non `toUpperCase` :
   * c'est lui qui traite correctement les accents et le ß allemand.
   */
  function setTextValue(ligne: number, value: string) {
    mutate((s) => {
      const l = s.lignes[ligne];
      if (l) l.value = ligneEnMajuscules(ligne) ? value.toLocaleUpperCase() : value;
    });
  }
  /** Change la police d'UNE ligne, indépendamment des autres. */
  function setTextFont(ligne: number, font: string) {
    mutate((s) => {
      const l = s.lignes[ligne];
      if (l) l.font = font;
    });
  }

  /** Met à jour le STYLE PARTAGÉ (couleur/taille) de toutes les lignes. */
  function setTextStyle(
    patch: Partial<{ font: string; color: string; size: number }>,
  ) {
    mutate((s) => {
      Object.assign(s.textStyle, patch);
    });
  }

  /* --------------------------- étape 2 ------------------------------------ */
  /**
   * Le rang du personnage que « + Ajouter un personnage » vient de poser,
   * tant que la cliente ne l'a pas validé ; `null` sinon. C'est lui que
   * « ‹ Retour » retire (quitterEditeur).
   */
  let ajoutNonValide: number | null = null;

  function addCharacter() {
    // Le perso ajouté par défaut respecte l'orientation de l'affiche.
    const base = visibleCharacters()[0] ?? props.characters[0];
    if (!base) return;
    ajoutNonValide = state.characters.length;
    mutate((s) => {
      const position = s.characters.length;
      // Les variantes que CE personnage peut porter : c'est là-dedans que se
      // résout sa tenue par défaut.
      s.characters.push(
        defaultCharacter(
          base,
          position,
          slotsForCharacter(
            variantesDeVue(props.slots, base.orientation ?? state.view),
            base,
          ),
        ),
      );
      s.editingIndex = s.characters.length - 1;
    });
  }
  /**
   * Dupliquer un personnage.
   *
   * Une famille de quatre se compose rarement de quatre inconnus : on pose un
   * enfant, on l'habille, puis on veut le même en changeant la couleur du
   * pull. Le refaire de zéro demandait de reprendre chaque vêtement et chaque
   * teinte, une dizaine de choix, pour arriver au même point.
   *
   * La copie est PROFONDE — `structuredClone` — parce que les tenues et les
   * couleurs sont des objets : copiés par référence, changer le pull du double
   * changerait aussi celui de l'original, et personne ne comprendrait pourquoi.
   *
   * Elle se glisse juste derrière son modèle plutôt qu'en fin de liste : c'est
   * là que l'œil la cherche, et l'ordre de la liste décide de qui passe devant
   * qui sur l'affiche.
   */
  function duplicateCharacter(index: number) {
    ajoutNonValide = null;
    mutate((s) => {
      const source = s.characters[index];
      if (!source) return;
      // `source` est un reflet du magasin, pas l'objet lui-même : le cloner tel
      // quel lève une erreur (DataCloneError), avalée par le clic — le bouton
      // ne faisait rien. On clone l'objet réel qu'il reflète.
      const copie = structuredClone(unwrap(source));
      s.characters.splice(index + 1, 0, copie);
      s.characters.forEach((c, i) => (c.position = i));
      // On ouvre la copie : on duplique pour modifier, jamais pour contempler.
      s.editingIndex = index + 1;
    });
  }
  function removeCharacter(index: number) {
    mutate((s) => {
      s.characters.splice(index, 1);
      s.characters.forEach((c, i) => (c.position = i));
      if (s.editingIndex === index) s.editingIndex = null;
    });
  }
  function selectCharacter(index: number | null) {
    ajoutNonValide = null;
    mutate((s) => {
      s.editingIndex = index;
    });
  }
  /**
   * Ferme l'éditeur de personnage et revient à la liste.
   *
   * « ‹ Retour » sur un personnage qu'on vient d'ajouter ANNULE l'ajout : on
   * a ouvert le catalogue pour voir, on n'y a rien voulu, et l'affiche ne
   * doit pas garder un « Femme 1 » posé d'office. Seul « Valider mon
   * personnage » le garde. Pour un personnage déjà dans la liste, les deux
   * boutons reviennent à la liste : il est modifié au fil des choix, et
   * Retour n'a rien à défaire.
   */
  function quitterEditeur(garder: boolean) {
    const i = state.editingIndex;
    if (!garder && i !== null && i === ajoutNonValide) {
      ajoutNonValide = null;
      removeCharacter(i);
      return;
    }
    selectCharacter(null);
  }
  function setAsset(index: number, slot: Slot, variantId: string | number) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      // La pièce déjà portée, touchée à nouveau : rien ne change, ses couleurs
      // non plus.
      if (String(c.assets[slot]) === String(variantId)) return;
      const variantes = slotVariants()[slot];
      const ancienne = findVariant(variantes, c.assets[slot]);
      c.assets[slot] = variantId;
      const v = findVariant(variantes, variantId);
      if (!v) return;
      // La nouvelle pièce arrive avec les couleurs de son dessin, et seulement
      // elles : celles de la pièce d'avant, rangées sous les mêmes numéros de
      // zone, tombaient sur d'autres parties du dessin (cf.
      // couleursAuChangementDePiece). Écrites ici, dans la configuration,
      // elles sont celles que l'aperçu montre et que le fichier d'impression
      // relit.
      const couleurs = couleursAuChangementDePiece(
        slot,
        c.colors,
        ancienne,
        v,
        props.pieceCategories,
        props.nuanciersBase,
      );
      const prefixe = colorKey(slot, "");
      for (const cle of Object.keys(c.colors))
        if (cle.startsWith(prefixe)) delete c.colors[cle];
      Object.assign(c.colors, couleurs);
    });
  }
  /**
   * Vignette « Aucun » : masque la couche du slot, Y COMPRIS celle qui est
   * pré-composée dans le SVG de base (casquette/coupe d'origine). Re-cliquer
   * « Aucun » quand il est déjà actif rétablit la couche d'origine de la base.
   */
  function clearSlot(index: number, slot: Slot) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      if (c.assets[slot] === NONE_ASSET) delete c.assets[slot];
      else c.assets[slot] = NONE_ASSET;
    });
  }
  /**
   * Couleurs choisies par le client, clé namespacée -> couleur. Un choix de
   * groupe arrive d'un seul tenant — la référence et ses nuances —, écrit en
   * une fois : l'aperçu ne se redessine qu'une fois par geste.
   */
  function setColors(index: number, couleurs: Record<string, string>) {
    mutate((s) => {
      const c = s.characters[index];
      if (c) Object.assign(c.colors, couleurs);
    });
  }
  /**
   * Remet les couleurs d'origine d'une couche : la pièce portée dans un
   * emplacement, ou le dessin de base (peau, pelage…).
   *
   * Une action à part, et non un setColors : setColors ne sait qu'écrire, et
   * remettre à l'origine demande d'abord de RETIRER les clés de la couche —
   * une famille en pixels choisie, une zone d'un vieux panier — avant de
   * réécrire celles d'origine.
   *
   * Ce qui est réécrit, c'est exactement ce qu'écrit l'arrivée de la couche :
   *   - pour une pièce, ce que setAsset écrit — les couleurs de son dessin,
   *     sans rien reporter de la pièce d'avant ;
   *   - pour la base, ce que changeCharacter écrit — les couleurs par défaut
   *     du back-office, zone par zone. Les retirer seulement laissait
   *     couleursDeLaBase retomber sur les défauts DU JOUR DE L'IMPRESSION : une
   *     couleur de personnage changée au back-office entre la commande et
   *     l'impression partait à l'imprimante sans que le client l'ait vue.
   *     Figées ici, l'affiche s'imprime comme il l'a vue.
   */
  function remettreCouleurs(index: number, scope: Slot | typeof BASE_COLOR_SCOPE) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      const prefixe = colorKey(scope, "");
      for (const cle of Object.keys(c.colors))
        if (cle.startsWith(prefixe)) delete c.colors[cle];
      if (scope === BASE_COLOR_SCOPE) {
        const base = characterById(c.characterId);
        for (const [zone, hex] of Object.entries(base?.baseColorZones ?? {}))
          c.colors[colorKey(BASE_COLOR_SCOPE, zone)] = hex;
        return;
      }
      const v = findVariant(slotVariants()[scope], c.assets[scope]);
      if (!v) return;
      Object.assign(
        c.colors,
        couleursAuChangementDePiece(scope, {}, undefined, v, props.pieceCategories),
      );
    });
  }
  /** Change la base (type) d'un personnage : conserve les variantes choisies
   *  encore AUTORISÉES pour la nouvelle base (les autres sont abandonnées —
   *  la tenue intégrée de la base reprend le relais), réinitialise les
   *  couleurs sur celles de la nouvelle base. */
  function changeCharacter(index: number, base: CharacterDTO) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      // La tenue par défaut de l'ANCIEN personnage : ce que le client
      // portait sans l'avoir choisi.
      const ancien = characterById(c.characterId);
      const tenueAncienne = ancien
        ? defaultCharacter(ancien, 0, slotsDe(ancien)).assets
        : {};
      c.characterId = base.id;
      const variants = slotsForCharacter(
        variantesDeVue(props.slots, base.orientation ?? state.view),
        base,
      );
      // Changement de personnage : les pièces qui n'existent pas chez le
      // nouveau tombent, sa tenue par défaut prend le relais pour ces
      // emplacements-là — sinon un perso nu resterait nu après l'échange.
      // Une pièce que le client n'a pas choisie (celle de la tenue par défaut
      // de l'ancien) cède aussi la place à celle du nouveau : passer de
      // Femme 6 à Femme 4 lui laissait la coupe blonde de Femme 6, au lieu
      // de celle réglée pour Femme 4 au back-office (vidéo de la boutique,
      // 27 octobre).
      for (const slot of SLOTS) {
        const parDefaut =
          c.assets[slot] !== undefined &&
          String(c.assets[slot]) === String(tenueAncienne[slot]);
        if (parDefaut) delete c.assets[slot];
        else if (findVariant(variants[slot], c.assets[slot])) continue;
        const pos = base.defaultAssets?.[slot];
        const v =
          pos == null ? undefined : variants[slot]?.find((x) => x.position === pos);
        if (v) c.assets[slot] = v.id;
      }
      // Couleurs : base + couleurs des variantes encore sélectionnées, chacune
      // sous sa clé namespacée (base:stN / slot:stN) — les zones stN partagées
      // entre couches ne se mélangent plus.
      const colors: Record<string, string> = {};
      for (const [zone, hex] of Object.entries(base.baseColorZones ?? {})) {
        colors[colorKey(BASE_COLOR_SCOPE, zone)] = hex;
      }
      for (const slot of SLOTS) {
        const v = findVariant(variants[slot], c.assets[slot]);
        if (!v) {
          delete c.assets[slot];
          continue;
        }
        for (const [zone, hex] of Object.entries(v.colorZones ?? {})) {
          colors[colorKey(slot, zone)] = hex;
        }
      }
      c.colors = colors;
    });
  }
  function swap(a: number, b: number) {
    mutate((s) => {
      const ca = s.characters[a];
      const cb = s.characters[b];
      if (!ca || !cb) return;
      const tmp = ca.position;
      ca.position = cb.position;
      cb.position = tmp;
      s.characters[a] = cb;
      s.characters[b] = ca;
    });
  }
  function bringForward(index: number) {
    if (index < state.characters.length - 1) swap(index, index + 1);
  }

  /**
   * Sort un personnage de la liste et le repose à un autre rang.
   *
   * Un échange deux à deux ne suffit pas ici : le geste peut traverser
   * plusieurs lignes d'un coup, et enchaîner des échanges ferait remonter les
   * voisins dans le désordre. Les rangs de superposition sont renumérotés
   * d'après l'ordre obtenu, pour que le dessin suive la liste.
   */
  function reordonner(depuis: number, vers: number) {
    if (depuis === vers) return;
    mutate((s) => {
      if (
        depuis < 0 ||
        vers < 0 ||
        depuis >= s.characters.length ||
        vers >= s.characters.length
      )
        return;
      const [pris] = s.characters.splice(depuis, 1);
      if (!pris) return;
      s.characters.splice(vers, 0, pris);
      s.characters.forEach((c, rang) => {
        c.position = rang;
      });
    });
  }
  function sendBackward(index: number) {
    if (index > 0) swap(index, index - 1);
  }

  /**
   * Le client vient de poser un personnage sur l'affiche : sa place devient la
   * sienne, et ce personnage quitte la rangée automatique.
   */
  function deplacerPersonnage(
    index: number,
    position: { x: number; y: number },
  ) {
    mutate((s) => {
      const c = s.characters[index];
      if (!c) return;
      c.x = position.x;
      c.y = position.y;
      c.placementManuel = true;
    });
  }

  /** Tout le monde retourne dans la rangée : les places posées sont oubliées. */
  function replacerAutomatiquement() {
    mutate((s) => {
      for (const c of s.characters) c.placementManuel = false;
    });
  }

  /** Au moins un personnage a été posé à la main. */
  const aDesPlacesPosees = () =>
    state.characters.some((c) => c.placementManuel);

  /* --------------------------- étape 3 ------------------------------------ */
  /** Choix du cadre — null = sans cadre. */
  function setCadre(frameId: string | number | null) {
    mutate((s) => {
      s.frameId = frameId;
    });
  }
  function setFormat(format: PosterFormat) {
    mutate((s) => {
      s.format = format;
    });
  }

  /** La fenêtre « Voir sur un mur » (26/11). */
  const [auMur, setAuMur] = createSignal(false);
  /** Cadre actuellement choisi, s'il y en a un. */
  const cadreChoisi = (): CadreDTO | undefined =>
    state.frameId == null || state.frameId === ""
      ? undefined
      : props.cadres?.find((c) => String(c.id) === String(state.frameId));

  /**
   * Prix courant : format sélectionné + supplément du cadre POUR CE FORMAT.
   *
   * Même addition que côté serveur (`resolveUnitPriceCents`), et même choix
   * du prix du cadre (`prixDuCadreCents`) : le montant affiché ici doit être
   * celui qui sera facturé, sinon le client découvre le supplément au panier.
   */
  const currentPrice = (): number => {
    const p = props.prices?.[state.format];
    const affiche = typeof p === "number" ? p : props.product.basePriceCents;
    const cadre = cadreChoisi();
    return affiche + (cadre ? prixDuCadreCents(cadre, state.format) : 0);
  };

  /** Rappel du choix — le format courant s'il sort de l'ordinaire, le cadre.
   *  Vide en A4 sans cadre : il n'y aurait rien à rappeler. Vide aussi quand
   *  l'étape du format n'est pas proposée (20/11) : l'hôte fait choisir le
   *  format sur son propre écran, et un « A3 » au pied de l'écran des
   *  personnages ne rappellerait aucun choix fait ici. */
  const rappelChoix = (): string =>
    etapes().includes("format")
      ? [state.format === "A3" ? "A3" : null, cadreChoisi()?.name]
          .filter(Boolean)
          .join(" · ")
      : "";

  const isLast = () => stepIndex() === etapes().length - 1;
  const editingActive = () =>
    state.step === "characters" && state.editingIndex !== null;

  return (
    <div
      class="ml-cfg-root"
      // Sur une tablette, la barre de la fenêtre de personnalisation ne se
      // montre qu'au premier geste : on en dessine une (cf. Defilement).
      ref={(el) => brancherBarreDeLaFenetre(el)}
      // L'étape en cours, pour la feuille de style de l'hôte : l'étape du
      // format se met en page autrement sur une tablette en portrait, pour
      // tenir à l'écran sans défiler (cf. global.css du site).
      data-etape={editingActive() ? "personnage" : state.step}
      style={{
        display: "grid",
        // Pendant l'édition d'un personnage, l'aperçu de l'affiche disparaît
        // et l'éditeur prend toute la largeur (cf. plus bas).
        "grid-template-columns": editingActive()
          ? "minmax(0, 1fr)"
          : "minmax(280px, 1fr) minmax(320px, 420px)",
        gap: "20px",
        "align-items": "start",
        // La police du site qui accueille le module (« ML Inter » sur
        // memoryline.fr, 18/11), celle du système à défaut.
        "font-family": "var(--font-sans, system-ui, sans-serif)",
        color: "#111827",
      }}
    >
      {/* Aperçu de l'affiche — MASQUÉ pendant la composition d'un personnage :
          l'éditeur affiche déjà le personnage seul, en grand, et montrer
          l'affiche entière par-dessus surchargeait l'écran (retour cliente).
          On la retrouve dès qu'on valide ou qu'on revient à la liste. */}
      <Show when={!editingActive()}>
      <div style={{ position: "sticky", top: "16px" }}>
        <PosterPreview
          state={state}
          characterById={characterById}
          slots={props.slots}
          cache={cache}
          foregroundUrl={
            props.foregroundUrl
              ? props.foregroundUrl.startsWith("http")
                ? props.foregroundUrl
                : props.assetBaseUrl.replace(/\/$/, "") + props.foregroundUrl
              : undefined
          }
          assetBaseUrl={props.assetBaseUrl}
          cadre={cadreChoisi() ?? null}
          messages={msg()}
          // Le seul aperçu qui compose : chaque ajout, retrait ou changement
          // d'ordre replace tout le monde. Le panier et la commande dessinent
          // ensuite les places que ce module aura enregistrées.
          recomposer
          etalon={etalon()}
          // Tels que l'hôte les donne : absents, le filigrane et le texte
          // restent, comme toujours (voir ConfiguratorProps).
          filigrane={props.filigrane}
          sansTexte={props.sansTexte}
        />
        {/* L'affiche au mur, à l'échelle (26/11). Pas sur l'affiche tirée
            d'une photo, qui n'ouvre ici que ses personnages (sansTexte) :
            son écran a son propre aperçu. */}
        <Show when={!props.sansTexte && props.apercuMur !== false}>
          <button
            type="button"
            class="ml-cfg-mur"
            onClick={() => setAuMur(true)}
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              gap: "8px",
              width: "100%",
              "margin-top": "10px",
              padding: "9px 12px",
              border: "1px solid #d1d5db",
              "border-radius": "8px",
              background: "#fff",
              "font-size": "14px",
              "font-weight": "600",
              color: "#1f2937",
              cursor: "pointer",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 21h18M5 21v-4h14v4M8 3h8v10H8z" />
            </svg>
            {msg().murVoir}
          </button>
        </Show>
        <Show when={auMur()}>
          <ApercuAuMur
            format={state.format}
            encadree={cadreChoisi() != null}
            onFormat={setFormat}
            onClose={() => setAuMur(false)}
            messages={msg()}
            affiche={() => (
              <PosterPreview
                state={state}
                characterById={characterById}
                slots={props.slots}
                cache={cache}
                foregroundUrl={
                  props.foregroundUrl
                    ? props.foregroundUrl.startsWith("http")
                      ? props.foregroundUrl
                      : props.assetBaseUrl.replace(/\/$/, "") + props.foregroundUrl
                    : undefined
                }
                assetBaseUrl={props.assetBaseUrl}
                cadre={cadreChoisi() ?? null}
                messages={msg()}
                filigrane={props.filigrane}
                auMur
              />
            )}
          />
        </Show>
      </div>
      </Show>

      {/* Panneau de contrôle */}
      <div
        class="ml-cfg-panel"
        style={{
          border: "1px solid #e5e7eb",
          "border-radius": "10px",
          padding: "16px",
          background: "#fafafa",
        }}
      >
        {/* Fil d'étapes.
            Toujours sur UNE rangée (retour cliente : « ça doit être que sur
            une ligne, là trop gros »). Il avait été grossi à 15 px en gras
            et 40 px de haut pour se lire mieux ; à cette taille, l'anglais,
            l'allemand et l'italien passaient sur deux rangées dans la
            colonne de 386 px d'un ordinateur. Juste milieu : 13 px en
            demi-gras (12 px à l'origine), 32 px de haut, et le gris foncé
            des étapes inactives, qui reste lisible. L'allemand, le plus
            long, tient alors avec une marge que gardent aussi les polices
            système plus larges (Mac, iPhone). Sur un téléphone, la feuille
            de style de l'hôte resserre encore (cf. global.css).
            Masqué s'il n'y a qu'une étape (20/11 : les personnages seuls,
            sur l'affiche tirée d'une photo) : une pastille seule ne mène
            nulle part, et sa place revient aux personnages. */}
        <Show when={etapes().length > 1}>
          <div
            class="ml-cfg-etapes"
            style={{
              display: "flex",
              "flex-wrap": "nowrap",
              gap: "6px",
              "margin-bottom": "14px",
            }}
          >
            {/* Chaque étape est cliquable à tout moment (retour cliente) : on
                n'est pas tenu d'enchaîner Continuer / Retour pour revenir au
                fond depuis le format. goToStep ferme l'éditeur de personnage
                s'il était ouvert. */}
            {etapes().map((s, i) => (
              <button
                type="button"
                class="ml-cfg-etape"
                onClick={() => goToStep(s)}
                aria-current={state.step === s ? "step" : undefined}
                style={{
                  // Chaque pastille prend sa part de la rangée ; `min-width: 0`
                  // la laisse céder plutôt que de pousser la rangée hors du
                  // panneau.
                  flex: "1 1 auto",
                  "min-width": "0",
                  display: "inline-flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "min-height": "32px",
                  "box-sizing": "border-box",
                  padding: "6px 12px",
                  border: "none",
                  "border-radius": "9999px",
                  background: state.step === s ? "#4f46e5" : "#e5e7eb",
                  color: state.step === s ? "#fff" : "#374151",
                  "font-weight": "600",
                  "font-size": "13px",
                  "line-height": "1.2",
                  "font-family": "inherit",
                  "white-space": "nowrap",
                  cursor: state.step === s ? "default" : "pointer",
                }}
              >
                {/* Filet de sécurité : si une police plus large que prévu ne
                    laissait pas la place, le libellé finirait par « … » dans
                    sa pastille, sans jamais passer à la ligne ni déborder. Les
                    tailles sont choisies pour que cela n'arrive pas. */}
                <span
                  style={{
                    "min-width": "0",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                  }}
                >
                  {i + 1}. {STEP_LABELS()[s]}
                </span>
              </button>
            ))}
          </div>
        </Show>

        <Show when={state.step === "background"}>
          <StepBackgroundText
            state={state}
            backgrounds={props.backgrounds}
            assetBaseUrl={props.assetBaseUrl}
            onSelectBackground={selectBackground}
            onTextValue={setTextValue}
            onTextStyle={setTextStyle}
            onTextFont={setTextFont}
            messages={msg()}
          />
        </Show>

        <Show when={state.step === "characters"}>
          <StepCharacters
            state={state}
            characters={visibleCharacters()}
            slots={slotVariants()}
            slotsDe={slotsDe}
            pieceCategories={props.pieceCategories}
            nuanciersBase={props.nuanciersBase}
            cache={cache}
            assetBaseUrl={props.assetBaseUrl}
            characterById={characterById}
            onAdd={addCharacter}
            onDuplicate={duplicateCharacter}
            onRemove={removeCharacter}
            onSelect={selectCharacter}
            onQuitterEditeur={quitterEditeur}
            onReorder={reordonner}
            onSetAsset={setAsset}
            onClearSlot={clearSlot}
            onSetColors={setColors}
            onRemettreCouleurs={remettreCouleurs}
            onChangeCharacter={changeCharacter}
            messages={msg()}
          />
          {/* Le placement sur l'affiche reste automatique : la boutique veut
              qu'on réordonne la LISTE, pas qu'on pousse les dessins. */}
        </Show>

        <Show when={state.step === "format"}>
          <StepFormat
            state={state}
            prices={props.prices}
            sansPrix={props.sansPrix}
            sansPrixCadres={props.sansPrixCadres}
            onSelect={setFormat}
            cadres={props.cadres}
            onSelectCadre={setCadre}
            messages={msg()}
          />
        </Show>

        {/* Navigation globale (masquée quand on édite un perso : l'éditeur a ses
            propres boutons Retour / Valider §18.2 F). Collée au bas de la
            fenêtre, avec l'indice qui dit qu'il reste à voir plus bas — sauf
            à l'étape des personnages, où le bord bas tombe déjà au milieu
            d'une ligne et où le fondu la recouvrirait. */}
        <Show when={!editingActive()}>
          <BarreActions indice={state.step !== "characters"}>
            <Button variant="secondary" onClick={prev}>
              {msg().retour}
            </Button>
            {/* Prix mis à jour selon le format ET le cadre choisis. Le
                détail entre parenthèses reprend le nom du cadre tel qu'il est
                saisi au back-office : rien à traduire. Sans prix, ce rappel
                reste seul et tient le milieu de la barre — les deux boutons
                s'écarteraient sinon aux extrémités, autour d'un vide. */}
            <div style={{ "font-weight": "700", "font-size": "18px", "white-space": "nowrap" }}>
              <Show when={!props.sansPrix}>{fmtPrice(currentPrice(), locale())}</Show>
              <Show when={rappelChoix()}>
                <span
                  style={{
                    "font-size": props.sansPrix ? "14px" : "12px",
                    color: "#6b7280",
                    "font-weight": "500",
                  }}
                >
                  {props.sansPrix ? rappelChoix() : ` (${rappelChoix()})`}
                </span>
              </Show>
            </div>
            <Button variant="primary" onClick={next}>
              {isLast() ? msg().validerAffiche : msg().continuer}
            </Button>
          </BarreActions>
        </Show>
      </div>
    </div>
  );
}

export default Configurator;

/**
 * Aperçu d'affiche réutilisable hors du configurateur — le panier s'en sert
 * pour montrer EXACTEMENT ce que le client a composé, pas seulement le fond.
 * C'est le même composant, donc les deux rendus ne peuvent pas diverger.
 */
export { PosterPreview } from "./components/PosterPreview";
/**
 * La réduction des lignes trop longues : l'affiche tirée d'une photo
 * (apps/web, AfficheIA) pose ses textes comme l'aperçu, et doit les réduire
 * de la même façon que lui et que le fichier d'impression.
 */
export { createReductionDesLignes } from "./components/ReductionTexte";
/**
 * La liste qui défile avec ses boutons et sa barre bien visibles : le site
 * s'en sert aussi (la liste des points relais), pour que toutes les listes se
 * fassent défiler du même geste.
 */
export { ZoneDefilante } from "./components/Defilement";
export {
  createSvgCache,
  stateFromConfig,
  SLOTS,
  findVariant,
  variantesDeVue,
} from "./store";
export type { PosterConfig } from "@memoryline/types";
/** Une étape du module (« characters »…), pour la prop `etapes`. */
export type { Step } from "./store";
export type {
  CadreDTO,
  PieceCategoryDTO,
  NuanciersPersonnages,
  CharacterDTO,
  VariantDTO,
  SlotsDTO,
  SlotVariants,
} from "./store";
