/**
 * Traductions : la langue du visiteur, les textes saisis au back-office
 * (noms, descriptions, messages…) dans cette langue, leur enregistrement, et
 * la PROPOSITION de traduction automatique du back-office.
 *
 * La règle, partout la même : le français est la référence ET le repli. Une
 * traduction absente ou vide affiche le français, jamais un blanc ; un
 * français vide reste vide dans toutes les langues (texteDansLaLangue).
 *
 * Les traductions restent écrites par la boutique : le bouton « Proposer une
 * traduction » ne fait que PRÉ-REMPLIR les champs, qu'elle relit et
 * enregistre elle-même. Rien n'est jamais enregistré par la machine.
 */
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db, schema } from "./db/client.js";
import { tc, type Langue } from "./courriels/index.js";
import { fr } from "./courriels/fr.js";

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
 * Le dictionnaire de traductions d'une ligne : langue → champ → texte.
 * Toutes les colonnes `translations` du schéma ont cette forme ; seuls les
 * champs changent d'une table à l'autre (name, description, message…).
 */
type Traductions = Partial<Record<string, Partial<Record<string, unknown>>>>;

/**
 * Un champ traduit (nom, description, message…), ou undefined pour le
 * français et pour une traduction absente ou vide — l'appelant affiche alors
 * le texte français, jamais un trou.
 */
export function champTraduit(
  traductions: Traductions | null | undefined,
  langue: string,
  champ: string,
): string | undefined {
  if (langue === "fr") return undefined;
  const v = traductions?.[langue]?.[champ];
  const texte = typeof v === "string" ? v.trim() : "";
  return texte || undefined;
}

/**
 * Le texte à montrer dans une langue : sa traduction quand elle existe, le
 * français sinon.
 *
 * Un français VIDE reste vide dans toutes les langues, traduction ou pas.
 * C'est le français qui décide de ce qui s'affiche : la boutique qui efface le
 * lieu de retrait d'un mode, ou le texte du lien de son bandeau, ne doit pas
 * le voir survivre en anglais parce qu'une ancienne traduction traîne encore
 * dans le dictionnaire.
 */
export function texteDansLaLangue<T extends string | null | undefined>(
  traductions: Traductions | null | undefined,
  langue: string,
  champ: string,
  francais: T,
): T | string {
  if (!francais || !francais.trim()) return francais;
  return champTraduit(traductions, langue, champ) ?? francais;
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
  return champTraduit(traductions, langue, "name");
}

/**
 * Une traduction enregistrée, champ par champ : un champ ENVOYÉ remplace
 * l'ancien (vide, il est retiré), un champ non envoyé garde sa valeur. Une
 * langue dont il ne reste aucun champ est retirée du dictionnaire.
 *
 * « Non envoyé = inchangé » est ce qui permet à deux écrans de traduire la
 * même ligne sans s'effacer : la fiche produit enregistre le nom et la
 * description, le bloc référencement le titre et la description Google.
 */
export function fusionnerTraductions<T extends Record<string, string>>(
  existantes: Partial<Record<string, Partial<T>>> | null | undefined,
  langue: LangueEtrangere,
  champs: Partial<Record<keyof T & string, string>>,
): Partial<Record<string, Partial<T>>> {
  const suite = { ...(existantes ?? {}) };
  const entree: Record<string, string> = { ...((suite[langue] ?? {}) as Record<string, string>) };
  for (const [champ, valeur] of Object.entries(champs)) {
    if (valeur === undefined) continue;
    const propre = String(valeur).trim();
    if (propre) entree[champ] = propre;
    else delete entree[champ];
  }
  if (Object.keys(entree).length) suite[langue] = entree as Partial<T>;
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
- Keep place names in their usual form for a ${NOM_LANGUE[langue]} reader. Proper names written in CAPITALS (city names such as AMIENS, BAIE DE SOMME) stay in capitals and unchanged. Ordinary words written in capitals (for example a promotional banner such as "3 AFFICHES ACHETÉES = 1 OFFERTE") ARE translated, and stay in capitals.
- Tone: warm, natural e-commerce copy, as a native ${NOM_LANGUE[langue]} copywriter would write it — not a literal translation. Address the reader as the rest of the site does: "Sie" in German, informal "tu" in Italian and Spanish.
- Product formats (A4, A3), prices and measurements stay as they are.
- An empty value stays empty.`;

export class EchecTraduction extends Error {}

/**
 * Propose une traduction de chaque champ (texte simple ou HTML). Lève
 * EchecTraduction avec un message lisible : clé absente, service muet…
 *
 * `precisions` : des règles propres au texte, ajoutées après les règles
 * générales et qui l'emportent sur elles. Le courriel de relance s'en sert :
 * ses {variables} doivent revenir intactes, et l'italien comme l'espagnol y
 * tutoient, comme le site — là où la règle générale dirait « Lei », « usted ».
 */
export async function proposerTraduction(
  champs: Record<string, string>,
  langue: LangueEtrangere,
  precisions?: string,
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
            {
              role: "system",
              content: precisions?.trim()
                ? `${CONSIGNE(langue)}\nAdditional rules for this text (they take precedence over the rules above):\n${precisions.trim()}`
                : CONSIGNE(langue),
            },
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
 * Une table du schéma qui porte une colonne `translations` : c'est tout ce
 * dont la route d'enregistrement a besoin. Les champs traduits, eux, sont
 * donnés à `routeTraductions` — ils diffèrent d'une table à l'autre.
 */
type TableTraduisible = PgTable & { id: AnyPgColumn; translations: AnyPgColumn };

/**
 * Enregistre les traductions d'une ligne, UNE langue à la fois :
 * { lang, <champ>: texte, … }, pour les seuls champs listés dans `champs`
 * (nom du champ → longueur maximale).
 *
 * Un champ envoyé vide retire sa traduction — le français s'affiche de
 * nouveau ; un champ non envoyé garde la sienne (voir fusionnerTraductions).
 * Rend { translations } : le dictionnaire entier, tel qu'enregistré.
 *
 * Une seule route pour toutes les tables, parce que la règle doit être la
 * même partout : une cliente qui vide une case du mode de livraison doit
 * obtenir exactement ce qu'elle obtient en vidant celle d'un cadre.
 */
function routeTraductions(
  app: Hono,
  chemin: string,
  table: TableTraduisible,
  champs: Record<string, number>,
): void {
  app.post(chemin, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "introuvable" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const langue = String(b.lang ?? "") as LangueEtrangere;
    if (!(LANGUES_ETRANGERES as readonly string[]).includes(langue))
      return c.json({ error: "langue inconnue" }, 400);
    const envoyes: Record<string, string> = {};
    for (const [champ, max] of Object.entries(champs))
      if (champ in b) envoyes[champ] = String(b[champ] ?? "").slice(0, max);
    if (!Object.keys(envoyes).length)
      return c.json({ error: `rien à traduire : ${Object.keys(champs).join(", ")}` }, 400);

    const [ligne] = (await db
      .select({ translations: table.translations })
      .from(table)
      .where(eq(table.id, id))) as { translations: Traductions | null }[];
    if (!ligne) return c.json({ error: "introuvable" }, 404);
    const translations = fusionnerTraductions(
      ligne.translations as Partial<Record<string, Partial<Record<string, string>>>> | null,
      langue,
      envoyes,
    );
    await db
      .update(table)
      // Le type de `set` dépend de la table précise ; ici seule la colonne
      // `translations` est écrite, et toutes les tables listées l'ont.
      .set({ translations: Object.keys(translations).length ? translations : null } as never)
      .where(eq(table.id, id));
    return c.json({ translations });
  });
}

/**
 * Le nom et la description du mode de livraison d'une commande, dans la
 * langue de la cliente — pour ses courriels et sa facture.
 *
 * La commande garde le nom FRANÇAIS du jour où elle a été passée
 * (`shippingLabel`) : c'est celui du back-office, des bordereaux et de
 * l'atelier, et il ne doit pas changer. Pour une autre langue, on reprend la
 * traduction du mode par son `slug` (`shippingMethod`) — archivé compris :
 * une commande partie avec un mode rangé depuis reste écrite dans la langue
 * de sa cliente. Sans traduction, le français figé sur la commande.
 *
 * La vente du stand n'a pas de mode : son « Remise sur le stand » est écrit
 * par le code (salon.ts) et se traduit donc par le dictionnaire des
 * courriels.
 *
 * En français, rend exactement ce que la commande porte : le courriel et la
 * facture français ne changent pas d'un octet.
 */
export async function livraisonDansLaLangue(
  commande: {
    shippingMethod: string | null;
    shippingLabel: string | null;
    shippingDescription?: string | null;
  },
  langue: string,
): Promise<{ nom: string | null; description: string | null }> {
  const francais = {
    nom: commande.shippingLabel,
    description: commande.shippingDescription ?? null,
  };
  if (langue === "fr" || !(LANGUES_ETRANGERES as readonly string[]).includes(langue))
    return francais;
  const remiseAuStand =
    commande.shippingLabel === fr["livraison.remiseStand"]
      ? tc(langue as Langue)("livraison.remiseStand")
      : undefined;
  const [mode] = commande.shippingMethod
    ? await db
        .select({ translations: schema.shippingMethods.translations })
        .from(schema.shippingMethods)
        .where(eq(schema.shippingMethods.slug, commande.shippingMethod))
    : [];
  return {
    // La traduction écrite par la boutique d'abord : si elle a appelé un de
    // ses modes « Remise sur le stand », c'est sa traduction qui compte. Rien
    // de figé sur la commande, rien à traduire : un nom vide le reste.
    nom: francais.nom?.trim()
      ? (champTraduit(mode?.translations, langue, "name") ?? remiseAuStand ?? francais.nom)
      : francais.nom,
    description: texteDansLaLangue(
      mode?.translations,
      langue,
      "description",
      francais.description,
    ),
  };
}

/**
 * POST /admin/traduire { lang, champs: { name?, description?, … } }
 *   → { champs: { … traduits } }
 * Sous /admin/* : protégée par la garde du back-office. N'ENREGISTRE RIEN.
 *
 * Et les routes d'enregistrement des traductions saisies au back-office,
 * toutes sur le même modèle (voir routeTraductions) :
 *   POST /admin/<table>/:id/translations { lang, <champ>: texte, … }
 */
export function mountTraduction(app: Hono): void {
  routeTraductions(app, "/admin/categories/:id/translations", schema.characterCategories, {
    name: 120,
  });
  routeTraductions(app, "/admin/frames/:id/translations", schema.frames, { name: 120 });
  // Les personnages : leur nom s'affiche dans le module de personnalisation.
  routeTraductions(app, "/admin/characters/:id/translations", schema.characterTypes, {
    name: 120,
  });
  // Les modes de livraison : ce que la caisse montre, et ce que redisent les
  // courriels et la facture. La note de préparation n'en est pas : elle est
  // écrite pour la boutique. La description va jusqu'à 1000 caractères : pour
  // un retrait sur place, c'est le texte de plusieurs lignes que la caisse
  // affiche (horaires, ce qu'il faut apporter).
  routeTraductions(app, "/admin/shipping/methods/:id/translations", schema.shippingMethods, {
    name: 120,
    description: 1000,
    pickupLocation: 500,
  });
  // Les lieux de retrait (lieux-retrait.ts) : leur nom et leur texte se
  // lisent à la caisse et dans les courriels. L'adresse ne se traduit pas.
  routeTraductions(app, "/admin/pickup-points/:id/translations", schema.pickupPoints, {
    nom: 120,
    description: 1000,
  });
  // Le bandeau d'annonce : son message et le texte de son lien.
  routeTraductions(app, "/admin/banner/:id/translations", schema.announcementBanners, {
    message: 500,
    linkLabel: 120,
  });
  // Les collections : leur nom fait le titre du rayon. La description suit
  // la limite de la française (collections.ts), avec de la marge pour les
  // langues plus longues.
  routeTraductions(app, "/admin/collections/:id/translations", schema.collections, {
    name: 120,
    description: 4000,
  });
  // Les promotions : leur nom s'écrit sur la ligne de remise du panier.
  routeTraductions(app, "/admin/promos/:id/translations", schema.promoRules, {
    name: 120,
  });
  // Les styles d'affiche IA : leur titre est le seul mot que la cliente lit
  // avant d'envoyer sa photo (« Paysage »). La consigne, elle, part au modèle
  // et ne se traduit pas.
  routeTraductions(app, "/admin/ia/prompts/:id/translations", schema.aiPrompts, {
    title: 120,
  });

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
