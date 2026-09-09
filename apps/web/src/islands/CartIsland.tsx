/// <reference lib="dom" />
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
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

/**
 * Panier (§18.3). Lit ml_cart_id (localStorage), liste les lignes avec une
 * vignette d'aperçu, le prix et la quantité. Chaque ligne :
 *  - « Modifier » -> renvoie sur la fiche produit ?edit=ITEM_ID, qui rouvre le
 *    configurateur avec la config et fait un PUT (§18.3 I).
 *  - « Supprimer » -> DELETE.
 * Affiche le total et un bouton « Commander » vers /commande.
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

/** Ce que le panier a besoin de savoir d'un produit, au-delà de sa ligne. */
interface FicheLigne {
  slug: string | null;
  /** Le visuel de la boutique, seul aperçu possible d'une affiche non composée. */
  image: string | null;
  /** « personnalisable » ou « prete_a_imprimer ». */
  kind: string | null;
}

/**
 * Le catalogue, lu UNE fois par chargement de page.
 *
 * Chaque ligne du panier avait sa propre requête : cinq articles, cinq fois
 * cinq cents produits téléchargés. La promesse est mémorisée, pas son
 * résultat : deux lignes demandées en même temps partagent le même appel.
 */
let catalogueEnCours: Promise<Map<number, FicheLigne>> | null = null;
function catalogue(): Promise<Map<number, FicheLigne>> {
  if (!catalogueEnCours)
    catalogueEnCours = (async () => {
      const par = new Map<number, FicheLigne>();
      try {
        const res = await fetch(`${PUBLIC_API_URL}/products?limit=1000`);
        if (!res.ok) return par;
        const list = (await res.json()) as {
          id: number;
          slug: string;
          image: string | null;
          kind: string | null;
        }[];
        for (const p of list)
          par.set(p.id, {
            slug: p.slug,
            image: p.image ?? null,
            kind: p.kind ?? null,
          });
      } catch {
        /* catalogue injoignable : on retombe sur l'aperçu en calques */
      }
      return par;
    })();
  return catalogueEnCours;
}

export default function CartIsland(props: { langue?: Langue }): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
  const [busy, setBusy] = createSignal<number | null>(null);

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
      const regle = await browserApi.verifierCode(propre);
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
  // s'il n'est plus valable.
  if (codeSaisi()) void appliquerCode(codeSaisi(), true);

  const [cart, { refetch }] = createResource(async () => {
    const cartId = getCartId();
    const data = await browserApi.cart(cartId);
    // Le catalogue sert à deux choses : le lien « Modifier » et l'image des
    // affiches prêtes à imprimer.
    const fiches = await catalogue();
    return { items: data.items, fiches, poidsGrammes: data.poidsGrammes ?? 0 };
  });

  // Promos actives (ex. « 3 achetées = 1 A4 offerte »).
  const [promos] = createResource(async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/promos`);
      return res.ok ? ((await res.json()) as PromoRule[]) : [];
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
      return await browserApi.characters();
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
      return await browserApi.frames();
    } catch {
      return [];
    }
  });

  /**
   * Dimensions imprimées, en clair. Le client reconnaît « 21 × 29,7 cm »
   * mieux que « A4 » — c'est ce que faisait l'ancien site.
   */
  const DIMENSIONS: Record<string, string> = {
    A4: dimensionsFormat("A4"),
    A3: dimensionsFormat("A3"),
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
      `${tr("panier.format")} : ${format}${DIMENSIONS[format] ? ` (${DIMENSIONS[format]})` : ""}`,
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
      `${tr("panier.cadre")} : ${cadre ? cadre.name : tr("panier.sans_cadre")}`,
    );
    // lignesRemplies() lit aussi bien les trois lignes d'aujourd'hui que le
    // titre/sous-titre des paniers composés avant.
    const lignes = lignesRemplies(it.config.texts).map((b) => b.value);
    if (lignes.length) out.push(`« ${lignes.join(" — ")} »`);
    const n = it.config.characters?.length ?? 0;
    if (n > 0)
      out.push(
        `${n} ${n > 1 ? tr("panier.personnages") : tr("panier.personnage")}`,
      );
    return out;
  }

  /** Sous-total (somme des lignes, sans remise). */
  const subtotal = () =>
    (cart()?.items ?? []).reduce(
      (s, it) => s + it.unitPriceCents * it.quantity,
      0,
    );

  /** Lignes réduites à ce dont le moteur de remises a besoin. */
  const lignes = () =>
    (cart()?.items ?? []).map((it) => ({
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
      format: it.config.format ?? null,
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
      label: detail.map((d) => d.regle).join(" · "),
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
    return slug ? `/affiches/${slug}?edit=${it.id}` : null;
  }

  /**
   * Vrai pour une affiche vendue telle quelle.
   *
   * Le genre du produit fait foi. À défaut — catalogue injoignable, produit
   * disparu — on retombe sur ce que la ligne montre d'elle-même : ni fond ni
   * personnage, donc rien à composer.
   */
  function pretAImprimer(it: OrderItem): boolean {
    const genre =
      it.productId != null ? cart()?.fiches.get(it.productId)?.kind : null;
    if (genre) return genre === "prete_a_imprimer";
    return (
      !it.config.backgroundUrl && (it.config.characters?.length ?? 0) === 0
    );
  }

  /**
   * L'image à montrer quand la ligne n'a rien de composé.
   *
   * Une affiche prête à imprimer arrive au panier sans fond ni personnage :
   * l'aperçu en calques n'aurait rien à empiler. On lui rend son visuel de
   * boutique. Une affiche composée, elle, garde sa pile, même si le catalogue
   * n'est pas joignable.
   */
  function imageSeule(it: OrderItem): string | undefined {
    if (!pretAImprimer(it) || it.productId == null) return undefined;
    const image = cart()?.fiches.get(it.productId)?.image;
    // Le chemin stocké est relatif à l'API : c'est elle qui sert les visuels.
    return image ? urlAsset(PUBLIC_API_URL, image) : undefined;
  }

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
      });
      await refetch();
    } finally {
      setBusy(null);
    }
  }

  async function remove(it: OrderItem) {
    setBusy(it.id);
    try {
      await browserApi.deleteCartItem(getCartId(), it.id);
      await refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {/* Attente : un squelette aux dimensions des vraies lignes, pour que
          la page ne saute pas quand le contenu arrive. */}
      <Show when={cart.loading}>
        <div class="space-y-4" aria-busy="true" aria-label="Chargement du panier">
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
            href="/affiches"
            class="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-paper font-medium hover:bg-ink/85 transition-colors"
          >
            Découvrir les affiches
          </a>
        </div>
      </Show>

      <Show when={cart() && cart()!.items.length > 0}>
        {/* Trois colonnes comme sur une facture : ce qu'on achète, combien,
            pour quel montant. Sur mobile, la quantité et le total passent
            sous la description plutôt que de serrer trois colonnes. */}
        <div class="hidden sm:grid grid-cols-[1fr_auto_7rem] gap-4 border-b border-ink/15 pb-3 text-xs uppercase tracking-[0.08em] text-ink-soft">
          <span>{tr("panier.produit")}</span>
          <span class="text-center">{tr("panier.quantite")}</span>
          <span class="text-right">{tr("panier.total_ligne")}</span>
        </div>

        <ul>
          <For each={cart()!.items}>
            {(it) => {
              const href = editHref(it);
              return (
                <li class="grid gap-4 border-b border-ink/10 py-6 sm:grid-cols-[1fr_auto_7rem] sm:items-start">
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
                          style={{ "aspect-ratio": "1 / 1.4142" }}
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
                        {it.title ?? "Affiche personnalisée"}
                      </h2>
                      <p class="mt-1 text-sm">{formatPrice(it.unitPriceCents)}</p>
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

                  <div class="flex items-center gap-3 sm:justify-center">
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

                  <p class="font-medium sm:text-right">
                    {formatPrice(it.unitPriceCents * it.quantity)}
                  </p>
                </li>
              );
            }}
          </For>
        </ul>

        {/* Totaux, alignés à droite comme sur une facture. */}
        <div class="mt-8 flex justify-end">
          <div class="w-full max-w-sm text-right">
            <Show when={discount().amount > 0}>
              <div class="flex items-center justify-between text-sm text-ink-soft">
                <span>{tr("panier.sous_total")}</span>
                <span>{formatPrice(subtotal())}</span>
              </div>
              <div class="mt-1 flex items-center justify-between text-sm text-sage">
                <span>✨ {discount().label}</span>
                <span>− {formatPrice(discount().amount)}</span>
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
              <span class="text-2xl">{formatPrice(total())}</span>
            </div>
            <p class="mt-2 text-xs text-ink-soft">{tr("panier.taxes")}</p>
            {/* Le port se chiffre au tunnel, mais son ingrédient principal se
                lit déjà ici : même poids serveur qu'à l'étape suivante, donc
                jamais deux chiffres différents. */}
            <Show when={cart()!.poidsGrammes > 0}>
              <p class="mt-1 text-xs text-ink-soft">
                {tr("livraison.poids_colis")}{" "}
                {formaterPoids(cart()!.poidsGrammes)}
              </p>
            </Show>
            <a
              href="/commande"
              class="mt-4 block rounded-md bg-ink px-8 py-4 text-center font-medium text-paper hover:bg-ink-soft transition-colors"
            >
              {tr("panier.payer")}
            </a>
          </div>
        </div>
      </Show>
    </div>
  );
}
