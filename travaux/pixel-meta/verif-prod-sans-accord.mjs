// Vérification EN PROD (28/11) : sans accord des cookies, le pixel Meta ne se
// pose pas et rien ne part chez Meta. Chrome sans écran, profil neuf, et les
// noms de Meta injoignables (--host-resolver-rules) : même en cas de défaut,
// aucune donnée ne pourrait partir.  node travaux/pixel-meta/verif-prod-sans-accord.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9353;
const profil = mkdtempSync(join(tmpdir(), "ml-pixel-prod-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`, "--no-first-run",
  "--host-resolver-rules=MAP *.facebook.com 0.0.0.0, MAP facebook.com 0.0.0.0, MAP *.facebook.net 0.0.0.0, MAP facebook.net 0.0.0.0",
  "about:blank",
], { stdio: "ignore" });
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
let cible;
for (let i = 0; i < 50 && !cible; i++) {
  await pause(200);
  try { cible = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok));
let n = 0; const attente = new Map(); const meta = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attente.has(m.id)) { attente.get(m.id)(m.result); attente.delete(m.id); }
  if (m.method === "Network.requestWillBeSent" && /facebook/.test(m.params.request.url)) meta.push(m.params.request.url);
});
const cdp = (method, params = {}) => new Promise((ok) => { const id = ++n; attente.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const evaluer = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;
await cdp("Network.enable");
await cdp("Page.enable");
const etat = `({consent: localStorage.getItem('ml_cookie_consent'), fbq: typeof window.fbq, fbScripts: [...document.scripts].filter(s => /facebook/.test(s.src)).length, banniere: !document.getElementById('cookie-banner')?.hidden, cookieFbp: /_fbp=/.test(document.cookie)})`;
const resultats = [];
for (const [nom, avant] of [["sans choix", null], ["refusé", "refuse"]]) {
  if (avant) await evaluer(`localStorage.setItem('ml_cookie_consent', '${avant}')`);
  await cdp("Page.navigate", { url: "https://memoryline.fr/affiches/ciel-etoile" });
  await pause(6000);
  resultats.push({ cas: nom, ...(await evaluer(etat)) });
}
console.log(JSON.stringify({ resultats, requetesMeta: meta }, null, 2));
ws.close();
chrome.kill();
await pause(500);
try { rmSync(profil, { recursive: true, force: true }); } catch {}
process.exit(0);
