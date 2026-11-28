/**
 * API d'essai pour BO › Pages › une page : le bouton « dans toutes les
 * langues » (A-FAIRE § 2, Alexandra le 28/11 : « finis le à faire »).
 *
 * Les VRAIES routes des pages (mountCms, apps/api/src/cms.ts : lecture,
 * enregistrement avec ses refus, page publique) sur une base JETABLE, et
 * trois bouchons à la place de ce qu'il ne faut pas toucher :
 *   - /auth/me : une propriétaire fictive — aucun compte, aucun mot de passe ;
 *   - /admin/traduire : un faux traducteur (« [en] » devant chaque texte,
 *     balises gardées), sans appel à OpenAI ; FAUX_ECHEC=zh fait échouer le
 *     chinois, FAUX_DELAI règle sa lenteur (ms) ;
 *   - /essai/journal : ce que le back-office a demandé (traductions, envois).
 * Le reste (/admin/mode-essai, /admin/products…) est absent : le BO s'en passe.
 *
 * Ne démarre QUE sur la base jetable memoryline_essais_traduire (conteneur
 * memoryline-db, port 5433 de l'hôte).
 *
 *   DATABASE_URL=… PORT=3971 apps/api/node_modules/.bin/tsx travaux/finir-a-faire/bo-tout-traduire/api-essai.mts
 */
import { createRequire } from "node:module";

const base = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1):5433\/memoryline_essais_traduire$/.test(base)) {
  console.error("Refusé : cette API d'essai ne tourne que sur la base jetable memoryline_essais_traduire.");
  process.exit(1);
}

// hono et son serveur Node vivent dans les dépendances de l'API.
const requireApi = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
const { Hono } = requireApi("hono") as typeof import("hono");
const { serve } = requireApi("@hono/node-server") as typeof import("@hono/node-server");
const { mountCms } = await import("../../../apps/api/src/cms.ts");

const PORT = Number(process.env.PORT ?? 3971);
const DELAI = Number(process.env.FAUX_DELAI ?? 400);
const ECHECS = (process.env.FAUX_ECHEC ?? "").split(",").filter(Boolean);

interface Trace {
  quand: number;
  quoi: string;
  [cle: string]: unknown;
}
const journal: Trace[] = [];
const t0 = Date.now();

const app = new Hono();

app.get("/auth/me", (c) =>
  c.json({ user: { email: "essai@exemple.invalid", role: "owner" } }),
);

/** Le faux traducteur : « [en] » devant chaque texte visible, balises intactes. */
function traduire(texte: string, langue: string): string {
  if (!/[<>]/.test(texte)) return `[${langue}] ${texte}`;
  return texte.replace(/>([^<>]*\S[^<>]*)</g, (_m, t: string) => `>[${langue}] ${t}<`);
}

app.post("/admin/traduire", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { lang?: string; champs?: Record<string, string> };
  const langue = String(b.lang ?? "");
  if (!["en", "de", "it", "es", "ja", "zh"].includes(langue))
    return c.json({ error: "langue inconnue" }, 400);
  const champs = b.champs ?? {};
  const debut = Date.now() - t0;
  await new Promise((r) => setTimeout(r, DELAI));
  journal.push({
    quand: debut,
    fin: Date.now() - t0,
    quoi: "traduire",
    langue,
    cles: Object.keys(champs),
    tailles: Object.values(champs).map((v) => String(v).length),
  });
  if (ECHECS.includes(langue))
    return c.json({ error: "Le service de traduction ne répond pas. Réessayez dans un instant." }, 502);
  return c.json({
    champs: Object.fromEntries(Object.entries(champs).map(([k, v]) => [k, traduire(String(v), langue)])),
  });
});

// Ce que le back-office envoie pour enregistrer une page : relevé, puis
// laissé à la vraie route (Hono garde le corps lu en mémoire).
app.use("/admin/pages/:id", async (c, next) => {
  if (c.req.method === "POST") {
    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const trads = (corps.translations ?? null) as Record<string, { blocks?: unknown[] } | null> | null;
    journal.push({
      quand: Date.now() - t0,
      quoi: "enregistrer",
      page: c.req.param("id"),
      cles: Object.keys(corps),
      blocsFrancais: Array.isArray(corps.blocks) ? corps.blocks.length : null,
      langues: trads
        ? Object.fromEntries(
            Object.entries(trads).map(([l, t]) => [l, t === null ? "effacée" : `${t.blocks?.length ?? 0} bloc(s)`]),
          )
        : null,
    });
  }
  await next();
});

mountCms(app);

app.get("/essai/journal", (c) => c.json(journal));
app.post("/essai/journal/vider", (c) => {
  journal.length = 0;
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () =>
  console.log(`API d'essai sur http://127.0.0.1:${PORT} (faux traducteur, délai ${DELAI} ms, échecs : ${ECHECS.join(",") || "aucun"})`),
);
