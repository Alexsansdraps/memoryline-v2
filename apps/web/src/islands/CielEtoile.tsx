/// <reference lib="dom" />
import { createSignal, For, Show, type JSX } from "solid-js";
import { t, type Langue } from "../i18n/utils.ts";
import { PUBLIC_API_URL, getCartId } from "../lib/api.ts";
import { apercuAbsolu } from "../lib/ia.ts";

/**
 * Le ciel étoilé d'un soir (26/11) — page cachée /ciel-etoile, à montrer à
 * Margaux avant de l'ouvrir aux clients.
 *
 * Une date, une heure, une ville : l'API calcule le ciel (apps/api/src/ciel.ts)
 * et le range comme une affiche tirée d'une photo. On le montre ici, puis
 * « Personnaliser » ouvre l'écran de l'affiche photo sur cette création —
 * textes, personnages, format et panier y sont déjà.
 */

/**
 * Les villes proposées : coordonnées au centre-ville et fuseau horaire. À
 * l'échelle d'une carte du ciel, un degré ne se voit pas : la grande ville la
 * plus proche suffit.
 */
const VILLES: { nom: string; lat: number; lon: number; tz: string }[] = [
  { nom: "Mulhouse", lat: 47.75, lon: 7.34, tz: "Europe/Paris" },
  { nom: "Colmar", lat: 48.08, lon: 7.36, tz: "Europe/Paris" },
  { nom: "Strasbourg", lat: 48.57, lon: 7.75, tz: "Europe/Paris" },
  { nom: "Belfort", lat: 47.64, lon: 6.86, tz: "Europe/Paris" },
  { nom: "Besançon", lat: 47.24, lon: 6.02, tz: "Europe/Paris" },
  { nom: "Metz", lat: 49.12, lon: 6.18, tz: "Europe/Paris" },
  { nom: "Nancy", lat: 48.69, lon: 6.18, tz: "Europe/Paris" },
  { nom: "Reims", lat: 49.26, lon: 4.03, tz: "Europe/Paris" },
  { nom: "Dijon", lat: 47.32, lon: 5.04, tz: "Europe/Paris" },
  { nom: "Paris", lat: 48.86, lon: 2.35, tz: "Europe/Paris" },
  { nom: "Lille", lat: 50.63, lon: 3.06, tz: "Europe/Paris" },
  { nom: "Rouen", lat: 49.44, lon: 1.1, tz: "Europe/Paris" },
  { nom: "Le Havre", lat: 49.49, lon: 0.11, tz: "Europe/Paris" },
  { nom: "Rennes", lat: 48.12, lon: -1.68, tz: "Europe/Paris" },
  { nom: "Brest", lat: 48.39, lon: -4.49, tz: "Europe/Paris" },
  { nom: "Nantes", lat: 47.22, lon: -1.55, tz: "Europe/Paris" },
  { nom: "Tours", lat: 47.39, lon: 0.69, tz: "Europe/Paris" },
  { nom: "Limoges", lat: 45.83, lon: 1.26, tz: "Europe/Paris" },
  { nom: "Bordeaux", lat: 44.84, lon: -0.58, tz: "Europe/Paris" },
  { nom: "Toulouse", lat: 43.6, lon: 1.44, tz: "Europe/Paris" },
  { nom: "Clermont-Ferrand", lat: 45.78, lon: 3.09, tz: "Europe/Paris" },
  { nom: "Lyon", lat: 45.76, lon: 4.84, tz: "Europe/Paris" },
  { nom: "Grenoble", lat: 45.19, lon: 5.72, tz: "Europe/Paris" },
  { nom: "Montpellier", lat: 43.61, lon: 3.88, tz: "Europe/Paris" },
  { nom: "Perpignan", lat: 42.7, lon: 2.9, tz: "Europe/Paris" },
  { nom: "Marseille", lat: 43.3, lon: 5.37, tz: "Europe/Paris" },
  { nom: "Nice", lat: 43.71, lon: 7.26, tz: "Europe/Paris" },
  { nom: "Ajaccio", lat: 41.92, lon: 8.74, tz: "Europe/Paris" },
  { nom: "Bâle", lat: 47.56, lon: 7.59, tz: "Europe/Zurich" },
  { nom: "Zurich", lat: 47.38, lon: 8.54, tz: "Europe/Zurich" },
  { nom: "Genève", lat: 46.2, lon: 6.14, tz: "Europe/Zurich" },
  { nom: "Fribourg-en-Brisgau", lat: 48.0, lon: 7.84, tz: "Europe/Berlin" },
  { nom: "Berlin", lat: 52.52, lon: 13.4, tz: "Europe/Berlin" },
  { nom: "Bruxelles", lat: 50.85, lon: 4.35, tz: "Europe/Brussels" },
  { nom: "Luxembourg", lat: 49.61, lon: 6.13, tz: "Europe/Luxembourg" },
  { nom: "Londres", lat: 51.51, lon: -0.13, tz: "Europe/London" },
  { nom: "Madrid", lat: 40.42, lon: -3.7, tz: "Europe/Madrid" },
  { nom: "Lisbonne", lat: 38.72, lon: -9.14, tz: "Europe/Lisbon" },
  { nom: "Rome", lat: 41.9, lon: 12.5, tz: "Europe/Rome" },
  { nom: "Alger", lat: 36.75, lon: 3.06, tz: "Africa/Algiers" },
  { nom: "Casablanca", lat: 33.57, lon: -7.59, tz: "Africa/Casablanca" },
  { nom: "Montréal", lat: 45.5, lon: -73.57, tz: "America/Toronto" },
  { nom: "New York", lat: 40.71, lon: -74.01, tz: "America/New_York" },
  { nom: "Pointe-à-Pitre", lat: 16.24, lon: -61.53, tz: "America/Guadeloupe" },
  { nom: "Fort-de-France", lat: 14.62, lon: -61.06, tz: "America/Martinique" },
  { nom: "Saint-Denis (La Réunion)", lat: -20.88, lon: 55.45, tz: "Indian/Reunion" },
  { nom: "Tokyo", lat: 35.68, lon: 139.65, tz: "Asia/Tokyo" },
  { nom: "Pékin", lat: 39.9, lon: 116.41, tz: "Asia/Shanghai" },
];

export interface CielEtoileProps {
  langue: Langue;
  /** L'affiche « à partir d'une photo » qui accueille le ciel. */
  productId: number;
  /** Son adresse, dans la langue de la page. */
  adresseAffiche: string;
}

export default function CielEtoile(props: CielEtoileProps): JSX.Element {
  const tr = t(props.langue);
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const [date, setDate] = createSignal(aujourdHui);
  const [heure, setHeure] = createSignal("21:00");
  const [ville, setVille] = createSignal(0);
  const [occupe, setOccupe] = createSignal(false);
  const [erreur, setErreur] = createSignal(false);
  const [creation, setCreation] = createSignal<{ publicId: string; apercuChemin: string; apercu: string } | null>(null);

  async function dessiner(e: Event) {
    e.preventDefault();
    if (occupe()) return;
    const v = VILLES[ville()]!;
    setOccupe(true);
    setErreur(false);
    try {
      const r = await fetch(`${PUBLIC_API_URL}/ia/ciel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: props.productId,
          cartId: getCartId(),
          date: date(),
          heure: heure(),
          fuseau: v.tz,
          lat: v.lat,
          lon: v.lon,
          lieu: v.nom,
        }),
      });
      const data = (await r.json().catch(() => null)) as { publicId?: string; apercu?: string } | null;
      if (!r.ok || !data?.publicId || !data.apercu) throw new Error(String(r.status));
      setCreation({ publicId: data.publicId, apercuChemin: data.apercu, apercu: apercuAbsolu(data.apercu) });
    } catch {
      setErreur(true);
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
    <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={dessiner} class="space-y-4">
        <label class="block text-sm font-medium">
          {tr("ciel.date")}
          <input type="date" required min="1900-01-01" max="2100-12-31" value={date()} onInput={(e) => setDate(e.currentTarget.value)} class={champ} />
        </label>
        <label class="block text-sm font-medium">
          {tr("ciel.heure")}
          <input type="time" required value={heure()} onInput={(e) => setHeure(e.currentTarget.value)} class={champ} />
        </label>
        <label class="block text-sm font-medium">
          {tr("ciel.ville")}
          <select value={ville()} onChange={(e) => setVille(Number(e.currentTarget.value))} class={champ}>
            <For each={VILLES}>{(v, i) => <option value={i()}>{v.nom}</option>}</For>
          </select>
          <span class="mt-1 block text-xs font-normal text-ink-soft">{tr("ciel.ville_aide")}</span>
        </label>
        <button
          type="submit"
          disabled={occupe()}
          class="rounded-full bg-ink px-8 py-3 font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
        >
          {occupe() ? tr("ciel.calcul") : creation() ? tr("ciel.redessiner") : tr("ciel.dessiner")}
        </button>
        <Show when={erreur()}>
          <p role="status" class="border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep">
            {tr("ciel.erreur")}
          </p>
        </Show>
      </form>

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
    </div>
  );
}
