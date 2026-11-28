// Essai du pixel Meta dans Chrome sans écran (28/11), piloté par Playwright.
//
// AUCUNE requête ne part chez Meta : tout ce qui va vers facebook.com,
// facebook.net, fbcdn.net ou fb.com est intercepté, noté, puis ANNULÉ.
// Le vrai memoryline.fr n'est jamais joint : la partie 1 le remplace par une
// page fabriquée ici (le code de base du pixel et le bandeau cookies, recopiés
// tels quels de Base.astro et CookieBanner.astro). La partie 2 utilise le site
// LOCAL (http://localhost:8080, pile docker de dev) avec un faux `fbq` qui
// note ses appels ; la création de commande et le paiement y sont simulés
// (routes interceptées) : rien n'est créé que des paniers brouillons locaux,
// retirés à la fin.
//
//   apps/api/node_modules/.bin/tsx travaux/pixel-meta/essai-navigateur.mts
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require(resolve(ici, "../../apps/web/node_modules/playwright")) as typeof import("playwright");
type Page = import("playwright").Page;
type BrowserContext = import("playwright").BrowserContext;

const CAPTURES = resolve(ici, "captures");
mkdirSync(CAPTURES, { recursive: true });
const LOCAL = "http://localhost:8080";

const BASE = readFileSync(resolve(ici, "../../apps/web/src/layouts/Base.astro"), "utf8");
const d = BASE.indexOf("{/* Le pixel Meta (28/11");
const o = BASE.indexOf("<script is:inline>", d) + "<script is:inline>".length;
const PIXEL = BASE.slice(o, BASE.indexOf("</script>", o));
const BANNIERE = readFileSync(resolve(ici, "../../apps/web/src/components/CookieBanner.astro"), "utf8");
const ob = BANNIERE.indexOf("<script is:inline>") + "<script is:inline>".length;
const BANNIERE_JS = BANNIERE.slice(ob, BANNIERE.indexOf("</script>", ob));

const resultats: { nom: string; ok: boolean }[] = [];
function verifier(nom: string, ok: boolean, detail?: unknown) {
  resultats.push({ nom, ok });
  const suite = detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 400)}`;
  console.log(`${ok ? "OK   " : "ÉCHEC"} ${nom}${suite}`);
}

const navigateur = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const META = /^https?:\/\/([^/]+\.)?(facebook\.(com|net)|fbcdn\.net|fb\.com)(\/|:|$)/i;
const versMetaTotal: string[] = [];

async function contexte(): Promise<{ ctx: BrowserContext; versMeta: string[] }> {
  const ctx = await navigateur.newContext({ locale: "fr-FR" });
  const versMeta: string[] = [];
  await ctx.route(
    (u: URL) => META.test(u.href),
    (r) => {
      versMeta.push(r.request().url());
      versMetaTotal.push(r.request().url());
      return r.abort();
    },
  );
  return { ctx, versMeta };
}

/* ======================================================================
 * Partie 1 — le code de base, sur une page fabriquée servie comme
 * https://memoryline.fr (rien ne sort de la machine).
 * ==================================================================== */

function pageFabriquee(url: string): string {
  const u = new URL(url);
  const stand = u.searchParams.has("stand") && u.searchParams.get("stand") !== "0";
  return `<!doctype html><html lang="fr"${stand ? ' data-stand="1"' : ""}><head><meta charset="utf-8"><title>essai</title>
<script>${PIXEL}</script></head><body><h1>Essai du pixel</h1><a id="lien" href="/commande">suite</a>
<div id="cookie-banner" hidden><button data-consent="refuse">Refuser</button><button data-consent="accept">Accepter</button></div>
<script>${BANNIERE_JS}</script></body></html>`;
}

async function siteFabrique(ctx: BrowserContext) {
  await ctx.route(/^https:\/\/(www\.)?memoryline\.fr\//, (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: pageFabriquee(r.request().url()) }),
  );
}

async function etat(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { fbq?: { queue?: ArrayLike<unknown>[] }; _fbq?: unknown };
    return {
      fbq: typeof w.fbq,
      _fbq: typeof w._fbq,
      file: w.fbq?.queue ? Array.from(w.fbq.queue, (a) => Array.from(a)) : null,
      scripts: Array.from(document.querySelectorAll("script[src]"), (s) => (s as HTMLScriptElement).src),
      cookies: document.cookie,
      referrer: document.referrer,
    };
  });
}
const FBEVENTS = "https://connect.facebook.net/en_US/fbevents.js";
const BASE_ATTENDUE = JSON.stringify([
  ["set", "autoConfig", false, "1156538100082754"],
  ["init", "1156538100082754"],
  ["track", "PageView"],
]);

console.log("— Partie 1 : code de base sur une page fabriquée (https://memoryline.fr simulé)");
{
  const { ctx, versMeta } = await contexte();
  await siteFabrique(ctx);
  const page = await ctx.newPage();
  await page.goto("https://memoryline.fr/");
  await page.waitForTimeout(1500);
  let e = await etat(page);
  verifier("1. sans choix : ni fbq ni _fbq", e.fbq === "undefined" && e._fbq === "undefined", e);
  verifier("1. sans choix : aucune requête vers Meta, aucun script", versMeta.length === 0 && e.scripts.length === 0, versMeta);
  verifier("1. sans choix : le bandeau est affiché", await page.locator("#cookie-banner").isVisible());

  await page.click("[data-consent=accept]");
  e = await etat(page);
  verifier("2. « Accepter » : fbq posé, file = autoConfig off / init / PageView", JSON.stringify(e.file) === BASE_ATTENDUE, e.file);
  await page.waitForTimeout(1200);
  verifier("2. « Accepter » : le script de Meta est demandé (requête annulée par l'essai)", versMeta.includes(FBEVENTS), versMeta);
  e = await etat(page);
  verifier("2. pas de cookie _fbp (le script de Meta n'a jamais tourné)", !/_fbp|_fbc/.test(e.cookies), e.cookies);

  versMeta.length = 0;
  await page.reload();
  e = await etat(page);
  verifier("3. choix « accept » gardé : fbq dès la page suivante", JSON.stringify(e.file) === BASE_ATTENDUE, e.file);
  await page.waitForTimeout(1200);
  verifier("3. choix « accept » gardé : script de Meta demandé après la page", versMeta.filter((u) => u === FBEVENTS).length === 1, versMeta);

  await page.evaluate(() => (document.querySelector("[data-consent=refuse]") as HTMLElement).click());
  e = await etat(page);
  verifier("4. « Refuser » après « Accepter » : consent revoke", JSON.stringify(e.file?.at(-1)) === '["consent","revoke"]', e.file?.at(-1));
  await page.evaluate(() => (document.querySelector("[data-consent=accept]") as HTMLElement).click());
  await page.waitForTimeout(600);
  e = await etat(page);
  verifier("4. ré-accepter : consent grant, sans second chargement", JSON.stringify(e.file?.at(-1)) === '["consent","grant"]' && versMeta.filter((u) => u === FBEVENTS).length === 1, { fin: e.file?.at(-1), versMeta });

  // « accept » gardé : le stand, le retour de banque, les liens à jeton.
  versMeta.length = 0;
  await page.goto("https://memoryline.fr/?stand=1&accueil=1");
  await page.waitForTimeout(1500);
  e = await etat(page);
  verifier("5. tablette du stand (?stand=1 → data-stand) : rien", e.fbq === "undefined" && versMeta.length === 0, { fbq: e.fbq, versMeta });

  versMeta.length = 0;
  await page.goto("https://memoryline.fr/commande?payment_intent=pi_E&payment_intent_client_secret=pi_E_secret_E&redirect_status=succeeded");
  await page.waitForTimeout(2500);
  e = await etat(page);
  verifier("6. retour de banque : fbq en attente, script de Meta PAS demandé tant que le secret est dans l'adresse", e.fbq === "function" && versMeta.length === 0, versMeta);
  await page.evaluate(() => history.replaceState(history.state, "", window.location.pathname));
  await page.waitForTimeout(1200);
  verifier("6. adresse effacée par la caisse : le script de Meta vient", versMeta.includes(FBEVENTS), versMeta);

  versMeta.length = 0;
  await page.goto("https://memoryline.fr/compte/reinitialiser?jeton=JETON-ESSAI");
  await page.waitForTimeout(3000);
  verifier("7. lien « mot de passe oublié » (jeton) : Meta ne vient pas", versMeta.length === 0, versMeta);
  versMeta.length = 0;
  await page.goto("https://memoryline.fr/panier/recuperer?jeton=JETON-ESSAI");
  await page.click("#lien"); // vers /commande, sans balise « referrer » sur cette page fabriquée
  await page.waitForTimeout(1500);
  e = await etat(page);
  verifier("8. page ouverte depuis une adresse à jeton (filet du script) : Meta ne vient pas", versMeta.length === 0 && /jeton/.test(e.referrer), { referrer: e.referrer, versMeta });
  await ctx.close();
}
{
  const { ctx, versMeta } = await contexte();
  await siteFabrique(ctx);
  const page = await ctx.newPage();
  await page.goto("https://memoryline.fr/affiches");
  await page.click("[data-consent=refuse]");
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1500);
  const e = await etat(page);
  verifier("9. « Refuser » puis page suivante : rien", e.fbq === "undefined" && versMeta.length === 0, { fbq: e.fbq, versMeta });
  await page.goto("https://www.memoryline.fr/");
  await page.click("[data-consent=accept]");
  await page.waitForTimeout(1500);
  const w = await etat(page);
  verifier("10. www.memoryline.fr (redirigé en vrai) : rien même après « Accepter »", w.fbq === "undefined" && versMeta.length === 0, { fbq: w.fbq, versMeta });
  await ctx.close();
}

/* ======================================================================
 * Partie 2 — le site LOCAL (dev) : îlots réels, faux fbq, accord simulé.
 * ==================================================================== */

type Appel = unknown[];
async function contexteLocal(accord: string | null) {
  const { ctx, versMeta } = await contexte();
  const appels: Appel[] = [];
  await ctx.exposeFunction("__noterFbq", (json: string) => void appels.push(JSON.parse(json)));
  await ctx.addInitScript((a: string | null) => {
    try {
      if (a) localStorage.setItem("ml_cookie_consent", a);
    } catch {
      /* rien */
    }
    (window as unknown as { fbq: unknown }).fbq = function () {
      // eslint-disable-next-line prefer-rest-params
      void (window as unknown as { __noterFbq: (s: string) => unknown }).__noterFbq(JSON.stringify(Array.from(arguments)));
    };
  }, accord);
  return { ctx, appels, versMeta };
}

type Ligne = { id: number; unitPriceCents: number; quantity: number };
const lignesCreees: { cartId: string; itemId: number }[] = [];
/**
 * Les ajouts au panier de la page, lus DANS une route (la page quitte la
 * fiche aussitôt après : le corps de la réponse ne se lit plus ensuite).
 * `premiereClose` : le premier envoi reçoit « panier_clos » (409), comme un
 * panier déjà payé, sans toucher à l'API.
 */
async function suivreLignes(page: Page, premiereClose = false) {
  const envois: { cartId: string; envoye: Record<string, unknown>; statut: number; ligne?: Ligne }[] = [];
  await page.route(
    (u: URL) => /^\/api\/cart\/[^/]+\/items$/.test(u.pathname),
    async (r) => {
      if (r.request().method() !== "POST") return r.continue();
      const cartId = new URL(r.request().url()).pathname.split("/")[3]!;
      const envoye = r.request().postDataJSON() as Record<string, unknown>;
      if (premiereClose && envois.length === 0) {
        envois.push({ cartId, envoye, statut: 409 });
        return r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "panier_clos" }) });
      }
      const rep = await r.fetch();
      const texte = await rep.text();
      let ligne: Ligne | undefined;
      try {
        ligne = JSON.parse(texte) as Ligne;
        if (rep.ok()) lignesCreees.push({ cartId, itemId: ligne.id });
      } catch {
        /* rien */
      }
      envois.push({ cartId, envoye, statut: rep.status(), ligne });
      return r.fulfill({ response: rep, body: texte });
    },
  );
  return envois;
}
const evenements = (appels: Appel[], nom: string) => appels.filter((a) => a[0] === "track" && a[1] === nom);

console.log("— Partie 2 : site local (îlots réels, faux fbq)");

// 2a. La balise « referrer » des adresses à secret (rendu réel de Base.astro).
{
  const { ctx } = await contexte();
  const page = await ctx.newPage();
  await page.goto(`${LOCAL}/panier/recuperer?jeton=essai-pixel-inexistant`, { timeout: 90_000 });
  const balise = await page.locator('meta[name="referrer"]').getAttribute("content").catch(() => null);
  verifier("2a. lien de panier à reprendre : <meta name=referrer content=strict-origin>", balise === "strict-origin", balise);
  // Comme la page le fait elle-même (location.replace vers la caisse).
  await Promise.all([page.waitForURL(/\/affiches/, { timeout: 90_000 }), page.evaluate(() => location.assign("/affiches"))]);
  await page.waitForLoadState("domcontentloaded");
  const ref = await page.evaluate(() => document.referrer);
  verifier("2a. la page suivante ne reçoit que l'origine (pas le jeton)", ref === `${LOCAL}/`, ref);
  await page.goto(`${LOCAL}/contact`, { timeout: 90_000 });
  const sans = await page.locator('meta[name="referrer"]').count();
  verifier("2a. page ordinaire : pas de balise referrer (rien ne change)", sans === 0, sans);
  await ctx.close();
}

// 2b. Formulaire envoyé depuis une adresse à jeton : Origin gardé, Astro l'accepte.
{
  const { ctx } = await contexte();
  const page = await ctx.newPage();
  await page.goto(`${LOCAL}/compte/reinitialiser?jeton=essai-pixel-inexistant`, { timeout: 90_000 });
  let origine: string | null = null;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/compte/reinitialiser")) origine = r.headers()["origin"] ?? null;
  });
  // Deux mots de passe différents : refusés par la page AVANT tout appel à l'API.
  await page.fill('input[name="nouveau"]', "essai-pixel-un");
  await page.fill('input[name="confirmation"]', "essai-pixel-deux");
  const [rep] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/compte/reinitialiser")),
    page.locator('form:has(input[name="nouveau"]) button[type="submit"]').first().click(),
  ]);
  verifier("2b. envoi du formulaire à jeton : en-tête Origin gardé", origine === LOCAL, origine);
  verifier("2b. envoi du formulaire à jeton : Astro l'accepte (pas de 403)", rep.status() === 200, rep.status());
  await page.screenshot({ path: resolve(CAPTURES, "2b-reinitialiser.png") });
  await ctx.close();
}

// 2c. Carte cadeau, avec accord : AddToCart puis InitiateCheckout.
let panierCarte: string | null = null;
try {
{
  const { ctx, appels } = await contexteLocal("accept");
  const page = await ctx.newPage();
  const envois = await suivreLignes(page);
  // La pile locale n'a pas de moyen de paiement branché (« paiement
  // momentanément indisponible ») : un moyen simulé, pour que la caisse
  // montre son bouton. Rien ne se charge chez Stripe avant la commande, et la
  // commande est elle-même simulée (2h).
  await page.route(
    (u: URL) => u.pathname === "/api/payments/config",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stripe: { publicKey: "pk_test_essai_pixel" }, paypal: null, essai: true }) }),
  );
  await page.goto(`${LOCAL}/carte-cadeau`, { timeout: 90_000 });
  const bouton = page.getByRole("button", { name: /Ajouter au panier/ });
  await bouton.waitFor({ timeout: 60_000 });
  await bouton.click();
  await page.waitForURL(/\/commande/, { timeout: 60_000 });
  const ligne = envois[0]!.ligne!;
  panierCarte = await page.evaluate(() => localStorage.getItem("ml_cart_id"));
  await page.getByText("Récapitulatif").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const ajouts = evenements(appels, "AddToCart");
  verifier(
    "2c. carte cadeau : un AddToCart au montant de la ligne enregistrée",
    ajouts.length === 1 && JSON.stringify(ajouts[0]) === JSON.stringify(["track", "AddToCart", { value: (ligne.unitPriceCents * ligne.quantity) / 100, currency: "EUR", content_type: "product", num_items: ligne.quantity }, { eventID: `ajout-${ligne.id}` }]),
    ajouts,
  );
  const debuts = evenements(appels, "InitiateCheckout");
  verifier(
    "2c. caisse ouverte : un InitiateCheckout au sous-total",
    debuts.length === 1 && JSON.stringify(debuts[0]) === JSON.stringify(["track", "InitiateCheckout", { value: (ligne.unitPriceCents * ligne.quantity) / 100, currency: "EUR", num_items: ligne.quantity }]),
    debuts,
  );
  verifier("2c. l'identifiant du panier ne part pas", !!panierCarte && !JSON.stringify(appels).includes(panierCarte), panierCarte);
  await page.reload();
  await page.getByText("Récapitulatif").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  verifier("2c. caisse rechargée : pas de second InitiateCheckout", evenements(appels, "InitiateCheckout").length === 1, evenements(appels, "InitiateCheckout").length);
  await page.screenshot({ path: resolve(CAPTURES, "2c-caisse-carte-cadeau.png") });

  // 2h. Commande gratuite (validerSansPaiement), commande et validation SIMULÉES.
  await page.route(
    (u: URL) => u.pathname === "/api/orders",
    (r) =>
      r.request().method() === "POST"
        ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orderId: 999_999_001, number: "WEB-ESSAI-PIXEL", status: "pending", totalCents: ligne.unitPriceCents, aPayerCents: 0 }) })
        : r.continue(),
  );
  await page.route(
    (u: URL) => u.pathname === "/api/payments/gratuit",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "paid", number: "WEB-ESSAI-PIXEL" }) }),
  );
  await page.fill('input[autocomplete="given-name"]', "Essai");
  await page.fill('input[autocomplete="family-name"]', "Pixel");
  await page.locator('input[type="email"]').first().fill("essai-pixel@example.invalid");
  await page.getByRole("button", { name: /Continuer vers le paiement/ }).click({ timeout: 30_000 });
  await page.getByText("Merci !").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const achats = evenements(appels, "Purchase");
  verifier(
    "2h. commande gratuite (simulée) : un Purchase au total de la commande",
    achats.length === 1 && JSON.stringify(achats[0]) === JSON.stringify(["track", "Purchase", { value: ligne.unitPriceCents / 100, currency: "EUR" }, { eventID: "achat-WEB-ESSAI-PIXEL" }]),
    achats,
  );
  verifier("2h. « Merci » : le panier est oublié comme avant", (await page.evaluate(() => localStorage.getItem("ml_cart_id"))) !== panierCarte);
  verifier("2h. aucune donnée personnelle chez Meta (ni e-mail ni nom)", !/essai-pixel@|Pixel"|Essai"/.test(JSON.stringify(appels)), appels.length);
  await page.screenshot({ path: resolve(CAPTURES, "2h-merci-gratuit.png") });
  await ctx.close();
}

// 2d. Affiche prête à imprimer, quantité 2 : prix réel × 2, numéro de produit.
{
  const { ctx, appels } = await contexteLocal("accept");
  const page = await ctx.newPage();
  const envois = await suivreLignes(page);
  await page.goto(`${LOCAL}/affiches?genre=prete_a_imprimer`, { timeout: 90_000 });
  const fiche = await page.locator('a[href$="-affiche-prete-a-imprimer"]').first().getAttribute("href");
  await page.goto(`${LOCAL}${fiche}`, { timeout: 90_000 });
  await page.getByRole("button", { name: "Augmenter la quantité" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Ajouter au panier/ }).click();
  await page.waitForURL(/\/commande/, { timeout: 60_000 });
  const envoye = envois[0]!.envoye as { productId: number; unitPriceCents: number; quantity: number };
  const ligne = envois[0]!.ligne!;
  await page.getByText("Récapitulatif").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const ajouts = evenements(appels, "AddToCart");
  verifier(
    `2d. affiche ${fiche} ×${ligne.quantity} : AddToCart = prix SERVEUR × quantité, numéro du produit`,
    ajouts.length === 1 && ligne.quantity === 2 && JSON.stringify(ajouts[0]) === JSON.stringify(["track", "AddToCart", { value: (ligne.unitPriceCents * 2) / 100, currency: "EUR", content_type: "product", content_ids: [String(envoye.productId)], num_items: 2 }, { eventID: `ajout-${ligne.id}` }]),
    { ajouts, envoye: { unitPriceCents: envoye.unitPriceCents, quantity: envoye.quantity }, serveur: ligne.unitPriceCents },
  );
  const debuts = evenements(appels, "InitiateCheckout");
  verifier("2d. InitiateCheckout au sous-total", debuts.length === 1 && (debuts[0]![2] as { value: number }).value === (ligne.unitPriceCents * 2) / 100, debuts);
  await ctx.close();
}

// 2e. Panier clos (déjà payé) : nouvel essai sur un panier neuf, un seul AddToCart.
{
  const { ctx, appels } = await contexteLocal("accept");
  const page = await ctx.newPage();
  const envois = await suivreLignes(page, true);
  await page.goto(`${LOCAL}/carte-cadeau`, { timeout: 90_000 });
  await page.getByRole("button", { name: /Ajouter au panier/ }).click({ timeout: 60_000 });
  await page.waitForURL(/\/commande/, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  const ajouts = evenements(appels, "AddToCart");
  const paniers = envois.map((e) => e.cartId);
  const neuf = await page.evaluate(() => localStorage.getItem("ml_cart_id"));
  verifier("2e. panier clos : deux envois, sur deux paniers différents ; le neuf est gardé", paniers.length === 2 && paniers[0] !== paniers[1] && neuf === paniers[1], { paniers, neuf });
  verifier(
    "2e. panier clos : un seul AddToCart (la ligne du panier neuf)",
    ajouts.length === 1 && JSON.stringify(ajouts[0]![3]) === JSON.stringify({ eventID: `ajout-${envois[1]?.ligne?.id}` }),
    ajouts,
  );
  await ctx.close();
}

// 2f. Refus de l'API, et réseau coupé : même message qu'avant, rien chez Meta.
{
  const { ctx, appels } = await contexteLocal("accept");
  const page = await ctx.newPage();
  let mode: "refus" | "coupure" = "refus";
  await page.route(
    (u: URL) => /^\/api\/cart\/[^/]+\/items$/.test(u.pathname),
    (r) => {
      if (r.request().method() !== "POST") return r.continue();
      if (mode === "coupure") return r.abort("internetdisconnected");
      return r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Le montant…", code: "montant_carte" }) });
    },
  );
  await page.goto(`${LOCAL}/carte-cadeau`, { timeout: 90_000 });
  await page.getByRole("button", { name: /Ajouter au panier/ }).click({ timeout: 60_000 });
  await page.getByText("5 € minimum, sans centimes.").waitFor({ timeout: 15_000 }).catch(() => null);
  const refus = await page.getByText("5 € minimum, sans centimes.").count();
  mode = "coupure";
  await page.getByRole("button", { name: /Ajouter au panier/ }).click();
  await page.getByText(/La carte n'a pas pu être ajoutée/).waitFor({ timeout: 15_000 }).catch(() => null);
  const coupure = await page.getByText(/La carte n'a pas pu être ajoutée/).count();
  verifier("2f. refus 400 : le message d'avant (« 5 € minimum »), on reste sur la page", refus > 0 && page.url().includes("/carte-cadeau"), { refus, url: page.url() });
  verifier("2f. réseau coupé : le message d'avant (« n'a pas pu être ajoutée »)", coupure > 0, coupure);
  verifier("2f. aucun AddToCart sur un échec", evenements(appels, "AddToCart").length === 0, appels);
  await page.screenshot({ path: resolve(CAPTURES, "2f-refus.png") });
  await ctx.close();
}

// 2g. Sans accord : rien chez Meta, rien d'écrit pour Meta dans le navigateur.
{
  const { ctx, appels } = await contexteLocal(null);
  const page = await ctx.newPage();
  await suivreLignes(page);
  await page.goto(`${LOCAL}/carte-cadeau`, { timeout: 90_000 });
  await page.getByRole("button", { name: /Ajouter au panier/ }).click({ timeout: 60_000 });
  await page.waitForURL(/\/commande/, { timeout: 60_000 });
  await page.getByText("Récapitulatif").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const cles = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith("ml_meta")));
  verifier("2g. sans accord : aucun appel à fbq (même si fbq existe)", appels.length === 0, appels);
  verifier("2g. sans accord : aucune clé ml_meta_* dans le navigateur", cles.length === 0, cles);
  await ctx.close();
}

// 2i. Retour d'un paiement à redirection (retour de banque SIMULÉ) : Purchase lu dans l'onglet.
{
  const { ctx, appels } = await contexteLocal("accept");
  const page = await ctx.newPage();
  await page.route(
    (u: URL) => u.pathname === "/api/payments/stripe/retour",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ issue: "payee", number: "WEB-ESSAI-RETOUR" }) }),
  );
  await page.goto(`${LOCAL}/contact`, { timeout: 90_000 });
  // Ce qu'avait gardé la caisse avant de partir à la banque (retenirCommande).
  await page.evaluate(() => sessionStorage.setItem("ml_meta_commande_WEB-ESSAI-RETOUR", "4590"));
  await page.goto(`${LOCAL}/commande?payment_intent=pi_essai&payment_intent_client_secret=pi_essai_secret_essai&redirect_status=succeeded`, { timeout: 90_000 });
  const balise = await page.locator('meta[name="referrer"]').getAttribute("content").catch(() => null);
  await page.getByText("Merci !").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const achats = evenements(appels, "Purchase");
  verifier(
    "2i. retour de banque : un Purchase au total gardé dans l'onglet",
    achats.length === 1 && JSON.stringify(achats[0]) === JSON.stringify(["track", "Purchase", { value: 45.9, currency: "EUR" }, { eventID: "achat-WEB-ESSAI-RETOUR" }]),
    achats,
  );
  verifier("2i. le secret a quitté l'adresse", !page.url().includes("secret"), page.url());
  verifier("2i. la page du retour porte la balise referrer strict-origin", balise === "strict-origin", balise);
  await page.screenshot({ path: resolve(CAPTURES, "2i-retour-banque-merci.png") });
  await ctx.close();
}

} catch (err) {
  verifier("partie 2 : l'essai a levé", false, String(err).slice(0, 600));
} finally {
  // Ménage : les lignes de paniers brouillons créées dans la base LOCALE.
  for (const { cartId, itemId } of lignesCreees) {
    const r = await fetch(`${LOCAL}/api/cart/${cartId}/items/${itemId}`, { method: "DELETE" }).catch(() => null);
    console.log(`ménage local : ligne ${itemId} du panier ${cartId.slice(0, 8)}… → ${r?.status ?? "échec"}`);
  }
}

verifier("Aucune requête n'a atteint Meta (toutes annulées par l'essai)", true, { interceptees: versMetaTotal.length });

await navigateur.close();
const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications réussies`);
process.exitCode = echecs.length ? 1 : 0;
