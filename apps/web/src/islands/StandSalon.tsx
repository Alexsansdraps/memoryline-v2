/// <reference lib="dom" />
import {
  createSignal,
  For,
  Show,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import type { PosterConfig } from "@memoryline/types";
import {
  ErreurSalon,
  assetUrl,
  browserApi,
  getCartId,
  nouveauCartId,
  salonApi,
  type OrderItem,
  type Product,
  type ProductDetail,
} from "../lib/api.ts";
import ConfiguratorIsland from "./ConfiguratorIsland.tsx";

/**
 * Stand de salon — la tablette posée sur la table, devant un client qui a
 * déjà son porte-monnaie à la main.
 *
 * Ce n'est pas la boutique : AUCUN montant n'apparaît (le tarif du stand n'est
 * pas celui du site et c'est la vendeuse qui l'annonce de vive voix), il n'y a
 * ni adresse de livraison ni paiement en ligne — le client repart avec son
 * affiche et règle sur place. Tout tient en gros boutons : la vendeuse
 * enchaîne les clients debout, elle ne vise pas.
 *
 * Les prix continuent d'être CALCULÉS et enregistrés en base : la boutique
 * doit savoir ce qu'elle a vendu. Seul l'affichage change.
 */

type Ecran =
  | "chargement"
  | "ferme"
  | "code"
  | "catalogue"
  | "affiche"
  | "validation"
  | "confirmation";

/** Le code du stand est retenu par la TABLETTE : le retaper entre deux
 *  clients est intenable un jour de salon. */
const CLE_CODE = "ml_salon_code";

/** Nom d'affiche sans le suffixe commercial, comme dans la boutique. */
function nomCourt(nom: string): string {
  return nom.replace(/\s*[-–]\s*Affiche.*$/i, "");
}

export default function StandSalon(): JSX.Element {
  const [ecran, setEcran] = createSignal<Ecran>("chargement");
  const [evenement, setEvenement] = createSignal<string | null>(null);
  const [code, setCode] = createSignal<string | null>(null);
  const [saisieCode, setSaisieCode] = createSignal("");
  const [erreurCode, setErreurCode] = createSignal<string | null>(null);

  const [produits, setProduits] = createSignal<Product[]>([]);
  const [recherche, setRecherche] = createSignal("");
  const [erreurCatalogue, setErreurCatalogue] = createSignal<string | null>(
    null,
  );
  const [chargementAffiche, setChargementAffiche] = createSignal(false);
  const [affiche, setAffiche] = createSignal<ProductDetail | null>(null);

  const [articles, setArticles] = createSignal<OrderItem[]>([]);
  const [nom, setNom] = createSignal("");
  const [courriel, setCourriel] = createSignal("");
  const [envoi, setEnvoi] = createSignal(false);
  const [erreurCommande, setErreurCommande] = createSignal<string | null>(null);
  const [numero, setNumero] = createSignal<string | null>(null);

  /* ----------------------------- le code --------------------------------- */

  function codeMemorise(): string | null {
    try {
      return localStorage.getItem(CLE_CODE);
    } catch {
      return null;
    }
  }
  function retenirCode(valeur: string) {
    try {
      localStorage.setItem(CLE_CODE, valeur);
    } catch {
      /* navigation privée : le stand marche, il faudra retaper le code */
    }
  }
  function oublierCode() {
    try {
      localStorage.removeItem(CLE_CODE);
    } catch {
      /* rien à oublier */
    }
    setCode(null);
  }

  /**
   * Interroge le stand et choisit l'écran. `aRetenir` distingue un code qu'on
   * vient de taper (à mémoriser s'il est bon) du code déjà mémorisé.
   */
  async function verifier(saisi: string | null, aRetenir = false) {
    try {
      const etat = await salonApi.etat(saisi);
      setEvenement(etat.evenement);
      if (!etat.ouvert) {
        setEcran("ferme");
        return;
      }
      if (!etat.autorise) {
        // Un code mémorisé devenu faux (changé entre deux salons) est effacé :
        // sinon la tablette réessaie indéfiniment le mauvais.
        if (!aRetenir) oublierCode();
        setErreurCode(saisi ? "Code refusé." : null);
        setEcran("code");
        return;
      }
      setCode(saisi);
      setErreurCode(null);
      if (aRetenir && saisi) retenirCode(saisi);
      void chargerCatalogue();
      // Une commande en cours (code redemandé en plein parcours) survit : on
      // ne repart d'un panier vide que s'il n'y a rien à conserver.
      if (articles().length > 0) {
        setEcran("validation");
        return;
      }
      commencerCommande();
      setEcran("catalogue");
    } catch {
      setErreurCode("Stand injoignable. Réessayez.");
      setEcran("code");
    }
  }

  function soumettreCode(e: Event) {
    e.preventDefault();
    const saisi = saisieCode().trim();
    if (!saisi) return;
    setSaisieCode("");
    setEcran("chargement");
    void verifier(saisi, true);
  }

  onMount(() => {
    // L'adresse copiée depuis le back-office porte « ?code=XXXXXX » : on le
    // lit, on le garde, et on l'ôte aussitôt de la barre d'adresse — un code
    // qui reste affiché devant le client n'est plus un code.
    const params = new URLSearchParams(window.location.search);
    const parAdresse = params.get("code")?.trim();
    if (parAdresse) {
      try {
        localStorage.setItem(CLE_CODE, parAdresse);
      } catch {
        /* sans stockage, le code ne tiendra que le temps de la page */
      }
      window.history.replaceState(null, "", window.location.pathname);
    }
    void verifier(codeMemorise());
    // Le stand peut s'ouvrir pendant que la tablette affiche « fermé ». On
    // revérifie en silence : personne ne pense à recharger une page sur un
    // salon.
    const minuteur = setInterval(() => {
      if (ecran() === "ferme") void verifier(codeMemorise());
    }, 30_000);
    onCleanup(() => clearInterval(minuteur));
  });

  /* ---------------------------- le catalogue ----------------------------- */

  async function chargerCatalogue() {
    if (produits().length > 0) return;
    try {
      setProduits(await browserApi.produits());
    } catch {
      setErreurCatalogue("Catalogue indisponible.");
    }
  }

  const produitsVisibles = (): Product[] => {
    const q = recherche().trim().toLowerCase();
    if (!q) return produits();
    return produits().filter((p) =>
      nomCourt(p.name).toLowerCase().includes(q),
    );
  };

  /** Prix retenu pour le panier : le plus bas des variantes, comme la fiche
   *  produit de la boutique. Calculé, jamais montré. */
  function prixDeBase(detail: ProductDetail): number {
    const prix = detail.variants.map((v) => v.priceCents).filter((c) => c > 0);
    return prix.length ? Math.min(...prix) : detail.basePriceCents;
  }

  async function choisirAffiche(p: Product) {
    if (chargementAffiche()) return;
    setChargementAffiche(true);
    setErreurCatalogue(null);
    try {
      const detail = await browserApi.produit(p.slug);
      if (detail.aiEnabled) {
        setErreurCatalogue(
          "Cette affiche se compose à partir d'une photo : elle ne se vend pas sur le stand.",
        );
        return;
      }
      if (detail.kind !== "personnalisable") {
        await ajouterTelleQuelle(detail);
        return;
      }
      setAffiche(detail);
      setEcran("affiche");
    } catch {
      setErreurCatalogue("Affiche indisponible. Réessayez.");
    } finally {
      setChargementAffiche(false);
    }
  }

  /** Affiche prête à imprimer : rien à composer, elle rejoint directement la
   *  commande — même contenu minimal que la boutique. */
  async function ajouterTelleQuelle(detail: ProductDetail) {
    const config: PosterConfig = {
      schemaVersion: 1,
      view: detail.defaultView || "front",
      texts: {},
      characters: [],
    };
    const item = await browserApi.addCartItem(getCartId(), {
      productId: detail.id,
      unitPriceCents: prixDeBase(detail),
      quantity: 1,
      title: nomCourt(detail.name),
      config,
    });
    ajouterArticle(item);
  }

  /* ----------------------------- la commande ----------------------------- */

  /** Un client, une commande : chaque commande part d'un panier vide. */
  function commencerCommande() {
    nouveauCartId();
    setArticles([]);
    setNom("");
    setCourriel("");
    setNumero(null);
    setErreurCommande(null);
    setRecherche("");
  }

  function ajouterArticle(item: OrderItem) {
    setArticles([...articles(), item]);
    setAffiche(null);
    setEcran("validation");
  }

  async function retirerArticle(item: OrderItem) {
    try {
      await browserApi.deleteCartItem(getCartId(), item.id);
    } catch {
      // Ligne déjà partie : l'écran doit se remettre à jour quand même, sinon
      // la vendeuse reste devant un article qu'elle ne peut plus retirer.
    }
    const reste = articles().filter((a) => a.id !== item.id);
    setArticles(reste);
    if (reste.length === 0) setEcran("catalogue");
  }

  /**
   * Le client change d'avis, ou s'en va : on repart de zéro.
   *
   * Le panier est VIDÉ, pas seulement abandonné — laissé en l'état il
   * resterait en base avec ses lignes, et la boutique compterait des commandes
   * en attente qui n'ont jamais existé.
   */
  async function toutAnnuler() {
    const panier = getCartId();
    await Promise.all(
      articles().map((a) =>
        browserApi.deleteCartItem(panier, a.id).catch(() => undefined),
      ),
    );
    commencerCommande();
    setEcran("catalogue");
  }

  async function valider(e: Event) {
    e.preventDefault();
    if (envoi()) return;
    const n = nom().trim();
    const m = courriel().trim();
    if (!n) {
      setErreurCommande("Le nom est obligatoire.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) {
      setErreurCommande("Adresse e-mail incomplète.");
      return;
    }
    setEnvoi(true);
    setErreurCommande(null);
    try {
      const commande = await salonApi.commander(code(), {
        cartId: getCartId(),
        name: n,
        email: m,
      });
      setNumero(commande.number);
      setEcran("confirmation");
    } catch (err) {
      if (err instanceof ErreurSalon && err.statut === 403) {
        // Stand refermé ou code changé en plein salon : le panier reste en
        // l'état, on redemande le code et le parcours reprend à la validation.
        oublierCode();
        setErreurCode("Le stand a refusé le code. Saisissez-le à nouveau.");
        setEcran("code");
      } else {
        setErreurCommande(
          err instanceof ErreurSalon && err.message
            ? err.message
            : "La commande n'a pas pu être enregistrée.",
        );
      }
    } finally {
      setEnvoi(false);
    }
  }

  /* ------------------------------- rendu --------------------------------- */

  const BOUTON =
    "inline-flex items-center justify-center gap-2 px-6 py-4 text-lg font-medium transition-colors disabled:opacity-50";
  const PRINCIPAL = `${BOUTON} bg-ink text-paper hover:bg-ink/85`;
  const SECONDAIRE = `${BOUTON} border border-ink/25 text-ink hover:border-ink`;
  const CHAMP =
    "w-full border border-ink/25 bg-paper px-5 py-4 text-2xl outline-none focus:border-ink";

  return (
    <div class="min-h-screen bg-paper text-ink">
      <Show when={ecran() === "chargement"}>
        <p class="flex min-h-screen items-center justify-center text-2xl text-ink-soft">
          <span class="ml-spinner mr-3" aria-hidden="true" />
          Un instant…
        </p>
      </Show>

      {/* Stand fermé : un mur, et rien d'autre. Pas de code demandé, pas de
          catalogue — il n'y a rien à prendre. */}
      <Show when={ecran() === "ferme"}>
        <main class="flex min-h-screen flex-col items-center justify-center px-8 text-center">
          <h1 class="text-5xl sm:text-6xl">Le stand est fermé</h1>
        </main>
      </Show>

      <Show when={ecran() === "code"}>
        <main class="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-8">
          {/* Rien sur l'événement ni sur le catalogue tant que le code n'est
              pas bon : cette page s'ouvre depuis n'importe quel navigateur. */}
          <h1 class="text-4xl">Code du stand</h1>
          <form class="flex flex-col gap-5" onSubmit={soumettreCode}>
            <input
              type="password"
              inputmode="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              class={CHAMP}
              aria-label="Code du stand"
              value={saisieCode()}
              onInput={(e) => setSaisieCode(e.currentTarget.value)}
            />
            <button type="submit" class={`${PRINCIPAL} py-5 text-xl`}>
              Ouvrir le stand
            </button>
          </form>
          <Show when={erreurCode()}>
            <p class="text-lg text-terracotta-deep">{erreurCode()}</p>
          </Show>
        </main>
      </Show>

      <Show
        when={
          ecran() === "catalogue" ||
          ecran() === "affiche" ||
          ecran() === "validation"
        }
      >
        <header class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 bg-paper px-5 py-3">
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-[0.2em] text-ink-soft">
              Stand
            </p>
            <p class="truncate text-xl">{evenement() ?? "Memory Line"}</p>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Show when={ecran() !== "catalogue"}>
              <button
                type="button"
                class={SECONDAIRE}
                onClick={() => setEcran("catalogue")}
              >
                {ecran() === "validation" ? "Ajouter une affiche" : "Catalogue"}
              </button>
            </Show>
            <Show when={ecran() === "catalogue" && articles().length > 0}>
              <button
                type="button"
                class={PRINCIPAL}
                onClick={() => setEcran("validation")}
              >
                Voir la commande ({articles().length})
              </button>
            </Show>
            <Show when={articles().length > 0}>
              <button
                type="button"
                class={SECONDAIRE}
                onClick={() => void toutAnnuler()}
              >
                Tout annuler
              </button>
            </Show>
            <Show when={articles().length === 0}>
              <button
                type="button"
                class={SECONDAIRE}
                onClick={() => {
                  oublierCode();
                  setSaisieCode("");
                  setErreurCode(null);
                  setEcran("code");
                }}
              >
                Verrouiller
              </button>
            </Show>
          </div>
        </header>
      </Show>

      <Show when={ecran() === "catalogue"}>
        <main class="mx-auto w-full max-w-[1400px] px-5 py-5">
          <input
            type="search"
            class={`${CHAMP} mb-5`}
            placeholder="Chercher une affiche…"
            aria-label="Chercher une affiche"
            value={recherche()}
            onInput={(e) => setRecherche(e.currentTarget.value)}
          />
          <Show when={erreurCatalogue()}>
            <p class="mb-4 bg-terracotta/10 px-5 py-4 text-lg text-terracotta-deep">
              {erreurCatalogue()}
            </p>
          </Show>
          <Show
            when={produits().length > 0}
            fallback={
              <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>
                  {() => (
                    <div
                      class="ml-skeleton w-full"
                      style="aspect-ratio:1020/1400"
                    />
                  )}
                </For>
              </div>
            }
          >
            <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <For each={produitsVisibles()}>
                {(p) => (
                  <li>
                    {/* Vignette entière cliquable : sur une tablette, on pose
                        le doigt sur l'affiche, on ne vise pas un lien. */}
                    <button
                      type="button"
                      class="block w-full text-left disabled:opacity-50"
                      disabled={chargementAffiche()}
                      onClick={() => void choisirAffiche(p)}
                    >
                      <div
                        class="flex items-center justify-center overflow-hidden bg-paper-deep"
                        style="aspect-ratio:1020/1400"
                      >
                        <Show
                          when={assetUrl(p.image)}
                          fallback={
                            <span class="px-3 text-center text-lg text-ink-soft">
                              {nomCourt(p.name)}
                            </span>
                          }
                        >
                          {(src) => (
                            <img
                              src={src()}
                              alt=""
                              loading="lazy"
                              class="h-full w-full object-cover"
                            />
                          )}
                        </Show>
                      </div>
                      <p class="mt-2 text-lg leading-tight">
                        {nomCourt(p.name)}
                      </p>
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={produitsVisibles().length === 0}>
              <p class="py-10 text-center text-xl text-ink-soft">
                Aucune affiche à ce nom.
              </p>
            </Show>
          </Show>
        </main>
      </Show>

      <Show when={ecran() === "affiche"}>
        {/* Le filigrane reste sur l'aperçu : la commande n'est pas payée. */}
        <main class="mx-auto w-full max-w-[1400px] px-5 py-5">
          <Show when={affiche()}>
            {(detail) => (
              <>
                <h1 class="mb-4 text-2xl">{nomCourt(detail().name)}</h1>
                <ConfiguratorIsland
                  sansPrix
                  product={{
                    id: detail().id,
                    name: nomCourt(detail().name),
                    basePriceCents: prixDeBase(detail()),
                  }}
                  prices={Object.fromEntries(
                    detail().variants.map((v) => [v.format, v.priceCents]),
                  )}
                  foregroundUrl={detail().foregroundUrl ?? null}
                  defaults={{
                    lignes: [
                      detail().defaultTitle ?? null,
                      detail().defaultSubtitle ?? null,
                      detail().defaultLine3 ?? null,
                    ],
                    view: detail().defaultView ?? null,
                  }}
                  mode="add"
                  onAjoute={ajouterArticle}
                  onCancel={() => setEcran("catalogue")}
                />
              </>
            )}
          </Show>
        </main>
      </Show>

      <Show when={ecran() === "validation"}>
        <main class="mx-auto w-full max-w-2xl px-6 py-6">
          <h1 class="text-3xl">Commande</h1>
          <ul class="mt-4 divide-y divide-ink/10 border-y border-ink/10">
            <For each={articles()}>
              {(item) => (
                <li class="flex items-center justify-between gap-4 py-4">
                  <span class="text-xl">{item.title ?? "Affiche"}</span>
                  <button
                    type="button"
                    class={SECONDAIRE}
                    onClick={() => void retirerArticle(item)}
                  >
                    Retirer
                  </button>
                </li>
              )}
            </For>
          </ul>

          {/* Nom et adresse e-mail, rien d'autre : le client repart avec son
              affiche et règle sur place — pas d'adresse de livraison, pas de
              paiement en ligne. */}
          <form class="mt-8 flex flex-col gap-5" onSubmit={valider}>
            <label class="flex flex-col gap-2">
              <span class="text-lg">Nom</span>
              <input
                type="text"
                class={CHAMP}
                autocomplete="off"
                aria-label="Nom"
                value={nom()}
                onInput={(e) => setNom(e.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-2">
              <span class="text-lg">Adresse e-mail</span>
              <input
                type="email"
                inputmode="email"
                class={CHAMP}
                autocomplete="off"
                aria-label="Adresse e-mail"
                autocapitalize="off"
                spellcheck={false}
                value={courriel()}
                onInput={(e) => setCourriel(e.currentTarget.value)}
              />
            </label>
            <Show when={erreurCommande()}>
              <p class="bg-terracotta/10 px-5 py-4 text-lg text-terracotta-deep">
                {erreurCommande()}
              </p>
            </Show>
            <button
              type="submit"
              class={`${PRINCIPAL} py-6 text-2xl`}
              disabled={envoi() || articles().length === 0}
            >
              {envoi() ? "…" : "Valider la commande"}
            </button>
          </form>
        </main>
      </Show>

      {/* Confirmation : c'est l'écran que la vendeuse regarde en tendant
          l'affiche. Le numéro se lit à bout de bras, le reste s'efface. */}
      <Show when={ecran() === "confirmation"}>
        <main class="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
          <p class="text-2xl text-ink-soft">Commande enregistrée</p>
          <p class="text-7xl leading-none tracking-tight sm:text-8xl">
            {numero()}
          </p>
          <p class="text-2xl">{nom()}</p>
          <button
            type="button"
            class={`${PRINCIPAL} px-10 py-6 text-2xl`}
            onClick={() => {
              commencerCommande();
              setEcran("catalogue");
            }}
          >
            Commande suivante
          </button>
        </main>
      </Show>
    </div>
  );
}
