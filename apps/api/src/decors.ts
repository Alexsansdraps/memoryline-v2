/**
 * Les décors des affiches, vus tous ensemble.
 *
 * Un décor est le dessin de fond d'une affiche personnalisable : la Tour
 * Eiffel vue de la rue, le phare du Tréport, la cathédrale d'Amiens. C'est le
 * cœur du catalogue, et jusqu'ici on ne pouvait les voir qu'un par un, en
 * ouvrant la fiche de l'affiche à laquelle ils sont rattachés. Impossible donc
 * de répondre à la question la plus simple : « qu'est-ce qu'on a, au juste ? »
 *
 * Cette question n'est pas théorique. Le configurateur propose au client les
 * décors rattachés à l'affiche ; et quand une affiche n'en a aucun, il en
 * cherche par le NOM DE LA VILLE. Une affiche « PARIS Tour Eiffel vue rue »
 * sans décor à elle se voit donc proposer tous les décors dont le nom
 * commence par Paris — sans que personne ne l'ait décidé, et sans qu'aucun
 * écran ne le montre.
 *
 * D'où cet écran : tous les décors, leur nom, l'affiche à laquelle ils
 * appartiennent, et surtout ceux qui n'appartiennent à personne — ceux-là ne
 * remontent que par la pêche au nom, et ce sont eux qui surprennent.
 */
import type { Hono } from "hono";
import { asc, eq, isNull, sql as raw } from "drizzle-orm";
import { db, schema } from "./db/client.js";

/** Longueur maximale d'un nom de décor. Au-delà, plus rien ne se lit. */
const NOM_MAX = 160;

/**
 * Le premier mot du nom d'une affiche, normalisé.
 *
 * C'est exactement ce que fait la pêche au nom de ville du configurateur : on
 * le refait ici pour pouvoir MONTRER ce qu'elle trouverait, au lieu de le
 * laisser se découvrir en boutique.
 */
function villeDe(nom: string | null): string {
  const morceaux = (nom ?? "")
    .split(/[-–]/)[0]!
    .trim()
    .split(/\s+/)
    .map((m) =>
      m
        .toUpperCase()
        .normalize("NFD")
        .replace(/[^A-Z0-9]/g, ""),
    )
    .filter((m) => m.length >= 3 && !["LES", "DES", "AFFICHE"].includes(m));
  return morceaux[0] ?? "";
}

export function mountDecors(app: Hono): void {
  /**
   * Tous les décors, avec l'affiche de chacun.
   *
   * Une seule requête pour les décors, une seule pour les affiches : l'écran
   * en montre cent soixante d'un coup, et cent soixante requêtes le feraient
   * ramer sans rien apporter.
   */
  app.get("/admin/decors", async (c) => {
    if (c.get("utilisateur")?.role !== "owner")
      return c.json(
        { error: "Les décors du catalogue sont réservés à la propriétaire." },
        403,
      );

    const decors = await db
      .select({
        id: schema.backgrounds.id,
        nom: schema.backgrounds.name,
        url: schema.backgrounds.url,
        position: schema.backgrounds.position,
        produitId: schema.backgrounds.productId,
        produitNom: schema.products.name,
        produitSlug: schema.products.slug,
        produitStatut: schema.products.status,
      })
      .from(schema.backgrounds)
      .leftJoin(
        schema.products,
        eq(schema.products.id, schema.backgrounds.productId),
      )
      // Les décors archivés sortent de l'inventaire : la question posée ici est
      // « qu'est-ce que le configurateur a sous la main ? », et il ne les
      // propose plus. Ils restent sur la fiche de leur affiche, dans
      // « Visuels archivés », avec leur bouton « Restaurer ».
      .where(isNull(schema.backgrounds.archivedAt))
      .orderBy(asc(schema.backgrounds.name), asc(schema.backgrounds.id));

    // Les affiches qui n'ont AUCUN décar à elles : ce sont celles pour
    // lesquelles le configurateur pêche par nom de ville, et donc celles où
    // des décors inattendus peuvent apparaître.
    const sansDecor = await db
      .select({
        id: schema.products.id,
        nom: schema.products.name,
        slug: schema.products.slug,
      })
      .from(schema.products)
      .where(
        // « Aucun décor » veut dire aucun décor PROPOSABLE : une affiche dont
        // tous les décors sont archivés retombe sur la pêche au nom de ville,
        // exactement comme une affiche qui n'en a jamais eu.
        raw`${schema.products.kind} = 'personnalisable' and not exists (select 1 from ${schema.backgrounds} b where b.product_id = ${schema.products.id} and b.archived_at is null)`,
      )
      .orderBy(asc(schema.products.name));

    // Ce que la pêche trouverait pour chacune : on regroupe les décors par
    // ville pour pouvoir le dire sans interroger la base affiche par affiche.
    const parVille = new Map<string, number>();
    for (const d of decors) {
      const ville = villeDe(d.nom ?? d.produitNom);
      if (ville) parVille.set(ville, (parVille.get(ville) ?? 0) + 1);
    }

    return c.json({
      decors: decors.map((d) => ({
        ...d,
        ville: villeDe(d.nom ?? d.produitNom),
        orphelin: d.produitId === null,
      })),
      sansDecor: sansDecor.map((p) => ({
        ...p,
        ville: villeDe(p.nom),
        // Combien de décors la pêche au nom lui proposerait. Zéro veut dire
        // que le configurateur n'aura rien à montrer.
        devines: parVille.get(villeDe(p.nom)) ?? 0,
      })),
    });
  });

  /**
   * Renomme un décor.
   *
   * Ce n'est pas cosmétique : c'est le nom qui décide de ce que la pêche au
   * nom de ville trouvera. Un décor importé s'appelle
   * « paris-rues-eiffel-affiche-personnalisee-a6bcbfab », ce qui ne se lit pas
   * et ne se retrouve pas.
   */
  app.post("/admin/decors/:id", async (c) => {
    if (c.get("utilisateur")?.role !== "owner")
      return c.json(
        { error: "Les décors du catalogue sont réservés à la propriétaire." },
        403,
      );
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "Ce décor n'existe plus. Rechargez la page." }, 400);

    const corps = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const nom = String(corps.nom ?? "").trim().slice(0, NOM_MAX);
    if (!nom)
      return c.json(
        { error: "Donnez un nom au décor, par exemple « PARIS Tour Eiffel vue rue »." },
        400,
      );

    const [maj] = await db
      .update(schema.backgrounds)
      .set({ name: nom })
      .where(eq(schema.backgrounds.id, id))
      .returning({ id: schema.backgrounds.id, nom: schema.backgrounds.name });
    if (!maj) return c.notFound();
    return c.json({ ...maj, ville: villeDe(maj.nom) });
  });

  /**
   * Les décors qui n'appartiennent à aucune affiche.
   *
   * Route séparée parce qu'elle répond à une question différente : « qu'est-ce
   * qui traîne ? ». Ceux-là ne s'affichent jamais d'eux-mêmes ; ils ne
   * remontent que par la pêche au nom, chez une affiche qui n'a rien à elle.
   */
  app.get("/admin/decors/orphelins", async (c) => {
    if (c.get("utilisateur")?.role !== "owner")
      return c.json(
        { error: "Les décors du catalogue sont réservés à la propriétaire." },
        403,
      );
    const rows = await db
      .select()
      .from(schema.backgrounds)
      .where(isNull(schema.backgrounds.productId))
      .orderBy(asc(schema.backgrounds.name));
    return c.json(rows);
  });
}
