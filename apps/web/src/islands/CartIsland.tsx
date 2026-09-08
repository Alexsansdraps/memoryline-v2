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

/** Slug du produit pour reconstruire le lien « Modifier ». */
async function slugForProduct(
  productId: number | null,
): Promise<string | null> {
  if (productId == null) return null;
  try {
    const res = await fetch(`${PUBLIC_API_URL}/products?limit=500`);
    if (!res.ok) return null;
    const list = (await res.json()) as { id: number; slug: string }[];
    return list.find((p) => p.id === productId)?.slug ?? null;
  } catch {
    return null;
  }
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
    // On résout les slugs en parallèle pour les liens « Modifier ».
    const slugs = new Map<number, string | null>();
    await Promise.all(
      [...new Set(data.items.map((i) => i.productId))].map(async (pid) => {
        if (pid != null) slugs.set(pid, await slugForProduct(pid));
      }),
    );
    return { items: data.items, slugs };
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
    A4: "21 × 29,7 cm",
    A3: "29,7 × 42 cm",
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
    const cadre = (cadres() ?? []).find(
      (c) => String(c.id) === String(it.config.frameId),
    );
    out.push(
      `${tr("panier.cadre")} : ${cadre ? cadre.name : tr("panier.sans_cadre")}`,
    );
    const titre = it.config.texts?.title?.value;
    const sousTitre = it.config.texts?.subtitle?.value;
    if (titre) out.push(sousTitre ? `« ${titre} — ${sousTitre} »` : `« ${titre} »`);
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
    const slug = it.productId != null ? cart()?.slugs.get(it.productId) : null;
    return slug ? `/affiches/${slug}?edit=${it.id}` : null;
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
                      {/* L'aperçu du configurateur, à l'identique : fond,
                          personnages et textes tels que le client les a
                          composés. Même composant des deux côtés, donc les
                          deux rendus ne peuvent pas diverger. */}
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
