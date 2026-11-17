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
  browserApi,
  getCartId,
  type OrderItem,
} from "../lib/api.ts";
import { messageAjoutRefuse } from "../lib/ajout-panier.ts";

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
      // snapshot pour que le PDF d'impression le rende aussi.
      if (props.foregroundUrl) config = { ...config, foregroundUrl: props.foregroundUrl };
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
      const panier = lien(langue, "/panier");
      // replace : l'entrée « fenêtre ouverte » de la fiche (ProductConfigurator)
      // ne reste pas dans l'historique, « précédent » depuis le panier
      // revient en un appui sur la fiche.
      window.location.replace(ligne.cadreRetire ? `${panier}?cadres=retires` : panier);
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
      window.location.replace(lien(langue, "/panier"));
    } else if (props.onCancel) {
      props.onCancel();
    } else {
      window.location.href = lien(langue, "/affiches");
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
              messages={{
                titre: tr("cfg.titre"),
                etapeFond: tr("cfg.etape.fond"),
                etapePersonnages: tr("cfg.etape.personnages"),
                etapeFormat: tr("cfg.etape.format"),
                champsLignes: [
                  tr("cfg.ligne1_champ"),
                  tr("cfg.ligne2_champ"),
                  tr("cfg.ligne3_champ"),
                ],
                exemplesLignes: [
                  tr("cfg.ligne1_exemple"),
                  tr("cfg.ligne2_exemple"),
                  tr("cfg.ligne3_exemple"),
                ],
                // Le compteur d'exemplaires se tient sur la fiche produit, pas
                // ici : ces trois libellés ne s'affichent donc nulle part
                // aujourd'hui. On les passe quand même, parce que `messages`
                // est un dictionnaire PARTIEL — une clé qu'on oublie retombe
                // sur le français du paquet, dans les cinq langues. Le jour où
                // le module reprend son compteur, rien n'est à traduire.
                quantite: tr("cfg.quantite"),
                quantiteMoins: tr("cfg.quantite_moins"),
                quantitePlus: tr("cfg.quantite_plus"),
                couleurTexte: tr("cfg.couleur_texte"),
                choisirFond: tr("cfg.fond"),
                personnages: tr("cfg.personnages"),
                nouveauPersonnage: tr("cfg.nouveau_perso"),
                modifier: tr("cfg.modifier"),
                retirer: tr("cfg.retirer"),
                monter: tr("cfg.monter"),
                descendre: tr("cfg.descendre"),
                retour: tr("cfg.retour"),
                continuer: tr("cfg.continuer"),
                validerAffiche: tr("cfg.valider_affiche"),
                validerPersonnage: tr("cfg.valider_perso"),
                personnalisation: tr("cfg.personnalisation"),
                choixPersonnage: tr("cfg.choix_perso"),
                choixCouleur: tr("cfg.choix_couleur"),
                vetements: tr("cfg.vetements"),
                pantalon: tr("cfg.pantalon"),
                coupes: tr("cfg.coupes"),
                accessoires: tr("cfg.accessoires"),
                aucun: tr("cfg.aucun"),
                cadre: tr("cfg.cadre"),
                sansCadre: tr("cfg.sans_cadre"),
                reordonnerAide: tr("cfg.reordonner_aide"),
                dupliquer: tr("cfg.dupliquer"),
                ligneN: tr("cfg.ligne_n"),
                precedent: tr("cfg.precedent"),
                suivant: tr("cfg.suivant"),
                defilerHaut: tr("defiler.haut"),
                defilerBas: tr("defiler.bas"),
                couleurPerso: tr("cfg.couleur_perso"),
                remettreCouleurs: tr("cfg.remettre_couleurs"),
                remettreCouleursDe: tr("cfg.remettre_couleurs_de"),
                couleurActuelle: tr("cfg.couleur_actuelle"),
                autres: tr("cfg.autres"),
                personnageN: tr("cfg.personnage_n"),
                personnage: tr("cfg.personnage"),
                deplacerAide: tr("cfg.deplacer_aide"),
                exempleAffiche: tr("cfg.exemple_affiche"),
                apercuCadre: tr("cfg.apercu_cadre"),
                apercuCadreSansNom: tr("cfg.apercu_cadre_sans_nom"),
                // Seules les polices et couleurs proposées aujourd'hui : une
                // police absente d'ici garde son nom français.
                libellesPolices: {
                  serif: tr("cfg.police.serif"),
                  abril: tr("cfg.police.abril"),
                  shabby: tr("cfg.police.shabby"),
                },
                libellesCouleursTexte: {
                  blanc: tr("cfg.couleur.blanc"),
                  anthracite: tr("cfg.couleur.anthracite"),
                },
                // Montants et dimensions à la manière de la langue de la page.
                locale,
                personnaliserPerso: tr("cfg.personnaliser_perso"),
                plusBas: tr("cfg.plus_bas"),
                partieCouleurs: tr("cfg.partie.couleurs"),
                partieVetements: tr("cfg.partie.vetements"),
                partieCheveux: tr("cfg.partie.cheveux"),
                partieAccessoires: tr("cfg.partie.accessoires"),
              }}
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
              foregroundUrl={props.foregroundUrl}
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
