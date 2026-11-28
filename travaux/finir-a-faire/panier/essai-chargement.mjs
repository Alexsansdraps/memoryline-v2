// Le résumé des personnages pendant que la bibliothèque arrive (28/11) : la
// tablette (/panier?stand=1) ne doit JAMAIS annoncer un compte faux. On
// retient la requête /api/characters (protocole CDP, domaine Fetch) :
//   1. retenue : la page s'affiche, la phrase des personnages attend ;
//   2. relâchée : « Sapin de Noël, 2 personnages » arrive ;
//   3. en échec (bibliothèque injoignable) : rien, comme la vignette, qui
//      reste grise — jamais un compte faux.
// Lecture seule : rien n'est ajouté, validé ni payé.
//   CDP_PORT=9387 node essai-chargement.mjs
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9387);
const SITE = "http://localhost:8080";
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

const liste = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = liste.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, ko) => {
  ws.onopen = ok;
  ws.onerror = ko;
});
let id = 0;
const attente = new Map();
let surPause = () => {};
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && attente.has(d.id)) {
    const { ok, ko } = attente.get(d.id);
    attente.delete(d.id);
    d.error ? ko(new Error(JSON.stringify(d.error))) : ok(d.result);
  } else if (d.method === "Fetch.requestPaused") surPause(d.params);
};
const envoyer = (method, params = {}) =>
  new Promise((ok, ko) => {
    const n = ++id;
    attente.set(n, { ok, ko });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
async function evaluer(expression) {
  const r = await envoyer("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function attendre(expression, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      if (await evaluer(`!!(${expression})`)) return true;
    } catch {
      /* page en cours de chargement */
    }
    await pause(200);
  }
  throw new Error("délai dépassé : " + expression);
}
// Pour chaque ligne : la phrase des personnages (après format, cadre et
// texte), le nombre de lignes du résumé et la hauteur de la ligne du panier.
const LIRE =
  "[...document.querySelectorAll('#ml-attente li.grid')].map(li => { const d = [...li.querySelectorAll('ul li')]; return (d.slice(3).map(x => x.textContent.trim()).join(' | ') || '(rien)') + ' [' + d.length + ' lignes, ' + Math.round(li.getBoundingClientRect().height) + ' px]'; })";
async function capture(fichier) {
  const r = await envoyer("Page.captureScreenshot", { format: "png" });
  writeFileSync(fichier, Buffer.from(r.data, "base64"));
}

try {
  await envoyer("Page.enable");
  await envoyer("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1 et 2. Retenue, puis relâchée.
  const retenues = [];
  surPause = (p) => retenues.push(p.requestId);
  await envoyer("Fetch.enable", { patterns: [{ urlPattern: "*/api/characters*", requestStage: "Request" }] });
  await envoyer("Page.navigate", { url: `${SITE}/panier?stand=1` });
  await attendre("document.getElementById('ml-attente')?.hasAttribute('data-pret') && document.querySelectorAll('#ml-attente li.grid').length === 4");
  await pause(1500);
  console.log("retenues :", retenues.length);
  console.log("PENDANT  ", JSON.stringify(await evaluer(LIRE)));
  await capture("chargement-1-bibliotheque-retenue.png");
  for (const r of retenues.splice(0)) await envoyer("Fetch.continueRequest", { requestId: r });
  surPause = (p) => void envoyer("Fetch.continueRequest", { requestId: p.requestId });
  await attendre("document.querySelectorAll('#ml-attente .ml-cfg-poster').length === 4");
  await pause(1500);
  console.log("APRÈS    ", JSON.stringify(await evaluer(LIRE)));
  await capture("chargement-2-bibliotheque-arrivee.png");

  // 3. En échec.
  surPause = (p) => void envoyer("Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" });
  await envoyer("Page.navigate", { url: `${SITE}/panier?stand=1` });
  await attendre("document.getElementById('ml-attente')?.hasAttribute('data-pret') && document.querySelectorAll('#ml-attente li.grid').length === 4");
  await pause(2500);
  console.log("ÉCHEC    ", JSON.stringify(await evaluer(LIRE)));
  await capture("chargement-3-bibliotheque-injoignable.png");
} finally {
  await envoyer("Fetch.disable").catch(() => {});
  ws.close();
}
