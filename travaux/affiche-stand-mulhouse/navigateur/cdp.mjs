// Petit pilote de Chrome sans écran (protocole CDP), sans dépendance :
// Node 22+ a WebSocket et fetch. Sert aux vérifications de l'affiche du stand
// de Mulhouse (captures, parcours jusqu'au panier, JAMAIS de paiement).
//
// Chrome est lancé à part, une fois, avec :
//   chrome.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<dossier>
// puis chaque commande se branche sur l'onglet ouvert :
//   node cdp.mjs goto <url>
//   node cdp.mjs eval "<expression js>"        (await permis, résultat en JSON)
//   node cdp.mjs wait "<expression js>" [ms]   (attend qu'elle soit vraie)
//   node cdp.mjs shot <fichier.png> [sélecteur css] [échelle]
//   node cdp.mjs size <largeur> <hauteur> [mobile]
//   node cdp.mjs clic <x> <y>                  (vrai clic souris)
//   node cdp.mjs erreurs                       (erreurs JS relevées depuis le chargement)
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = `http://127.0.0.1:${PORT}`;

async function onglet() {
  const liste = await (await fetch(`${BASE}/json/list`)).json();
  let page = liste.find((t) => t.type === "page");
  if (!page) page = await (await fetch(`${BASE}/json/new?about:blank`, { method: "PUT" })).json();
  return page;
}

async function brancher() {
  const page = await onglet();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = ko;
  });
  let id = 0;
  const attente = new Map();
  const ecouteurs = [];
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
  return { ws, envoyer, ecouteurs, fermer: () => ws.close() };
}

async function evaluer(c, expression) {
  const r = await c.envoyer("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    const t = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error("Exception dans la page : " + t);
  }
  return r.result.value;
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function attendre(c, expression, ms = 15000) {
  const fin = Date.now() + ms;
  for (;;) {
    let v = false;
    try {
      v = await evaluer(c, `(async () => { return !!(${expression}); })()`);
    } catch {
      v = false;
    }
    if (v) return true;
    if (Date.now() > fin) return false;
    await pause(250);
  }
}

// Relève les erreurs JS de la page dès son chargement.
const COLLECTEUR = `
window.__erreurs = [];
window.addEventListener("error", (e) => window.__erreurs.push(String(e.message || e)));
window.addEventListener("unhandledrejection", (e) => window.__erreurs.push("rejet : " + String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
const __ce = console.error;
console.error = (...a) => { try { window.__erreurs.push("console.error : " + a.map(String).join(" ")); } catch {} __ce.apply(console, a); };
`;

const [cmd, ...args] = process.argv.slice(2);
const c = await brancher();
try {
  if (cmd === "goto") {
    await c.envoyer("Page.enable");
    await c.envoyer("Page.addScriptToEvaluateOnNewDocument", { source: COLLECTEUR });
    const charge = new Promise((ok) => {
      c.ecouteurs.push((d) => {
        if (d.method === "Page.loadEventFired") ok();
      });
    });
    await c.envoyer("Page.navigate", { url: args[0] });
    await Promise.race([charge, pause(30000)]);
    await pause(Number(args[1] || 800));
    console.log(await evaluer(c, "location.href + ' | ' + document.title"));
  } else if (cmd === "eval") {
    const v = await evaluer(c, args[0]);
    console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1));
  } else if (cmd === "wait") {
    const ok = await attendre(c, args[0], Number(args[1] || 15000));
    console.log(ok ? "ok" : "DÉLAI DÉPASSÉ");
    if (!ok) process.exitCode = 2;
  } else if (cmd === "shot") {
    const [fichier, selecteur, echelle] = args;
    // Chrome sans écran garde parfois un dessin périmé d'un calque (vu le
    // 28/11 : le tronc du sapin absent de la capture, présent dans un vrai
    // navigateur). On force un nouveau dessin de la page avant de capturer.
    await evaluer(
      c,
      `(async () => { const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const el = ${JSON.stringify(selecteur || "")} && ${JSON.stringify(selecteur || "")} !== "-" ? document.querySelector(${JSON.stringify(selecteur || "-")}) : document.body;
        if (!el) return; const avant = el.style.visibility; el.style.visibility = 'hidden'; await raf(); el.style.visibility = avant; await raf(); await raf(); })()`,
    );
    let clip;
    if (selecteur && selecteur !== "-") {
      const r = await evaluer(
        c,
        `(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return null;
          const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`,
      );
      if (!r) throw new Error("élément introuvable : " + selecteur);
      clip = { ...r, scale: Number(echelle || 1) };
    }
    const r = await c.envoyer("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip, captureBeyondViewport: true } : {}),
    });
    writeFileSync(fichier, Buffer.from(r.data, "base64"));
    console.log("capture : " + fichier);
  } else if (cmd === "size") {
    const [l, h, mobile] = args;
    await c.envoyer("Emulation.setDeviceMetricsOverride", {
      width: Number(l),
      height: Number(h),
      deviceScaleFactor: 1,
      mobile: mobile === "mobile",
    });
    console.log("taille : " + l + "x" + h);
  } else if (cmd === "clic") {
    const [x, y] = args.map(Number);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await c.envoyer("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    console.log("clic " + x + "," + y);
  } else if (cmd === "bouton") {
    // node cdp.mjs bouton "<texte>" [n-ième] [dans <sélecteur>] : clique le bouton dont le
    // texte (ou le title / aria-label) vaut exactement ce texte, sinon le contient.
    const [texte, rang, dans] = args;
    const r = await evaluer(
      c,
      `(() => { const t = ${JSON.stringify(texte)}; const racine = ${JSON.stringify(dans || "")} ? document.querySelector(${JSON.stringify(dans || "")}) : document;
        const tous = [...racine.querySelectorAll('button, [role=button], a')].filter(b => b.offsetParent !== null || b.getClientRects().length);
        const nom = (b) => (b.textContent || '').replace(/\\s+/g, ' ').trim();
        let liste = tous.filter(b => nom(b) === t || b.title === t || b.getAttribute('aria-label') === t);
        if (!liste.length) liste = tous.filter(b => nom(b).includes(t));
        const b = liste[Number(${JSON.stringify(rang || "0")})];
        if (!b) return 'INTROUVABLE : ' + t;
        b.scrollIntoView({ block: 'center' }); b.click(); return 'clic : ' + (nom(b) || b.title).slice(0, 60); })()`,
    );
    console.log(r);
    if (String(r).startsWith("INTROUVABLE")) process.exitCode = 3;
  } else if (cmd === "saisir") {
    // node cdp.mjs saisir <n° du champ de texte (0, 1, 2)> "<valeur>"
    const [n, valeur] = args;
    const r = await evaluer(
      c,
      `(() => { const champ = [...document.querySelectorAll('.ml-cfg-panel textarea')][${Number(n)}];
        if (!champ) return 'champ introuvable';
        champ.focus(); champ.value = ${JSON.stringify(valeur ?? "")};
        champ.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return 'valeur : ' + champ.value; })()`,
    );
    console.log(r);
  } else if (cmd === "erreurs") {
    console.log(JSON.stringify(await evaluer(c, "window.__erreurs || []"), null, 1));
  } else {
    console.log("commande inconnue : " + cmd);
    process.exitCode = 1;
  }
} finally {
  c.fermer();
}
