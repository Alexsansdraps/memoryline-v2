// Essai du pixel Meta au navigateur, en local (28/11), SANS RIEN ENVOYER À META
// et SANS COMMANDE : voir pilote-pixel.mjs pour l'interception.
//
//   node essai-pixel.mjs        (Chrome sans écran, port 9341, profil neuf)
//
// Écrit captures/journal-pixel.json, captures/resume-pixel.txt et les captures.
// Les seules écritures en base sont celles d'un panier (base LOCALE, copie
// neutralisée) : ajout, quantité, retrait. La création et la validation de la
// commande du « Merci » sont SIMULÉES dans le navigateur (aucune commande, aucun
// courrier, aucun fichier d'impression).
import { demarrer, pause, SITE, scriptDuPixel } from "./pilote-pixel.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ICI = new URL("./", import.meta.url);
const disque = (u) => decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const CAPTURES = disque(new URL("./captures/", ICI));
const REPO = new URL("../../", ICI);
const lire = (rel) => readFileSync(new URL(rel, REPO), "utf8");
const empreinte = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const AFFICHE = "/affiches/strasbourg-cathedrale-affiche-personnalisee";
const ID_PIXEL = "1156538100082754";

function versions() {
  return {
    "meta-pixel.ts": empreinte(lire("apps/web/src/lib/meta-pixel.ts")),
    "Base.astro (script du pixel)": empreinte(scriptDuPixel().exact),
    "api-navigateur.ts": empreinte(lire("apps/web/src/lib/api-navigateur.ts")),
    "CheckoutIsland.tsx": empreinte(lire("apps/web/src/islands/CheckoutIsland.tsx")),
  };
}
const versionsDebut = versions();

const p = await demarrer({ captures: CAPTURES });
const verifs = [];
const texte = (d) => (typeof d === "string" ? d : JSON.stringify(d));
function verifier(nom, ok, details = "") {
  verifs.push({ scenario: p.etat.scenario, nom, ok: !!ok, details: texte(details) });
  console.log(`  ${ok ? "OK   " : "ÉCHEC"} ${nom}${details !== "" ? " — " + texte(details).slice(0, 300) : ""}`);
}
const ACCEPTER = "document.querySelector('#cookie-banner [data-consent=accept]').click(); 1";
const REFUSER = "document.querySelector('#cookie-banner [data-consent=refuse]').click(); 1";
const tracks = (liste, ev) => liste.filter((a) => a.args[0] === "track" && a.args[1] === ev);
const estBruitVite = (e) => /\[vite\]|@vite\/client|ws:\/\/localhost/.test(`${e.texte} ${e.url || ""}`);
const vraiesErreurs = (sc) => p.etat.erreurs.filter((e) => sc.includes(e.scenario) && !estBruitVite(e));
const MERCI = "[...document.querySelectorAll('h2')].some(h => h.textContent.trim() === 'Merci !')";
const resultats = {};

async function remiseAZero() {
  p.scenario("remise à zéro");
  await p.aller("/robots.txt", 200);
  await p.eval("localStorage.clear(); sessionStorage.clear(); 1");
}
/** Le panier tel que l'API le rend (lu depuis Node : rien dans le journal du navigateur). */
async function etatPanier() {
  const id = await p.eval("localStorage.getItem('ml_cart_id')");
  if (!id) return { id: null, lignes: [] };
  const r = await fetch(`${SITE}/api/cart/${id}`);
  const c = await r.json();
  return {
    id,
    statut: r.status,
    etat: c.status ?? null,
    lignes: (c.items || []).map((it) => ({
      id: it.id,
      produit: it.productId ?? null,
      carte: !!it.giftCard,
      quantite: it.quantity,
      prixCents: it.unitPriceCents,
      format: it.config?.format ?? null,
    })),
  };
}
const sansIds = (e) => ({ ...e, id: undefined, lignes: e.lignes.map((l) => ({ ...l, id: undefined })) });
/** Les lignes de la page qui portent un prix (récapitulatif, livraison, total). */
const prixAffiches = () =>
  p.eval("(document.querySelector('main')?.innerText || '').split('\\n').map(s => s.trim()).filter(s => /€/.test(s))");
async function attendreLignes(n) {
  await p.attendre(
    `[...document.querySelectorAll('main button')].filter(b => b.textContent.trim() === 'Supprimer').length === ${n}`,
    30000,
  );
  await pause(1500);
}
async function attendrePanier(test, ms = 20000) {
  const fin = Date.now() + ms;
  for (;;) {
    const e = await etatPanier();
    if (test(e)) return e;
    if (Date.now() > fin) throw new Error("le panier n'a pas pris l'état attendu : " + JSON.stringify(e));
    await pause(400);
  }
}
const normaliser = (c) => c.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<panier>").replace(/\/\d+(?=\/|$|\?)/g, "/<n>");
const mutations = (sc) =>
  p.etat.api.filter((a) => a.scenario === sc && a.methode !== "GET").map((a) => `${a.methode} ${normaliser(a.chemin)}`);

/**
 * Le parcours du panier, identique avec ou sans accord : affiche personnalisable
 * en 2 exemplaires, carte cadeau de 30 €, rechargement de la caisse, quantité +1
 * dans la caisse, retrait de la carte cadeau. Aucune commande.
 */
async function parcoursPanier(x) {
  const r = { etats: [], prix: [], adresses: [] };
  await p.aller(AFFICHE, 2500);
  await p.bouton("+", 0, "main");
  await pause(400);
  r.quantiteFiche = await p.eval("[...document.querySelectorAll('main span, main input')].map(e => e.value ?? e.textContent).find(v => String(v).trim() === '2') ? 2 : null");
  await p.bouton("Personnaliser");
  await p.attendre("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Continuer')", 25000);
  await pause(1500);
  await p.bouton("Continuer");
  await pause(900);
  await p.bouton("Continuer");
  await pause(900);
  let nav = p.attendreChargement();
  await p.bouton("Valider l'affiche");
  await nav;
  await attendreLignes(1);
  r.adresses.push(await p.eval("location.pathname + location.search"));
  r.etats.push({ quand: "affiche ajoutée", ...(await etatPanier()) });
  r.prix.push(await prixAffiches());
  await p.capture(`${x}-1-caisse-apres-affiche`);

  await p.aller("/carte-cadeau", 2000);
  await p.bouton("30 €", 0, "main");
  await pause(400);
  nav = p.attendreChargement();
  await p.bouton("Ajouter au panier · 30 €");
  await nav;
  await attendreLignes(2);
  r.adresses.push(await p.eval("location.pathname + location.search"));
  r.etats.push({ quand: "carte cadeau ajoutée", ...(await etatPanier()) });
  r.prix.push(await prixAffiches());
  await p.capture(`${x}-2-caisse-avec-carte`);

  await p.recharger(1500);
  await attendreLignes(2);
  r.prix.push(await prixAffiches());

  await p.bouton("Augmenter la quantité", 0, "main");
  r.etats.push({ quand: "quantité +1 dans la caisse", ...(await attendrePanier((e) => e.lignes.some((l) => !l.carte && l.quantite === 3))) });
  await pause(1500);
  r.prix.push(await prixAffiches());

  const retrait = await p.eval(`(() => { const b = [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Supprimer' && b.parentElement && b.parentElement.querySelector('input[type=number]'));
    if (!b) return 'INTROUVABLE'; b.scrollIntoView({ block: 'center' }); b.click(); return 'ok'; })()`);
  if (retrait !== "ok") throw new Error("bouton Supprimer de la carte cadeau introuvable");
  await attendreLignes(1);
  r.etats.push({ quand: "carte cadeau retirée", ...(await etatPanier()) });
  r.prix.push(await prixAffiches());
  await p.capture(`${x}-3-caisse-apres-retrait`);
  return r;
}

async function scenario(nom, corps) {
  p.scenario(nom);
  try {
    await corps();
  } catch (e) {
    verifier(`le scénario s'est déroulé jusqu'au bout`, false, String(e).slice(0, 400));
    try {
      await p.capture(`echec-${nom}`);
    } catch {}
  }
}

try {
  // 0. Le site local tel quel (le script n'existe qu'en production).
  p.etat.injection = "aucune";
  await remiseAZero();
  await scenario("0-site-local-tel-quel", async () => {
    await p.aller("/", 2500);
    const html = await p.eval("document.documentElement.outerHTML");
    verifier("le HTML servi en local ne contient pas le pixel", !/fbevents|1156538100082754|fbq\(/.test(html));
    verifier("pas de window.fbq avant le choix", (await p.etatPixel()).fbq === "undefined");
    await p.eval(ACCEPTER);
    await pause(2500);
    verifier("« Accepter » cliqué : toujours pas de window.fbq", (await p.etatPixel()).fbq === "undefined");
    await p.aller("/affiches", 2500);
    verifier("page suivante : pas de window.fbq", (await p.etatPixel()).fbq === "undefined");
    verifier("aucune requête vers Meta", p.metaDu("0-site-local-tel-quel").length === 0, p.metaDu("0-site-local-tel-quel"));
  });

  // 0b. La copie EXACTE du script (adresse non touchée) : rien hors de memoryline.fr.
  p.etat.injection = "exacte";
  await remiseAZero();
  await scenario("0b-copie-exacte-sur-localhost", async () => {
    await p.aller("/", 2000);
    await p.eval(ACCEPTER);
    await pause(2500);
    const e = await p.etatPixel();
    verifier("script exact inséré, « Accepter » cliqué : pas de window.fbq (adresse ≠ memoryline.fr)", e.scriptInsere === "exacte" && e.fbq === "undefined", e);
    verifier("aucune requête vers Meta", p.metaDu("0b-copie-exacte-sur-localhost").length === 0);
  });

  // Désormais : le script avec la seule condition d'adresse élargie à localhost.
  p.etat.injection = "localhost";
  await remiseAZero();
  await scenario("a-sans-choix", async () => {
    await p.aller("/", 3000);
    let e = await p.etatPixel();
    verifier("script inséré, bandeau affiché, pas de window.fbq", e.scriptInsere === "localhost" && e.bandeauVisible && e.fbq === "undefined" && e._fbq === "undefined", e);
    await p.capture("a-sans-choix");
    await p.aller("/affiches", 3000);
    e = await p.etatPixel();
    verifier("page suivante sans choix : pas de window.fbq", e.fbq === "undefined" && e.bandeauVisible, e);
    verifier("aucune requête vers Meta, aucun appel", p.metaDu("a-sans-choix").length === 0 && p.appelsDu("a-sans-choix").length === 0);
  });

  await scenario("b-refuser", async () => {
    await p.eval(REFUSER);
    await pause(2500);
    let e = await p.etatPixel();
    verifier("« Refuser » : choix gardé, bandeau caché, pas de window.fbq", e.consentement === "refuse" && !e.bandeauVisible && e.fbq === "undefined", e);
    await p.capture("b-refuser");
    await p.aller("/", 3000);
    e = await p.etatPixel();
    verifier("page suivante : toujours pas de window.fbq", e.fbq === "undefined", e);
    // Les mesures appelées sans accord : rien, et rien d'écrit dans le navigateur.
    const r = await p.eval(`(async () => { const m = await import('/src/lib/meta-pixel.ts');
      m.suivreAjoutPanier({ productId: 1, unitPriceCents: 2300, quantity: 1 }, { id: 1, unitPriceCents: 2300, quantity: 1 });
      m.suivreDebutPaiement('essai-sans-accord', 2300, 1); m.retenirCommande('ESSAI-SANS-ACCORD', 2300); m.suivreAchat('ESSAI-SANS-ACCORD');
      const cles = [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(k => k.startsWith('ml_meta'));
      return { cles }; })()`);
    verifier("les 4 fonctions de meta-pixel.ts appelées sans accord : aucun appel, aucune clé ml_meta_*", r.cles.length === 0 && p.appelsDu("b-refuser").length === 0, r);
    verifier("aucune requête vers Meta", p.metaDu("b-refuser").length === 0);
  });

  // A. Le panier, cookies REFUSÉS (le pixel ne fait rien : la référence).
  await scenario("A-panier-cookies-refuses", async () => {
    resultats.A = await parcoursPanier("A");
    verifier("aucun appel au pixel, aucune requête vers Meta", p.appelsDu("A-panier-cookies-refuses").length === 0 && p.metaDu("A-panier-cookies-refuses").length === 0);
  });

  // c. Accepter.
  await remiseAZero();
  await scenario("c-accepter", async () => {
    await p.aller("/", 2500);
    verifier("avant le choix : pas de window.fbq", (await p.etatPixel()).fbq === "undefined");
    await p.eval(ACCEPTER);
    await pause(2000);
    const e = await p.etatPixel();
    const a = p.appelsDu("c-accepter").map((x) => x.args);
    verifier("« Accepter » : window.fbq posé, le script de Meta chargé une fois (faux, local)", e.fbq === "function" && e.fauxCharge === 1 && p.metaDu("c-accepter").length === 1, e);
    verifier(
      "appels : set autoConfig false, init 1156538100082754, track PageView (dans cet ordre, une fois)",
      JSON.stringify(a) === JSON.stringify([["set", "autoConfig", false, ID_PIXEL], ["init", ID_PIXEL], ["track", "PageView"]]),
      a,
    );
    await p.capture("c-accepter");
  });
  await scenario("c-page-suivante", async () => {
    await p.aller("/affiches", 2500);
    const a = p.appelsDu("c-page-suivante");
    const charge = p.etat.chargements.filter((x) => x.scenario === "c-page-suivante").at(-1);
    const requete = p.metaDu("c-page-suivante")[0];
    verifier("PageView dès le chargement de la page suivante (sans clic)", tracks(a, "PageView").length === 1 && a[1]?.args[0] === "init", a.map((x) => x.args));
    verifier("le script de Meta se charge APRÈS l'évènement load de la page", requete && charge && requete.t >= charge.t, { load: charge?.t, script: requete?.t });
    verifier("window.fbq posé dès le <head> (file d'attente avant le script de Meta)", a.every((x) => x.via === "file"), a.map((x) => x.via));
  });
  await scenario("c-retrait-de-l-accord-simule", async () => {
    // L'interface n'offre pas de revenir sur son choix : on rejoue ce que ferait
    // le bandeau (localStorage puis évènement ml:consent).
    await p.eval("localStorage.setItem('ml_cookie_consent', 'refuse'); document.dispatchEvent(new CustomEvent('ml:consent', { detail: { consent: 'refuse' } })); 1");
    await pause(500);
    const r = await p.eval(`(async () => { const m = await import('/src/lib/meta-pixel.ts');
      m.suivreAjoutPanier({ productId: 1, unitPriceCents: 2300, quantity: 1 }, { id: 1, unitPriceCents: 2300, quantity: 1 }); return 1; })()`);
    const a = p.appelsDu("c-retrait-de-l-accord-simule").map((x) => x.args);
    verifier("« Refuser » après coup : fbq('consent','revoke'), puis plus aucune mesure", JSON.stringify(a) === JSON.stringify([["consent", "revoke"]]), a);
    await p.eval("localStorage.setItem('ml_cookie_consent', 'accept'); document.dispatchEvent(new CustomEvent('ml:consent', { detail: { consent: 'accept' } })); 1");
    await pause(500);
    const b = p.appelsDu("c-retrait-de-l-accord-simule").map((x) => x.args);
    verifier("nouvel « Accepter » : fbq('consent','grant'), sans second init ni second script", JSON.stringify(b.slice(1)) === JSON.stringify([["consent", "grant"]]) && p.metaDu("c-retrait-de-l-accord-simule").length === 0, b);
  });

  // B. Le même panier, cookies ACCEPTÉS : AddToCart, InitiateCheckout.
  await scenario("B-panier-cookies-acceptes", async () => {
    resultats.B = await parcoursPanier("B");
    const a = p.appelsDu("B-panier-cookies-acceptes");
    const etats = resultats.B.etats;
    const affiche = etats[0].lignes.find((l) => !l.carte);
    const carte = etats[1].lignes.find((l) => l.carte);
    const ajouts = tracks(a, "AddToCart");
    verifier("2 AddToCart (affiche, carte cadeau), pas plus", ajouts.length === 2, ajouts.map((x) => x.args));
    const [x1, x2] = ajouts;
    verifier(
      "AddToCart de l'affiche : 2 × 23 € = 46 €, produit 250, 2 articles, eventID = ligne du serveur, envoyé depuis la fiche avant de partir",
      x1 && JSON.stringify(x1.args) === JSON.stringify(["track", "AddToCart", { value: (affiche.prixCents * affiche.quantite) / 100, currency: "EUR", content_type: "product", content_ids: [String(affiche.produit)], num_items: affiche.quantite }, { eventID: `ajout-${affiche.id}` }]) && x1.page.startsWith(AFFICHE) && affiche.quantite === 2 && affiche.prixCents === 2300,
      { appel: x1?.args, page: x1?.page, ligneServeur: affiche },
    );
    verifier(
      "AddToCart de la carte cadeau : 30 €, 1 article, sans content_ids, eventID = ligne du serveur",
      x2 && JSON.stringify(x2.args) === JSON.stringify(["track", "AddToCart", { value: 30, currency: "EUR", content_type: "product", num_items: 1 }, { eventID: `ajout-${carte.id}` }]) && x2.page === "/carte-cadeau",
      { appel: x2?.args, page: x2?.page, ligneServeur: carte },
    );
    const debuts = tracks(a, "InitiateCheckout");
    verifier(
      "InitiateCheckout UNE fois (à la 1re ouverture de la caisse), 46 €, 2 articles, sans identifiant du panier",
      debuts.length === 1 && JSON.stringify(debuts[0].args) === JSON.stringify(["track", "InitiateCheckout", { value: 46, currency: "EUR", num_items: 2 }]) && debuts[0].page === "/commande",
      debuts.map((x) => [x.page, x.args]),
    );
    verifier("pas de second InitiateCheckout : 2e arrivée sur la caisse, rechargement, quantité changée, ligne retirée", debuts.length === 1);
    const ids = etats.map((e) => e.id).filter(Boolean);
    verifier("l'identifiant du panier ne part dans aucun appel", !ids.some((id) => JSON.stringify(p.etat.appels).includes(id)), ids[0]);
    const pages = p.etat.pages.filter((x) => x.scenario === "B-panier-cookies-acceptes" && x.statut === 200 && x.insertion !== "aucune").length;
    verifier("un PageView par page HTML chargée", tracks(a, "PageView").length === pages, { pageViews: tracks(a, "PageView").length, pages });
  });

  // Comparaison A / B : le panier et la caisse se comportent pareil.
  await scenario("comparaison-A-B", async () => {
    const A = resultats.A;
    const B = resultats.B;
    if (!A || !B) throw new Error("un des deux parcours manque");
    verifier("mêmes adresses après chaque ajout (la caisse /commande)", JSON.stringify(A.adresses) === JSON.stringify(B.adresses), { A: A.adresses, B: B.adresses });
    verifier("même panier à chaque étape (produit, carte, quantité, prix, format)", JSON.stringify(A.etats.map(sansIds)) === JSON.stringify(B.etats.map(sansIds)), { A: A.etats.map(sansIds), B: B.etats.map(sansIds) });
    verifier("mêmes montants affichés par la caisse à chaque étape", JSON.stringify(A.prix) === JSON.stringify(B.prix), { A: A.prix, B: B.prix });
    const mA = mutations("A-panier-cookies-refuses");
    const mB = mutations("B-panier-cookies-acceptes");
    verifier("mêmes écritures envoyées à l'API (POST/PUT/DELETE), dans le même ordre", JSON.stringify(mA) === JSON.stringify(mB), { A: mA, B: mB });
    const eA = vraiesErreurs(["A-panier-cookies-refuses"]).map((e) => e.texte);
    const eB = vraiesErreurs(["B-panier-cookies-acceptes"]).map((e) => e.texte);
    verifier("aucune erreur nouvelle avec le pixel actif (hors bruit du serveur de dev Vite)", eB.every((t) => eA.includes(t)), { A: eA, B: eB });
  });

  // f1. Les fonctions de meta-pixel.ts, appelées dans la page (module du serveur de dev).
  await scenario("f1-fonctions-directes", async () => {
    await p.aller("/commande", 2000);
    const r = await p.eval(`(async () => { const m = await import('/src/lib/meta-pixel.ts');
      m.retenirCommande('ESSAI-PIXEL-1', 5390); m.suivreAchat('ESSAI-PIXEL-1'); m.suivreAchat('ESSAI-PIXEL-1');
      m.suivreAchat('ESSAI-INCONNUE'); m.suivreAchat(null); m.suivreAchat(undefined); m.suivreAchat('');
      m.retenirCommande('ESSAI-PIXEL-2', 12345);
      return { gardee2: sessionStorage.getItem('ml_meta_commande_ESSAI-PIXEL-2'), reste1: sessionStorage.getItem('ml_meta_commande_ESSAI-PIXEL-1'), marque1: localStorage.getItem('ml_meta_achat_ESSAI-PIXEL-1') }; })()`);
    await p.aller("/affiches", 2000);
    const r2 = await p.eval(`(async () => { const m = await import('/src/lib/meta-pixel.ts'); m.suivreAchat('ESSAI-PIXEL-2'); m.suivreAchat('ESSAI-PIXEL-2');
      return { reste2: sessionStorage.getItem('ml_meta_commande_ESSAI-PIXEL-2') }; })()`);
    const achats = tracks(p.appelsDu("f1-fonctions-directes"), "Purchase").map((x) => x.args);
    verifier(
      "Purchase : 53,90 € (même page) puis 123,45 € (page neuve, total relu dans l'onglet), une seule fois chacun, rien pour un numéro inconnu ou vide",
      JSON.stringify(achats) === JSON.stringify([
        ["track", "Purchase", { value: 53.9, currency: "EUR" }, { eventID: "achat-ESSAI-PIXEL-1" }],
        ["track", "Purchase", { value: 123.45, currency: "EUR" }, { eventID: "achat-ESSAI-PIXEL-2" }],
      ]),
      achats,
    );
    verifier("le total gardé dans l'onglet est effacé après l'achat", r.gardee2 === "12345" && r.reste1 === null && r.marque1 === "1" && r2.reste2 === null, { r, r2 });
  });

  // f3. Jusqu'au « Merci » par l'interface : commande gratuite, API SIMULÉE.
  await scenario("f3-commande-gratuite-simulee", async () => {
    await p.aller("/commande", 2500);
    await attendreLignes(1);
    const avant = await etatPanier();
    await p.saisir('input[autocomplete="given-name"]', "Essai");
    await p.saisir('input[autocomplete="family-name"]', "Pixel");
    await p.saisir('input[type="email"]', "essai.pixel@exemple.invalid");
    const mode = await p.eval(`(() => { const r = [...document.querySelectorAll('input[name="mode-livraison"]')].find(r => /domicile/i.test(r.closest('label')?.textContent || ''));
      if (!r) return null; r.click(); return r.closest('label').textContent.replace(/\\s+/g, ' ').trim(); })()`);
    const m = /(\d+),(\d{2})\s*€/.exec(mode || "");
    const PORT = m ? Number(m[1]) * 100 + Number(m[2]) : /offert|gratuit/i.test(mode || "") ? 0 : NaN;
    await pause(800);
    await p.saisir('input[placeholder="12 rue des Bains"]', "1 rue de l'Essai");
    await p.saisir('input[placeholder="80350"]', "68100");
    await p.saisir('input[placeholder="Mers-les-Bains"]', "Mulhouse");
    await p.saisir('input[placeholder="06 12 34 56 78"]', "0600000000");
    let totalCommande = null;
    p.etat.faux.set("POST /api/caisse/code", async () => ({
      body: { type: "carte", carte: { code: "ESSAIPIXEL", masque: "XXXX-XXXX-PIXL", soldeCents: 100000 } },
    }));
    p.etat.faux.set("POST /api/orders", async (req) => {
      const corps = JSON.parse(req.postData || "{}");
      const panier = await (await fetch(`${SITE}/api/cart/${corps.cartId}`)).json();
      totalCommande = panier.items.reduce((s, it) => s + it.unitPriceCents * it.quantity, 0) + PORT;
      return { body: { orderId: 990004, number: "ESSAI-PIXEL-4", status: "pending", totalCents: totalCommande, shippingCents: PORT, giftCardCents: totalCommande, aPayerCents: 0 } };
    });
    p.etat.faux.set("POST /api/payments/gratuit", async () => ({ body: { status: "paid", number: "ESSAI-PIXEL-4" } }));
    await p.saisir("#ml-code-caisse", "ESSAIPIXEL");
    await p.bouton("Appliquer");
    await p.attendre("[...document.querySelectorAll('main button')].some(b => b.textContent.trim() === 'Valider ma commande' && !b.disabled)", 20000);
    await p.capture("f3-1-caisse-gratuite");
    await p.bouton("Valider ma commande");
    await p.attendre(MERCI, 25000);
    await pause(2000);
    await p.capture("f3-2-merci");
    p.etat.faux.clear();
    const a = p.appelsDu("f3-commande-gratuite-simulee");
    const achats = tracks(a, "Purchase").map((x) => x.args);
    verifier(
      `Purchase une fois sur le « Merci », au total de la commande (${totalCommande / 100} € = 3 × 23 € + port ${PORT / 100} €, mode « ${mode} »)`,
      totalCommande === 3 * 2300 + PORT && JSON.stringify(achats) === JSON.stringify([["track", "Purchase", { value: totalCommande / 100, currency: "EUR" }, { eventID: "achat-ESSAI-PIXEL-4" }]]),
      achats,
    );
    verifier("pas d'InitiateCheckout de plus (déjà mesuré pour ce panier dans cet onglet)", tracks(a, "InitiateCheckout").length === 0);
    const simulees = p.etat.simulees.filter((s) => s.scenario === "f3-commande-gratuite-simulee").map((s) => s.requete);
    verifier("code, création et validation SIMULÉES (rien n'a atteint l'API)", JSON.stringify(simulees) === JSON.stringify(["POST /api/caisse/code", "POST /api/orders", "POST /api/payments/gratuit"]), simulees);
    const apres = await (await fetch(`${SITE}/api/cart/${avant.id}`)).json();
    verifier("le panier est resté un panier côté serveur (aucune commande créée)", (apres.status ?? null) === avant.etat && (apres.items || []).length === avant.lignes.length, { avant: avant.etat, apres: apres.status });
    const idApres = await p.eval("localStorage.getItem('ml_cart_id')");
    verifier("le « Merci » oublie le panier payé (la pastille en rouvre un neuf), comme avant", idApres !== avant.id, { avant: avant.id, apres: idApres });
  });

  // f2. Retour d'un paiement à redirection (secret dans l'adresse), API SIMULÉE.
  await scenario("f2-retour-de-redirection-simule", async () => {
    await p.aller("/affiches", 1500);
    await p.eval("(async () => { const m = await import('/src/lib/meta-pixel.ts'); m.retenirCommande('ESSAI-PIXEL-3', 4560); return 1; })()");
    p.etat.faux.set("POST /api/payments/stripe/retour", async () => {
      await pause(2500);
      return { body: { issue: "payee", number: "ESSAI-PIXEL-3" } };
    });
    const debut = p.etat.meta.length;
    const charge = p.attendreChargement();
    await p.envoyer("Page.navigate", { url: `${SITE}/commande?payment_intent=pi_essai_pixel&payment_intent_client_secret=pi_essai_pixel_secret_essai` });
    await charge;
    await pause(1200);
    const pendant = { adresse: await p.eval("location.search"), scriptsMeta: p.etat.meta.length - debut, fbq: (await p.etatPixel()).fbq };
    await p.attendre(MERCI, 25000);
    await pause(2500);
    p.etat.faux.clear();
    const apres = { adresse: await p.eval("location.search"), scriptsMeta: p.etat.meta.length - debut, reste: await p.eval("sessionStorage.getItem('ml_meta_commande_ESSAI-PIXEL-3')") };
    await p.capture("f2-merci-apres-redirection");
    verifier("tant que le secret du paiement est dans l'adresse, le script de Meta ne se charge pas", pendant.adresse.includes("client_secret") && pendant.scriptsMeta === 0 && pendant.fbq === "function", pendant);
    verifier("adresse nettoyée par la caisse, puis script chargé une fois", apres.adresse === "" && apres.scriptsMeta === 1, apres);
    const a = p.appelsDu("f2-retour-de-redirection-simule");
    verifier(
      "Purchase 45,60 € (total gardé avant la redirection), une fois, envoyé depuis l'adresse SANS secret",
      JSON.stringify(tracks(a, "Purchase").map((x) => x.args)) === JSON.stringify([["track", "Purchase", { value: 45.6, currency: "EUR" }, { eventID: "achat-ESSAI-PIXEL-3" }]]) && a.every((x) => !/secret|payment_intent/.test(x.page)),
      a.map((x) => [x.page, x.args]),
    );
    verifier("total effacé de l'onglet après l'achat", apres.reste === null);
  });

  // f4. Une adresse à jeton (mot de passe oublié) : rien chez Meta, ni sur la page d'après.
  await scenario("f4-adresse-a-jeton", async () => {
    const debut = p.etat.meta.length;
    await p.aller("/compte/reinitialiser?jeton=essai-pixel-jeton-secret", 3500);
    const sur = {
      adresse: await p.eval("location.pathname + location.search"),
      scriptsMeta: p.etat.meta.length - debut,
      meta: await p.eval("document.querySelector('meta[name=referrer]')?.content || null"),
    };
    const charge = p.attendreChargement();
    await p.eval("location.href = '/affiches'; 1");
    await charge;
    await pause(3000);
    const ensuite = { referrer: await p.eval("document.referrer"), scriptsMeta: p.etat.meta.length - debut };
    verifier("page à jeton : le script de Meta ne se charge pas", sur.scriptsMeta === 0, sur);
    verifier("page à jeton : <meta name=referrer content=strict-origin>", sur.meta === "strict-origin", sur);
    verifier("page suivante : le referrer ne porte plus le jeton (origine seule)", !/jeton/.test(ensuite.referrer), ensuite);
    verifier(
      "aucune mesure traitée sur la page à jeton (rien n'a pu partir avec le jeton)",
      !p.appelsDu("f4-adresse-a-jeton").some((a) => /jeton|reinitialiser/.test(a.page)),
      p.appelsDu("f4-adresse-a-jeton").map((a) => [a.page, a.args[1] ?? a.args[0]]),
    );
    // Garde de secours : une page du site atteinte depuis une adresse à secret
    // (referrer imposé ici par CDP) ne charge pas le script de Meta.
    const avantSecours = p.etat.meta.length;
    const chargeSecours = p.attendreChargement();
    await p.envoyer("Page.navigate", { url: `${SITE}/affiches`, referrer: `${SITE}/panier/recuperer?jeton=essai-pixel-secret` });
    await chargeSecours;
    await pause(3000);
    const secours = {
      referrer: await p.eval("document.referrer"),
      scriptsMeta: p.etat.meta.length - avantSecours,
      fbq: (await p.etatPixel()).fbq,
    };
    verifier(
      "arrivée depuis une adresse du site à jeton (referrer complet) : fbq en file d'attente, script de Meta jamais chargé",
      /jeton/.test(secours.referrer) && secours.scriptsMeta === 0 && secours.fbq === "function",
      secours,
    );
    await p.aller("/", 2500);
  });

  // g. La tablette d'un stand : rien, même avec l'accord.
  await scenario("g-stand", async () => {
    await p.aller("/?stand=1", 3000);
    let e = await p.etatPixel();
    verifier("mode stand (?stand=1), accord donné : html[data-stand=1], pas de window.fbq", e.dataStand === "1" && e.fbq === "undefined" && e.consentement === "accept", e);
    await p.capture("g-stand-accueil");
    await p.aller(`${AFFICHE}?stand=1`, 2500);
    await p.bouton("Personnaliser");
    await p.attendre("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Continuer')", 25000);
    await pause(1500);
    await p.bouton("Continuer");
    await pause(900);
    await p.bouton("Continuer");
    await pause(900);
    const nav = p.attendreChargement();
    await p.bouton("Valider l'affiche");
    await nav;
    await pause(3000);
    const adresse = await p.eval("location.pathname + location.search");
    e = await p.etatPixel();
    const panier = await etatPanier();
    await p.capture("g-stand-panier");
    verifier("au stand, l'ajout mène au panier de la tablette, l'affiche y est", /^\/panier\?stand=1/.test(adresse) && panier.lignes.length >= 1, { adresse, lignes: panier.lignes });
    verifier("au stand : aucun appel au pixel, aucune requête vers Meta", p.appelsDu("g-stand").length === 0 && p.metaDu("g-stand").length === 0 && e.fbq === "undefined");
  });

  // h. Un bloqueur de pub qui refuse le script de Meta : le panier marche.
  await scenario("h-bloqueur-de-pub", async () => {
    p.etat.modeMeta = "bloquer";
    // Un panier du site, pas celui de la tablette du stand ci-dessus.
    await p.eval("localStorage.removeItem('ml_cart_id'); 1");
    await p.aller("/carte-cadeau", 2500);
    await p.bouton("20 €", 0, "main");
    await pause(400);
    const nav = p.attendreChargement();
    await p.bouton("Ajouter au panier · 20 €");
    await nav;
    await attendreLignes(1);
    const panier = await etatPanier();
    const e = await p.etatPixel();
    p.etat.modeMeta = "faux";
    const erreurs = vraiesErreurs(["h-bloqueur-de-pub"]).filter((x) => !/facebook|fbevents/.test(`${x.texte} ${x.url || ""}`));
    verifier("script de Meta bloqué : la carte cadeau arrive au panier, la caisse s'affiche", panier.lignes.some((l) => l.carte && l.prixCents === 2000), panier.lignes);
    verifier("les mesures restent en file d'attente, sans erreur", e.fbq === "function" && e.file >= 3 && erreurs.length === 0, { file: e.file, erreurs });
    await p.capture("h-bloqueur-de-pub");
  });

  // Bilan réseau : rien n'est parti chez Meta.
  p.scenario("bilan");
  const autres = p.etat.meta.filter((m) => m.reponse === "bloquée");
  verifier("toutes les requêtes vers Meta interceptées : fbevents.js servi en local (ou bloqué), aucune autre", autres.length === 0, autres);
  verifier("aucune réponse de Meta venue du réseau (pas d'adresse IP distante)", p.etat.reseauMeta.every((r) => !r.ipDistante), p.etat.reseauMeta.filter((r) => r.ipDistante));
  const hotes = [...new Set(p.etat.externes.map((x) => new URL(x.url).hostname))];
  verifier("hôtes extérieurs demandés par les pages", true, hotes);
} finally {
  const versionsFin = versions();
  const changees = Object.keys(versionsDebut).filter((k) => versionsDebut[k] !== versionsFin[k]);
  const journal = {
    date: new Date().toISOString(),
    versions: versionsDebut,
    fichiersModifiesPendantLEssai: changees,
    verifications: verifs,
    appelsAuPixel: p.etat.appels,
    requetesMeta: p.etat.meta,
    reseauMeta: p.etat.reseauMeta,
    requetesExterieures: p.etat.externes,
    simulees: p.etat.simulees,
    pagesServies: p.etat.pages,
    erreurs: p.etat.erreurs.filter((e) => !estBruitVite(e)),
    bruitServeurDeDev: p.etat.erreurs.filter(estBruitVite).length,
    dialogues: p.etat.dialogues,
    parcours: resultats,
  };
  writeFileSync(`${CAPTURES}journal-pixel.json`, JSON.stringify(journal, null, 1));
  const lignes = [
    `Essai du pixel Meta en local — ${journal.date}`,
    `Fichiers essayés (sha1) : ${Object.entries(versionsDebut).map(([k, v]) => `${k} ${v}`).join(" ; ")}`,
    changees.length ? `ATTENTION : modifiés pendant l'essai : ${changees.join(", ")}` : "Aucun fichier modifié pendant l'essai.",
    "",
    "VÉRIFICATIONS",
    ...verifs.map((v) => `${v.ok ? "OK   " : "ÉCHEC"} [${v.scenario}] ${v.nom}${v.ok ? "" : " — " + v.details.slice(0, 500)}`),
    "",
    "APPELS AU PIXEL (notés par le faux fbevents.js)",
    ...p.etat.appels.map((a) => `[${a.scenario}] ${a.page} (${a.via}) ${JSON.stringify(a.args)}`),
    "",
    "REQUÊTES VERS META (toutes interceptées)",
    ...p.etat.meta.map((m) => `[${m.scenario}] ${m.methode} ${m.url} → ${m.reponse}`),
    "",
    "RÉPONSES DE L'API SIMULÉES",
    ...p.etat.simulees.map((s) => `[${s.scenario}] ${s.requete} ${s.corps ? s.corps.slice(0, 200) : ""} → ${JSON.stringify(s.reponse)}`),
    "",
    `ERREURS (hors ${journal.bruitServeurDeDev} messages du client Vite du serveur de dev)`,
    ...journal.erreurs.map((e) => `[${e.scenario}] ${e.source} : ${e.texte.slice(0, 200)}`),
  ];
  writeFileSync(`${CAPTURES}resume-pixel.txt`, lignes.join("\n") + "\n");
  console.log(`\n${verifs.filter((v) => v.ok).length}/${verifs.length} vérifications OK ; journal : ${CAPTURES}journal-pixel.json`);
  if (changees.length) console.log("ATTENTION : modifiés pendant l'essai : " + changees.join(", "));
  await p.fermer();
}
