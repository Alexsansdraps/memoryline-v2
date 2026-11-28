// Pilote de Chrome sans écran (CDP) pour l'essai du pixel Meta (28/11), en
// local, SANS RIEN ENVOYER À META :
//  - Chrome est lancé ici, avec un profil neuf, et les noms de Meta (facebook.com,
//    facebook.net, fbcdn.net…) ne s'y résolvent pas (--host-resolver-rules) :
//    filet de sécurité si une requête échappait à l'interception ;
//  - l'interception (Fetch) répond à fbevents.js par un FAUX script qui note
//    les appels (fbq.callMethod) sans faire aucune requête, et bloque tout le
//    reste de Meta ; chaque requête interceptée est notée ;
//  - le script du pixel n'existe qu'en production : il est inséré dans chaque
//    page HTML de localhost:8080, à la place exacte où Base.astro le met (juste
//    avant <meta name="generator">), copie exacte du fichier, seule la
//    condition d'adresse acceptant aussi « localhost » ;
//  - certaines routes de l'API peuvent être SIMULÉES (code carte cadeau,
//    création et validation de commande) pour aller jusqu'au « Merci » sans
//    écrire de commande ni faire partir de courrier.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const SITE = "http://localhost:8080";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT || 9341);

const HOTES_META = ["*.facebook.com", "facebook.com", "*.facebook.net", "facebook.net", "*.fbcdn.net", "*.fbsbx.com"];
const estMeta = (url) => /(^|\.)(facebook\.com|facebook\.net|fbcdn\.net|fbsbx\.com)$/i.test(new URL(url).hostname);

/**
 * Le script inline du pixel, lu dans Base.astro. `exact` : tel quel (il ne
 * fait rien hors de memoryline.fr) ; `injecte` : la même chose, seule la
 * condition d'adresse acceptant aussi localhost.
 */
export function scriptDuPixel() {
  const source = readFileSync(new URL("../../apps/web/src/layouts/Base.astro", import.meta.url), "utf8");
  const m = source.match(
    /<script is:inline>\r?\n(\s*\(function \(\) \{\s*if \(location\.hostname !== "memoryline\.fr"\) return;[\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error("script du pixel introuvable dans Base.astro");
  const exact = m[1];
  const avant = 'if (location.hostname !== "memoryline.fr") return;';
  const apres = 'if (location.hostname !== "memoryline.fr" && location.hostname !== "localhost") return;';
  if (exact.split(avant).length !== 2) throw new Error("condition d'adresse introuvable ou en double");
  return { exact, injecte: exact.replace(avant, apres), avant, apres };
}

/** Le faux fbevents.js : il vide la file d'attente et note chaque appel, sans aucune requête. */
const FAUX_FBEVENTS = `/* FAUX fbevents.js (essai local du pixel, 28/11) : aucune requête, il note les appels. */
(function () {
  function noter(via, args) {
    try {
      var e = { via: via, page: location.pathname + location.search, t: Date.now(),
        args: JSON.parse(JSON.stringify(Array.prototype.slice.call(args))) };
      (window.__appelsMeta = window.__appelsMeta || []).push(e);
      if (typeof window.__metaBinding === "function") window.__metaBinding(JSON.stringify(e));
    } catch (err) {}
  }
  window.__fauxFbeventsCharge = (window.__fauxFbeventsCharge || 0) + 1;
  var f = window.fbq;
  if (typeof f !== "function") { noter("sans-fbq", []); return; }
  var q = f.queue || [];
  f.callMethod = function () { noter("direct", arguments); };
  for (var i = 0; i < q.length; i++) noter("file", q[i]);
  f.queue = [];
})();
`;

export async function demarrer({ captures }) {
  const { injecte, exact } = scriptDuPixel();
  const profil = mkdtempSync(join(process.env.PROFIL_DIR || tmpdir(), "chrome-pixel-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profil}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      `--host-resolver-rules=${HOTES_META.map((h) => `MAP ${h} ~NOTFOUND`).join(", ")}`,
      "--window-size=1366,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let base = null;
  for (let i = 0; i < 80 && !base; i++) {
    for (const h of [`http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`]) {
      try {
        await fetch(`${h}/json/version`);
        base = h;
        break;
      } catch {}
    }
    if (!base) await pause(250);
  }
  if (!base) throw new Error("Chrome ne répond pas sur le port " + PORT);
  const liste = await (await fetch(`${base}/json/list`)).json();
  const page = liste.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = ko;
  });

  let id = 0;
  const attente = new Map();
  const ecouteurs = [];
  const envoyer = (method, params = {}) =>
    new Promise((ok, ko) => {
      const n = ++id;
      attente.set(n, { ok, ko, method });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  // Ce que l'essai relève, étiqueté par scénario.
  const etat = {
    scenario: "",
    injection: "localhost", // "localhost" | "exacte" | "aucune"
    modeMeta: "faux", // "faux" (faux fbevents.js) | "bloquer" (comme un bloqueur de pub)
    reseauMeta: [], // ce que le réseau du navigateur dit des requêtes vers Meta
    faux: new Map(), // "POST /api/orders" -> (requete) => ({ status, body })
    appels: [], // appels notés par le faux fbevents.js
    meta: [], // requêtes vers Meta interceptées
    externes: [], // toute requête hors de localhost
    api: [], // appels à l'API (méthode + chemin)
    erreurs: [], // exceptions, console.error/warn, journal du navigateur
    chargements: [], // évènements « load » des pages
    pages: [], // pages HTML servies (et où le script a été inséré)
    simulees: [], // réponses de l'API simulées
    dialogues: [],
  };
  const now = () => Date.now();
  const metaParRequete = new Map();

  async function surPause(p) {
    const { requestId, request, resourceType } = p;
    const url = request.url;
    try {
      // 1) Meta : jamais sur le réseau.
      if (estMeta(url)) {
        const faux = etat.modeMeta !== "bloquer" && /^https:\/\/connect\.facebook\.net\/[^/]+\/fbevents\.js(\?|$)/.test(url);
        etat.meta.push({
          scenario: etat.scenario,
          t: now(),
          url,
          methode: request.method,
          type: resourceType,
          reponse: faux ? "faux fbevents.js servi localement" : etat.modeMeta === "bloquer" ? "bloquée (essai « bloqueur de pub »)" : "bloquée",
        });
        if (faux)
          await envoyer("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/javascript; charset=utf-8" },
              { name: "Cache-Control", value: "no-store" },
            ],
            body: Buffer.from(FAUX_FBEVENTS).toString("base64"),
          });
        else await envoyer("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
        return;
      }
      // 2) Pages HTML du site (étape « réponse ») : le script du pixel inséré.
      if (p.responseStatusCode !== undefined) {
        const type = (p.responseHeaders || []).find((h) => h.name.toLowerCase() === "content-type")?.value || "";
        if (etat.injection === "aucune" || p.responseStatusCode !== 200 || !type.includes("text/html")) {
          etat.pages.push({ scenario: etat.scenario, url, statut: p.responseStatusCode, insertion: "aucune" });
          await envoyer("Fetch.continueRequest", { requestId });
          return;
        }
        const r = await envoyer("Fetch.getResponseBody", { requestId });
        let html = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
        const script = `<script data-essai-pixel="${etat.injection}">\n${etat.injection === "exacte" ? exact : injecte}</script>\n`;
        let ou = "avant <meta name=generator>";
        const i = html.indexOf('<meta name="generator"');
        if (i >= 0) html = html.slice(0, i) + script + html.slice(i);
        else {
          ou = "avant </head>";
          html = html.replace("</head>", script + "</head>");
        }
        const dataStand = (html.match(/<html[^>]*>/) || [""])[0].includes('data-stand="1"');
        etat.pages.push({ scenario: etat.scenario, url, statut: 200, insertion: ou, script: etat.injection, dataStand });
        const entetes = (p.responseHeaders || []).filter(
          (h) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(h.name),
        );
        await envoyer("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: entetes,
          body: Buffer.from(html, "utf8").toString("base64"),
        });
        return;
      }
      // 3) Routes de l'API simulées par le scénario.
      const chemin = new URL(url).pathname;
      const cle = `${request.method} ${chemin}`;
      const faux = etat.faux.get(cle) || [...etat.faux.entries()].find(([k]) => k.endsWith("*") && cle.startsWith(k.slice(0, -1)))?.[1];
      if (faux) {
        const { status = 200, body } = await faux(request);
        etat.simulees.push({ scenario: etat.scenario, t: now(), requete: cle, corps: request.postData ?? null, reponse: body });
        await envoyer("Fetch.fulfillRequest", {
          requestId,
          responseCode: status,
          responseHeaders: [{ name: "Content-Type", value: "application/json; charset=utf-8" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64"),
        });
        return;
      }
      await envoyer("Fetch.continueRequest", { requestId });
    } catch (e) {
      etat.erreurs.push({ scenario: etat.scenario, source: "pilote", texte: "interception : " + String(e).slice(0, 300), url });
      try {
        await envoyer("Fetch.continueRequest", { requestId });
      } catch {}
    }
  }

  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && attente.has(d.id)) {
      const { ok, ko, method } = attente.get(d.id);
      attente.delete(d.id);
      if (d.error) ko(new Error(method + " : " + JSON.stringify(d.error)));
      else ok(d.result);
      return;
    }
    if (!d.method) return;
    const p = d.params || {};
    switch (d.method) {
      case "Fetch.requestPaused":
        void surPause(p);
        break;
      case "Runtime.bindingCalled":
        if (p.name === "__metaBinding") {
          try {
            etat.appels.push({ scenario: etat.scenario, ...JSON.parse(p.payload) });
          } catch {}
        }
        break;
      case "Runtime.exceptionThrown":
        etat.erreurs.push({
          scenario: etat.scenario,
          source: "exception",
          texte: (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "").slice(0, 400),
          url: p.exceptionDetails?.url,
        });
        break;
      case "Runtime.consoleAPICalled":
        if (p.type === "error" || p.type === "warning" || p.type === "assert")
          etat.erreurs.push({
            scenario: etat.scenario,
            source: "console." + p.type,
            texte: (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 400),
          });
        break;
      case "Log.entryAdded":
        if (p.entry?.level === "error" || p.entry?.level === "warning")
          etat.erreurs.push({ scenario: etat.scenario, source: "journal." + p.entry.source, texte: String(p.entry.text).slice(0, 400), url: p.entry.url });
        break;
      case "Network.requestWillBeSent": {
        const u = new URL(p.request.url);
        if (u.protocol === "data:" || u.protocol === "blob:") break;
        if (estMeta(p.request.url)) metaParRequete.set(p.requestId, p.request.url);
        if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))
          etat.externes.push({ scenario: etat.scenario, t: now(), url: p.request.url.slice(0, 200), type: p.type });
        else if (u.pathname.startsWith("/api/"))
          etat.api.push({ scenario: etat.scenario, t: now(), methode: p.request.method, chemin: u.pathname + u.search });
        break;
      }
      // Une réponse venue du réseau porte l'adresse IP du serveur : celles de
      // Meta n'en ont pas (servies par l'interception) ou échouent.
      case "Network.responseReceived":
        try {
          if (estMeta(p.response.url))
            etat.reseauMeta.push({
              scenario: etat.scenario,
              url: p.response.url,
              statut: p.response.status,
              ipDistante: p.response.remoteIPAddress || null,
            });
        } catch {}
        break;
      case "Network.loadingFailed":
        if (metaParRequete.has(p.requestId))
          etat.reseauMeta.push({
            scenario: etat.scenario,
            url: metaParRequete.get(p.requestId),
            echec: p.errorText,
            raison: p.blockedReason || null,
          });
        break;
      case "Page.loadEventFired":
        etat.chargements.push({ scenario: etat.scenario, t: now() });
        break;
      case "Page.javascriptDialogOpening":
        etat.dialogues.push({ scenario: etat.scenario, type: p.type, message: p.message });
        void envoyer("Page.handleJavaScriptDialog", { accept: true });
        break;
    }
    for (const e of ecouteurs) e(d);
  };

  await envoyer("Page.enable");
  await envoyer("Runtime.enable");
  await envoyer("Log.enable");
  await envoyer("Network.enable");
  await envoyer("Runtime.addBinding", { name: "__metaBinding" });
  await envoyer("Fetch.enable", {
    patterns: [
      { urlPattern: "*facebook.net*", requestStage: "Request" },
      { urlPattern: "*facebook.com*", requestStage: "Request" },
      { urlPattern: "*fbcdn.net*", requestStage: "Request" },
      { urlPattern: "*fbsbx.com*", requestStage: "Request" },
      { urlPattern: `${SITE}/*`, resourceType: "Document", requestStage: "Response" },
      { urlPattern: `${SITE}/api/caisse/code*`, requestStage: "Request" },
      { urlPattern: `${SITE}/api/orders*`, requestStage: "Request" },
      { urlPattern: `${SITE}/api/payments/*`, requestStage: "Request" },
    ],
  });
  await envoyer("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

  const p = {
    etat,
    envoyer,
    scenario(nom) {
      etat.scenario = nom;
      console.log("\n=== " + nom);
    },
    async eval(expression) {
      const r = await envoyer("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error("Exception dans la page : " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async attendre(expression, ms = 20000) {
      const fin = Date.now() + ms;
      for (;;) {
        let v = false;
        try {
          v = await p.eval(`(async () => { return !!(${expression}); })()`);
        } catch {
          v = false;
        }
        if (v) return true;
        if (Date.now() > fin) throw new Error("délai dépassé : " + expression.slice(0, 140));
        await pause(200);
      }
    },
    /** Attend la fin d'une navigation lancée par la page (clic, location.href…). */
    attendreChargement(ms = 30000) {
      return new Promise((ok) => {
        const fin = setTimeout(() => ok(false), ms);
        const e = (d) => {
          if (d.method === "Page.loadEventFired") {
            clearTimeout(fin);
            ecouteurs.splice(ecouteurs.indexOf(e), 1);
            ok(true);
          }
        };
        ecouteurs.push(e);
      });
    },
    async aller(url, apres = 1500) {
      const charge = p.attendreChargement();
      await envoyer("Page.navigate", { url: url.startsWith("http") ? url : SITE + url });
      await charge;
      await pause(apres);
    },
    async recharger(apres = 1500) {
      const charge = p.attendreChargement();
      await envoyer("Page.reload", { ignoreCache: true });
      await charge;
      await pause(apres);
    },
    /** Clique le bouton (ou lien) dont le texte vaut `texte` (sinon le contient). */
    async bouton(texte, rang = 0, dans = "") {
      const r = await p.eval(`(() => { const t = ${JSON.stringify(texte)}; const racine = ${JSON.stringify(dans)} ? document.querySelector(${JSON.stringify(dans)}) : document;
        if (!racine) return 'INTROUVABLE (racine) : ' + t;
        const tous = [...racine.querySelectorAll('button, [role=button], a, input[type=submit]')].filter(b => b.offsetParent !== null || b.getClientRects().length);
        const nom = (b) => (b.textContent || b.value || '').replace(/\\s+/g, ' ').trim();
        let liste = tous.filter(b => nom(b) === t || b.title === t || b.getAttribute('aria-label') === t);
        if (!liste.length) liste = tous.filter(b => nom(b).includes(t));
        const b = liste[${Number(rang)}];
        if (!b) return 'INTROUVABLE : ' + t;
        b.scrollIntoView({ block: 'center' }); b.click(); return 'clic : ' + (nom(b) || b.title || b.getAttribute('aria-label')).slice(0, 70); })()`);
      if (String(r).startsWith("INTROUVABLE")) throw new Error(r);
      console.log("  " + r);
      return r;
    },
    /** Remplit un champ (input/textarea) comme au clavier, pour les îlots Solid (onInput). */
    async saisir(selecteur, valeur) {
      const r = await p.eval(`(() => { const c = document.querySelector(${JSON.stringify(selecteur)}); if (!c) return 'INTROUVABLE';
        const proto = c.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(c, ${JSON.stringify(valeur)});
        c.dispatchEvent(new InputEvent('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
      if (r !== "ok") throw new Error("champ introuvable : " + selecteur);
    },
    async capture(nom) {
      await p.eval("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const r = await envoyer("Page.captureScreenshot", { format: "png" });
      const f = join(captures, nom + ".png");
      writeFileSync(f, Buffer.from(r.data, "base64"));
      return f;
    },
    /** Ce que la page sait du pixel, à l'instant. */
    async etatPixel() {
      return p.eval(`({ fbq: typeof window.fbq, _fbq: typeof window._fbq, file: window.fbq && window.fbq.queue ? window.fbq.queue.length : null,
        callMethod: !!(window.fbq && window.fbq.callMethod), fauxCharge: window.__fauxFbeventsCharge || 0,
        consentement: (() => { try { return localStorage.getItem('ml_cookie_consent'); } catch (e) { return 'illisible'; } })(),
        bandeauVisible: !!document.getElementById('cookie-banner') && !document.getElementById('cookie-banner').hidden,
        dataStand: document.documentElement.getAttribute('data-stand'), scriptInsere: document.querySelector('script[data-essai-pixel]')?.dataset.essaiPixel || null,
        scriptFbevents: [...document.querySelectorAll('script[src*="facebook"]')].map(s => s.src) })`);
    },
    appelsDu(scenario) {
      return etat.appels.filter((a) => a.scenario === scenario);
    },
    metaDu(scenario) {
      return etat.meta.filter((a) => a.scenario === scenario);
    },
    async fermer() {
      try {
        await envoyer("Browser.close");
      } catch {}
      try {
        ws.close();
      } catch {}
      await pause(800);
      try {
        chrome.kill();
      } catch {}
      try {
        rmSync(profil, { recursive: true, force: true });
      } catch {}
    },
  };
  return p;
}
