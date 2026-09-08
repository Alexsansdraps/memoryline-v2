/// <reference lib="dom" />
import { createSignal, Show, type JSX } from "solid-js";
import { t, LANGUE_DEFAUT, type Langue } from "../i18n/utils.ts";
import { PUBLIC_API_URL } from "../lib/api.ts";

/**
 * Inscription à la lettre d'information.
 *
 * Le champ ne promet rien qu'il ne tienne : l'adresse part vraiment en base
 * (POST /newsletter) et la liste se relit au back-office. Une adresse déjà
 * inscrite obtient la même réponse qu'une nouvelle — dire « vous êtes déjà
 * inscrit » révélerait qui figure dans la liste.
 */
export default function Newsletter(props: { langue?: Langue }): JSX.Element {
  const tr = t(props.langue ?? LANGUE_DEFAUT);
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
          langue: props.langue ?? LANGUE_DEFAUT,
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
          {tr("lettre.email")}
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
          placeholder={tr("lettre.email")}
          autocomplete="email"
          class="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none"
        />
        <button
          type="submit"
          disabled={etat() === "envoi"}
          aria-label={tr("lettre.envoyer")}
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
        <p class="mt-3 text-sm text-sage">{tr("lettre.merci")}</p>
      </Show>
      <Show when={etat() === "erreur"}>
        <p class="mt-3 text-sm text-terracotta-deep">{tr("lettre.erreur")}</p>
      </Show>
    </form>
  );
}
