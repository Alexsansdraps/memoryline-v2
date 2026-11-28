/**
 * Parcours au navigateur de BO › Pages › une page : le bouton « dans toutes
 * les langues » (A-FAIRE § 2, Alexandra le 28/11 : « finis le à faire »).
 *
 * Chrome sans écran (CDP, port 9351) sur un back-office de développement
 * (http://127.0.0.1:4391/bo) branché sur l'API d'essai (api-essai.mts : les
 * vraies routes des pages, une base jetable, un faux traducteur, aucun compte).
 * Rien ne part chez OpenAI ; rien ne touche la base locale ni la prod.
 *
 *   node travaux/finir-a-faire/bo-tout-traduire/parcours.mjs [principal|echec]
 *
 * Captures dans ./captures. Chaque vérification s'écrit « OK » ou « ÉCHEC ».
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { corpsDepuisBlocs, morceauxHtml } from "../../../apps/admin/src/lib/traductions-pages.ts";

const ICI = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(ICI, "captures");
mkdirSync(CAPTURES, { recursive: true });
const CDP = `http://127.0.0.1:${process.env.CDP_PORT || 9351}`;
const BO = process.env.BO || "http://127.0.0.1:4391/bo";
const API = process.env.API || "http://127.0.0.1:3971";
const LANGUES = ["en", "de", "it", "es", "ja", "zh"];

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
let echecs = 0;
function verifie(condition, quoi) {
  console.log(`${condition ? "OK   " : "ÉCHEC"} ${quoi}`);
  if (!condition) echecs++;
}

/* --- Le petit client CDP ------------------------------------------------- */
async function brancher() {
  const liste = await (await fetch(`${CDP}/json/list`)).json();
  let onglet = liste.find((t) => t.type === "page");
  if (!onglet) onglet = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(onglet.webSocketDebuggerUrl);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = ko;
  });
  let id = 0;
  const attente = new Map();
  const ecouteurs = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && attente.has(d.id)) {
      const { ok, ko } = attente.get(d.id);
      attente.delete(d.id);
      if (d.error) ko(new Error(JSON.stringify(d.error)));
      else ok(d.result);
    } else if (d.method) for (const e of ecouteurs) e(d);
  };
  const envoyer = (method, params = {}) =>
    new Promise((ok, ko) => {
      const n = ++id;
      attente.set(n, { ok, ko });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { ws, envoyer, ecouteurs };
}

const c = await brancher();
await c.envoyer("Page.enable");
await c.envoyer("Runtime.enable");
const erreursJs = [];
c.ecouteurs.add((d) => {
  if (d.method === "Runtime.exceptionThrown")
    erreursJs.push(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
    erreursJs.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
});
async function taille(largeur, hauteur) {
  await c.envoyer("Emulation.setDeviceMetricsOverride", {
    width: largeur,
    height: hauteur,
    deviceScaleFactor: 1,
    mobile: largeur < 768,
  });
}
await taille(1400, 1000);

function prochainChargement(ms = 90_000) {
  return new Promise((ok) => {
    const f = (d) => {
      if (d.method === "Page.loadEventFired") {
        clearTimeout(minuterie);
        c.ecouteurs.delete(f);
        ok(true);
      }
    };
    const minuterie = setTimeout(() => {
      c.ecouteurs.delete(f);
      ok(false);
    }, ms);
    c.ecouteurs.add(f);
  });
}
async function js(expression) {
  const r = await c.envoyer("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails)
    throw new Error("Exception dans la page : " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function ouvrir(chemin) {
  const charge = prochainChargement();
  await c.envoyer("Page.navigate", { url: chemin.startsWith("http") ? chemin : BO + chemin });
  await charge;
  await pause(400);
}
/** Le premier bouton dont le texte commence par… (espaces réduits). */
const bouton = (texte, dans = "document") =>
  `[...${dans}.querySelectorAll("button")].find((b) => b.textContent.replace(/\\s+/g, " ").trim().startsWith(${JSON.stringify(texte)}))`;
async function cliquer(expressionElement, { attendre = true } = {}) {
  const charge = attendre ? prochainChargement() : null;
  const r = await js(
    `(() => { const el = ${expressionElement}; if (!el) return "INTROUVABLE"; el.scrollIntoView({ block: "center" }); el.click(); return "ok"; })()`,
  );
  if (r !== "ok") throw new Error("Élément introuvable : " + expressionElement);
  if (charge && !(await charge)) throw new Error("La page n'a pas été rechargée après le clic.");
  if (charge) await pause(400);
}
async function capture(nom, selecteur) {
  let clip;
  if (selecteur) {
    const r = await js(
      `(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`,
    );
    if (r) clip = { ...r, scale: 1 };
  }
  const r = await c.envoyer("Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip, captureBeyondViewport: true } : {}),
  });
  writeFileSync(join(CAPTURES, nom), Buffer.from(r.data, "base64"));
  console.log(`      capture : captures/${nom}`);
}
const message = () => js(`document.querySelector("#traductions [role=status]")?.textContent.replace(/\\s+/g, " ").trim() ?? ""`);
const messageHaut = () =>
  js(`[...document.querySelectorAll("main p.mb-4.rounded.border, p.mb-4.rounded.border")].map((p) => p.textContent.replace(/\\s+/g, " ").trim()).find((t) => t.startsWith("Page enregistrée")) ?? ""`);
const valeurs = () =>
  js(`Object.fromEntries(${JSON.stringify(LANGUES)}.map((l) => [l, Object.fromEntries(["titre", "corps", "seoTitle", "seoDescription"].map((c) => [c, document.querySelector("[name=" + c + "-" + l + "]")?.value ?? null]))]))`);

const apiGet = async (chemin) => (await fetch(API + chemin)).json();
const journal = () => apiGet("/essai/journal");
const viderJournal = () => fetch(API + "/essai/journal/vider", { method: "POST" });

/** Le faux traducteur de l'API d'essai, pour savoir ce qu'il doit rendre. */
function faux(texte, langue) {
  if (!/[<>]/.test(texte)) return `[${langue}] ${texte}`;
  return texte.replace(/>([^<>]*\S[^<>]*)</g, (_m, t) => `>[${langue}] ${t}<`);
}

/* ======================================================================== */
async function principal() {
  /* 1. Une page neuve, sans traduction ----------------------------------- */
  console.log("\n— Page neuve (n° 9), sans aucune traduction");
  await ouvrir("/pages/9");
  verifie(await js(`!!${bouton("✨ Proposer les traductions manquantes (6 langues)")}`), "le bouton des six langues est en tête du bloc Traductions");
  verifie(await js(`!![...document.querySelectorAll("#traductions a")].find((a) => a.textContent.trim() === "Toutes les langues")`), "« Toutes les langues » rejoint les six langues");
  await capture("01-page-neuve.png", "#traductions");

  await viderJournal();
  const charge = prochainChargement();
  // Lu dans le même geste que le clic : la page part aussitôt vers la suivante.
  const pendant = await js(`(async () => {
    const b = ${bouton("✨ Proposer les traductions manquantes (6 langues)")};
    b.click();
    await new Promise((r) => setTimeout(r, 30));
    return b.textContent.trim() + (b.disabled ? " (bloqué)" : "");
  })()`);
  verifie(pendant.startsWith("Traduction en cours dans les six langues") && pendant.endsWith("(bloqué)"), `pendant la traduction, le bouton le dit et se bloque : ${pendant}`);
  await charge;
  await pause(400);
  verifie((await js("location.search")) === "?langue=toutes", "l'écran des six langues s'ouvre (?langue=toutes)");
  let m = await message();
  verifie(m.startsWith("Traductions proposées en anglais, allemand, italien, espagnol, japonais et chinois, pour les champs vides"), `message : ${m}`);
  let v = await valeurs();
  verifie(v.ja.titre === "[ja] Page d'essai à traduire", `nom proposé en japonais : ${v.ja.titre}`);
  verifie(v.zh.corps?.startsWith("<p>[zh] Bonjour, voici une page <strong>[zh] toute neuve</strong>"), `texte proposé en chinois : ${v.zh.corps?.slice(0, 80)}`);
  verifie(v.de.seoTitle === "[de] Page d'essai — Memory Line" && v.de.seoDescription === "", "référencement : le titre Google proposé, la description (française vide) laissée vide");
  const jaunes = await js(`({ cases: document.querySelectorAll("#traductions input.border-amber-400, #traductions textarea.border-amber-400").length, editeurs: document.querySelectorAll("#traductions .ring-amber-400").length, pastilles: [...document.querySelectorAll("#traductions h4 span")].filter((s) => s.textContent.includes("proposition à relire")).length })`);
  verifie(jaunes.cases === 12 && jaunes.editeurs === 6 && jaunes.pastilles === 6, `propositions encadrées de jaune : ${JSON.stringify(jaunes)}`);
  let j = await journal();
  const appels = j.filter((x) => x.quoi === "traduire");
  verifie(appels.length === 6 && new Set(appels.map((x) => x.langue)).size === 6, `six appels, un par langue (${appels.map((x) => x.langue + ":" + x.cles.join("+")).join(" ")})`);
  const debuts = appels.map((x) => x.quand);
  verifie(Math.max(...debuts) - Math.min(...debuts) < 300, `partis ensemble (écart ${Math.max(...debuts) - Math.min(...debuts)} ms ; 400 ms chacun)`);
  verifie(!j.some((x) => x.quoi === "enregistrer"), "rien n'est enregistré par la proposition");
  await capture("02-six-langues-proposees.png", "#traductions");

  /* 2. Relire, corriger, enregistrer -------------------------------------- */
  console.log("\n— Relire, corriger à la main, enregistrer les six langues d'un coup");
  await js(`(() => { const t = document.querySelector("[name=titre-de]"); t.value = "Testseite (von Hand)"; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[name=seoTitle-it]").value = ""; })()`);
  await viderJournal();
  await cliquer(bouton("Enregistrer les traductions"));
  m = await message();
  verifie(m.startsWith("Traductions enregistrées en anglais, allemand, italien, espagnol, japonais et chinois."), `message : ${m}`);
  j = await journal();
  verifie(j.filter((x) => x.quoi === "enregistrer").length === 1, "un seul envoi pour les six langues");
  let p = (await apiGet("/admin/pages/9")).page;
  verifie(Object.keys(p.translations ?? {}).sort().join() === "de,en,es,it,ja,zh", "les six langues sont en base");
  verifie(p.translations.de.title === "Testseite (von Hand)", "la correction à la main est enregistrée");
  verifie(p.translations.it.seoTitle === undefined && p.translations.it.title === "[it] Page d'essai à traduire", "un champ vidé n'est pas enregistré (le site retombe sur le nom traduit)");
  const pub = await apiGet("/pages/essai-sans-traduction?lang=ja");
  verifie(pub.title === "[ja] Page d'essai à traduire" && pub.blocks?.[0]?.html?.includes("[ja] Bonjour"), "la page publique japonaise montre la traduction");
  const pastilles = await js(`Object.fromEntries([...document.querySelectorAll("#traductions h4")].map((h) => [h.querySelector("span").textContent.trim(), h.querySelectorAll("span")[1]?.textContent.trim()]))`);
  verifie(pastilles.Allemand === "traduit" && pastilles.Italien === "partiel", `états après l'enregistrement : ${JSON.stringify(pastilles)}`);
  await capture("03-six-langues-enregistrees.png", "#traductions");

  /* 3. Re-proposer ne remplace rien d'écrit ------------------------------- */
  console.log("\n— Proposer de nouveau : seul ce qui est vide part, rien d'écrit n'est remplacé");
  await js(`document.querySelector("[name=titre-en]").value = ""`);
  await viderJournal();
  await cliquer(bouton("✨ Proposer les traductions manquantes", 'document.querySelector("#traductions form:has([name=titre-en])")'));
  j = (await journal()).filter((x) => x.quoi === "traduire");
  verifie(
    j.length === 2 && j.some((x) => x.langue === "en" && x.cles.join() === "titre") && j.some((x) => x.langue === "it" && x.cles.join() === "seoTitle"),
    `ne repartent que le nom anglais vidé et le titre Google italien (${j.map((x) => x.langue + ":" + x.cles.join("+")).join(" ")})`,
  );
  v = await valeurs();
  verifie(v.de.titre === "Testseite (von Hand)", "la traduction allemande faite à la main est intacte");
  verifie(v.en.titre === "[en] Page d'essai à traduire", "le nom anglais vidé est proposé de nouveau");
  await cliquer(`[...document.querySelectorAll("#traductions a")].find((a) => a.textContent.trim() === "Fermer sans enregistrer")`);
  verifie((await js("location.search")) === "", "« Fermer sans enregistrer » referme les six langues");

  /* 4. Confidentialité : la traduction que le site montrait tronquée ------ */
  console.log("\n— Confidentialité (n° 7) : traductions en 17 morceaux face au français d'un seul tenant");
  const avant7 = (await apiGet("/admin/pages/7")).page;
  const enAvant = (await apiGet("/pages/confidentialite?lang=en")).blocks?.[0]?.html ?? "";
  const enComplet = corpsDepuisBlocs(avant7.translations.en.blocks);
  verifie(enAvant.length < enComplet.length / 3, `avant : le site anglais n'en montre que ${enAvant.length} caractères sur ${enComplet.length}`);
  await ouvrir("/pages/7");
  const alerte = await js(`[...document.querySelectorAll("#traductions form")].map((f) => f.textContent.replace(/\\s+/g, " ").trim()).find((t) => t.includes("ne suivent plus le découpage")) ?? ""`);
  verifie(alerte.includes("anglais, allemand, italien et espagnol"), `l'écran le dit : ${alerte.slice(0, 140)}…`);
  await capture("04-confidentialite-a-recaler.png", "#traductions");
  await viderJournal();
  await cliquer(bouton("Recaler ces traductions"));
  m = await message();
  verifie(m.includes("Les traductions déjà enregistrées en anglais, allemand, italien et espagnol ont été recalées sur le texte français, sans changer un mot"), `message : ${m}`);
  j = (await journal()).filter((x) => x.quoi === "enregistrer");
  verifie(j.length === 1 && JSON.stringify(j[0].langues) === JSON.stringify({ en: "1 bloc(s)", de: "1 bloc(s)", it: "1 bloc(s)", es: "1 bloc(s)" }) && j[0].blocsFrancais === null, `envoi : ${JSON.stringify(j[0])}`);
  const apres7 = (await apiGet("/admin/pages/7")).page;
  let entier = true;
  for (const l of ["en", "de", "it", "es"]) {
    const html = (await apiGet(`/pages/confidentialite?lang=${l}`)).blocks?.[0]?.html ?? "";
    if (html !== corpsDepuisBlocs(avant7.translations[l].blocks)) entier = false;
    if (apres7.translations[l].title !== avant7.translations[l].title || apres7.translations[l].seoTitle !== avant7.translations[l].seoTitle) entier = false;
  }
  verifie(entier, "après : les quatre langues s'affichent en entier, mot pour mot, nom et référencement intacts");
  verifie(JSON.stringify(apres7.blocks) === JSON.stringify(avant7.blocks), "le français n'a pas bougé");
  verifie(!(await js(`document.body.textContent.includes("ne suivent plus le découpage")`)), "l'alerte a disparu");

  /* 5. Conditions de vente : le japonais et le chinois manquent ----------- */
  console.log("\n— Conditions de vente (n° 5) : 29 morceaux en français ; japonais et chinois à faire");
  const avant5 = (await apiGet("/admin/pages/5")).page;
  const corpsFr = corpsDepuisBlocs(avant5.blocks);
  await ouvrir("/pages/5");
  verifie(!(await js(`document.body.textContent.includes("ne suivent plus le découpage")`)), "pas d'alerte : français et traductions ont le même découpage");
  await viderJournal();
  await cliquer(bouton("✨ Proposer les traductions manquantes (6 langues)"));
  m = await message();
  verifie(m.startsWith("Traductions proposées en japonais et chinois, pour les champs vides"), `message : ${m}`);
  j = (await journal()).filter((x) => x.quoi === "traduire");
  const attendus = morceauxHtml(corpsFr).length;
  verifie(j.every((x) => x.langue === "ja" || x.langue === "zh"), "l'anglais, l'allemand, l'italien et l'espagnol, déjà traduits, ne repartent pas");
  verifie(j.filter((x) => x.langue === "ja").length === attendus && attendus > 1, `le texte (${corpsFr.length} caractères) part en ${attendus} morceaux par langue (${j.filter((x) => x.langue === "ja").map((x) => x.cles.join("+") + "=" + x.tailles.join("/")).join(" ; ")})`);
  verifie(Math.max(...j.map((x) => x.quand)) - Math.min(...j.map((x) => x.quand)) < 300, "tous les morceaux partent ensemble");
  v = await valeurs();
  verifie(v.ja.corps === faux(corpsFr, "ja"), "les morceaux sont recollés dans l'ordre, sans perte");
  verifie(v.en.titre === avant5.translations.en.title && v.en.corps === corpsDepuisBlocs(avant5.translations.en.blocks), "l'anglais est montré tel qu'enregistré");
  await capture("05-cgv-japonais-chinois-proposes.png", "#traductions");
  await viderJournal();
  await cliquer(bouton("Enregistrer les traductions"));
  m = await message();
  verifie(
    m.startsWith("Traductions enregistrées en japonais et chinois.") &&
      m.includes("Le texte français, encore découpé en morceaux, a été réuni au passage.") &&
      m.includes("Les traductions déjà enregistrées en anglais, allemand, italien et espagnol ont été recalées"),
    `message : ${m}`,
  );
  j = (await journal()).filter((x) => x.quoi === "enregistrer");
  verifie(j[0]?.blocsFrancais === 1 && Object.keys(j[0]?.langues ?? {}).length === 6, `un envoi : français réuni + six langues (${JSON.stringify(j[0]?.langues)})`);
  let toutes = true;
  for (const l of ["en", "de", "it", "es"]) {
    const html = (await apiGet(`/pages/conditions-de-vente?lang=${l}`)).blocks?.[0]?.html ?? "";
    if (html !== corpsDepuisBlocs(avant5.translations[l].blocks)) toutes = false;
  }
  verifie(toutes, "les CGV anglaises, allemandes, italiennes et espagnoles s'affichent toujours en entier");
  verifie((await apiGet("/pages/conditions-de-vente?lang=fr")).blocks?.[0]?.html === corpsFr, "le français s'affiche mot pour mot");
  verifie((await apiGet("/pages/conditions-de-vente?lang=ja")).blocks?.[0]?.html === faux(corpsFr, "ja"), "le japonais s'affiche");

  /* 6. L'écran d'une langue ------------------------------------------------ */
  console.log("\n— Cookies (n° 8), écran de l'anglais seul");
  const avant8 = (await apiGet("/admin/pages/8")).page;
  await ouvrir("/pages/8?langue=en");
  // Les boutons qui envoient le formulaire (pas ceux de la barre de l'éditeur).
  const boutons = await js(`[...document.querySelectorAll("#traductions form:has([name=lang]) button:not([type=button])")].map((b) => b.textContent.replace(/\\s+/g, " ").trim())`);
  verifie(boutons[0] === "Enregistrer anglais" && boutons.includes("✨ Proposer dans les six langues"), `boutons : ${JSON.stringify(boutons)}`);
  // La touche Entrée dans le nom : « Enregistrer anglais », jamais une traduction.
  await js(`(() => { const t = document.querySelector("[name=titre]"); t.focus(); t.value = "Cookies"; })()`);
  await viderJournal();
  const chargeEntree = prochainChargement();
  for (const type of ["keyDown", "keyUp"])
    await c.envoyer("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
  await chargeEntree;
  await pause(400);
  m = await message();
  verifie(m.startsWith("Traduction en anglais enregistrée.") && !(await journal()).some((x) => x.quoi === "traduire"), `Entrée enregistre l'anglais : ${m}`);
  verifie(m.includes("Les traductions déjà enregistrées en allemand, italien et espagnol ont été recalées"), "le français réuni, l'allemand, l'italien et l'espagnol ont suivi dans le même envoi");
  for (const l of ["de", "it", "es"]) {
    const html = (await apiGet(`/pages/cookies?lang=${l}`)).blocks?.[0]?.html ?? "";
    verifie(html === corpsDepuisBlocs(avant8.translations[l].blocks), `cookies en ${l} : toujours en entier sur le site`);
  }
  // « Proposer dans les six langues » depuis l'écran de l'anglais : ce qui
  // vient d'y être tapé est gardé.
  await js(`(() => { const t = document.querySelector("[name=titre]"); t.value = "Cookies (à la main, pas enregistré)"; })()`);
  await viderJournal();
  await cliquer(bouton("✨ Proposer dans les six langues"));
  verifie((await js("location.search")) === "?langue=toutes", "il mène à l'écran des six langues");
  v = await valeurs();
  verifie(v.en.titre === "Cookies (à la main, pas enregistré)", "le nom anglais tapé (non enregistré) est gardé");
  j = (await journal()).filter((x) => x.quoi === "traduire");
  verifie(j.length && j.every((x) => x.langue === "ja" || x.langue === "zh"), `seuls le japonais et le chinois partent (${j.map((x) => x.langue).join(" ")})`);

  /* 7. Le français enregistré d'un seul tenant ---------------------------- */
  console.log("\n— Mentions légales (n° 6) : enregistrer le français ne tronque plus ses traductions");
  const avant6 = (await apiGet("/admin/pages/6")).page;
  await ouvrir("/pages/6");
  await viderJournal();
  await cliquer(`[...document.querySelectorAll("form:has(input[name=_action][value=page]) button")].find((b) => b.textContent.trim() === "Enregistrer")`);
  const haut = await messageHaut();
  verifie(haut.startsWith("Page enregistrée. Elle est en ligne sur le site.") && haut.includes("ont été recalées"), `message : ${haut}`);
  j = (await journal()).filter((x) => x.quoi === "enregistrer");
  verifie(j[0]?.blocsFrancais === 1 && Object.keys(j[0]?.langues ?? {}).sort().join() === "de,en,es,it", `envoi : ${JSON.stringify(j[0])}`);
  let mentions = true;
  for (const l of ["en", "de", "it", "es"]) {
    const html = (await apiGet(`/pages/mentions-legales?lang=${l}`)).blocks?.[0]?.html ?? "";
    if (html !== corpsDepuisBlocs(avant6.translations[l].blocks)) mentions = false;
  }
  verifie(mentions, "les mentions légales traduites s'affichent toujours en entier");
  verifie((await apiGet("/pages/mentions-legales?lang=fr")).blocks?.[0]?.html === corpsDepuisBlocs(avant6.blocks), "le français s'affiche mot pour mot");

  /* 8. Téléphone ------------------------------------------------------------ */
  console.log("\n— Sur téléphone (390 px)");
  await taille(390, 844);
  await ouvrir("/pages/9?langue=toutes");
  const deborde = await js(`document.documentElement.scrollWidth > innerWidth + 1`);
  verifie(!deborde, "l'écran des six langues ne déborde pas en largeur");
  await capture("06-telephone-six-langues.png", "#traductions");
  await taille(1400, 1000);
}

async function echec() {
  console.log("\n— Le chinois échoue (FAUX_ECHEC=zh), les autres langues sont proposées");
  await ouvrir("/pages/9?langue=toutes");
  await js(`(() => { for (const l of ["ja", "zh"]) { document.querySelector("[name=titre-" + l + "]").value = ""; document.querySelector("[name=seoTitle-" + l + "]").value = ""; } })()`);
  await viderJournal();
  await cliquer(bouton("✨ Proposer les traductions manquantes", 'document.querySelector("#traductions form:has([name=titre-en])")'));
  const m = await message();
  verifie(
    m.startsWith("Traductions proposées en japonais") &&
      m.includes("Pas de proposition complète en chinois : Le service de traduction ne répond pas. Réessayez dans un instant.") &&
      m.includes("Cliquez de nouveau « Proposer les traductions manquantes » pour compléter."),
    `message : ${m}`,
  );
  const enRouge = await js(`document.querySelector("#langue-zh")?.textContent.includes("Pas de proposition complète en chinois") ?? false`);
  verifie(enRouge, "la section du chinois dit pourquoi");
  const v = await valeurs();
  verifie(v.ja.titre === "[ja] Page d'essai à traduire" && v.zh.titre === "", "le japonais est proposé, le chinois reste vide");
  await capture("07-chinois-en-echec.png", "#traductions");
}

try {
  if ((process.argv[2] ?? "principal") === "echec") await echec();
  else await principal();
} catch (e) {
  echecs++;
  console.log("ÉCHEC (arrêt) " + (e?.stack ?? e));
} finally {
  if (erreursJs.length) console.log("Erreurs JavaScript relevées :\n  " + erreursJs.join("\n  "));
  else console.log("\nAucune erreur JavaScript dans la page.");
  console.log(echecs ? `\n${echecs} vérification(s) en échec.` : "\nToutes les vérifications passent.");
  c.ws.close();
  process.exitCode = echecs ? 1 : 0;
}
