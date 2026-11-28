/// <reference lib="dom" />
import { t, lien, LANGUE_DEFAUT, LOCALE_COMPLETE, type Langue } from "../i18n/utils.ts";
import { createResource, createSignal, Show, type JSX } from "solid-js";
import { Configurator } from "@memoryline/configurator";
import type {
  BackgroundDTO,
  CharacterTypeDTO,
  PosterConfig,
  PosterFormat,
} from "@memoryline/types";
import {
  PUBLIC_API_URL,
  avecStand,
  versLePanier,
  browserApi,
  getCartId,
  type OrderItem,
} from "../lib/api.ts";
import { messageAjoutRefuse } from "../lib/ajout-panier.ts";
import { messagesDuConfigurateur } from "../lib/messages-configurateur.ts";

/**
 * Île SolidJS qui pilote le configurateur d'affiche.
 *
 * Deux modes :
 *  - AJOUT (mode="add")  : POST /cart/:cartId/items, puis redirige vers /panier.
 *  - ÉDITION (mode="edit"): réouverture avec initialConfig + PUT (§18.3 I), puis
 *    retour au panier.
 *
 * Le panier est identifié par un UUID persistant dans localStorage
 * ("ml_cart_id"). Tout est fait côté navigateur (client:only).
 */
export interface ConfiguratorIslandProps {
  /** Langue de la page — pilote les libellés du configurateur. */
  langue?: Langue;
  product: { id: number; name: string; basePriceCents: number };
  /** Prix réels par format (centimes), ex. { A4: 2300, A3: 2900 }. */
  prices?: Partial<Record<string, number>>;
  /** Décor d'avant-plan du produit (muret/banc…), rendu au 1er plan. */
  foregroundUrl?: string | null;
  /**
   * Le jeu de motifs que la fiche propose (28/11, affiche du stand de
   * Mulhouse) : transmis tel quel au configurateur. Null : affiche classique.
   */
  vueMotifs?: string | null;
  /** La palette des couleurs du motif (28/11), transmise telle quelle. */
  couleursMotif?: { id: string; nom: string; hex: string }[] | null;
  /** Réglages par défaut du produit (pré-remplissage), une entrée par ligne. */
  defaults?: {
    lignes?: (string | null)[];
    view?: string | null;
    format?: PosterFormat;
  };
  /** "add" depuis la fiche produit, "edit" depuis le panier. */
  mode?: "add" | "edit";
  /** Réouverture (edit) : config de la ligne à modifier. */
  initialConfig?: PosterConfig;
  /** Réouverture (edit) : id de la ligne de panier à mettre à jour. */
  itemId?: number;
  /** Fermeture de la modale (bouton « Retour » à l'étape 1). */
  onCancel?: () => void;
  /** Stand de salon : aucun montant à l'écran (cf. ConfiguratorProps). */
  sansPrix?: boolean;
  /**
   * Vrai quand la boutique tait le supplément de chaque cadre (« + 15 € »
   * sous sa vignette), réglage de la page Cadres du back-office. Le cadre
   * reste compté dans le total. Cf. StepFormat du configurateur.
   */
  sansPrixCadres?: boolean;
  /** Faux : « Voir sur un mur » coupé au back-office (page Cadres). */
  apercuMur?: boolean;
  /**
   * Faux quand le site ne propose pas les cadres (réglage du back-office,
   * jamais au stand) : la rubrique « Cadre » disparaît du configurateur, et
   * une ligne rouverte depuis le panier repart sans son cadre. Absent, les
   * cadres sont proposés.
   */
  cadresProposes?: boolean;
  /**
   * Le nombre d'exemplaires, choisi sur la fiche produit.
   *
   * Il vient de l'extérieur et non du configurateur : on décide combien avant
   * de composer, au même endroit que pour une affiche prête à imprimer. Une
   * ligne de panier porte ce nombre ; les exemplaires sont identiques.
   */
  quantite?: number;
}

/** Prix selon le format choisi, depuis les prix réels des variantes. */
function priceForConfig(
  config: PosterConfig,
  basePriceCents: number,
  prices?: Partial<Record<string, number>>,
): number {
  const fmt = config.format ?? "A4";
  const p = prices?.[fmt];
  return typeof p === "number" ? p : basePriceCents;
}

export default function ConfiguratorIsland(
  props: ConfiguratorIslandProps,
): JSX.Element {
  const langue = props.langue ?? LANGUE_DEFAUT;
  const tr = t(langue);
  const locale = LOCALE_COMPLETE[langue];
  const mode = props.mode ?? "add";
  const cadresProposes = props.cadresProposes !== false;

  // Chargement de la bibliothèque (personnages + variantes de slots + fonds).
  const [data] = createResource(async () => {
    const [library, backgrounds, cadres] = await Promise.all([
      browserApi.characters(props.langue),
      browserApi.backgrounds(props.product.id),
      // Pas de cadres à proposer : une liste vide, et le configurateur
      // n'affiche pas la rubrique du tout (StepFormat).
      cadresProposes ? browserApi.frames(props.langue).catch(() => []) : [],
    ]);
    return {
      characters: library.characters,
      slots: library.slots,
      pieceCategories: library.pieceCategories ?? [],
      // Les nuanciers des personnages réglés au back-office (peau, cheveux…).
      nuanciersBase: library.nuanciersBase,
      backgrounds,
      cadres,
    };
  });

  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  /**
   * L'affiche validée part au panier, avec son nombre d'exemplaires.
   *
   * La quantité vient du configurateur et non de la configuration : trois
   * exemplaires d'une affiche, c'est la même affiche trois fois, pas trois
   * affiches différentes.
   */
  async function handleSubmit(config: PosterConfig) {
    // Borné ici aussi : la fiche le borne déjà, mais cet îlot est appelé
    // depuis plusieurs écrans et rien ne garantit qu'ils le feront tous.
    const quantite = Math.min(20, Math.max(1, Math.trunc(props.quantite ?? 1) || 1));
    if (saving()) return;
    setSaving(true);
    setError(null);
    try {
      // Le décor d'avant-plan est un réglage produit : on l'injecte dans le
      // snapshot pour que le PDF d'impression le rende aussi. Sauf quand le
      // module l'a déjà écrit lui-même : une affiche à motifs sans personnage
      // n'a pas de muret (28/11), et le dit par un décor vide (configFromState).
      if (props.foregroundUrl && config.foregroundUrl === undefined)
        config = { ...config, foregroundUrl: props.foregroundUrl };
      // Une ligne rouverte depuis le panier peut porter un cadre choisi avant
      // que le site ne les retire : la rubrique n'est plus là pour l'enlever,
      // on ne le renvoie pas.
      if (!cadresProposes) {
        const { frameId: _retire, ...sansCadre } = config;
        config = sansCadre;
      }
      const cartId = getCartId();
      const unitPriceCents = priceForConfig(
        config,
        props.product.basePriceCents,
        props.prices,
      );
      let ligne: OrderItem;
      if (mode === "edit" && props.itemId != null) {
        // La langue de la page suit le panier ; au stand, l'API l'ignore.
        ligne = await browserApi.updateCartItem(cartId, props.itemId, {
          config,
          unitPriceCents,
          langue,
        });
      } else {
        // Le prix est CALCULÉ et enregistré même quand il n'est pas affiché :
        // la boutique doit savoir ce qu'elle a vendu sur le stand. Au stand
        // aussi, l'affiche validée part au panier — c'est lui qui y sert de
        // récapitulatif et de dernière étape.
        ligne = await browserApi.addCartItem(cartId, {
          productId: props.product.id,
          unitPriceCents,
          quantity: quantite,
          title: props.product.name,
          config,
          langue,
        });
      }
      // Le serveur a écrit la ligne sans son cadre (page ouverte avant que la
      // boutique ne les retire du site) : le panier le dit à la cliente.
      // Le panier dans la langue de la fiche, pas celui du français.
      // Sur le site, le panier est la page de commande (17/11) ; au stand,
      // la page /panier de la tablette.
      const panier = versLePanier(lien(langue, "/commande"), lien(langue, "/panier"));
      // replace : l'entrée « fenêtre ouverte » de la fiche (ProductConfigurator)
      // ne reste pas dans l'historique, « précédent » depuis le panier
      // revient en un appui sur la fiche.
      window.location.replace(ligne.cadreRetire ? `${panier}${panier.includes("?") ? "&" : "?"}cadres=retires` : panier);
    } catch (e) {
      // Une phrase dans la langue de la fiche : l'erreur brute (« Error: API
      // POST /cart/… -> 400 … ») s'affichait telle quelle, en jargon et en
      // français, sur les fiches de toutes les langues.
      setError(messageAjoutRefuse(e, tr));
      setSaving(false);
    }
  }

  function handleBack() {
    // Étape 1 « Retour » : en édition on revient au panier ; en ajout on
    // ferme simplement la modale (reste sur la fiche produit).
    if (mode === "edit") {
      window.location.replace(versLePanier(lien(langue, "/commande"), lien(langue, "/panier")));
    } else if (props.onCancel) {
      props.onCancel();
    } else {
      window.location.href = avecStand(lien(langue, "/affiches"));
    }
  }

  return (
    <div>
      {/* Attente : l'ossature du configurateur (affiche + panneau). */}
      <Show when={data.loading}>
        <div
          class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,320px)]"
          aria-busy="true"
          aria-label={tr("cfg.chargement")}
        >
          <div class="ml-skeleton mx-auto aspect-[1/1.4142] w-full max-w-[280px]" />
          <div class="space-y-3">
            <div class="ml-skeleton h-7 w-40" />
            <div class="ml-skeleton h-10 w-full" />
            <div class="ml-skeleton h-10 w-full" />
            <div class="ml-skeleton h-24 w-full" />
          </div>
        </div>
      </Show>

      <Show when={data.error}>
        <p class="text-terracotta-deep">
          {tr("cfg.erreur")}
        </p>
      </Show>

      <Show when={data()}>
        {(d) => (
          <>
            <Show when={error()}>
              <p class="mb-4 rounded-lg bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
                {error()}
              </p>
            </Show>
            {/* L'affiche validée part au panier : un voile couvre la fenêtre
                et dit ce qui se passe, au milieu de l'écran. Ce n'était qu'un
                « … » gris tout en haut du panneau — hors de la vue de qui
                vient de toucher « Valider », en bas —, et l'on retouchait le
                bouton en croyant qu'il n'avait rien fait. */}
            <Show when={saving()}>
              <div class="ml-attente-voile" role="status">
                <p>
                  <span class="ml-spinner ml-spinner-clair" aria-hidden="true" />
                  {mode === "edit"
                    ? tr("cfg.enregistrement_en_cours")
                    : tr("produit.ajout_en_cours")}
                </p>
              </div>
            </Show>
            <Configurator
              // Le dictionnaire vit dans lib/messages-configurateur.ts (20/11) :
              // l'affiche tirée d'une photo ouvre le même module pour ses
              // personnages, et doit dire les mêmes mots.
              messages={messagesDuConfigurateur(tr, locale)}
              product={{
                id: props.product.id,
                name: props.product.name,
                basePriceCents: props.product.basePriceCents,
              }}
              backgrounds={d().backgrounds}
              cadres={d().cadres}
              pieceCategories={d().pieceCategories}
              nuanciersBase={d().nuanciersBase}
              characters={d().characters as never}
              slots={d().slots as never}
              prices={props.prices}
              sansPrix={props.sansPrix}
              sansPrixCadres={props.sansPrixCadres}
              apercuMur={props.apercuMur}
              foregroundUrl={props.foregroundUrl}
              vueMotifs={props.vueMotifs ?? null}
              couleursMotif={props.couleursMotif ?? null}
              defaults={props.defaults}
              initialConfig={props.initialConfig}
              assetBaseUrl={PUBLIC_API_URL}
              onSubmit={handleSubmit}
              onBack={handleBack}
            />
          </>
        )}
      </Show>
    </div>
  );
}
