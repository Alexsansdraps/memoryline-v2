/// <reference lib="dom" />
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  Show,
  type JSX,
} from "solid-js";
import {
  Configurator,
  PosterPreview,
  createSvgCache,
  stateFromConfig,
  SLOTS,
  findVariant,
  variantesDeVue,
} from "@memoryline/configurator";
import { urlAsset, type Character, type PosterFormat } from "@memoryline/types";
import { t, LANGUE_DEFAUT, LOCALE_COMPLETE, type Langue } from "../i18n/utils.ts";
import { PUBLIC_API_URL, browserApi, type CharacterLibrary } from "../lib/api.ts";
import { messagesDuConfigurateur } from "../lib/messages-configurateur.ts";

/**
 * Les personnages et le muret de l'affiche tirée d'une photo (20/11, « faut
 * pouvoir ajouter personnages et murets si les gens veulent »).
 *
 * Chargé À LA DEMANDE par AfficheIA.tsx, comme le configurateur l'est par
 * ProductConfigurator.tsx : la plupart des clients n'ajoutent personne, et
 * ni ce code ni la bibliothèque des personnages n'ont à partir avec la fiche.
 *
 * AfficheIA reste le seul maître de la ligne de panier — textes posés à la
 * main, format, quantité, créations cochées. Ce module ne fait que deux
 * choses :
 *  - ComposerPersonnages (export par défaut) ouvre le module de
 *    personnalisation sur sa SEULE étape « Personnages », l'aperçu de la
 *    création pour fond, et rend la composition validée ;
 *  - ApercuPersonnages redessine l'image, le muret et les personnages dans
 *    le grand aperçu d'AfficheIA, sous ses calques de texte.
 *
 * Le fond est TOUJOURS l'aperçu filigrané (/ia/apercu/<id>) : la pleine
 * définition n'existe côté client qu'une fois la commande payée. Un seul
 * filigrane, celui cuit dans l'image : celui du module est coupé, sinon deux
 * se superposeraient.
 */

/**
 * Le muret d'origine : le décor du type « de dos » tant que la boutique n'en
 * a pas réglé un autre. Le fichier d'impression le pose aussi d'office sur
 * une vue de dos sans décor.
 */
const MURET_OFFICIEL = "/assets/muret_officiel.svg";

/** L'adresse brute de l'aperçu filigrané d'une création, sans préfixe d'API. */
function cheminApercu(publicId: string): string {
  return `/ia/apercu/${publicId}`;
}

/**
 * Les personnages posés sur UNE création.
 *
 * Gardée par AfficheIA avec la création elle-même (sessionStorage) : elle
 * survit au retour sur une autre création et au rechargement de la page.
 */
export interface CompositionIA {
  /**
   * « back » : de dos, assis sur le muret ; « front » : debout, de face, sans
   * muret. On ne mélange jamais les deux sur une affiche.
   */
  vue: "back" | "front";
  /**
   * Tels que le module les rend (configFromState) : places, échelles,
   * tenues, couleurs, ordre de dessin. Le fichier d'impression relit
   * exactement ceux-là.
   */
  personnages: Character[];
  /** Le muret de la vue « back », chemin brut /assets/… ; null de face. */
  decor: string | null;
}

/** La bibliothèque des personnages, et le muret à poser sous ceux de dos. */
export interface BibliothequeIA {
  lib: CharacterLibrary;
  muret: string;
}

/** Une lecture par langue (les noms des catégories sont traduits). */
const bibliotheques = new Map<Langue, Promise<BibliothequeIA>>();

/**
 * Les bibliothèques ARRIVÉES, par langue (21/11). Le grand aperçu les lit
 * ici, et non dans une lecture à lui : celle-ci, faite une fois à son
 * montage, gardait son échec (réseau du marché) tant qu'il restait monté —
 * « 2 personnages, assis sur le muret » sous une image sans personne, même
 * après que la composition avait relu la bibliothèque sans peine. Arrivée
 * par n'importe quel chemin (préchargement, composition, aperçu), elle sert
 * désormais à tous.
 */
const [bibliothequesArrivees, setBibliothequesArrivees] = createSignal<
  ReadonlyMap<Langue, BibliothequeIA>
>(new Map());

/**
 * La bibliothèque des personnages et le muret, lus une seule fois.
 *
 * La promesse est gardée en mémoire : le préchargement d'AfficheIA (au repos,
 * dès la première création, pour la tablette en 4G), la composition et le
 * grand aperçu partagent la même lecture. Un échec, lui, n'est pas gardé :
 * la prochaine ouverture réessaie.
 *
 * Le muret est le décor du type d'affiche « back » (BO › Types d'affiche),
 * à défaut le muret d'origine (décision du 20/11 : un seul muret). Le
 * serveur n'accepte que ces décors-là sur une ligne de panier.
 */
export function chargerBibliotheque(langue?: Langue): Promise<BibliothequeIA> {
  const cle = langue ?? LANGUE_DEFAUT;
  const deja = bibliotheques.get(cle);
  if (deja) return deja;
  const promesse = Promise.all([
    browserApi.characters(cle),
    // La liste des types muette : le muret d'origine, toujours accepté.
    browserApi.views().catch(() => []),
  ]).then(([lib, vues]) => {
    const arrivee: BibliothequeIA = {
      lib,
      muret: vues.find((v) => v.slug === "back")?.foregroundUrl || MURET_OFFICIEL,
    };
    setBibliothequesArrivees((avant) => new Map(avant).set(cle, arrivee));
    return arrivee;
  });
  bibliotheques.set(cle, promesse);
  promesse.catch(() => {
    if (bibliotheques.get(cle) === promesse) bibliotheques.delete(cle);
  });
  return promesse;
}

/** La même attente que la fenêtre des affiches personnalisables. */
function Attente(props: { texte: string }): JSX.Element {
  return (
    <p class="flex items-center justify-center gap-2 py-16 text-ink-soft" role="status">
      <span class="ml-spinner" aria-hidden="true" />
      {props.texte}
    </p>
  );
}

export interface ComposerPersonnagesProps {
  langue?: Langue;
  product: { id: number; name: string; basePriceCents: number };
  /** La création qui reçoit les personnages : son aperçu filigrané sert de fond. */
  publicId: string;
  format: PosterFormat;
  vue: "back" | "front";
  /** Les personnages déjà posés (« Modifier »), sinon aucun. */
  personnages: Character[];
  /** « Valider les personnages ». */
  onValider: (compo: CompositionIA) => void;
  /** « Retour » : rien n'est gardé, l'affiche reste telle qu'avant. */
  onRetour: () => void;
}

/**
 * L'écran de composition, dans la fenêtre d'AfficheIA : le module de
 * personnalisation ouvert sur la seule étape des personnages.
 *
 * Aucun prix nulle part, au stand comme sur le site : ajouter des personnages
 * ne change pas le prix (décision du 20/11), il n'y a rien à annoncer. Ni
 * texte (AfficheIA pose les siens, à leur place), ni cadre, ni filigrane du
 * module. Le placement est celui du module, automatique : rangée le long du
 * muret de dos, groupe de face.
 */
export default function ComposerPersonnages(props: ComposerPersonnagesProps): JSX.Element {
  const langue = props.langue ?? LANGUE_DEFAUT;
  const tr = t(langue);
  const locale = LOCALE_COMPLETE[langue];
  const [biblio] = createResource(() => chargerBibliotheque(langue).catch(() => null));
  const fond = cheminApercu(props.publicId);
  /** Le décor de cette composition, lu une fois la bibliothèque arrivée. */
  const decor = (b: BibliothequeIA) => (props.vue === "back" ? b.muret : null);

  return (
    <Show when={!biblio.loading} fallback={<Attente texte={tr("ia.perso.chargement")} />}>
      <Show
        when={biblio()}
        fallback={
          // Bibliothèque injoignable (réseau du marché) : on le dit, et l'on
          // rend la main. L'affiche n'a pas bougé.
          <div class="py-12 text-center">
            <p role="alert" class="text-terracotta-deep">
              {tr("ia.perso.erreur")}
            </p>
            <button
              type="button"
              onClick={() => props.onRetour()}
              class="mt-5 rounded-full border border-ink px-6 py-3 text-sm font-medium hover:bg-ink hover:text-paper transition-colors"
            >
              {tr("cfg.retour")}
            </button>
          </div>
        }
      >
        {(b) => (
          <Configurator
            etapes={["characters"]}
            product={props.product}
            backgrounds={[{ id: 0, url: fond, name: null, position: 0 }]}
            characters={b().lib.characters}
            slots={b().lib.slots}
            pieceCategories={b().lib.pieceCategories ?? []}
            nuanciersBase={b().lib.nuanciersBase}
            cadres={[]}
            sansPrix
            filigrane={false}
            sansTexte
            foregroundUrl={decor(b())}
            initialConfig={{
              schemaVersion: 1,
              productId: props.product.id,
              backgroundUrl: fond,
              format: props.format,
              view: props.vue,
              texts: { lines: [] },
              characters: props.personnages,
            }}
            messages={{
              ...messagesDuConfigurateur(tr, locale),
              validerAffiche: tr("ia.perso.valider"),
            }}
            assetBaseUrl={PUBLIC_API_URL}
            onSubmit={(cfg) =>
              props.onValider({
                // La vue de l'ouverture, pas celle que rend le module : elle ne
                // se change pas à cette étape, et le type reste fermé.
                vue: props.vue,
                personnages: cfg.characters,
                decor: decor(b()),
              })
            }
            onBack={() => props.onRetour()}
          />
        )}
      </Show>
    </Show>
  );
}

/**
 * Le grand aperçu d'AfficheIA quand la création montrée a des personnages :
 * l'image, le muret et les personnages, à leurs places enregistrées — celles
 * que le fichier d'impression relit. Sans texte : les deux calques de texte
 * d'AfficheIA restent posés par-dessus, toujours déplaçables.
 *
 * Pleine taille de la boîte d'aperçu : la règle globale qui borne l'aperçu du
 * module à la hauteur de l'écran (.ml-cfg-poster, global.css) est annulée ici,
 * comme dans la vignette du panier, et l'aperçu perd ses coins arrondis et
 * son ombre — c'est la boîte d'AfficheIA qui fait le cadre. Sinon l'image
 * serait plus petite que la boîte, et les textes posés à côté de leur place.
 *
 * L'image est recadrée comme sur le papier (`cover`) : une image en
 * 1024 × 1536 y perd quelques pour cent de hauteur, comme à l'impression.
 */
export function ApercuPersonnages(props: {
  langue?: Langue;
  publicId: string;
  format: PosterFormat;
  compo: CompositionIA;
  /** Ce que dit le lecteur d'écran, comme pour l'image seule. */
  alt: string;
  /** Ce qui se montre si les personnages ne peuvent pas être dessinés : l'image seule. */
  repli: () => JSX.Element;
}): JSX.Element {
  const langue = props.langue ?? LANGUE_DEFAUT;
  const tr = t(langue);
  const locale = LOCALE_COMPLETE[langue];
  /**
   * La bibliothèque, arrivée par n'importe quel chemin (21/11) ; tant qu'elle
   * manque, l'image seule. Demandée au montage, puis de nouveau à chaque
   * changement de composition (« Valider », une autre création) tant qu'elle
   * n'est pas là : un réseau revenu suffit, sans recharger la page — ce qui
   * perdrait les textes tapés.
   */
  const biblio = () => bibliothequesArrivees().get(langue);
  createEffect(
    on(
      () => props.compo,
      () => {
        if (!biblio()) void chargerBibliotheque(langue).catch(() => {});
      },
    ),
  );
  const { cache, fetchSvg } = createSvgCache(PUBLIC_API_URL);
  const personnageParId = (id: string | number) =>
    biblio()?.lib.characters.find((c) => String(c.id) === String(id));

  /**
   * Précharge les SVG des personnages posés : base et pièces réellement
   * choisies. Sans lui, l'aperçu resterait vide (même règle que le panier,
   * CartIsland.tsx).
   */
  createEffect(() => {
    const b = biblio();
    if (!b) return;
    for (const perso of props.compo.personnages) {
      const base = personnageParId(perso.typeId);
      if (!base) continue;
      void fetchSvg(base.baseSvgUrl);
      const jeu = variantesDeVue(b.lib.slots, base.orientation);
      for (const slot of SLOTS) {
        const v = findVariant(jeu[slot], perso.assets?.[slot]);
        if (v) void fetchSvg(v.svgUrl);
      }
    }
  });

  const etat = createMemo(() =>
    stateFromConfig({
      schemaVersion: 1,
      backgroundUrl: cheminApercu(props.publicId),
      format: props.format,
      view: props.compo.vue,
      texts: { lines: [] },
      characters: props.compo.personnages,
    }),
  );

  return (
    <Show when={biblio()} fallback={props.repli()}>
      {(b) => (
        <div
          role="img"
          aria-label={props.alt}
          class="absolute inset-0 [&>.ml-cfg-poster]:w-full! [&>.ml-cfg-poster]:rounded-none! [&>.ml-cfg-poster]:shadow-none!"
        >
          <PosterPreview
            state={etat()}
            characterById={personnageParId}
            slots={b().lib.slots}
            cache={cache}
            assetBaseUrl={PUBLIC_API_URL}
            // Le même calcul que le panier : le décor enregistré, sinon le
            // muret d'origine pour une vue de dos.
            foregroundUrl={
              urlAsset(
                PUBLIC_API_URL,
                props.compo.decor || (props.compo.vue === "back" ? MURET_OFFICIEL : ""),
              ) || undefined
            }
            filigrane={false}
            sansTexte
            messages={messagesDuConfigurateur(tr, locale)}
          />
        </div>
      )}
    </Show>
  );
}
