/// <reference lib="dom" />
import {
  lien,
  t,
  LANGUE_DEFAUT,
  LOCALE_COMPLETE,
  type Langue,
} from "../i18n/utils.ts";
import {
  createEffect,
  createResource,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  PosterPreview,
  createSvgCache,
  stateFromConfig,
  SLOTS,
  findVariant,
  variantesDeVue,
} from "@memoryline/configurator";
import {
  dimensionsFormat,
  formaterPoids,
  lignesRemplies,
  remisesPanier,
  totalPanierCents,
  urlAsset,
  type PosterConfig,
  type RegleParier,
} from "@memoryline/types";
import {
  PUBLIC_API_URL,
  browserApi,
  formatPrice,
  getCartId,
  type OrderItem,
} from "../lib/api.ts";
import { apercuAbsolu, urlApercu } from "../lib/ia.ts";
// Le genre et le visuel de chaque produit (partagés avec la caisse), et son
// nom dans la langue de la page.
import {
  catalogue,
  estPretAImprimer,
  nomDeLaLigne,
  visuelBoutique,
} from "../lib/catalogue-panier.ts";
import CommandeStand, { ConfirmationStand, type VenteStand } from "./CommandeStand.tsx";

/**
 * Panier (§18.3). Lit ml_cart_id (localStorage), liste les lignes avec une
 * vignette d'aperçu, le prix et la quantité. Chaque ligne :
 *  - « Modifier » -> renvoie sur la fiche produit ?edit=ITEM_ID, qui rouvre le
 *    configurateur avec la config et fait un PUT (§18.3 I).
 *  - « Supprimer » -> DELETE.
 * Affiche le total et un bouton « Commander » vers /commande.
 *
 * Au stand, le même panier devient la DERNIÈRE ÉTAPE : récapitulatif sans un
 * montant, puis nom, adresse e-mail et « Valider mes affiches »
 * (CommandeStand.tsx). Toutes les lignes partent dans une seule commande.
 */

/** Règle de promo renvoyée par l'API /promos. */
interface PromoRule {
  id: number;
  name: string;
  type: string;
  config: unknown;
  code?: string | null;
  priority?: number;
}

/**
 * Code promo retenu entre le panier et le tunnel de commande.
 *
 * Il ne vaut RIEN par lui-même : le serveur revérifie le code au moment de
 * créer la commande et recalcule le montant. Ce qui est gardé ici n'est qu'un
 * confort — ne pas avoir à le retaper à l'étape suivante.
 */
export const CLE_CODE_PROMO = "ml_code_promo";
export function codePromoRetenu(): string {
  try {
    return localStorage.getItem(CLE_CODE_PROMO) ?? "";
  } catch {
    return "";
  }
}


export default function CartIsland(props: {
  langue?: Langue;
  /**
   * Au stand : aucun montant, ni par ligne, ni en total — et la validation
   * du stand à la place du paiement.
   *
   * Le panier reste le panier — mêmes articles, mêmes aperçus, mêmes
   * quantités. Les chiffres s'effacent, parce que la vendeuse annonce ses prix
   * de salon et qu'un total affiché la contredirait devant le client. Le code
   * promo, le poids du colis et « Procéder au paiement » disparaissent avec
   * eux : il n'y a ni remise à calculer, ni colis, ni paiement en ligne.
   *
   * Masquer le bloc des totaux cachait AUSSI le seul bouton qui menait plus
   * loin : le panier du stand était une impasse. La validation vit donc ici,
   * sous les affiches, et non sur une page de plus.
   */
  stand?: boolean;
}): JSX.Element {
  const langue = props.langue ?? LANGUE_DEFAUT;
  const tr = t(langue);
  /** Les montants s'écrivent à la manière de la langue de la page. */
  const locale = LOCALE_COMPLETE[langue];
  const [busy, setBusy] = createSignal<number | null>(null);
  /** La vente du stand, une fois enregistrée : elle remplace le panier à l'écran. */
  const [vente, setVente] = createSignal<VenteStand | null>(null);

  // Code promo : celui déjà saisi est repris, et revérifié à l'affichage —
  // un code peut avoir expiré depuis la dernière visite.
  const [codeSaisi, setCodeSaisi] = createSignal(codePromoRetenu());
  const [codeApplique, setCodeApplique] = createSignal<PromoRule | null>(null);
  const [codeEtat, setCodeEtat] = createSignal<"repos" | "envoi" | "refuse">(
    "repos",
  );

  async function appliquerCode(code: string, silencieux = false) {
    const propre = code.trim();
    if (!propre) return;
    setCodeEtat("envoi");
    try {
      // Dans la langue de la page : le nom de la règle s'écrit sur la ligne
      // de remise.
      const regle = await browserApi.verifierCode(propre, langue);
      setCodeApplique({ id: 0, ...regle } as PromoRule);
      setCodeEtat("repos");
      try {
        localStorage.setItem(CLE_CODE_PROMO, regle.code);
      } catch {
        // Stockage refusé (navigation privée) : le code reste valable pour
        // cette page, il faudra le ressaisir au tunnel.
      }
    } catch {
      setCodeApplique(null);
      setCodeEtat(silencieux ? "repos" : "refuse");
      if (silencieux) oublierCode();
    }
  }

  function oublierCode() {
    setCodeApplique(null);
    setCodeSaisi("");
    setCodeEtat("repos");
    try {
      localStorage.removeItem(CLE_CODE_PROMO);
    } catch {
      // rien à faire : sans stockage, il n'y avait rien à oublier
    }
  }

  // Reprise d'un code d'une visite précédente, sans rien reprocher au client
  // s'il n'est plus valable. Pas au stand : aucune remise ne s'y affiche.
  if (!props.stand && codeSaisi()) void appliquerCode(codeSaisi(), true);

  /**
   * Des cadres ont quitté le panier parce que le site ne les propose plus.
   *
   * Deux chemins y mènent : un panier rempli avant que la boutique ne les
   * retire, nettoyé ci-dessous à l'ouverture ; une affiche validée dans une
   * page restée ouverte, que le serveur a écrite sans cadre et que le
   * configurateur envoie ici avec « ?cadres=retires ». Le message reste le
   * temps de la page : c'est ici que la cliente voit son nouveau montant.
   */
  const [cadresRetires, setCadresRetires] = createSignal(false);
  try {
    const adresse = new URL(window.location.href);
    if (adresse.searchParams.get("cadres") === "retires") {
      setCadresRetires(true);
      // Retiré de l'adresse : un rechargement ne doit pas redire ce qui a
      // déjà été dit.
      adresse.searchParams.delete("cadres");
      history.replaceState(history.state, "", adresse.pathname + adresse.search + adresse.hash);
    }
  } catch {
    /* adresse illisible : pas de message, le panier reste juste */
  }

  const [cart, { refetch }] = createResource(async () => {
    const cartId = getCartId();
    let data = await browserApi.cart(cartId);
    // Le serveur compte les cadres que le site ne propose plus (jamais au
    // stand) ; c'est l'ouverture du panier qui les retire, pour que le retrait
    // se VOIE — la pastille de l'en-tête lit le même panier sans y toucher.
    if ((data.cadresHorsSite ?? 0) > 0) {
      // Un échec ici ne doit pas cacher le panier : la caisse retire de
      // toute façon ces cadres avant de compter quoi que ce soit.
      const { retires } = await browserApi
        .retirerCadres(cartId)
        .catch(() => ({ retires: 0 }));
      if (retires > 0) {
        setCadresRetires(true);
        data = await browserApi.cart(cartId);
      }
    }
    // Le catalogue sert à trois choses : le lien « Modifier », l'image des
    // affiches prêtes à imprimer, et le nom de chaque affiche dans la langue
    // de la page (nomDeLaLigne).
    const fiches = await catalogue(langue);
    return { items: data.items, fiches, poidsGrammes: data.poidsGrammes ?? 0 };
  });

  // Promos actives (ex. « 3 achetées = 1 A4 offerte »), leur nom dans la
  // langue de la page : c'est lui que la ligne de remise affiche.
  const [promos] = createResource(async () => {
    try {
      return await browserApi.promos<PromoRule>(langue);
    } catch {
      return [];
    }
  });

  /**
   * Bibliothèque de personnages, chargée UNE fois pour tout le panier : sans
   * elle, l'aperçu ne saurait pas dessiner les personnages composés.
   */
  const [biblio] = createResource(async () => {
    try {
      return await browserApi.characters(props.langue);
    } catch {
      return null;
    }
  });
  const { cache, fetchSvg } = createSvgCache(PUBLIC_API_URL);
  const personnageParId = (id: string | number) =>
    biblio()?.characters.find((c) => String(c.id) === String(id));

  /**
   * Précharge les SVG de chaque ligne : base du personnage et variantes
   * réellement choisies. Sans ce préchargement, l'aperçu resterait vide.
   */
  createEffect(() => {
    const lib = biblio();
    if (!lib) return;
    for (const ligne of cart()?.items ?? []) {
      for (const perso of ligne.config.characters ?? []) {
        const base = personnageParId(perso.typeId);
        if (!base) continue;
        void fetchSvg(base.baseSvgUrl);
        const jeu = variantesDeVue(lib.slots, base.orientation);
        for (const slot of SLOTS) {
          const v = findVariant(jeu[slot], perso.assets?.[slot]);
          if (v) void fetchSvg(v.svgUrl);
        }
      }
    }
  });

  /**
   * Cadres du catalogue : la configuration ne garde que l'identifiant du
   * cadre choisi, il faut le catalogue pour l'écrire en toutes lettres.
   */
  const [cadres] = createResource(async () => {
    try {
      return await browserApi.frames(props.langue);
    } catch {
      return [];
    }
  });

  /**
   * Dimensions imprimées, en clair. Le client reconnaît « 21 × 29,7 cm »
   * mieux que « A4 » — c'est ce que faisait l'ancien site.
   */
  const DIMENSIONS: Record<string, string> = {
    A4: dimensionsFormat("A4", locale),
    A3: dimensionsFormat("A3", locale),
  };

  /**
   * Ce qu'il y a dans l'affiche, en phrases lisibles. L'ancien site déversait
   * ici le JSON de la configuration : illisible, et il donnait à voir des
   * URLs et des identifiants internes.
   */
  function details(it: OrderItem): string[] {
    const out: string[] = [];
    const format = it.config.format ?? "A4";
    out.push(
      `${tr("panier.format")}${tr("ponct.deux_points")}${format}${DIMENSIONS[format] ? ` (${DIMENSIONS[format]})` : ""}`,
    );
    // Une affiche IA n'a ni cadre, ni texte, ni personnages : lui lister des
    // rubriques vides ne dirait rien au client.
    if (it.config.aiPublicId) {
      out.push(tr("panier.affiche_ia"));
      return out;
    }
    const cadre = (cadres() ?? []).find(
      (c) => String(c.id) === String(it.config.frameId),
    );
    out.push(
      `${tr("panier.cadre")}${tr("ponct.deux_points")}${cadre ? cadre.name : tr("panier.sans_cadre")}`,
    );
    // lignesRemplies() lit aussi bien les trois lignes d'aujourd'hui que le
    // titre/sous-titre des paniers composés avant.
    const lignes = lignesRemplies(it.config.texts).map((b) => b.value);
    // Remplacement par une fonction : un « $ » tapé par le client sur son
    // affiche serait sinon lu comme un motif de remplacement.
    if (lignes.length)
      out.push(
        tr("ponct.guillemets").replace("{texte}", () => lignes.join(" — ")),
      );
    const n = it.config.characters?.length ?? 0;
    if (n > 0)
      out.push(
        `${n} ${n > 1 ? tr("panier.personnages") : tr("panier.personnage")}`,
      );
    return out;
  }

  /** Le nombre d'affiches, exemplaires compris : « mon affiche » ou « mes affiches ». */
  const exemplaires = () =>
    (cart()?.items ?? []).reduce((s, it) => s + it.quantity, 0);

  /** La vente du stand est faite : la confirmation prend toute la place. */
  function venteEnregistree(v: VenteStand) {
    setVente(v);
    // La pastille de l'en-tête compte encore le panier servi : on lui dit
    // qu'il est clos (CartBadge.tsx), sinon elle annoncerait ses affiches
    // au client suivant.
    window.dispatchEvent(new Event("ml:panier"));
    window.scrollTo({ top: 0 });
  }

  /** Sous-total (somme des lignes, sans remise). */
  const subtotal = () =>
    (cart()?.items ?? []).reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );

  /**
   * Lignes réduites à ce dont le moteur de remises a besoin — la part du
   * cadre comprise, dite par le serveur : une affiche offerte « cadre non
   * compris » se déduit sans son cadre, ici comme à l'encaissement.
   */
  const lignes = () =>
    (cart()?.items ?? []).map((it) => ({
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
      format: it.config.format ?? null,
      cadreCents: it.cadreCents ?? 0,
    }));

  /**
   * Remises — calculées par le moteur PARTAGÉ (@memoryline/types), le même que
   * l'API utilise pour le montant réellement encaissé. Ce qui est affiché ici
   * ne peut donc plus diverger de ce qui sera débité.
   */
  /** Promotions automatiques + celle du code saisi, s'il y en a un. */
  const reglesEnJeu = (): PromoRule[] => {
    const auto = promos() ?? [];
    const c = codeApplique();
    return c ? [...auto, c] : auto;
  };
  const codes = () => {
    const c = codeApplique();
    return c?.code ? [c.code] : [];
  };

  const discount = (): { amount: number; label: string } => {
    const { remiseCents, detail } = remisesPanier(
      lignes(),
      reglesEnJeu(),
      new Date(),
      codes(),
    );
    return {
      amount: remiseCents,
      // Le nom des promotions, dans la langue de la page : la boutique les
      // traduit au back-office, et l'API retombe sur le français quand elle
      // ne l'a pas fait. « Remise » ne sert plus que faute de règle du tout.
      label: detail.length
        ? detail.map((d) => d.regle).join(" · ")
        : tr("compte.commande.remise"),
    };
  };

  const total = () =>
    totalPanierCents(lignes(), reglesEnJeu(), new Date(), codes());

  function editHref(it: OrderItem): string | null {
    // Une affiche IA ne se « modifie » pas : on en regénère une autre depuis la
    // fiche produit. Proposer « Modifier » ouvrirait un configurateur qui n'a
    // rien à éditer.
    if (it.config.aiPublicId) return null;
    // Une affiche prête à imprimer ne se compose pas : « Modifier » ouvrirait
    // un configurateur vide, et la cliente y perdrait son temps.
    if (pretAImprimer(it)) return null;
    const slug =
      it.productId != null ? cart()?.fiches.get(it.productId)?.slug : null;
    return slug ? `${lien(langue, `/affiches/${slug}`)}?edit=${it.id}` : null;
  }

  /** Vrai pour une affiche vendue telle quelle (cf. lib/catalogue-panier). */
  const pretAImprimer = (it: OrderItem): boolean =>
    estPretAImprimer(cart()?.fiches, it);

  /** Le visuel de la boutique d'une ligne non composée (cf. lib/catalogue-panier). */
  const imageSeule = (it: OrderItem): string | undefined =>
    visuelBoutique(cart()?.fiches, it);

  /**
   * Change la quantité d'une ligne. On repasse la configuration telle quelle :
   * le serveur recalcule le prix unitaire lui-même, le navigateur n'a jamais
   * son mot à dire sur un montant.
   */
  async function setQuantite(it: OrderItem, quantite: number) {
    const q = Math.max(1, Math.min(99, quantite));
    if (q === it.quantity) return;
    setBusy(it.id);
    try {
      await browserApi.updateCartItem(getCartId(), it.id, {
        config: it.config,
        quantity: q,
        langue,
      });
      await refetch();
      // La pastille de l'en-tête compte les exemplaires : elle doit suivre
      // (CartBadge.tsx, recette du 17/11).
      window.dispatchEvent(new Event("ml:panier"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(it: OrderItem) {
    setBusy(it.id);
    try {
      await browserApi.deleteCartItem(getCartId(), it.id);
      await refetch();
      window.dispatchEvent(new Event("ml:panier"));
    } finally {
      setBusy(null);
    }
  }

  /*
   * Les colonnes d'une ligne : ce qu'on achète, combien, pour quel montant.
   * Au stand, la colonne du montant n'existe pas — une colonne vide laissait
   * un trou à droite de chaque affiche.
   *
   * Et sur la tablette tenue en portrait (768 à 1023 px), la liste n'a que la
   * moitié gauche, le formulaire tient l'autre : la quantité passe sous la
   * description, comme sur un téléphone. Restée à droite, elle laissait 75 px
   * au texte — le titre coupé en deux, « Format : A4 (21 × 29,7 cm) » sur
   * trois lignes.
   */
  const COLONNES = props.stand
    ? "sm:grid-cols-[1fr_auto] md:max-lg:grid-cols-1"
    : "sm:grid-cols-[1fr_auto_7rem]";

  return (
    <>
    <Show when={vente()}>
      {(v) => <ConfirmationStand langue={langue} vente={v()} />}
    </Show>
    <Show when={!vente()}>
    <div>
      {/* Au stand, le titre vit dans l'îlot : il s'efface avec le panier quand
          la vente est enregistrée, et « Ajouter une autre affiche » ne reste
          pas affiché au-dessus d'une commande close. */}
      <Show when={props.stand}>
        <div class="mt-4 mb-6 flex flex-wrap items-baseline justify-between gap-4">
          <h1 class="text-3xl sm:text-4xl">{tr("stand.titre")}</h1>
          <a
            href={lien(langue, "/affiches")}
            class="border border-ink px-5 py-3 font-medium hover:bg-ink hover:text-paper transition-colors"
          >
            {tr("stand.ajouter")}
          </a>
        </div>
      </Show>

      {/* Attente : un squelette aux dimensions des vraies lignes, pour que
          la page ne saute pas quand le contenu arrive. */}
      <Show when={cart.loading}>
        <div class="space-y-4" aria-busy="true" aria-label={tr("panier.chargement")}>
          <For each={[0, 1]}>
            {() => (
              <div class="flex gap-4 rounded-2xl border border-ink/10 p-4">
                <div class="ml-skeleton h-28 w-20 shrink-0" />
                <div class="flex-1 space-y-3 py-1">
                  <div class="ml-skeleton h-4 w-2/3" />
                  <div class="ml-skeleton h-4 w-1/4" />
                  <div class="ml-skeleton h-8 w-32" />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={cart.error}>
        <p class="text-terracotta-deep">
          {tr("panier.erreur")} ({PUBLIC_API_URL}).
        </p>
      </Show>

      <Show when={cart() && cart()!.items.length === 0}>
        <div class="rounded-2xl border border-ink/10 bg-paper-deep/40 p-10 text-center">
          <p class="text-ink-soft">{tr("panier.vide")}</p>
          <a
            href={lien(langue, "/affiches")}
            class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
          >
            {tr("accueil.cta")}
          </a>
        </div>
      </Show>

      <Show when={cart() && cart()!.items.length > 0}>
        <Show when={cadresRetires()}>
          <p
            role="status"
            class="mb-6 rounded-lg border border-ink/15 bg-paper-deep/40 px-4 py-3 text-sm"
          >
            {tr("panier.cadres_retires")}
          </p>
        </Show>
        {/* Au stand, sur la tablette : les affiches à gauche, la validation
            à droite. Empilées, elles faisaient défiler la page, et « Valider
            mon affiche » tombait sous le bord de l'écran — devant un client
            qui attend, il faut tout voir d'un coup. Sur le site, rien ne
            change : les totaux et le paiement suivent la liste. */}
        <div
          class={
            props.stand
              ? "md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-10"
              : ""
          }
        >
        <div>
        {/* Trois colonnes comme sur une facture : ce qu'on achète, combien,
            pour quel montant. Sur mobile, la quantité et le total passent
            sous la description plutôt que de serrer trois colonnes. */}
        <div
          class={`hidden sm:grid ${COLONNES} ${props.stand ? "md:max-lg:hidden" : ""} gap-4 border-b border-ink/15 pb-3 text-xs uppercase tracking-[0.08em] text-ink-soft`}
        >
          <span>{tr("panier.produit")}</span>
          <span class="text-center">{tr("panier.quantite")}</span>
          <Show when={!props.stand}>
            <span class="text-right">{tr("panier.total_ligne")}</span>
          </Show>
        </div>

        <ul>
          <For each={cart()!.items}>
            {(it) => {
              const href = editHref(it);
              return (
                <li class={`grid gap-4 border-b border-ink/10 py-6 ${COLONNES} sm:items-start`}>
                  <div class="flex gap-4 min-w-0">
                    <div class="ml-panier-vignette w-20 shrink-0 sm:w-24">
                      {/* Affiche IA : le visuel n'est pas une pile de calques
                          mais l'image générée, dont l'aperçu arrive déjà
                          filigrané — le filigrane y est cuit dans les pixels,
                          donc plus solide que la couche SVG du site. */}
                      <Show
                        when={it.config.aiPublicId}
                        fallback={
                      <Show
                        when={imageSeule(it)}
                        fallback={
                      <Show
                        when={biblio()}
                        fallback={<div class="ml-skeleton aspect-[1/1.4142] w-full" />}
                      >
                        <PosterPreview
                          state={stateFromConfig(it.config)}
                          characterById={personnageParId}
                          slots={biblio()!.slots}
                          cache={cache}
                          assetBaseUrl={PUBLIC_API_URL}
                          messages={{ exempleAffiche: tr("cfg.exemple_affiche") }}
                          foregroundUrl={
                            // Le décor est enregistré dans la configuration au
                            // moment de l'ajout au panier. Les lignes ajoutées
                            // AVANT que le décor devienne une donnée du type
                            // n'en ont pas : pour elles, la vue de dos vaut
                            // toujours muret, sinon leur aperçu changerait.
                            urlAsset(
                              PUBLIC_API_URL,
                              it.config.foregroundUrl ||
                                (it.config.view === "back"
                                  ? "/assets/muret_officiel.svg"
                                  : ""),
                            ) || undefined
                          }
                        />
                      </Show>
                        }
                      >
                        {(image) => (
                          <img
                            src={image()}
                            alt=""
                            loading="lazy"
                            class="w-full rounded object-cover"
                            style={{ "aspect-ratio": "1 / 1.4142" }}
                          />
                        )}
                      </Show>
                        }
                      >
                        <div
                          class="relative w-full overflow-hidden bg-paper-deep"
                          /* LA FEUILLE, DANS SON VRAI SENS, et non un portrait
                             d'office : une création en paysage — le sens se
                             déduit de la photo — se retrouvait réduite au
                             milieu d'une vignette en portrait, entre deux
                             bandes vides. Même ternaire qu'AfficheIA, qui
                             montre déjà la création dans son sens. */
                          style={{
                            "aspect-ratio":
                              it.config.orientation === "paysage"
                                ? "1.4142 / 1"
                                : "1 / 1.4142",
                          }}
                        >
                          <img
                            src={apercuAbsolu(
                              it.config.aiApercuUrl ||
                                urlApercu(it.config.aiPublicId!),
                            )}
                            alt=""
                            class="absolute inset-0 h-full w-full object-contain"
                            onError={(e) => {
                              // Aperçu introuvable (route IA absente, fichier
                              // effacé) : on laisse le cadre vide plutôt que
                              // l'icône d'image cassée du navigateur.
                              e.currentTarget.hidden = true;
                            }}
                          />
                        </div>
                      </Show>
                    </div>

                    <div class="min-w-0">
                      <h2 class="text-lg leading-tight">
                        {nomDeLaLigne(cart()?.fiches, it) ??
                          tr("panier.affiche_sans_titre")}
                      </h2>
                      <Show when={!props.stand}>
                        <p class="mt-1 text-sm">
                          {formatPrice(it.unitPriceCents, locale)}
                        </p>
                      </Show>
                      <ul class="mt-2 space-y-0.5 text-sm text-ink-soft">
                        <For each={details(it)}>{(d) => <li>{d}</li>}</For>
                      </ul>
                      <Show when={href}>
                        <a
                          href={href!}
                          class="mt-2 inline-block text-sm underline underline-offset-4 hover:text-terracotta transition-colors"
                        >
                          {tr("panier.modifier")}
                        </a>
                      </Show>
                    </div>
                  </div>

                  <div
                    class={`flex items-center gap-3 sm:justify-center ${props.stand ? "md:max-lg:justify-start" : ""}`}
                  >
                    <div class="inline-flex items-center rounded-md border border-ink/20">
                      <button
                        type="button"
                        onClick={() => setQuantite(it, it.quantity - 1)}
                        disabled={busy() === it.id || it.quantity <= 1}
                        aria-label={tr("panier.moins")}
                        class="px-3 py-2 text-lg leading-none hover:bg-paper-deep disabled:opacity-40 transition-colors"
                      >
                        −
                      </button>
                      <span class="w-10 text-center tabular-nums">
                        {it.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantite(it, it.quantity + 1)}
                        disabled={busy() === it.id}
                        aria-label={tr("panier.plus")}
                        class="px-3 py-2 text-lg leading-none hover:bg-paper-deep disabled:opacity-40 transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(it)}
                      disabled={busy() === it.id}
                      aria-label={tr("panier.retirer_ligne")}
                      title={tr("panier.supprimer")}
                      class="rounded-md p-2 text-ink-soft hover:text-terracotta-deep disabled:opacity-40 transition-colors"
                    >
                      {/* Corbeille : le geste est assez courant pour se passer
                          de mot, mais il garde son intitulé pour les lecteurs
                          d'écran et au survol. */}
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </div>

                  <Show when={!props.stand}>
                    <p class="font-medium sm:text-right">
                      {formatPrice(it.unitPriceCents * it.quantity, locale)}
                    </p>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
        </div>

        {/* Au stand : la validation, à la place des totaux et du paiement.
            Elle reste à l'écran quand plusieurs affiches font défiler la
            liste — SOUS l'en-tête, collant lui aussi et haut de 80 px : à
            `top-6`, le nom passait derrière lui dès le premier défilement. */}
        <Show when={props.stand}>
          <div class="mt-10 md:sticky md:top-24 md:mt-0">
            <CommandeStand
              langue={langue}
              nombre={exemplaires()}
              occupe={busy() !== null}
              onEnregistree={venteEnregistree}
            />
          </div>
        </Show>
        </div>

        {/* Totaux, alignés à droite comme sur une facture. */}
        <Show when={!props.stand}>
        <div class="mt-8 flex justify-end">
          <div class="w-full max-w-sm text-right">
            <Show when={discount().amount > 0}>
              <div class="flex items-center justify-between text-sm text-ink-soft">
                <span>{tr("panier.sous_total")}</span>
                <span>{formatPrice(subtotal(), locale)}</span>
              </div>
              <div class="mt-1 flex items-center justify-between text-sm text-sage">
                <span>✨ {discount().label}</span>
                <span>− {formatPrice(discount().amount, locale)}</span>
              </div>
            </Show>
            {/* Code promo : un champ, un bouton, et la remise se voit tout
                de suite dans le total au-dessus. */}
            <div class="mt-4 text-left">
              <Show
                when={!codeApplique()}
                fallback={
                  <p class="flex items-center justify-between gap-3 text-sm">
                    <span class="text-sage">
                      {tr("panier.code_applique")} {codeApplique()!.code}
                    </span>
                    <button
                      type="button"
                      onClick={oublierCode}
                      class="text-ink-soft underline underline-offset-4 hover:text-ink"
                    >
                      {tr("panier.code_retirer")}
                    </button>
                  </p>
                }
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void appliquerCode(codeSaisi());
                  }}
                  class="flex items-stretch gap-2"
                >
                  <label class="sr-only" for="ml-code-promo">
                    {tr("panier.code")}
                  </label>
                  <input
                    id="ml-code-promo"
                    value={codeSaisi()}
                    onInput={(e) => {
                      setCodeSaisi(e.currentTarget.value);
                      if (codeEtat() === "refuse") setCodeEtat("repos");
                    }}
                    placeholder={tr("panier.code")}
                    autocomplete="off"
                    class="min-w-0 flex-1 border border-ink/20 px-3 py-2 outline-none focus:border-ink"
                  />
                  <button
                    type="submit"
                    disabled={codeEtat() === "envoi" || !codeSaisi().trim()}
                    class="border border-ink px-4 py-2 font-medium hover:bg-ink hover:text-paper disabled:opacity-40 transition-colors"
                  >
                    {tr("panier.code_appliquer")}
                  </button>
                </form>
                <Show when={codeEtat() === "refuse"}>
                  <p class="mt-2 text-sm text-terracotta-deep">
                    {tr("panier.code_refuse")}
                  </p>
                </Show>
              </Show>
            </div>

            <div class="mt-3 flex items-center justify-end gap-4">
              <span class="text-ink-soft">{tr("panier.total_estime")}</span>
              <span class="text-2xl">{formatPrice(total(), locale)}</span>
            </div>
            <p class="mt-2 text-xs text-ink-soft">{tr("panier.taxes")}</p>
            {/* Le port se chiffre au tunnel, mais son ingrédient principal se
                lit déjà ici : même poids serveur qu'à l'étape suivante, donc
                jamais deux chiffres différents. */}
            <Show when={cart()!.poidsGrammes > 0}>
              <p class="mt-1 text-xs text-ink-soft">
                {tr("livraison.poids_colis")}{" "}
                {formaterPoids(cart()!.poidsGrammes, locale)}
              </p>
            </Show>
            <a
              href={lien(langue, "/commande")}
              class="mt-4 block rounded-md bg-ink px-8 py-4 text-center font-medium text-paper hover:bg-ink-soft transition-colors"
            >
              {tr("panier.payer")}
            </a>
          </div>
        </div>
        </Show>
      </Show>
    </div>
    </Show>
    </>
  );
}
