/// <reference lib="dom" />
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { LOCALE_COMPLETE, t, type Langue } from "../i18n/utils.ts";
import { PUBLIC_API_URL, getCartId } from "../lib/api.ts";
import { apercuAbsolu } from "../lib/ia.ts";
import { saisonDeNoel } from "../lib/saison-noel.ts";

/**
 * Le ciel étoilé d'un soir (26/11) — page cachée /ciel-etoile, à montrer à
 * Margaux avant de l'ouvrir aux clients.
 *
 * Une date, une heure, une ville : l'API calcule le ciel (apps/api/src/ciel.ts)
 * et le range comme une affiche tirée d'une photo. On le montre ici, puis
 * « Personnaliser » ouvre l'écran de l'affiche photo sur cette création —
 * textes, personnages, format et panier y sont déjà.
 */

/** Un thème de couleurs du ciel (API /ia/ciel/themes). */
interface ThemeCiel {
  id: string;
  nom: string;
  fond: string;
  etoiles: string;
  dorures: string;
  haut: string;
  horizon: string;
}

/** Une ville trouvée par l'API (GeoNames, apps/api/src/ciel.ts). */
interface Ville {
  nom: string;
  pays: string;
  region: string;
  lat: number;
  lon: number;
  fuseau: string;
}

const MULHOUSE: Ville = {
  nom: "Mulhouse",
  pays: "FR",
  region: "Grand Est",
  lat: 47.75,
  lon: 7.336,
  fuseau: "Europe/Paris",
};

export interface CielEtoileProps {
  langue: Langue;
  /** L'affiche « à partir d'une photo » qui accueille le ciel. */
  productId: number;
  /** Son adresse, dans la langue de la page (page /ciel-etoile seule). */
  adresseAffiche?: string;
  /**
   * Intégré à la fiche de l'affiche (AfficheIA, `?ciel=1`, 26/11) : le
   * formulaire seul, et le ciel dessiné lui est rendu — elle le montre et
   * enchaîne sur ses textes, ses personnages, son format.
   */
  onCree?: (c: { publicId: string; apercuChemin: string; apercu: string }) => void;
  /** La fiche est occupée (création, composition) : le bouton s'éteint. */
  occupe?: boolean;
}

export default function CielEtoile(props: CielEtoileProps): JSX.Element {
  const tr = t(props.langue);
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const [date, setDate] = createSignal(aujourdHui);
  const [heure, setHeure] = createSignal("21:00");
  /*
   * La nuit de Noël (27/11, Alexandra : « Le ciel de la nuit de Noël. Un
   * bouton "Nuit de Noël 2026" sur la fiche Ciel étoilé règle la date sur le
   * 24 décembre à minuit, dans la ville de la cliente. On y ajoute un thème
   * rouge et or. C'est idéal pour "le premier Noël de…" », « avec un btn
   * original »). De saison seulement, du 1er novembre au 31 janvier : en
   * janvier, c'est le Noël de l'année d'avant. 23:59 plutôt que 00:00 : le
   * champ garde le 24, et le ciel est le même à une minute près.
   */
  const { enSaison, annee: anneeDeNoel } = saisonDeNoel(new Date());
  const DATE_NOEL = `${anneeDeNoel}-12-24`;
  const HEURE_NOEL = "23:59";
  const noelRegle = () => date() === DATE_NOEL && heure() === HEURE_NOEL;
  const [annonceNoel, setAnnonceNoel] = createSignal("");
  function reglerNoel() {
    setDate(DATE_NOEL);
    setHeure(HEURE_NOEL);
    if (themes().some((t) => t.id === "noel")) setTheme("noel");
    setAnnonceNoel(tr("ciel.noel.regle"));
  }
  const [ville, setVille] = createSignal<Ville | null>(MULHOUSE);
  const [saisie, setSaisie] = createSignal(MULHOUSE.nom);
  const [proposees, setProposees] = createSignal<Ville[]>([]);
  const [ouverte, setOuverte] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [aucune, setAucune] = createSignal(false);
  const [manque, setManque] = createSignal(false);

  /** « France », « Allemagne »… dans la langue de la page. */
  let noms: Intl.DisplayNames | null = null;
  try {
    noms = new Intl.DisplayNames([LOCALE_COMPLETE[props.langue]], { type: "region" });
  } catch {
    noms = null;
  }
  const pays = (code: string) => {
    try {
      return noms?.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const precision = (v: Ville) => [v.region, pays(v.pays)].filter(Boolean).join(", ");

  // Recherche au fil de la frappe, 200 ms après la dernière touche ; une
  // réponse arrivée après une plus récente est ignorée.
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  let tour = 0;
  onCleanup(() => clearTimeout(minuterie));
  function taper(valeur: string) {
    setSaisie(valeur);
    setVille(null);
    setManque(false);
    clearTimeout(minuterie);
    const q = valeur.trim();
    if (q.length < 2) {
      setProposees([]);
      setOuverte(false);
      setAucune(false);
      return;
    }
    const ce = ++tour;
    minuterie = setTimeout(async () => {
      try {
        const r = await fetch(`${PUBLIC_API_URL}/ia/ciel/villes?q=${encodeURIComponent(q)}`);
        const data = (await r.json()) as { villes?: Ville[] };
        if (ce !== tour) return;
        const liste = Array.isArray(data.villes) ? data.villes : [];
        setProposees(liste);
        setAucune(liste.length === 0);
        setActive(liste.length ? 0 : -1);
        setOuverte(true);
      } catch {
        /* réseau : on réessaiera à la prochaine touche */
      }
    }, 200);
  }
  function choisir(v: Ville) {
    setVille(v);
    setSaisie(v.nom);
    setOuverte(false);
    setManque(false);
  }
  function clavier(e: KeyboardEvent) {
    const n = proposees().length;
    if (!ouverte() || !n) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + n) % n);
    } else if (e.key === "Enter" && active() >= 0) {
      e.preventDefault();
      choisir(proposees()[active()]!);
    } else if (e.key === "Escape") {
      setOuverte(false);
    }
  }
  const [occupe, setOccupe] = createSignal(false);

  /**
   * Les couleurs du ciel (27/11) : les thèmes réglés au BO › Ciel étoilé.
   * Chaque pastille montre le dégradé du fond, une étoile et l'anneau doré.
   */
  const [themes, setThemes] = createSignal<ThemeCiel[]>([]);
  const [theme, setTheme] = createSignal<string | null>(null);
  onMount(async () => {
    try {
      const r = await fetch(`${PUBLIC_API_URL}/ia/ciel/themes`);
      const data = (await r.json()) as { themes?: ThemeCiel[] };
      const liste = Array.isArray(data.themes) ? data.themes : [];
      setThemes(liste);
      if (liste[0]) setTheme(liste[0].id);
    } catch {
      /* sans la liste, le serveur prend le premier thème */
    }
  });
  /**
   * Le message d'un échec. Un refus pour trop de demandes (429) dit de
   * patienter une minute (27/11) : il disait « vérifiez la date », ce qui
   * était faux. Tout autre échec garde ciel.erreur.
   */
  const [erreur, setErreur] = createSignal<"ciel.erreur" | "ia.err.rafale" | null>(null);
  const [creation, setCreation] = createSignal<{ publicId: string; apercuChemin: string; apercu: string } | null>(null);

  async function dessiner(e: Event) {
    e.preventDefault();
    if (occupe()) return;
    const v = ville();
    if (!v) {
      setManque(true);
      return;
    }
    setOccupe(true);
    setErreur(null);
    try {
      const r = await fetch(`${PUBLIC_API_URL}/ia/ciel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: props.productId,
          cartId: getCartId(),
          date: date(),
          heure: heure(),
          fuseau: v.fuseau,
          lat: v.lat,
          lon: v.lon,
          lieu: [v.nom, v.region, v.pays].filter(Boolean).join(", "),
          theme: theme() ?? undefined,
        }),
      });
      const data = (await r.json().catch(() => null)) as { publicId?: string; apercu?: string } | null;
      if (r.status === 429) {
        setErreur("ia.err.rafale");
        return;
      }
      if (!r.ok || !data?.publicId || !data.apercu) throw new Error(String(r.status));
      const cree = { publicId: data.publicId, apercuChemin: data.apercu, apercu: apercuAbsolu(data.apercu) };
      if (props.onCree) props.onCree(cree);
      else setCreation(cree);
    } catch {
      setErreur("ciel.erreur");
    } finally {
      setOccupe(false);
    }
  }

  /** Range la création avec celles de la séance (AfficheIA les relit) et y va. */
  function personnaliser() {
    const c = creation();
    if (!c) return;
    try {
      const cle = `ml_ia_creations_${getCartId()}_${props.productId}`;
      const liste = JSON.parse(sessionStorage.getItem(cle) ?? "[]") as { publicId: string }[];
      const autres = Array.isArray(liste) ? liste.filter((x) => x?.publicId !== c.publicId) : [];
      sessionStorage.setItem(
        cle,
        JSON.stringify([...autres, { ...c, sens: "portrait", source: "" }]),
      );
    } catch {
      /* mémoire indisponible : la page de l'affiche s'ouvrira sans le ciel */
    }
    location.href = `${props.adresseAffiche}?creation=${encodeURIComponent(c.publicId)}`;
  }

  const champ = "mt-1 w-full border border-ink/20 bg-paper px-3 py-2 text-base";

  return (
    <div class={props.onCree ? "" : "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}>
      <form onSubmit={dessiner} class="space-y-4">
        <label class="block text-sm font-medium">
          {tr("ciel.date")}
          <input type="date" required min="1900-01-01" max="2100-12-31" value={date()} onInput={(e) => setDate(e.currentTarget.value)} class={champ} />
        </label>
        <label class="block text-sm font-medium">
          {tr("ciel.heure")}
          <input type="time" required value={heure()} onInput={(e) => setHeure(e.currentTarget.value)} class={champ} />
        </label>
        {/* L'étiquette de cadeau de la nuit de Noël (27/11, voir
            `reglerNoel`) : accrochée au formulaire, penchée comme si elle
            pendait, elle se redresse quand on l'effleure, et reste droite
            tant que la date et l'heure sont celles de la nuit de Noël. La
            forme est un dessin posé DERRIÈRE le texte : le bouton n'est pas
            découpé, son contour de focus reste entier. */}
        <Show when={enSaison}>
          <div class="pt-1">
            <button
              type="button"
              class="ml-etiquette-noel"
              aria-pressed={noelRegle()}
              onClick={reglerNoel}
            >
              <svg aria-hidden="true" viewBox="0 0 240 64" preserveAspectRatio="none" class="absolute inset-0 h-full w-full overflow-visible">
                <path d="M24 32 C 8 28, 6 10, 16 0" fill="none" stroke="#b08d57" stroke-width="2" stroke-linecap="round" />
                <path d="M32 2 H234 a4 4 0 0 1 4 4 V58 a4 4 0 0 1 -4 4 H32 L8 32 Z" fill="#9c1616" />
                <path d="M35 7 H231 V57 H35 L16 32 Z" fill="none" stroke="#e9c56b" stroke-width="1.2" stroke-dasharray="4 3" />
                <circle cx="26" cy="32" r="4.5" fill="#fff" stroke="#e9c56b" stroke-width="1.5" />
              </svg>
              <svg aria-hidden="true" viewBox="0 0 24 24" class="relative h-5 w-5 shrink-0">
                <path
                  d="M12 2 13.8 10.2 22 12 13.8 13.8 12 22 10.2 13.8 2 12 10.2 10.2Z"
                  fill={noelRegle() ? "#e9c56b" : "none"}
                  stroke="#e9c56b"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="relative min-w-0 text-left leading-tight">
                <span class="block truncate text-lg" style={{ "font-family": "'DM Serif Display', serif" }}>
                  {tr("ciel.noel.bouton").replace("{annee}", String(anneeDeNoel))}
                </span>
                <span class="block text-xs opacity-90">{tr("ciel.noel.detail")}</span>
              </span>
            </button>
            <span class="sr-only" aria-live="polite">
              {annonceNoel()}
            </span>
          </div>
        </Show>
        <div class="relative">
          <label for="ciel-ville" class="block text-sm font-medium">
            {tr("ciel.ville")}
          </label>
          <input
            id="ciel-ville"
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            aria-expanded={ouverte()}
            aria-controls="ciel-villes"
            aria-activedescendant={ouverte() && active() >= 0 ? `ciel-ville-${active()}` : undefined}
            value={saisie()}
            onInput={(e) => taper(e.currentTarget.value)}
            onKeyDown={clavier}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setTimeout(() => setOuverte(false), 150)}
            class={champ}
          />
          <Show when={ouverte()}>
            <ul
              id="ciel-villes"
              role="listbox"
              class="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto border border-ink/20 bg-paper shadow-lg"
            >
              <Show when={aucune()}>
                <li class="px-3 py-2 text-sm text-ink-soft">{tr("ciel.ville_aucune")}</li>
              </Show>
              <For each={proposees()}>
                {(v, i) => (
                  <li
                    id={`ciel-ville-${i()}`}
                    role="option"
                    aria-selected={active() === i()}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choisir(v);
                    }}
                    onMouseEnter={() => setActive(i())}
                    class={`cursor-pointer px-3 py-2 ${active() === i() ? "bg-ink/10" : ""}`}
                  >
                    <span class="font-medium">{v.nom}</span>
                    <span class="ml-2 text-sm text-ink-soft">{precision(v)}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <span class="mt-1 block text-xs font-normal text-ink-soft">
            {ville() ? precision(ville()!) : tr("ciel.ville_aide")}
          </span>
          <Show when={manque()}>
            <span role="status" class="mt-1 block text-sm text-terracotta-deep">{tr("ciel.ville_choisir")}</span>
          </Show>
        </div>
        <Show when={themes().length > 1}>
          <div>
            <span class="block text-sm font-medium" id="ciel-theme-titre">
              {tr("ciel.theme")}
            </span>
            <div role="radiogroup" aria-labelledby="ciel-theme-titre" class="mt-2 flex flex-wrap gap-3">
              <For each={themes()}>
                {(th) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme() === th.id}
                    onClick={() => setTheme(th.id)}
                    class={`ml-choix flex w-[4.75rem] flex-col items-center gap-1.5 border px-1 pb-1.5 pt-1 text-xs ${
                      theme() === th.id ? "border-ink font-semibold" : "border-ink/15 hover:border-ink/45"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      class="relative block aspect-[1/1.4142] w-full"
                      style={{ background: `linear-gradient(${th.haut}, ${th.fond} 75%, ${th.horizon})` }}
                    >
                      <span
                        class="absolute left-1/2 top-[55%] block h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                        style={{ "border-color": th.dorures }}
                      >
                        <span class="absolute left-[30%] top-[35%] block h-1 w-1 rounded-full" style={{ background: th.etoiles }} />
                        <span class="absolute left-[60%] top-[55%] block h-1.5 w-1.5 rounded-full" style={{ background: th.etoiles }} />
                        <span class="absolute left-[45%] top-[70%] block h-0.5 w-0.5 rounded-full" style={{ background: th.etoiles }} />
                      </span>
                    </span>
                    <span class="leading-tight">{th.nom}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <button
          type="submit"
          disabled={occupe() || !!props.occupe}
          class="rounded-full bg-ink px-8 py-3 font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
        >
          {occupe() ? tr("ciel.calcul") : creation() ? tr("ciel.redessiner") : tr("ciel.dessiner")}
        </button>
        <Show when={erreur()}>
          {(cle) => (
            <p role="status" class="border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
              {tr(cle())}
            </p>
          )}
        </Show>
      </form>

      <Show when={!props.onCree}>
      <div>
        <Show
          when={creation()}
          fallback={
            <div class="flex aspect-[1/1.4142] w-full max-w-[460px] items-center justify-center bg-[#16243d] p-8 text-center text-sm text-[#d9c38f]">
              {tr("ciel.attente")}
            </div>
          }
        >
          {(c) => (
            <>
              <img src={c().apercu} alt={tr("ciel.alt")} class="w-full max-w-[460px] border border-ink/10 shadow-sm" />
              <button
                type="button"
                onClick={personnaliser}
                class="mt-4 rounded-full bg-ink px-8 py-3 font-medium text-paper transition-colors hover:bg-ink/85"
              >
                {tr("ciel.personnaliser")}
              </button>
              <p class="mt-2 max-w-[460px] text-sm text-ink-soft">{tr("ciel.personnaliser_aide")}</p>
            </>
          )}
        </Show>
      </div>
      </Show>
    </div>
  );
}
