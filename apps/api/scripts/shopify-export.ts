/**
 * Export PROPRE depuis Shopify via l'Admin GraphQL API.
 *
 * Récupère, pour récupération avant la suppression du site :
 *  - tous les produits (handle, title) + TOUS leurs metafields
 *    (dont le blob configurateur {backgrounds, title, subtitle, view}),
 *  - tous les metaobjects (toutes définitions).
 *
 * Écrit data/memoryline-archive/shopify-graphql-export.json (gitignored).
 *
 * Prérequis (.env, jamais commité) :
 *   SHOPIFY_STORE=xxxx.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN=shpat_...
 *
 * Usage : pnpm --filter @memoryline/api run shopify-export
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = "2024-10";

if (!STORE || !TOKEN) {
  console.error(
    "✗ SHOPIFY_STORE et SHOPIFY_ADMIN_TOKEN requis dans .env\n" +
      "  SHOPIFY_STORE=xxxx.myshopify.com\n  SHOPIFY_ADMIN_TOKEN=shpat_...",
  );
  process.exit(1);
}

const ENDPOINT = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

const PRODUCTS_QUERY = `
query Products($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title
      metafields(first: 30) {
        nodes { namespace key type value }
      }
    }
  }
}`;

const METAOBJECTS_DEFS_QUERY = `
query Defs { metaobjectDefinitions(first: 50) { nodes { type name } } }`;

const METAOBJECTS_QUERY = `
query Metaobjects($type: String!, $cursor: String) {
  metaobjects(type: $type, first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id handle type fields { key value type } }
  }
}`;

async function main() {
  // 1. Produits + metafields (pagination).
  const products: unknown[] = [];
  let cursor: string | null = null;
  do {
    const data: any = await gql(PRODUCTS_QUERY, { cursor });
    products.push(...data.products.nodes);
    cursor = data.products.pageInfo.hasNextPage
      ? data.products.pageInfo.endCursor
      : null;
    console.log(`  produits: ${products.length}…`);
  } while (cursor);

  // 2. Metaobjects (toutes définitions).
  const metaobjects: Record<string, unknown[]> = {};
  try {
    const defs: any = await gql(METAOBJECTS_DEFS_QUERY);
    for (const def of defs.metaobjectDefinitions.nodes) {
      const list: unknown[] = [];
      let c: string | null = null;
      do {
        const data: any = await gql(METAOBJECTS_QUERY, { type: def.type, cursor: c });
        list.push(...data.metaobjects.nodes);
        c = data.metaobjects.pageInfo.hasNextPage
          ? data.metaobjects.pageInfo.endCursor
          : null;
      } while (c);
      metaobjects[def.type] = list;
      console.log(`  metaobject "${def.type}": ${list.length}`);
    }
  } catch (e) {
    console.warn("  (metaobjects non lus — scope manquant ?)", String(e).slice(0, 80));
  }

  const out = resolve(
    fileURLToPath(import.meta.url),
    "../../../../data/memoryline-archive/shopify-graphql-export.json",
  );
  await writeFile(out, JSON.stringify({ products, metaobjects }, null, 2));
  console.log(`✓ Export écrit : ${out}`);
  console.log(`  ${products.length} produits, ${Object.keys(metaobjects).length} types de metaobjects`);
}

main().catch((e) => {
  console.error("✗ Export échoué :", e);
  process.exit(1);
});
