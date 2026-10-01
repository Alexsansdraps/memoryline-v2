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
  /**
   * L'encart vidéo de l'étape 1, fabriqué par la fiche produit.
   *
   * Pur transit : aucune ligne à ajouter au bloc `messages={{…}}` ci-dessous,
   * c'est tout l'intérêt d'une fente. Le paquet réserve la place, la boutique
   * fournit le contenu déjà traduit.
   */
  encartVideo?: () => JSX.Element;
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
        ligne = await browserApi.updateCartItem(cartId, props.itemId, {
          config,
          unitPriceCents,
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
        });
      }
      // Le serveur a écrit la ligne sans son cadre (page ouverte avant que la
      // boutique ne les retire du site) : le panier le dit à la cliente.
      // Le panier dans la langue de la fiche, pas celui du français.
      const panier = lien(langue, "/panier");
      window.location.href = ligne.cadreRetire ? `${panier}?cadres=retires` : panier;
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  function handleBack() {
    // Étape 1 « Retour » : en édition on revient au panier ; en ajout on
    // ferme simplement la modale (reste sur la fiche produit).
    if (mode === "edit") {
      window.location.href = lien(langue, "/panier");
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
            <Show when={saving()}>
              <p class="mb-4 text-sm text-ink-soft">…</p>
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
                aideRetourLigne: tr("cfg.aide_retour_ligne"),
                ligneN: tr("cfg.ligne_n"),
                precedent: tr("cfg.precedent"),
                suivant: tr("cfg.suivant"),
                couleurPerso: tr("cfg.couleur_perso"),
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
                  spartan: tr("cfg.police.spartan"),
                  shabby: tr("cfg.police.shabby"),
                },
                libellesCouleursTexte: {
                  blanc: tr("cfg.couleur.blanc"),
                  anthracite: tr("cfg.couleur.anthracite"),
                },
                // Montants et dimensions à la manière de la langue de la page.
                locale,
                personnaliserPerso: tr("cfg.personnaliser_perso"),
              }}
              product={{
                id: props.product.id,
                name: props.product.name,
                basePriceCents: props.product.basePriceCents,
              }}
              backgrounds={d().backgrounds}
              cadres={d().cadres}
              pieceCategories={d().pieceCategories}
              characters={d().characters as never}
              slots={d().slots as never}
              prices={props.prices}
              sansPrix={props.sansPrix}
              foregroundUrl={props.foregroundUrl}
              defaults={props.defaults}
              initialConfig={props.initialConfig}
              assetBaseUrl={PUBLIC_API_URL}
              encartVideo={props.encartVideo}
              onSubmit={handleSubmit}
              onBack={handleBack}
            />
          </>
        )}
      </Show>
    </div>
  );
}
