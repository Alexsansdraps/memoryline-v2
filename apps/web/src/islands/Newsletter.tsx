/// <reference lib="dom" />
import { createSignal, Show, type JSX } from "solid-js";
import type { Langue } from "../i18n/utils.ts";
import { PUBLIC_API_URL } from "../lib/api-navigateur.ts";

/** Les quatre textes du formulaire, déjà traduits (clés « lettre.* »). */
export interface TextesLettre {
  email: string;
  envoyer: string;
  merci: string;
  erreur: string;
}

/**
 * Inscription à la lettre d'information.
 *
 * Le champ ne promet rien qu'il ne tienne : l'adresse part vraiment en base
 * (POST /newsletter) et la liste se relit au back-office. Une adresse déjà
 * inscrite obtient la même réponse qu'une nouvelle — dire « vous êtes déjà
 * inscrit » révélerait qui figure dans la liste.
 *
 * Ses textes arrivent tout traduits (index.astro), et l'adresse de l'API
 * vient de api-navigateur.ts : quatre phrases ne justifient pas d'embarquer
 * le dictionnaire des cinq langues et la validation des affiches, 209 Ko de
 * JavaScript que l'accueil n'utilise nulle part ailleurs (CartBadge.tsx).
 * Aucun import de valeur depuis i18n ici — le type `Langue` s'efface à la
 * construction.
 */
export default function Newsletter(props: {
  langue?: Langue;
  textes: TextesLettre;
}): JSX.Element {
  const tr = (cle: keyof TextesLettre) => props.textes[cle];
  const [email, setEmail] = createSignal("");
  const [etat, setEtat] = createSignal<"repos" | "envoi" | "ok" | "erreur">(
    "repos",
  );

  async function envoyer(e: Event) {
    e.preventDefault();
    if (etat() === "envoi") return;
    setEtat("envoi");
    try {
      const res = await fetch(`${PUBLIC_API_URL}/newsletter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email().trim(),
          // Le français à défaut, comme LANGUE_DEFAUT — écrit en clair pour
          // ne rien importer de i18n (voir plus haut).
          langue: props.langue ?? "fr",
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setEmail("");
      setEtat("ok");
    } catch {
      setEtat("erreur");
    }
  }

  return (
    <form onSubmit={envoyer} class="mx-auto mt-6 max-w-md">
      <div class="flex items-stretch border border-ink/30 focus-within:border-ink transition-colors">
        <label class="sr-only" for="ml-newsletter">
          {tr("email")}
        </label>
        <input
          id="ml-newsletter"
          type="email"
          required
          value={email()}
          onInput={(e) => {
            setEmail(e.currentTarget.value);
            if (etat() !== "repos") setEtat("repos");
          }}
          placeholder={tr("email")}
          autocomplete="email"
          class="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none"
        />
        <button
          type="submit"
          disabled={etat() === "envoi"}
          aria-label={tr("envoyer")}
          class="px-5 text-ink-soft hover:text-ink disabled:opacity-50 transition-colors"
        >
          {/* Une flèche, comme sur la boutique : le champ dit déjà de quoi
              il s'agit, un mot de plus alourdirait. */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <Show when={etat() === "ok"}>
        <p class="mt-3 text-sm text-sage">{tr("merci")}</p>
      </Show>
      <Show when={etat() === "erreur"}>
        <p class="mt-3 text-sm text-terracotta-deep">{tr("erreur")}</p>
      </Show>
    </form>
  );
}
