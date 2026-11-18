/// <reference lib="dom" />
import type { CleUi } from "../i18n/utils.ts";
import { createSignal, For, Show, type JSX } from "solid-js";
import { ajouterAuPanier, getCartId, versLePanier } from "../lib/api-navigateur.ts";

/**
 * Le choix du montant d'une carte cadeau, et son ajout au panier (17/11).
 *
 * Un montant LIBRE, 5 € au moins, en euros ronds : quatre montants proposés
 * d'un clic, ou un autre tapé au clavier. Le serveur revérifie les bornes à
 * l'ajout et au paiement, et le montant devient le prix de la ligne ; rien de
 * ce qui est choisi ici ne peut fixer un prix à sa place.
 *
 * Léger, comme le bouton des affiches prêtes à imprimer : ses mots arrivent
 * traduits par la page, et l'ajout passe par le module léger du navigateur.
 */
export const LIBELLES_CARTE = [
  "carte.page.montant",
  "carte.page.autre",
  "carte.page.ajouter",
  "carte.page.ajout",
  "carte.page.montant_invalide",
  "carte.page.montant_trop",
  "carte.page.erreur",
  "carte.page.stand",
] as const satisfies readonly CleUi[];

/**
 * Les montants proposés d'un clic, tant que la page n'en donne pas d'autres :
 * ils se règlent au BO (18/11, Contenu du site › Carte cadeau).
 */
const MONTANTS = [20, 30, 50, 100];
/**
 * 5 € au moins ; pas de plafond annoncé (18/11). MIN et MAX sont ceux du
 * serveur (CARTE_MONTANT_MIN_CENTS et CARTE_MONTANT_MAX_CENTS de
 * @memoryline/types, écrits ici pour garder l'îlot léger) ; MAX n'est que le
 * garde-fou contre des zéros de trop.
 */
const MIN = 5;
const MAX = 10_000;

export default function CarteCadeauIsland(props: {
  langue: string;
  /** « fr-FR », « en-GB »… : les montants s'écrivent à la manière de la langue. */
  locale: string;
  libelles: Record<(typeof LIBELLES_CARTE)[number], string>;
  /** Les montants proposés d'un clic, réglés au BO (montantsProposes). */
  montants?: number[];
  /** La caisse (le panier du site) et le panier du stand, dans la langue de la page. */
  adresseCommande: string;
  adressePanier: string;
  /** Au stand, la carte ne se vend pas : la page le dit, sans bouton. */
  stand?: boolean;
}): JSX.Element {
  const l = props.libelles;
  const montants = props.montants?.length ? props.montants : MONTANTS;
  // Celui du milieu, choisi d'avance (50 € parmi 20, 30, 50, 100).
  const [euros, setEuros] = createSignal<number>(montants[Math.floor(montants.length / 2)]!);
  const [autre, setAutre] = createSignal("");
  const [occupe, setOccupe] = createSignal(false);
  const [erreur, setErreur] = createSignal<string | null>(null);

  /** Le montant retenu : un montant proposé, ou celui tapé (euros ronds). */
  const montant = (): number | null => {
    const tape = autre().trim();
    if (!tape) return euros();
    if (!/^\d{1,6}$/.test(tape)) return null;
    const n = Number(tape);
    return n >= MIN && n <= MAX ? n : null;
  };
  // Des euros ronds : « 25 € », pas « 25,00 € ».
  const enEuros = (n: number) =>
    new Intl.NumberFormat(props.locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  async function ajouter(e: Event) {
    e.preventDefault();
    const m = montant();
    if (m === null) {
      setErreur(l["carte.page.montant_invalide"]);
      return;
    }
    setOccupe(true);
    setErreur(null);
    try {
      await ajouterAuPanier(getCartId(), {
        carteCadeau: { montantCents: m * 100 },
        langue: props.langue,
      });
      // La pastille de l'en-tête compte les articles.
      window.dispatchEvent(new Event("ml:panier"));
      window.location.href = versLePanier(props.adresseCommande, props.adressePanier);
    } catch (err) {
      setErreur(
        /montant_carte/.test(String(err)) ? l["carte.page.montant_invalide"] : l["carte.page.erreur"],
      );
      setOccupe(false);
    }
  }

  return (
    <Show
      when={!props.stand}
      fallback={
        <p class="rounded-lg border border-ink/15 bg-paper-deep/40 px-4 py-3 text-ink-soft">
          {l["carte.page.stand"]}
        </p>
      }
    >
      <form onSubmit={ajouter} class="space-y-5">
        <fieldset>
          <legend class="text-sm font-medium">{l["carte.page.montant"]}</legend>
          <div class="mt-2 flex flex-wrap gap-2">
            <For each={montants}>
              {(m) => (
                <button
                  type="button"
                  onClick={() => {
                    setEuros(m);
                    setAutre("");
                    setErreur(null);
                  }}
                  aria-pressed={!autre().trim() && euros() === m}
                  class={`rounded-full border px-5 py-2 font-medium transition-colors ${
                    !autre().trim() && euros() === m
                      ? "border-ink bg-ink text-paper"
                      : "border-ink/25 hover:border-ink"
                  }`}
                >
                  {enEuros(m)}
                </button>
              )}
            </For>
          </div>
          <label class="mt-4 block max-w-xs">
            <span class="text-sm text-ink-soft">{l["carte.page.autre"]}</span>
            <span class="mt-1 flex items-center gap-2">
              <input
                type="number"
                inputmode="numeric"
                min={MIN}
                max={MAX}
                step="1"
                value={autre()}
                onInput={(e) => {
                  setAutre(e.currentTarget.value);
                  setErreur(null);
                }}
                class="w-32 rounded-lg border border-ink/20 bg-paper px-4 py-3 focus:border-terracotta focus:outline-none"
              />
              <span aria-hidden="true">€</span>
            </span>
            {/* Plus de phrase sur les bornes (18/11) : un mot seulement quand
                le montant tapé ne va pas, au lieu d'un bouton grisé muet. */}
            <Show when={autre().trim() !== "" && montant() === null}>
              <span class="mt-1 block text-xs text-terracotta-deep" role="status">
                {/^\d+$/.test(autre().trim()) && Number(autre().trim()) > MAX
                  ? l["carte.page.montant_trop"]
                  : l["carte.page.montant_invalide"]}
              </span>
            </Show>
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={occupe() || montant() === null}
          aria-busy={occupe()}
          class="w-full rounded-full bg-terracotta px-8 py-4 font-medium text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {occupe() ? (
            <>
              <span class="ml-spinner ml-spinner-clair mr-2" aria-hidden="true" />
              {l["carte.page.ajout"]}
            </>
          ) : (
            l["carte.page.ajouter"].replace("{montant}", () =>
              montant() === null ? "—" : enEuros(montant()!),
            )
          )}
        </button>
        <Show when={erreur()}>
          <p role="alert" class="text-sm text-terracotta-deep">
            {erreur()}
          </p>
        </Show>
      </form>
    </Show>
  );
}
