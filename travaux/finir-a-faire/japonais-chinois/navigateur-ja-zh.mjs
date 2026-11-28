// Vérifications au navigateur sans écran (Chrome + CDP) du chantier « japonais
// et chinois » (28/11) : pages légales en /ja et /zh, politique de
// confidentialité complète en /en, recherche en /ja et /zh (un idéogramme
// seul, kana voisés, clavier japonais qui compose), recherche française
// inchangée. Rien n'est commandé, rien n'est envoyé.
//
// Chrome est lancé à part :
//   chrome.exe --headless=new --remote-debugging-port=9395 --user-data-dir=<dossier>
//   node navigateur-ja-zh.mjs [http://localhost:8080]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = process.argv[2] ?? "http://localhost:8080";
const PORT = Number(process.env.CDP_PORT || 9395);
const CAPTURES = resolve(dirname(fileURLToPath(import.meta.url)), "captures");
mkdirSync(CAPTURES, { recursive: true });

const onglet = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(onglet.webSocketDebuggerUrl);
await new Promise((ok, ko) => ((ws.onopen = ok), (ws.onerror = ko)));
let n = 0;
const attente = new Map();
const evenements = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && attente.has(d.id)) {
    const { ok, ko } = attente.get(d.id);
    attente.delete(d.id);
    d.error ? ko(new Error(JSON.stringify(d.error))) : ok(d.result);
  } else if (d.method) evenements.push(d);
};
const cdp = (method, params = {}) =>
  new Promise((ok, ko) => {
    const id = ++n;
    attente.set(id, { ok, ko });
    ws.send(JSON.stringify({ id, method, params }));
  });
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function js(expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function attendre(expression, ms = 10000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await js(`!!(${expression})`).catch(() => false)) return true;
    await pause(150);
  }
  return false;
}
async function aller(url) {
  await cdp("Page.navigate", { url });
  // L'ancienne page peut encore répondre « complete » : on attend la nouvelle adresse.
  const chemin = new URL(url).pathname;
  await attendre(`decodeURIComponent(location.pathname) === ${JSON.stringify(decodeURIComponent(chemin))} && document.readyState === 'complete'`, 20000);
  await pause(400);
}
async function taille(largeur, hauteur, mobile = false) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile });
}
async function capture(nom, pleinePage = false) {
  let clip;
  if (pleinePage) {
    const { cssContentSize } = await cdp("Page.getLayoutMetrics");
    clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 9000), scale: 1 };
  }
  const { data } = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 72, captureBeyondViewport: pleinePage, ...(clip ? { clip } : {}) });
  writeFileSync(resolve(CAPTURES, nom), Buffer.from(data, "base64"));
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");
const bilan = [];
const noter = (ok, texte) => {
  bilan.push(`${ok ? "OK " : "NON"} ${texte}`);
  console.log(ok ? "OK " : "NON", texte);
};

// Le bandeau cookies ne doit pas masquer les captures : on refuse, comme
// une visiteuse prudente (rien ne part chez Meta ni Google).
async function refuserCookies() {
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(b => /refuser|拒否|拒绝|decline|ablehnen|rifiuta|rechazar/i.test(b.textContent || '')); if (b) b.click(); return !!b; })()`).catch(() => false);
  await pause(300);
}

/* 1. Pages légales ------------------------------------------------------- */
await taille(1280, 900);
for (const [l, slug, nom] of [
  ["ja", "conditions-de-vente", "ja-conditions-de-vente.jpg"],
  ["zh", "conditions-de-vente", "zh-conditions-de-vente.jpg"],
  ["ja", "confidentialite", "ja-confidentialite.jpg"],
  ["zh", "confidentialite", "zh-confidentialite.jpg"],
  ["ja", "cookies", "ja-cookies.jpg"],
  ["zh", "mentions-legales", "zh-mentions-legales.jpg"],
]) {
  await aller(`${SITE}/${l}/pages/${slug}`);
  await refuserCookies();
  const info = await js(`(() => { const a = document.querySelector('article'); return { lang: document.documentElement.lang, h1: document.querySelector('h1')?.textContent.trim(), texte: a ? a.innerText : '', liens: a ? [...a.querySelectorAll('a')].map(x => x.getAttribute('href')) : [] }; })()`);
  const latin = (info.texte.match(/\b(the|and|this|page|with|for|your|order|poster)\b/gi) ?? []).length;
  noter(info.lang === l && latin === 0 && info.texte.length > 300, `/${l}/pages/${slug} : « ${info.h1} », ${info.texte.length} caractères, ${latin} mot anglais, liens ${info.liens.filter((h) => h.startsWith("/")).join(" ") || "—"}`);
  await capture(nom, true);
}
await aller(`${SITE}/en/pages/confidentialite`);
await refuserCookies();
const en = await js(`document.querySelector('article').innerText`);
noter(/Your rights/.test(en) && /Children/.test(en) && !/OpenAI/.test(en), `/en/pages/confidentialite complète (${en.length} caractères, « Your rights » et « Children » présents, plus d'OpenAI)`);
await capture("en-confidentialite-complete.jpg", true);
await taille(375, 812, true);
await aller(`${SITE}/ja/pages/mentions-legales`);
await refuserCookies();
const deborde = await js(`document.documentElement.scrollWidth > window.innerWidth + 1`);
noter(!deborde, `/ja/pages/mentions-legales sur 375 px : ${deborde ? "défilement horizontal" : "pas de défilement horizontal"}`);
await capture("ja-mentions-legales-375.jpg", true);
await taille(1280, 900);

/* 2. Recherche ----------------------------------------------------------- */
async function saisir(texte) {
  await js(`(() => { const c = document.getElementById('ml-recherche-page-q'); c.focus(); c.value = ''; c.dispatchEvent(new InputEvent('input', { bubbles: true })); })()`);
  await pause(300);
  await cdp("Input.insertText", { text: texte });
}
const compte = () => js(`document.getElementById('ml-recherche-compte').textContent.trim()`);
const vignettes = () => js(`document.querySelectorAll('#ml-recherche-resultats li').length`);

for (const [l, q, attendu] of [
  ["ja", "港", /5/],
  ["zh", "港", /5/],
  ["ja", "ビーチ", /11/],
  ["ja", "びーち", /11/],
  ["zh", "海滩", /12/],
  ["ja", "エッフェル塔", /9/],
]) {
  await aller(`${SITE}/${l}/recherche`);
  await refuserCookies();
  await saisir(q);
  await attendre(`decodeURIComponent(location.search).includes(${JSON.stringify(q)})`, 5000);
  await pause(600);
  const c = await compte();
  noter(attendu.test(c) && (await vignettes()) > 0, `/${l}/recherche, « ${q} » tapé : ${c} (${await vignettes()} vignettes)`);
  if (q === "港" && l === "ja") await capture("ja-recherche-港.jpg");
  if (q === "ビーチ") await capture("ja-recherche-ビーチ.jpg");
  if (q === "海滩") await capture("zh-recherche-海滩.jpg");
}

// Le clavier japonais qui compose : pas de recherche tant que le mot n'est
// pas choisi, puis la recherche du mot choisi.
await aller(`${SITE}/ja/recherche`);
await refuserCookies();
await js(`document.getElementById('ml-recherche-page-q').focus()`);
const avantRequetes = evenements.filter((e) => e.method === "Network.requestWillBeSent" && /recherche\?q=/.test(e.params.request.url)).length;
for (const etape of ["p", "ぱ", "ぱr", "ぱり"]) {
  await cdp("Input.imeSetComposition", { text: etape, selectionStart: etape.length, selectionEnd: etape.length });
  await pause(120);
}
await pause(700);
const pendant = evenements.filter((e) => e.method === "Network.requestWillBeSent" && /recherche\?q=/.test(e.params.request.url)).length - avantRequetes;
const adressePendant = await js(`location.search`);
noter(pendant === 0 && !adressePendant.includes("q="), `/ja/recherche, clavier japonais en train de composer « ぱり » : ${pendant} requête, adresse « ${adressePendant || "(vide)"} »`);
await cdp("Input.insertText", { text: "ビーチ" });
await attendre(`decodeURIComponent(location.search).includes('ビーチ')`, 5000);
await pause(600);
noter(/11/.test(await compte()), `/ja/recherche, mot choisi « ビーチ » : ${await compte()}`);

// Le français ne change pas : une lettre ne cherche pas, deux cherchent, et
// une composition (accent mort, clavier de téléphone) cherche comme avant.
await aller(`${SITE}/recherche`);
await refuserCookies();
await saisir("p");
await pause(700);
noter(!(await js(`location.search`)).includes("q="), `/recherche, « p » seul : pas de recherche (${await compte()})`);
await saisir("phare");
await attendre(`location.search.includes('phare')`, 5000);
await pause(500);
noter(/4/.test(await compte()), `/recherche, « phare » : ${await compte()}`);
await js(`(() => { const c = document.getElementById('ml-recherche-page-q'); c.value = ''; c.focus(); })()`);
await cdp("Input.imeSetComposition", { text: "cath", selectionStart: 4, selectionEnd: 4 });
await pause(900);
noter((await js(`decodeURIComponent(location.search)`)).includes("cath"), `/recherche, composition en cours « cath » : la recherche part comme avant (${await compte()})`);
await cdp("Input.insertText", { text: "cath" });
await pause(300);
await js(`(() => { const c = document.getElementById('ml-recherche-page-q'); c.value = 'p'; c.dispatchEvent(new InputEvent('input', { bubbles: true })); })()`);
await capture("fr-recherche-phare.jpg");

// Une page de résultats servie directement (sans JavaScript, ou lien partagé).
for (const [chemin, attendu] of [
  ["/ja/recherche?q=城", /点のポスター/],
  ["/zh/recherche?q=塔", /张海报/],
  ["/ja/recherche?q=の", /2文字以上/],
  ["/recherche?q=a", /deux lettres/],
]) {
  await aller(SITE + encodeURI(chemin));
  const c = await compte();
  noter(attendu.test(c), `${chemin} servie directement : ${c}`);
}

const erreursJs = evenements.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params.exceptionDetails?.exception?.description?.split("\n")[0]);
noter(erreursJs.length === 0, `erreurs JavaScript : ${erreursJs.length ? erreursJs.join(" | ") : "aucune"}`);

writeFileSync(resolve(CAPTURES, "bilan-navigateur.txt"), bilan.join("\n") + "\n");
await fetch(`http://127.0.0.1:${PORT}/json/close/${onglet.id}`);
ws.close();
