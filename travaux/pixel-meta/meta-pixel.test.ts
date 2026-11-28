// Essai de apps/web/src/lib/meta-pixel.ts (28/11) : faux window, faux stockages,
// faux fbq qui enregistre ses appels. Rien ne part sur le réseau.
//
//   apps/api/node_modules/.bin/tsx --test travaux/pixel-meta/meta-pixel.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const ici = dirname(fileURLToPath(import.meta.url));
const MODULE = pathToFileURL(resolve(ici, "../../apps/web/src/lib/meta-pixel.ts")).href;

class FauxStockage {
  m = new Map<string, string>();
  casse = false;
  getItem(k: string) {
    if (this.casse) throw new Error("stockage bloqué");
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.casse) throw new Error("stockage bloqué");
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    if (this.casse) throw new Error("stockage bloqué");
    this.m.delete(k);
  }
  cles() {
    return [...this.m.keys()];
  }
}

const g = globalThis as Record<string, unknown>;
let local: FauxStockage;
let session: FauxStockage;
let attributs: Record<string, string>;
let appels: unknown[][];

function poser(nom: string, valeur: unknown) {
  Object.defineProperty(globalThis, nom, { value: valeur, configurable: true, writable: true });
}

beforeEach(() => {
  local = new FauxStockage();
  session = new FauxStockage();
  attributs = {};
  appels = [];
  poser("window", globalThis);
  poser("localStorage", local);
  poser("sessionStorage", session);
  poser("document", {
    documentElement: { getAttribute: (n: string) => (n in attributs ? attributs[n] : null) },
  });
  poser("fbq", (...args: unknown[]) => {
    appels.push(args);
  });
});

/** Une « page » : une instance neuve du module (sa mémoire repart de zéro). */
let n = 0;
async function page() {
  return (await import(`${MODULE}?page=${++n}`)) as typeof import("../../apps/web/src/lib/meta-pixel.ts");
}

const accepter = () => local.setItem("ml_cookie_consent", "accept");

test("sans accord : rien n'est envoyé ni écrit, même si une autre balise a posé fbq", async () => {
  const p = await page();
  p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 });
  p.suivreDebutPaiement("panier-a", 3990, 1);
  p.retenirCommande("WEB-1", 4590);
  p.suivreAchat("WEB-1");
  assert.deepEqual(appels, []);
  assert.deepEqual(local.cles(), []);
  assert.deepEqual(session.cles(), []);
});

test("« refuse » : rien", async () => {
  local.setItem("ml_cookie_consent", "refuse");
  const p = await page();
  p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 });
  p.suivreDebutPaiement("panier-a", 3990, 1);
  p.retenirCommande("WEB-1", 4590);
  p.suivreAchat("WEB-1");
  assert.deepEqual(appels, []);
  assert.deepEqual(session.cles(), []);
});

test("accord mais pas de fbq (local, autre domaine) : rien, sans erreur", async () => {
  accepter();
  delete g.fbq;
  const p = await page();
  p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 });
  p.suivreDebutPaiement("panier-a", 3990, 1);
  p.retenirCommande("WEB-1", 4590);
  p.suivreAchat("WEB-1");
  assert.deepEqual(appels, []);
  assert.deepEqual(session.cles(), []);
});

test("tablette d'un stand (data-stand=1) : rien, même avec accord et fbq", async () => {
  accepter();
  attributs["data-stand"] = "1";
  const p = await page();
  p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 });
  p.suivreDebutPaiement("panier-a", 3990, 1);
  p.retenirCommande("WEB-1", 4590);
  p.suivreAchat("WEB-1");
  assert.deepEqual(appels, []);
});

test("AddToCart : prix enregistré par le serveur × quantité, en euros", async () => {
  accepter();
  const p = await page();
  // Ce que rend POST /cart/:id/items : la ligne écrite (prix affiche + cadre).
  p.suivreAjoutPanier(
    { productId: 7, config: { texte: "Famille Martin" }, quantity: 2, unitPriceCents: 1 },
    { id: 42, unitPriceCents: 4490, quantity: 2, config: { texte: "Famille Martin" }, title: "Famille Martin" },
  );
  assert.deepEqual(appels, [
    [
      "track",
      "AddToCart",
      { value: 89.8, currency: "EUR", content_type: "product", content_ids: ["7"], num_items: 2 },
      { eventID: "ajout-42" },
    ],
  ]);
  assert.ok(!JSON.stringify(appels).includes("Martin"), "le texte de l'affiche ne part pas");
});

test("AddToCart : carte cadeau (montant de la ligne), sans numéro de produit", async () => {
  accepter();
  const p = await page();
  p.suivreAjoutPanier(
    { carteCadeau: { montantCents: 5000 }, langue: "fr" },
    { id: 43, unitPriceCents: 5000, quantity: 1, giftCard: { montantCents: 5000 } },
  );
  assert.deepEqual(appels, [
    ["track", "AddToCart", { value: 50, currency: "EUR", content_type: "product", num_items: 1 }, { eventID: "ajout-43" }],
  ]);
});

test("AddToCart : prix nul ou illisible → rien ; réponse vide → repli sur l'envoi", async () => {
  accepter();
  const p = await page();
  p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 0, quantity: 1 });
  p.suivreAjoutPanier({ productId: 7 }, { id: 2, unitPriceCents: "abc", quantity: 1 });
  p.suivreAjoutPanier({ productId: 7 }, null);
  assert.deepEqual(appels, []);
  p.suivreAjoutPanier({ carteCadeau: { montantCents: 2000 } }, undefined);
  assert.equal(appels.length, 1);
  assert.equal((appels[0]![2] as { value: number }).value, 20);
});

test("jamais d'erreur : fbq qui lève, ligne piégée, stockages bloqués, pas de window", async () => {
  accepter();
  poser("fbq", () => {
    throw new Error("fbq en panne");
  });
  const p = await page();
  const piege = new Proxy({}, { get: () => { throw new Error("piège"); } }) as Record<string, unknown>;
  assert.doesNotThrow(() => p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 }));
  assert.doesNotThrow(() => p.suivreAjoutPanier(piege, piege));
  assert.doesNotThrow(() => p.suivreDebutPaiement("panier-a", 3990, 1));
  assert.doesNotThrow(() => p.retenirCommande("WEB-9", 100));
  assert.doesNotThrow(() => p.suivreAchat("WEB-9"));
  session.casse = true;
  local.casse = true;
  assert.doesNotThrow(() => p.suivreDebutPaiement("panier-b", 3990, 1));
  assert.doesNotThrow(() => p.retenirCommande("WEB-10", 100));
  assert.doesNotThrow(() => p.suivreAchat("WEB-10"));
  for (const nom of ["window", "document", "localStorage", "sessionStorage", "fbq"]) delete g[nom];
  assert.doesNotThrow(() => p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 }));
  assert.doesNotThrow(() => p.suivreDebutPaiement("panier-c", 3990, 1));
  assert.doesNotThrow(() => p.retenirCommande("WEB-11", 100));
  assert.doesNotThrow(() => p.suivreAchat("WEB-11"));
});

test("une mesure ne rend rien et n'attend rien (pas de promesse)", async () => {
  accepter();
  const p = await page();
  assert.equal(p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 }), undefined);
  assert.equal(p.suivreDebutPaiement("x", 1, 1), undefined);
  assert.equal(p.retenirCommande("WEB-12", 1), undefined);
  assert.equal(p.suivreAchat("WEB-12"), undefined);
});

test("InitiateCheckout : sous-total, une fois par panier et par onglet, sans l'identifiant du panier", async () => {
  accepter();
  const p = await page();
  const panier = "3f2b9c1e-1111-4222-8333-944455556666";
  p.suivreDebutPaiement(panier, 8980, 3);
  p.suivreDebutPaiement(panier, 8980, 3); // le panier relu (quantité, code…) : pas de second envoi
  p.suivreDebutPaiement("autre-panier", 1990, 1);
  p.suivreDebutPaiement("vide", 0, 0);
  p.suivreDebutPaiement("", 1990, 1);
  assert.deepEqual(appels, [
    ["track", "InitiateCheckout", { value: 89.8, currency: "EUR", num_items: 3 }],
    ["track", "InitiateCheckout", { value: 19.9, currency: "EUR", num_items: 1 }],
  ]);
  assert.ok(!JSON.stringify(appels).includes(panier), "l'identifiant du panier (une clé) ne part pas");
});

test("Purchase : total de la commande (livraison comprise), une seule fois", async () => {
  accepter();
  const p = await page();
  p.retenirCommande("WEB-100", 4590);
  p.retenirCommande("WEB-100", 5080); // nouvel essai du même panier, total recalculé : le dernier vaut
  p.suivreAchat("WEB-100");
  p.suivreAchat("WEB-100");
  assert.deepEqual(appels, [["track", "Purchase", { value: 50.8, currency: "EUR" }, { eventID: "achat-WEB-100" }]]);
  // Le total gardé dans l'onglet est effacé une fois l'achat mesuré.
  assert.equal(session.getItem("ml_meta_commande_WEB-100"), null);
});

test("Purchase : retour d'un paiement à redirection (page neuve, même onglet)", async () => {
  accepter();
  const avant = await page();
  avant.retenirCommande("WEB-200", 2490);
  assert.equal(session.getItem("ml_meta_commande_WEB-200"), "2490");
  const apres = await page(); // la banque ramène sur une page neuve : mémoire vide
  apres.suivreAchat("WEB-200");
  assert.deepEqual(appels, [["track", "Purchase", { value: 24.9, currency: "EUR" }, { eventID: "achat-WEB-200" }]]);
  // Rechargement de l'écran « Merci » : pas de second achat.
  const encore = await page();
  encore.suivreAchat("WEB-200");
  assert.equal(appels.length, 1);
});

test("(contrôle de l'essai) une « page » neuve a bien une mémoire vide", async () => {
  accepter();
  const avant = await page();
  avant.retenirCommande("WEB-250", 100);
  session.removeItem("ml_meta_commande_WEB-250");
  const apres = await page();
  apres.suivreAchat("WEB-250");
  assert.deepEqual(appels, []);
});

test("Purchase : commande gratuite (validerSansPaiement) → valeur 0 ; commande inconnue → rien", async () => {
  accepter();
  const p = await page();
  p.retenirCommande("WEB-300", 0);
  p.suivreAchat("WEB-300");
  p.suivreAchat("WEB-301");
  p.suivreAchat(null);
  p.suivreAchat(undefined);
  p.suivreAchat("");
  assert.deepEqual(appels, [["track", "Purchase", { value: 0, currency: "EUR" }, { eventID: "achat-WEB-300" }]]);
});

test("accord donné APRÈS la création de la commande (même page) : l'achat se mesure quand même", async () => {
  const p = await page();
  p.retenirCommande("WEB-400", 3990); // sans accord : rien d'écrit dans le navigateur
  assert.deepEqual(session.cles(), []);
  accepter();
  p.suivreAchat("WEB-400");
  assert.deepEqual(appels, [["track", "Purchase", { value: 39.9, currency: "EUR" }, { eventID: "achat-WEB-400" }]]);
});

test("« Refuser » après coup : les mesures s'arrêtent aussitôt", async () => {
  accepter();
  const p = await page();
  p.suivreAjoutPanier({ productId: 7 }, { id: 1, unitPriceCents: 3990, quantity: 1 });
  local.setItem("ml_cookie_consent", "refuse");
  p.suivreAjoutPanier({ productId: 7 }, { id: 2, unitPriceCents: 3990, quantity: 1 });
  p.suivreDebutPaiement("panier-z", 3990, 1);
  assert.equal(appels.length, 1);
});
