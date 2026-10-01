/**
 * Traductions : la langue du visiteur, le nom traduit d'un élément du
 * catalogue, et la PROPOSITION de traduction automatique du back-office.
 *
 * Les traductions restent écrites par la boutique : le bouton « Proposer une
 * traduction » ne fait que PRÉ-REMPLIR les champs, qu'elle relit et
 * enregistre elle-même. Rien n'est jamais enregistré par la machine.
 */
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client.js";

/** Les langues du site autres que le français, dans l'ordre du back-office. */
export const LANGUES_ETRANGERES = ["en", "de", "it", "es"] as const;
export type LangueEtrangere = (typeof LANGUES_ETRANGERES)[number];

const NOM_LANGUE: Record<LangueEtrangere, string> = {
  en: "English",
  de: "German",
  it: "Italian",
  es: "Spanish",
};

/** La langue demandée par le site (?lang=), le français à défaut. */
export function langueDuVisiteur(c: {
  req: { query: (k: string) => string | undefined };
}): string {
  const l = (c.req.query("lang") ?? "").toLowerCase();
  return (LANGUES_ETRANGERES as readonly string[]).includes(l) ? l : "fr";
}

/**
 * Le nom traduit d'un élément du catalogue (catégorie, cadre…), ou undefined
 * pour le français et pour une traduction absente ou vide — l'appelant
 * affiche alors le nom français, jamais un trou.
 */
export function nomTraduit(
  traductions: Partial<Record<string, { name?: string }>> | null | undefined,
  langue: string,
): string | undefined {
  if (langue === "fr") return undefined;
  const nom = traductions?.[langue]?.name?.trim();
  return nom || undefined;
}

/** Une traduction enregistrée : champs vidés retirés, langue vide retirée. */
export function fusionnerTraduction(
  existantes: Partial<Record<string, { name?: string }>> | null | undefined,
  langue: LangueEtrangere,
  nom: string,
): Partial<Record<string, { name?: string }>> {
  const suite = { ...(existantes ?? {}) };
  const propre = nom.trim();
  if (propre) suite[langue] = { name: propre };
  else delete suite[langue];
  return suite;
}

// ─── La proposition automatique ───────────────────────────────────────────

/**
 * Par OpenAI, avec la clé déjà utilisée pour les affiches IA. Le modèle se
 * règle par OPENAI_MODELE_TRADUCTION ; à défaut, le premier de cette liste que
 * le compte connaît — les noms de modèles changent, la traduction ne doit pas
 * tomber en panne pour autant.
 */
const MODELES = [
  (process.env.OPENAI_MODELE_TRADUCTION ?? "").trim(),
  "gpt-5-mini",
  "gpt-4.1-mini",
  "gpt-4o-mini",
].filter(Boolean);

const OPENAI_BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
  /\/+$/,
  "",
);

export function traductionDisponible(): boolean {
  return (process.env.OPENAI_API_KEY ?? "").trim().length > 0;
}

const CONSIGNE = (langue: LangueEtrangere) =>
  `You translate French texts for Memory Line, a French online shop selling personalised illustrated posters (cities, landscapes, families, pets).
Translate every value of the JSON object you receive from French into ${NOM_LANGUE[langue]}.
Rules:
- Keep the exact same JSON keys; translate only the values. Answer with the JSON object only.
- Keep ALL HTML tags and attributes exactly as they are; translate only the visible text between them.
- Keep place names in their usual form for a ${NOM_LANGUE[langue]} reader, and keep words written in CAPITALS (city names such as AMIENS, BAIE DE SOMME) in capitals and unchanged.
- Tone: warm, natural and polite e-commerce copy, as a native ${NOM_LANGUE[langue]} copywriter would write it — not a literal translation. Use the polite form of address where the language has one (German "Sie").
- Product formats (A4, A3), prices and measurements stay as they are.
- An empty value stays empty.`;

export class EchecTraduction extends Error {}

/**
 * Propose une traduction de chaque champ (texte simple ou HTML). Lève
 * EchecTraduction avec un message lisible : clé absente, service muet…
 */
export async function proposerTraduction(
  champs: Record<string, string>,
  langue: LangueEtrangere,
): Promise<Record<string, string>> {
  const cle = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!cle)
    throw new EchecTraduction(
      "La traduction automatique n'est pas branchée : il manque OPENAI_API_KEY dans le .env du serveur.",
    );
  const aTraduire = Object.fromEntries(
    Object.entries(champs).filter(([, v]) => typeof v === "string" && v.trim()),
  );
  if (Object.keys(aTraduire).length === 0) return {};

  let derniere = "";
  for (const modele of MODELES) {
    let res: Response;
    try {
      res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modele,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CONSIGNE(langue) },
            { role: "user", content: JSON.stringify(aTraduire) },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new EchecTraduction("Le service de traduction ne répond pas. Réessayez dans un instant.");
    }
    const corps = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      derniere = corps?.error?.message ?? `réponse ${res.status}`;
      // Modèle inconnu de ce compte : on essaie le suivant.
      if (res.status === 404 || corps?.error?.code === "model_not_found") continue;
      throw new EchecTraduction(`Le service de traduction a refusé : ${derniere.slice(0, 200)}`);
    }
    let lu: Record<string, unknown>;
    try {
      lu = JSON.parse(corps?.choices?.[0]?.message?.content ?? "") as Record<string, unknown>;
    } catch {
      throw new EchecTraduction("La traduction reçue est illisible. Réessayez.");
    }
    // Seules les clés demandées reviennent, et seulement en texte.
    return Object.fromEntries(
      Object.keys(aTraduire)
        .map((k) => [k, typeof lu[k] === "string" ? (lu[k] as string).trim() : ""])
        .filter(([, v]) => v),
    );
  }
  throw new EchecTraduction(
    `Aucun modèle de traduction disponible sur ce compte OpenAI (${derniere.slice(0, 120)}).`,
  );
}

/**
 * Enregistre le nom traduit d'une catégorie de personnages ou d'un cadre,
 * UNE langue à la fois : { lang, name }. Un nom vidé retire la traduction —
 * le français s'affiche de nouveau.
 */
function routeTraductionNom(
  app: Hono,
  chemin: string,
  table: typeof schema.characterCategories | typeof schema.frames,
): void {
  app.post(chemin, async (c) => {
    const id = Number(c.req.param("id"));
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const langue = String(b.lang ?? "") as LangueEtrangere;
    if (!(LANGUES_ETRANGERES as readonly string[]).includes(langue))
      return c.json({ error: "langue inconnue" }, 400);
    const [ligne] = await db
      .select({ translations: table.translations })
      .from(table)
      .where(eq(table.id, id));
    if (!ligne) return c.json({ error: "introuvable" }, 404);
    const translations = fusionnerTraduction(
      ligne.translations,
      langue,
      String(b.name ?? "").slice(0, 120),
    );
    await db
      .update(table)
      .set({ translations: Object.keys(translations).length ? translations : null })
      .where(eq(table.id, id));
    return c.json({ translations });
  });
}

/**
 * POST /admin/traduire { lang, champs: { name?, description?, … } }
 *   → { champs: { … traduits } }
 * Sous /admin/* : protégée par la garde du back-office. N'ENREGISTRE RIEN.
 */
export function mountTraduction(app: Hono): void {
  routeTraductionNom(app, "/admin/categories/:id/translations", schema.characterCategories);
  routeTraductionNom(app, "/admin/frames/:id/translations", schema.frames);

  app.post("/admin/traduire", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const langue = String(b.lang ?? "") as LangueEtrangere;
    if (!(LANGUES_ETRANGERES as readonly string[]).includes(langue))
      return c.json({ error: "langue inconnue" }, 400);
    const brut = (b.champs ?? {}) as Record<string, unknown>;
    const champs: Record<string, string> = {};
    for (const [k, v] of Object.entries(brut))
      if (typeof v === "string" && /^[a-zA-Z0-9_.-]{1,60}$/.test(k)) champs[k] = v.slice(0, 20_000);
    try {
      return c.json({ champs: await proposerTraduction(champs, langue) });
    } catch (e) {
      if (e instanceof EchecTraduction) return c.json({ error: e.message }, 502);
      console.error("[traduction]", e);
      return c.json({ error: "La traduction a échoué. Réessayez dans un instant." }, 502);
    }
  });
}
