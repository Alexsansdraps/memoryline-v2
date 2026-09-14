/// <reference lib="dom" />
import { createSignal, onMount, Show, type JSX } from "solid-js";
import { ErreurSalon, getCartId, salonApi } from "../lib/api.ts";

/**
 * La dernière étape, au stand.
 *
 * Sur le site, on paie : adresse, livraison, carte bancaire. Au stand, le
 * client est devant la vendeuse et paie de la main à la main — il ne reste
 * qu'à savoir à qui appartient la commande, pour retrouver l'affiche à
 * l'impression et lui envoyer sa confirmation.
 *
 * Deux champs, donc, et rien d'autre. Tout ce qui précède — le catalogue, la
 * fiche, le configurateur, le panier — est celui de la boutique, aux montants
 * près. C'était le sens de la demande : une seule boutique, vue autrement,
 * plutôt que deux interfaces qui divergent en silence.
 *
 * LE CODE DU STAND N'EST PAS UN DÉTAIL. Le mode stand, lui, ne fait
 * qu'effacer des prix de l'écran : n'importe qui pourrait poser le cookie.
 * Ce qui autorise réellement à enregistrer une vente est ce code, vérifié par
 * l'API, et il voyage dans un EN-TÊTE — jamais dans l'adresse, où il
 * resterait dans l'historique d'une tablette qui passe de main en main.
 */

/** Le code du stand, retenu par la tablette : le retaper entre deux clients
 *  est intenable un jour de salon. */
const CLE_CODE = "ml_salon_code";

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
}

export default function CommandeStand(): JSX.Element {
  const [code, setCode] = createSignal<string | null>(null);
  const [saisieCode, setSaisieCode] = createSignal("");
  const [erreurCode, setErreurCode] = createSignal<string | null>(null);
  const [evenement, setEvenement] = createSignal<string | null>(null);

  const [nom, setNom] = createSignal("");
  const [courriel, setCourriel] = createSignal("");
  const [envoi, setEnvoi] = createSignal(false);
  const [erreur, setErreur] = createSignal<string | null>(null);
  const [numero, setNumero] = createSignal<string | null>(null);

  onMount(async () => {
    const retenu = codeMemorise();
    if (!retenu) return;
    // On vérifie le code retenu AVANT de s'en servir : un stand fermé depuis
    // hier, ou un code changé, se découvrirait sinon au pire moment — le
    // client devant soi, la commande déjà composée.
    try {
      const etat = await salonApi.etat(retenu);
      if (etat.ouvert) {
        setCode(retenu);
        setEvenement(etat.evenement ?? null);
      } else {
        oublierCode();
      }
    } catch {
      oublierCode();
    }
  });

  async function validerCode(e: Event) {
    e.preventDefault();
    const saisi = saisieCode().trim();
    if (!saisi) return;
    setErreurCode(null);
    try {
      const etat = await salonApi.etat(saisi);
      if (!etat.ouvert) {
        setErreurCode("Ce code ne correspond à aucun stand ouvert.");
        return;
      }
      retenirCode(saisi);
      setCode(saisi);
      setEvenement(etat.evenement ?? null);
    } catch {
      setErreurCode("Le stand n'a pas répondu. Réessayez.");
    }
  }

  async function valider(e: Event) {
    e.preventDefault();
    if (envoi()) return;
    const n = nom().trim();
    const m = courriel().trim();
    if (!n) {
      setErreur("Le nom est obligatoire.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) {
      setErreur("Adresse e-mail incomplète.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const commande = await salonApi.commander(code(), {
        cartId: getCartId(),
        name: n,
        email: m,
      });
      setNumero(commande.number);
    } catch (err) {
      if (err instanceof ErreurSalon && err.statut === 403) {
        // Stand refermé ou code changé en plein salon : le panier reste en
        // l'état, on redemande le code et la validation reprend.
        oublierCode();
        setCode(null);
        setErreurCode("Le stand a refusé le code. Saisissez-le à nouveau.");
      } else {
        setErreur(
          err instanceof ErreurSalon && err.message
            ? err.message
            : "La commande n'a pas pu être enregistrée.",
        );
      }
    } finally {
      setEnvoi(false);
    }
  }

  const CHAMP =
    "mt-1 w-full border border-ink/25 bg-paper px-4 py-3 text-lg outline-none focus:border-ink";
  const PRINCIPAL =
    "inline-flex items-center justify-center px-6 py-4 text-lg font-medium bg-ink text-paper hover:bg-ink/85 disabled:opacity-50";

  return (
    <div class="max-w-xl">
      <Show when={numero()}>
        <div class="border border-ink/15 bg-paper-deep p-8 text-center">
          <p class="text-2xl">Commande enregistrée</p>
          <p class="mt-3 text-4xl font-medium">{numero()}</p>
          <p class="mt-4 text-ink-soft">
            Le client recevra sa confirmation par e-mail. Notez ce numéro sur
            son bon si vous en remettez un.
          </p>
          <a
            href="/affiches?stand=1"
            class={`${PRINCIPAL} mt-8`}
            onClick={() => {
              // Chaque client a son panier : on repart à vide pour le suivant.
              try {
                localStorage.removeItem("ml_cart_id");
              } catch {
                /* rien à oublier */
              }
            }}
          >
            Client suivant
          </a>
        </div>
      </Show>

      <Show when={!numero() && !code()}>
        <form class="flex flex-col gap-4" onSubmit={validerCode}>
          <p class="text-ink-soft">
            Saisissez le code du stand pour enregistrer une vente.
          </p>
          <label class="block">
            <span class="text-sm font-medium">Code du stand</span>
            <input
              value={saisieCode()}
              onInput={(e) => setSaisieCode(e.currentTarget.value)}
              autocomplete="off"
              autocapitalize="characters"
              class={CHAMP}
            />
          </label>
          <Show when={erreurCode()}>
            <p class="text-terracotta-deep">{erreurCode()}</p>
          </Show>
          <button type="submit" class={PRINCIPAL}>
            Ouvrir le stand
          </button>
        </form>
      </Show>

      <Show when={!numero() && code()}>
        <form class="flex flex-col gap-5" onSubmit={valider}>
          <Show when={evenement()}>
            <p class="text-ink-soft">Stand : {evenement()}</p>
          </Show>
          <label class="block">
            <span class="text-sm font-medium">Nom du client</span>
            <input
              value={nom()}
              onInput={(e) => setNom(e.currentTarget.value)}
              autocomplete="off"
              class={CHAMP}
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium">Son adresse e-mail</span>
            <input
              type="email"
              value={courriel()}
              onInput={(e) => setCourriel(e.currentTarget.value)}
              autocomplete="off"
              inputmode="email"
              class={CHAMP}
            />
            <span class="mt-1 block text-sm text-ink-soft">
              C'est là qu'il recevra sa confirmation et, plus tard, son
              affiche prête.
            </span>
          </label>
          <Show when={erreur()}>
            <p class="text-terracotta-deep">{erreur()}</p>
          </Show>
          <button type="submit" class={PRINCIPAL} disabled={envoi()}>
            {envoi() ? "Enregistrement…" : "Enregistrer la commande"}
          </button>
          <p class="text-sm text-ink-soft">
            Aucun paiement n'est pris ici : le client règle sur place, comme
            d'habitude.
          </p>
        </form>
      </Show>
    </div>
  );
}
