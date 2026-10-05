/**
 * Faire suivre au menu du site l'ordre réglé ailleurs.
 *
 * La boutique range ses collections (écran « Collections ») et ses pages
 * (« Pages du site ») pour que cet ordre soit celui du SITE. Or ce que la
 * cliente voit d'abord, c'est le menu : « Villes » et « Thèmes & paysages »
 * y sont des sous-liens d'« Affiches personnalisables ». Ranger les
 * collections sans que le menu bouge ferait croire que rien n'a été
 * enregistré.
 *
 * Le menu garde pourtant SON ordre, parce qu'il mêle des collections, des
 * pages et des rayons : seuls les liens qui mènent aux éléments rangés
 * changent de place entre eux, et chacun reprend une des places que ces liens
 * occupaient déjà. « Tout voir » reste en tête ; « Villes » et « Thèmes &
 * paysages » échangent leur place si on les a échangées. Rien n'est ajouté,
 * rien n'est retiré, et l'écran « Menu du site » montre le résultat.
 */
import { asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db/client.js";

/** Une transaction ouverte par `db.transaction`. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Ce que montre une adresse du menu, réduit à ce qui se range : une
 * collection (« collection:villes ») ou une page écrite (« page:magnets »).
 *
 * Par ce qu'elle MONTRE et non lettre à lettre : le menu de la boutique mène
 * à « Villes » par « /affiches?genre=personnalisable&collection=villes ».
 */
export function cibleDuLien(href: string): string | null {
  const brut = href.trim();
  if (!brut.startsWith("/")) return null;
  let adresse: URL;
  try {
    adresse = new URL(brut, "https://boutique.invalid");
  } catch {
    return null;
  }
  const chemin = adresse.pathname.replace(/\/+$/, "").toLowerCase();
  if (chemin === "/affiches") {
    const collection = adresse.searchParams.get("collection");
    return collection ? `collection:${collection.toLowerCase()}` : null;
  }
  const page = /^\/pages\/([^/]+)$/.exec(chemin);
  return page ? `page:${page[1]}` : null;
}

/**
 * Range, entrée par entrée, les liens du menu qui mènent aux éléments de
 * `rangs` (cible → rang voulu), sans toucher aux autres. Rend le nombre de
 * liens déplacés.
 */
export async function menuSuitLOrdre(
  tx: Transaction,
  rangs: Map<string, number>,
): Promise<number> {
  const lignes = await tx
    .select({
      id: schema.menuItems.id,
      parentId: schema.menuItems.parentId,
      href: schema.menuItems.href,
      position: schema.menuItems.position,
    })
    .from(schema.menuItems)
    // Un lien retiré du menu garde sa place d'avant : il la retrouvera s'il
    // est restauré, on ne la lui change pas pendant son absence.
    .where(isNull(schema.menuItems.archivedAt))
    .orderBy(asc(schema.menuItems.position), asc(schema.menuItems.id));

  const freresPar = new Map<number | null, typeof lignes>();
  for (const l of lignes) {
    const freres = freresPar.get(l.parentId);
    if (freres) freres.push(l);
    else freresPar.set(l.parentId, [l]);
  }

  let deplaces = 0;
  for (const freres of freresPar.values()) {
    const concernes = freres
      .map((l) => ({ ...l, cible: cibleDuLien(l.href) }))
      .filter((l) => l.cible !== null && rangs.has(l.cible));
    // Un seul lien concerné sous une entrée : il n'a personne à doubler.
    if (concernes.length < 2) continue;
    const places = concernes.map((l) => l.position).sort((a, b) => a - b);
    const voulus = [...concernes].sort(
      (a, b) => rangs.get(a.cible!)! - rangs.get(b.cible!)! || a.position - b.position,
    );
    for (let i = 0; i < voulus.length; i++) {
      const lien = voulus[i]!;
      if (lien.position === places[i]) continue;
      await tx
        .update(schema.menuItems)
        .set({ position: places[i]! })
        .where(eq(schema.menuItems.id, lien.id));
      deplaces += 1;
    }
  }
  return deplaces;
}
