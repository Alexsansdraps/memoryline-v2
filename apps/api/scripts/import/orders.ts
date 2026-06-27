import { db, schema } from "../../src/db/client.js";
import {
  readCsv,
  groupByTopRow,
  toCents,
  toInt,
  legacyPropertiesToConfig,
  bump,
  type ImportReport,
} from "./lib.js";

/**
 * Importe clients + commandes (web ET salon), avec snapshot de perso (§14.3).
 *
 * Canal (§11) :
 *   Source = 'web'                 -> channel 'web'  -> numéro WEB-xxxx
 *   Source = 'shopify_draft_order' -> channel 'salon' -> numéro SAL-xxxx
 *
 * Numéro Shopify (#1001…) conservé dans legacy_name. Le numéro interne est
 * dérivé du n° Shopify pour rester stable et rejouable.
 */
export async function importCustomersAndOrders(report: ImportReport) {
  // --- Reset (idempotence) ----------------------------------------------
  await db.delete(schema.payments);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.customers);

  // --- Clients (Customers.csv) ------------------------------------------
  const customerIdByLegacy = new Map<number, number>();
  const customerIdByEmail = new Map<string, number>();

  for (const group of groupByTopRow(readCsv("Customers.csv"))) {
    const head = group[0]!;
    const legacyId = toInt(head["ID"]);
    const email = (head["Email"] ?? "").trim().toLowerCase();
    const first = (head["First Name"] ?? "").trim();
    const last = (head["Last Name"] ?? "").trim();
    const name = [first, last].filter(Boolean).join(" ") || null;
    if (!legacyId && !email) {
      bump(report, "customer", "skipped");
      continue;
    }
    const [row] = await db
      .insert(schema.customers)
      .values({
        name,
        email: email || null,
        phone: (head["Phone"] ?? "").trim() || null,
        legacyId: legacyId ?? undefined,
      })
      .returning({ id: schema.customers.id });
    if (legacyId) customerIdByLegacy.set(legacyId, row!.id);
    if (email) customerIdByEmail.set(email, row!.id);
    bump(report, "customer", "created");
  }

  // index produits/variantes par legacy id (pour rattacher les line items)
  const products = await db
    .select({ id: schema.products.id, legacyId: schema.products.legacyId })
    .from(schema.products);
  const productIdByLegacy = new Map<number, number>();
  for (const p of products) if (p.legacyId) productIdByLegacy.set(p.legacyId, p.id);

  const variants = await db
    .select({ id: schema.variants.id, legacyId: schema.variants.legacyId })
    .from(schema.variants);
  const variantIdByLegacy = new Map<number, number>();
  for (const v of variants) if (v.legacyId) variantIdByLegacy.set(v.legacyId, v.id);

  // --- Commandes (Orders.csv) -------------------------------------------
  // compteurs de séquence par canal
  const seq = { web: 0, salon: 0 };

  for (const group of groupByTopRow(readCsv("Orders.csv"))) {
    const head = group[0]!;
    const source = (head["Source"] ?? "").trim();
    const legacyName = (head["Name"] ?? "").trim();
    if (!legacyName) {
      bump(report, "order", "skipped");
      continue;
    }
    const channel: "web" | "salon" = source === "web" ? "web" : "salon";
    seq[channel] += 1;
    const prefix = channel === "web" ? "WEB" : "SAL";
    const number = `${prefix}-${String(seq[channel]).padStart(4, "0")}`;

    // client
    const custLegacy = toInt(head["Customer: ID"]);
    const custEmail = (head["Customer: Email"] ?? head["Email"] ?? "")
      .trim()
      .toLowerCase();
    let customerId: number | null = null;
    if (custLegacy && customerIdByLegacy.has(custLegacy)) {
      customerId = customerIdByLegacy.get(custLegacy)!;
    } else if (custEmail && customerIdByEmail.has(custEmail)) {
      customerId = customerIdByEmail.get(custEmail)!;
    } else if (custEmail) {
      // client guest non présent dans Customers.csv -> on le crée
      const name =
        [head["Customer: First Name"], head["Customer: Last Name"]]
          .map((s) => (s ?? "").trim())
          .filter(Boolean)
          .join(" ") || null;
      const [c] = await db
        .insert(schema.customers)
        .values({ name, email: custEmail, legacyId: custLegacy ?? undefined })
        .returning({ id: schema.customers.id });
      customerId = c!.id;
      customerIdByEmail.set(custEmail, c!.id);
      bump(report, "customer", "created");
    }

    const status = (head["Payment: Status"] ?? "").trim() || "pending";
    const [order] = await db
      .insert(schema.orders)
      .values({
        channel,
        number,
        status,
        totalCents: toCents(head["Price: Total"]),
        customerId,
        legacyId: toInt(head["ID"]) ?? undefined,
        legacyName,
        // commandes web historiques = déjà vues ; salon = à signaler (§17.3)
        seenAt: channel === "web" ? new Date() : null,
        createdAt: parseDate(head["Created At"]),
      })
      .returning({ id: schema.orders.id });
    const orderId = order!.id;
    bump(report, "order", "created");
    bump(report, `order_${channel}`, "created");

    // line items = lignes Line: Type == 'Line Item'
    for (const r of group) {
      if ((r["Line: Type"] ?? "").trim() !== "Line Item") continue;
      const config = legacyPropertiesToConfig(r["Line: Properties"] ?? "");
      const vLegacy = toInt(r["Line: Variant ID"]);
      const pLegacy = toInt(r["Line: Product ID"]);
      await db.insert(schema.orderItems).values({
        orderId,
        productId: (pLegacy && productIdByLegacy.get(pLegacy)) || null,
        variantId: (vLegacy && variantIdByLegacy.get(vLegacy)) || null,
        config: config ?? null,
        title: (r["Line: Title"] ?? "").trim() || null,
        unitPriceCents: toCents(r["Line: Price"]),
        quantity: toInt(r["Line: Quantity"]) ?? 1,
      });
      bump(report, "order_item", "created");
      if (config) bump(report, "order_item_with_config", "created");
    }
  }
}

function parseDate(v: string | undefined): Date {
  if (!v) return new Date();
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
