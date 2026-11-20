/// <reference lib="dom" />
import { createResource, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Configurator } from "@memoryline/configurator";
import type { BackgroundDTO, PosterConfig } from "@memoryline/types";
import { PUBLIC_API_URL, browserApi } from "../lib/api.ts";

/**
 * « Créer une affiche » de BO › Affiches IA (20/11).
 *
 * Alexandra : « faut reprendre le configurateur mais le placer côté BO et
 * pouvoir direct imprimer l'affiche ou la DL à la fin ». L'image générée est
 * un décor nu (« juste les affiches sans texte sans personnages ») : on ouvre
 * donc le module de personnalisation COMPLET — personnages, tenues, couleurs,
 * textes, format — avec elle pour seul fond, exactement comme le client le
 * voit sur une fiche.
 *
 * La seule différence est à la fin : « Valider » ne met rien au panier. La
 * configuration part à l'API, qui rend le PDF d'impression avec le moteur
 * des commandes (apps/api/src/ia-reutiliser.ts) ; on le télécharge ou on
 * l'imprime d'ici.
 *
 * Tout ce qui est lu ici est réservé à la propriétaire : l'image en pleine
 * définition (/admin/ia/full) comme le PDF. Sans sa session, la page ne
 * montre qu'un fond absent et un refus.
 */
export interface AtelierAfficheProps {
  /** `publicId` de la génération (table ai_generation). */
  publicId: string;
}

/** L'adresse de l'API pour cette génération. */
function routeIa(publicId: string, suite: string): string {
  return `/admin/ia/${encodeURIComponent(publicId)}/${suite}`;
}

/** Dit au back-office de fermer sa fenêtre ; dans un onglet, le referme. */
function fermer(): void {
  if (window.parent !== window) {
    // Aucun contenu dans le message : l'origine du back-office n'a pas à
    // être connue ici, et rien ne fuit vers qui l'écouterait.
    window.parent.postMessage({ type: "ml-atelier-fermer" }, "*");
  } else {
    window.close();
  }
}

export default function AtelierAffiche(props: AtelierAfficheProps): JSX.Element {
  // Le fond : la pleine définition, servie au back-office seulement. Un
  // identifiant fixe (0) : le serveur ne le lit pas, il impose lui-même
  // l'image de la génération au moment du rendu.
  const fond: BackgroundDTO = {
    id: 0,
    url: `/admin/ia/full/${encodeURIComponent(props.publicId)}`,
    name: null,
    position: 0,
  };

  const [data] = createResource(async () => {
    const library = await browserApi.characters("fr");
    return {
      characters: library.characters,
      slots: library.slots,
      pieceCategories: library.pieceCategories ?? [],
      nuanciersBase: library.nuanciersBase,
    };
  });

  const [enCours, setEnCours] = createSignal(false);
  const [erreur, setErreur] = createSignal<string | null>(null);
  /** Le PDF fabriqué : son adresse locale (blob) et son nom de fichier. */
  const [pdf, setPdf] = createSignal<{ url: string; nom: string } | null>(null);

  function oublierPdf() {
    const p = pdf();
    if (p) URL.revokeObjectURL(p.url);
    setPdf(null);
  }
  onCleanup(oublierPdf);

  async function fabriquer(config: PosterConfig) {
    if (enCours()) return;
    setEnCours(true);
    setErreur(null);
    oublierPdf();
    try {
      const res = await fetch(`${PUBLIC_API_URL}${routeIa(props.publicId, "affiche.pdf")}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) {
        const corps = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          res.status === 401 || res.status === 403
            ? "Votre session du back-office a expiré : reconnectez-vous, puis rouvrez cette fenêtre."
            : (corps?.error ?? `Le PDF n'a pas pu être fabriqué (erreur ${res.status}).`),
        );
      }
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      setPdf({
        url: URL.createObjectURL(blob),
        nom: `affiche-${config.format ?? "A4"}-${date}.pdf`,
      });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  }

  /**
   * Imprimer : le PDF chargé dans un cadre caché, puis la boîte d'impression
   * du navigateur. Un navigateur qui refuse d'imprimer un PDF depuis un cadre
   * l'ouvre dans un onglet, où l'on imprime à la main.
   */
  function imprimer() {
    const p = pdf();
    if (!p) return;
    const cadre = document.createElement("iframe");
    cadre.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    cadre.src = p.url;
    cadre.onload = () => {
      try {
        cadre.contentWindow?.focus();
        cadre.contentWindow?.print();
      } catch {
        window.open(p.url, "_blank");
      }
      // Le cadre reste le temps de la boîte d'impression.
      setTimeout(() => cadre.remove(), 60_000);
    };
    document.body.appendChild(cadre);
  }

  return (
    <div class="mx-auto max-w-6xl px-4 py-4">
      <Show when={data.loading}>
        <p class="py-10 text-center text-ink-soft">Chargement du module…</p>
      </Show>
      <Show when={data.error}>
        <p class="py-10 text-center text-terracotta-deep">
          Le module de personnalisation n'a pas pu se charger. Fermez la fenêtre
          et réessayez.
        </p>
      </Show>

      <Show when={erreur()}>
        <p class="mb-4 rounded-lg bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
          {erreur()}
        </p>
      </Show>

      <Show when={enCours()}>
        <Portal>
          <div class="ml-attente-voile" role="status" style={{ "z-index": 2147483000 }}>
            <p>
              <span class="ml-spinner ml-spinner-clair" aria-hidden="true" />
              Fabrication du PDF d'impression…
            </p>
          </div>
        </Portal>
      </Show>

      {/* Le PDF est prêt : il passe devant le module, qui garde l'affiche
          derrière — « Modifier l'affiche » y revient telle quelle. Posé à la
          racine de la page (Portal) et au-dessus de tout : rangé dans le
          module, l'aperçu de l'affiche le recouvrait. */}
      <Show when={pdf()}>
        {(p) => (
          <Portal>
          <div
            class="fixed inset-0 flex items-center justify-center p-4"
            style={{ "z-index": 2147483000, background: "rgba(255, 255, 255, 0.85)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="atelier-pdf-titre"
          >
            <div class="w-full max-w-md bg-paper p-6 shadow-xl ring-1 ring-ink/10">
              <h2 id="atelier-pdf-titre" class="mb-2 text-xl">Le PDF est prêt</h2>
              <p class="mb-5 text-sm text-ink-soft">
                C'est le fichier d'impression, en haute définition, tel qu'il
                part chez l'imprimeur pour une commande.
              </p>
              <div class="flex flex-col gap-2">
                <a
                  href={p().url}
                  download={p().nom}
                  class="bg-ink px-4 py-3 text-center font-semibold text-paper hover:opacity-90"
                >
                  Télécharger le PDF
                </a>
                <button
                  type="button"
                  onClick={imprimer}
                  class="border border-ink px-4 py-3 font-semibold hover:bg-paper-deep"
                >
                  Imprimer
                </button>
                <button
                  type="button"
                  onClick={oublierPdf}
                  class="px-4 py-2 text-sm underline"
                >
                  Modifier l'affiche
                </button>
                <button type="button" onClick={fermer} class="px-4 py-2 text-sm underline">
                  Fermer
                </button>
              </div>
            </div>
          </div>
          </Portal>
        )}
      </Show>

      <Show when={data()}>
        {(d) => (
          <Configurator
            messages={{
              titre: "Composez l'affiche",
              // « Retour » garde son nom : il ramène à l'étape d'avant, et ne
              // ferme la fenêtre qu'à la première, comme sur le site.
              validerAffiche: "Fabriquer le PDF",
            }}
            product={{ id: 0, name: "Affiche", basePriceCents: 0 }}
            backgrounds={[fond]}
            // Ni cadre (il ne s'imprime pas), ni prix : rien n'est vendu ici.
            cadres={[]}
            sansPrix
            pieceCategories={d().pieceCategories}
            nuanciersBase={d().nuanciersBase}
            characters={d().characters as never}
            slots={d().slots as never}
            assetBaseUrl={PUBLIC_API_URL}
            onSubmit={fabriquer}
            onBack={fermer}
          />
        )}
      </Show>
    </div>
  );
}
