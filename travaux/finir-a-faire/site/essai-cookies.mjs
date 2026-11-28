// Le bandeau cookies : « Gérer les cookies » au pied de page, et pas de
// bandeau à la tablette d'un stand (28/11, Alexandra : « finis le à faire
// sauf la partie personnages » ; A-FAIRE 0.1 quater et 0.6).
//
// Sur le site LOCAL (pile docker de dev, http://localhost:8080), chaque essai
// dans un contexte de navigation isolé (stockage vierge). Rien ne part chez
// Google ni chez Meta : en local, ni Tag Manager ni le pixel ne sont dans la
// page (import.meta.env.PROD). Pour voir ce que Google recevrait, le début du
// script de Google de Base.astro (le Consent Mode : `dataLayer`, `gtag`, le
// refus par défaut, l'écoute de « ml:consent »), recopié TEL QUEL, est joué en
// tête de chaque page, comme en production — sans la ligne qui charge Tag
// Manager.
//
//   node essai-cookies.mjs
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brancher, pause } from "./pilote.mjs";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, "../../..");
const SITE = process.env.SITE || "http://localhost:8080";
const CAPTURES = resolve(ici, "captures");
mkdirSync(CAPTURES, { recursive: true });

const BASE = readFileSync(resolve(racine, "apps/web/src/layouts/Base.astro"), "utf8");
const d = BASE.indexOf("window.dataLayer = window.dataLayer || [];");
const f = BASE.indexOf('gtag("js", new Date());', d);
if (d < 0 || f < 0) throw new Error("script de Google introuvable dans Base.astro");
const GOOGLE_CONSENT = BASE.slice(d, f);

/** L'état du Consent Mode après les commandes reçues par `dataLayer`. */
const ETAT_GOOGLE = `(() => {
  const etat = {}; const suite = [];
  for (const a of window.dataLayer || []) {
    if (!a || a[0] !== "consent") continue;
    Object.assign(etat, a[2]); suite.push(a[1] + ":" + a[2].analytics_storage);
  }
  return { analytics: etat.analytics_storage, pub: etat.ad_storage, suite };
})()`;

const ETAT = `(() => {
  const b = document.getElementById("cookie-banner");
  const g = document.querySelector("[data-cookies-gerer]");
  const ligne = document.querySelector("[data-cookies-actuel]");
  const croix = document.querySelector("[data-cookies-fermer]");
  const coche = (v) => { const el = document.querySelector('[data-consent="' + v + '"] .ml-cookies-coche'); return !!el && getComputedStyle(el).display !== "none"; };
  let choix = "illisible"; try { choix = localStorage.getItem("ml_cookie_consent"); } catch (e) {}
  return {
    stand: document.documentElement.getAttribute("data-stand"),
    bandeauPresent: !!b,
    bandeauVisible: !!b && !b.hidden && b.getClientRects().length > 0,
    lienPresent: !!g,
    lienVisible: !!g && !g.hidden && g.getClientRects().length > 0,
    lienTexte: g ? g.textContent.trim() : null,
    lienEtendu: g ? g.getAttribute("aria-expanded") : null,
    ligne: ligne && !ligne.hidden ? ligne.textContent : null,
    croix: !!croix && !croix.hidden,
    courant: [...document.querySelectorAll("[data-consent][aria-current=true]")].map((x) => x.getAttribute("data-consent")),
    cocheAccepter: coche("accept"),
    cocheRefuser: coche("refuse"),
    focus: document.activeElement ? (document.activeElement.id || document.activeElement.getAttribute("data-cookies-gerer") !== null && "lien-gerer" || document.activeElement.tagName) : null,
    choix,
    evenements: window.__consentements || [],
    erreurs: window.__erreurs || [],
    cookies: document.cookie,
  };
})()`;

const resultats = [];
function verifier(nom, ok, detail) {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? "OK   " : "ÉCHEC"} ${nom}${detail === undefined ? "" : " — " + JSON.stringify(detail).slice(0, 300)}`);
}

async function contexte(largeur = 1280, hauteur = 900, mobile = false) {
  const c = await brancher({ isole: true });
  await c.avantChaquePage(GOOGLE_CONSENT);
  await c.taille(largeur, hauteur, mobile);
  return c;
}
const cliquer = (c, sel) => c.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.click(); return true; })()`);
const echap = (c) => c.touche("Escape", "Escape", 27);
async function captureBas(c, fichier, largeur, hauteur) {
  await c.capture(resolve(CAPTURES, fichier), { x: 0, y: 0, width: largeur, height: hauteur });
}

/* --- 1. Le site, première visite : le bandeau, puis « Accepter » --- */
console.log("— 1. Première visite, puis « Accepter »");
{
  const c = await contexte(1280, 800);
  try {
    await c.aller(`${SITE}/`, 1500);
    let e = await c.eval(ETAT);
    verifier("1.1 bandeau affiché à la première visite", e.bandeauVisible, e);
    verifier("1.2 première fois : ni ligne « Choix actuel », ni coche, ni croix", !e.ligne && !e.croix && e.courant.length === 0 && !e.cocheAccepter && !e.cocheRefuser, e);
    verifier("1.3 Google : refus par défaut", (await c.eval(ETAT_GOOGLE)).analytics === "denied");
    await echap(c);
    e = await c.eval(ETAT);
    verifier("1.4 Échap ne ferme pas un bandeau sans choix", e.bandeauVisible);
    await c.eval("window.scrollTo(0, 0)");
    await captureBas(c, "cookies-1-premiere-visite-1280.png", 1280, 800);
    await cliquer(c, '#cookie-banner [data-consent="accept"]');
    e = await c.eval(ETAT);
    verifier("1.5 « Accepter » : choix gardé, bandeau fermé, évènement accept", e.choix === "accept" && !e.bandeauVisible && e.evenements.join() === "accept", e);
    verifier("1.6 Google : accordé", (await c.eval(ETAT_GOOGLE)).analytics === "granted");
    verifier("1.7 pas d'erreur JS", e.erreurs.length === 0, e.erreurs);

    /* --- 2. Page suivante : le lien, puis le bandeau rouvert --- */
    console.log("— 2. « Gérer les cookies » après « Accepter »");
    await c.aller(`${SITE}/affiches?genre=personnalisable`, 1200);
    e = await c.eval(ETAT);
    verifier("2.1 page suivante : pas de bandeau, Google accordé d'emblée", !e.bandeauVisible && (await c.eval(ETAT_GOOGLE)).analytics === "granted", e);
    verifier("2.2 le lien « Gérer les cookies » est au pied de page", e.lienVisible && e.lienTexte === "Gérer les cookies" && e.lienEtendu === "false", e);
    await c.eval('document.querySelector("[data-cookies-gerer]").scrollIntoView({ block: "center" }); true');
    await pause(300);
    const pied = await c.eval('(() => { const r = document.querySelector("footer").getBoundingClientRect(); return { y: Math.max(0, r.top + scrollY), h: r.height }; })()');
    await c.capture(resolve(CAPTURES, "cookies-2-pied-de-page-1280.png"), { x: 0, y: pied.y, width: 1280, height: pied.h });
    // Un vrai clic de souris sur le lien. La capture « au-delà de l'écran »
    // fait défiler la page : on remet le lien sous les yeux d'abord.
    await c.eval('document.querySelector("[data-cookies-gerer]").scrollIntoView({ block: "center" }); true');
    await pause(200);
    const pos = await c.eval('(() => { const r = document.querySelector("[data-cookies-gerer]").getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, sous: document.elementFromPoint(x, y)?.hasAttribute("data-cookies-gerer") }; })()');
    verifier("2.2b le lien est bien sous le pointeur", pos.sous, pos);
    await c.clic(pos.x, pos.y);
    await pause(150);
    e = await c.eval(ETAT);
    verifier("2.3 le bandeau se rouvre", e.bandeauVisible && e.lienEtendu === "true", e);
    verifier("2.4 il montre le choix actuel : « Accepter » coché, la ligne", e.courant.join() === "accept" && e.cocheAccepter && !e.cocheRefuser && e.ligne === "Choix actuel : vous avez accepté.", e);
    verifier("2.5 la croix est là, le focus est dans le bandeau", e.croix && e.focus === "cookie-banner", e);
    await captureBas(c, "cookies-3-rouvert-accepte-1280.png", 1280, 800);
    await echap(c);
    e = await c.eval(ETAT);
    verifier("2.6 Échap referme sans rien changer, le focus revient au lien", !e.bandeauVisible && e.choix === "accept" && e.evenements.length === 0 && e.focus === "lien-gerer", e);
    await cliquer(c, "[data-cookies-gerer]");
    await cliquer(c, "[data-cookies-fermer]");
    e = await c.eval(ETAT);
    verifier("2.7 la croix referme sans rien changer", !e.bandeauVisible && e.choix === "accept" && e.evenements.length === 0, e);

    /* --- 3. « Refuser » après « Accepter » --- */
    console.log("— 3. « Refuser » après « Accepter »");
    await c.eval(`(() => {
      for (const n of ["_ga=GA1.1.1", "_ga_ESSAI=GS1.1.1", "_gid=GA1.1.2", "_gcl_au=1.1.1", "_fbp=fb.1.1", "_fbc=fb.1.2", "ml_essai_garde=1"])
        document.cookie = n + "; path=/";
      return document.cookie;
    })()`);
    await cliquer(c, "[data-cookies-gerer]");
    await cliquer(c, '#cookie-banner [data-consent="refuse"]');
    e = await c.eval(ETAT);
    verifier("3.1 « Refuser » : choix gardé, bandeau fermé, évènement refuse", e.choix === "refuse" && !e.bandeauVisible && e.evenements.join() === "refuse", e);
    const g = await c.eval(ETAT_GOOGLE);
    verifier("3.2 Google repasse en refus (mesure et publicité)", g.analytics === "denied" && g.pub === "denied", g);
    verifier("3.3 cookies de mesure effacés, les autres gardés", !/(^|; )(_ga|_ga_ESSAI|_gid|_gcl_au|_fbp|_fbc)=/.test(e.cookies) && /ml_essai_garde=1/.test(e.cookies), e.cookies);
    await cliquer(c, "[data-cookies-gerer]");
    e = await c.eval(ETAT);
    verifier("3.4 rouvert : « Refuser » coché, la ligne « vous avez refusé »", e.courant.join() === "refuse" && e.cocheRefuser && !e.cocheAccepter && e.ligne === "Choix actuel : vous avez refusé.", e);
    await captureBas(c, "cookies-4-rouvert-refuse-1280.png", 1280, 800);
    await cliquer(c, '#cookie-banner [data-consent="accept"]');
    e = await c.eval(ETAT);
    verifier("3.5 et « Accepter » de nouveau : évènement accept, Google accordé", e.choix === "accept" && e.evenements.join() === "refuse,accept" && (await c.eval(ETAT_GOOGLE)).analytics === "granted", e);
    await c.aller(`${SITE}/affiches?genre=personnalisable`, 900);
    e = await c.eval(ETAT);
    verifier("3.6 le choix tient d'une page à l'autre", !e.bandeauVisible && e.choix === "accept" && (await c.eval(ETAT_GOOGLE)).analytics === "granted", e);
    verifier("3.7 pas d'erreur JS", e.erreurs.length === 0, e.erreurs);
  } finally {
    await c.fermer();
  }
}

/* --- 4. La tablette d'un stand --- */
console.log("— 4. Tablette du stand (?stand=1)");
{
  const c = await contexte(1180, 820);
  try {
    await c.aller(`${SITE}/?stand=1&accueil=1`, 1500);
    let e = await c.eval(ETAT);
    verifier("4.1 html[data-stand=1], ni bandeau ni lien « Gérer les cookies »", e.stand === "1" && !e.bandeauPresent && !e.lienPresent, e);
    verifier("4.2 aucun choix enregistré", e.choix === null, e.choix);
    const g = await c.eval(ETAT_GOOGLE);
    verifier("4.3 Google en refus", g.analytics === "denied" && g.pub === "denied", g);
    await c.capture(resolve(CAPTURES, "cookies-5-stand-1180.png"));
    // Une autre page du stand, par un vrai lien de la tablette.
    await c.aller(`${SITE}/affiches?genre=personnalisable&stand=1`, 1200);
    e = await c.eval(ETAT);
    verifier("4.4 page suivante du stand : toujours rien, rien d'enregistré", e.stand === "1" && !e.bandeauPresent && !e.lienPresent && e.choix === null, e);
    // Un « Accepter » resté dans la tablette d'avant ce jour.
    await c.eval('localStorage.setItem("ml_cookie_consent", "accept"); true');
    await c.aller(`${SITE}/?stand=1&accueil=1`, 1200);
    const g2 = await c.eval(ETAT_GOOGLE);
    e = await c.eval(ETAT);
    verifier("4.5 ancien « Accepter » dans la tablette : Google finit en refus", g2.analytics === "denied" && g2.pub === "denied", g2);
    verifier("4.6 … sans que le choix gardé soit touché, ni bandeau", e.choix === "accept" && !e.bandeauPresent, e);
    verifier("4.7 pas d'erreur JS", e.erreurs.length === 0, e.erreurs);
    // Le même navigateur hors du stand : le site normal, choix gardé, lien là.
    await c.aller(`${SITE}/`, 1200);
    e = await c.eval(ETAT);
    verifier("4.8 hors du stand, même navigateur : le site normal (lien présent, pas de bandeau)", e.stand === null && e.lienVisible && !e.bandeauVisible, e);
  } finally {
    await c.fermer();
  }
}

/* --- 5. Téléphone (375 px) --- */
console.log("— 5. Téléphone");
{
  const c = await contexte(375, 812, true);
  try {
    await c.aller(`${SITE}/`, 1500);
    let e = await c.eval(ETAT);
    verifier("5.1 téléphone : bandeau à la première visite", e.bandeauVisible, e);
    await captureBas(c, "cookies-6-premiere-visite-375.png", 375, 812);
    await cliquer(c, '#cookie-banner [data-consent="refuse"]');
    await c.eval('document.querySelector("[data-cookies-gerer]").scrollIntoView({ block: "end" }); true');
    await pause(300);
    await captureBas(c, "cookies-7-pied-375.png", 375, 812);
    await cliquer(c, "[data-cookies-gerer]");
    await pause(150);
    e = await c.eval(ETAT);
    verifier("5.2 téléphone : rouvert, « Refuser » coché, croix", e.bandeauVisible && e.courant.join() === "refuse" && e.croix, e);
    const deborde = await c.eval("document.documentElement.scrollWidth > document.documentElement.clientWidth");
    verifier("5.3 téléphone : rien ne déborde en largeur", !deborde);
    await captureBas(c, "cookies-8-rouvert-375.png", 375, 812);
  } finally {
    await c.fermer();
  }
}

/* --- 6. Les sept langues : le lien, et la ligne du choix actuel --- */
console.log("— 6. Les sept langues");
{
  const c = await contexte(1280, 800);
  try {
    for (const l of ["fr", "en", "de", "it", "es", "ja", "zh"]) {
      await c.aller(`${SITE}${l === "fr" ? "/" : "/" + l}`, 700);
      await c.eval('localStorage.setItem("ml_cookie_consent", "refuse"); true');
      await cliquer(c, "[data-cookies-gerer]");
      const e = await c.eval(ETAT);
      verifier(`6.${l} lien « ${e.lienTexte} », ligne « ${e.ligne} »`, e.lienVisible && e.lienTexte && e.ligne && !/cookies\./.test(e.lienTexte + e.ligne), e.lienTexte);
    }
  } finally {
    await c.fermer();
  }
}

/* --- 7. Le lien sur les différentes sortes de pages --- */
console.log("— 7. Le lien sur toutes les sortes de pages");
for (const chemin of ["/", "/affiches", "/affiches?genre=personnalisable", "/recherche?q=paris", "/pages/cookies", "/pages/mentions-legales", "/contact", "/commande", "/compte/connexion", "/carte-cadeau", "/page-qui-n-existe-pas", "/en/affiches"]) {
  const r = await fetch(SITE + chemin, { redirect: "follow" });
  const html = await r.text();
  verifier(`7. ${chemin} (${r.status}) : lien et bandeau dans la page`, html.includes("data-cookies-gerer") && html.includes('id="cookie-banner"'));
}
for (const chemin of ["/?stand=1&accueil=1", "/affiches?stand=1", "/panier?stand=1", "/pages/cookies?stand=1"]) {
  const r = await fetch(SITE + chemin, { redirect: "follow" });
  const html = await r.text();
  verifier(`7. stand ${chemin} (${r.status}) : ni lien ni bandeau, « refuse » annoncé`, !html.includes("data-cookies-gerer") && !html.includes('id="cookie-banner"') && html.includes('consent: "refuse"'));
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length} vérifications, ${echecs.length} échec(s).`);
if (echecs.length) process.exitCode = 1;
