// Pilote de Chrome sans écran (CDP) du chantier « configurateur » (28/11) :
// celui de l'affiche du stand (travaux/affiche-stand-mulhouse/navigateur/
// pilote.mjs), plus deux choses :
//   - forcerCadres() : réécrit, dans CE navigateur seulement, la fiche servie
//     pour que le site propose les cadres (éteints au BO, réglage cadres.site) —
//     rien n'est écrit en base ;
//   - toute requête d'écriture vers le panier est interceptée et ANNULÉE avant
//     de partir (son corps est gardé pour l'examiner) : rien n'arrive à l'API.
// Port à part (CDP_PORT, 9371 par défaut) : d'autres agents pilotent leur
// propre Chrome en même temps.
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9371);
export const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
let BASE = `http://127.0.0.1:${PORT}`;
try {
  await fetch(`${BASE}/json/version`);
} catch {
  BASE = `http://[::1]:${PORT}`;
}

const COLLECTEUR = `
window.__erreurs = [];
window.addEventListener("error", (e) => window.__erreurs.push(String(e.message || e)));
window.addEventListener("unhandledrejection", (e) => window.__erreurs.push("rejet : " + String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
const __ce = console.error;
console.error = (...a) => { try { window.__erreurs.push("console.error : " + a.map(String).join(" ")); } catch {} __ce.apply(console, a); };
`;

export async function brancher() {
  const liste = await (await fetch(`${BASE}/json/list`)).json();
  let page = liste.find((t) => t.type === "page");
  if (!page) page = await (await fetch(`${BASE}/json/new?about:blank`, { method: "PUT" })).json();
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
  await envoyer("Page.enable");
  await envoyer("Page.addScriptToEvaluateOnNewDocument", { source: COLLECTEUR });

  /** Les réécritures de la fiche, et les écritures de panier retenues. */
  let cadresForces = false;
  const panierRetenu = [];
  await envoyer("Fetch.enable", {
    patterns: [
      { urlPattern: "*/affiches/*", resourceType: "Document", requestStage: "Response" },
      { urlPattern: "*/cart/*", requestStage: "Request" },
    ],
  });
  // « Quitter la page ? » (la fenêtre retient une composition en cours) : on
  // accepte, sinon la navigation suivante resterait bloquée sur l'ancienne page.
  ecouteurs.push((d) => {
    if (d.method === "Page.javascriptDialogOpening")
      void envoyer("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  });
  ecouteurs.push(async (d) => {
    if (d.method !== "Fetch.requestPaused") return;
    const { requestId, request, responseStatusCode, responseHeaders } = d.params;
    try {
      if (responseStatusCode === undefined) {
        // Étape « requête » : une écriture vers le panier est annulée ; une
        // lecture passe telle quelle.
        if (request.method !== "GET") {
          panierRetenu.push({ url: request.url, methode: request.method, corps: request.postData ?? null });
          await envoyer("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
        } else await envoyer("Fetch.continueRequest", { requestId });
        return;
      }
      if (!cadresForces) {
        await envoyer("Fetch.continueResponse", { requestId });
        return;
      }
      const r = await envoyer("Fetch.getResponseBody", { requestId });
      let corps = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
      corps = corps.replaceAll("cadresProposes&quot;:[0,false]", "cadresProposes&quot;:[0,true]");
      await envoyer("Fetch.fulfillRequest", {
        requestId,
        responseCode: responseStatusCode,
        responseHeaders: (responseHeaders || []).filter((h) => !/^content-(length|encoding)$/i.test(h.name)),
        body: Buffer.from(corps, "utf8").toString("base64"),
      });
    } catch (e) {
      console.error("interception : " + e.message);
    }
  });

  const p = {
    envoyer,
    ecouteurs,
    panierRetenu,
    fermer: () => ws.close(),
    forcerCadres(oui = true) {
      cadresForces = oui;
    },
    async eval(expression) {
      const r = await envoyer("Runtime.evaluate", {
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
        if (Date.now() > fin) throw new Error("délai dépassé : " + expression.slice(0, 120));
        await pause(200);
      }
    },
    async taille(l, h, mobile = false) {
      await envoyer("Emulation.setDeviceMetricsOverride", {
        width: l,
        height: h,
        deviceScaleFactor: 1,
        mobile,
      });
      await envoyer(
        "Emulation.setTouchEmulationEnabled",
        mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
      );
    },
    async aller(url, apres = 800) {
      const charge = new Promise((ok) => {
        const e = (d) => {
          if (d.method === "Page.loadEventFired") ok();
        };
        ecouteurs.push(e);
      });
      await envoyer("Page.navigate", { url });
      await Promise.race([charge, pause(30000)]);
      await pause(apres);
      // Le bandeau des cookies : refusé, comme le ferait une cliente prudente.
      await p.eval(
        "[...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Refuser')?.click(); 1",
      );
    },
    /** Clique le bouton (ou lien) dont le texte vaut `texte` (sinon le contient). */
    async bouton(texte, rang = 0, dans = "") {
      // Jusqu'à 8 s : un bouton peut naître un peu après (îlot, étape suivante).
      const fin = Date.now() + 8000;
      for (;;) {
        const r = await p.eval(`(() => { const t = ${JSON.stringify(texte)}; const racine = ${JSON.stringify(dans)} ? document.querySelector(${JSON.stringify(dans)}) : document;
          const tous = [...racine.querySelectorAll('button, [role=button], a')].filter(b => b.offsetParent !== null || b.getClientRects().length);
          const nom = (b) => (b.textContent || '').replace(/\\s+/g, ' ').trim();
          let liste = tous.filter(b => nom(b) === t || b.title === t || b.getAttribute('aria-label') === t);
          if (!liste.length) liste = tous.filter(b => nom(b).includes(t));
          const b = liste[${Number(rang)}];
          if (!b) return 'INTROUVABLE : ' + t + ' — visibles : ' + tous.map(nom).filter(Boolean).slice(0, 40).join(' | ');
          b.scrollIntoView({ block: 'center' }); b.click(); return 'clic : ' + (nom(b) || b.title).slice(0, 60); })()`);
        if (!String(r).startsWith("INTROUVABLE")) return r;
        if (Date.now() > fin) throw new Error(r);
        await pause(300);
      }
    },
    /** Saisit dans le n-ième champ de texte du panneau. */
    async saisir(n, valeur) {
      return p.eval(`(() => { const champ = [...document.querySelectorAll('.ml-cfg-panel textarea')][${Number(n)}];
        if (!champ) return 'champ introuvable';
        champ.focus(); champ.value = ${JSON.stringify(valeur)};
        champ.dispatchEvent(new InputEvent('input', { bubbles: true }));
        champ.blur();
        return 'valeur : ' + champ.value; })()`);
    },
    /** Attend que les images, les polices et le texte de l'aperçu soient là. */
    async apercuPret(selecteur = ".ml-cfg-poster") {
      await p.attendre(
        `document.querySelector(${JSON.stringify(selecteur)}) && [...document.querySelectorAll(${JSON.stringify(selecteur + " img")})].every(i => i.complete) && document.fonts.status === 'loaded' && !document.querySelector(${JSON.stringify(selecteur + " .ml-spinner")})`,
        30000,
      );
      await pause(900);
    },
    async capture(fichier, selecteur, echelle = 1) {
      await p.eval(
        `(async () => { const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const el = ${JSON.stringify(selecteur || "")} ? document.querySelector(${JSON.stringify(selecteur || "body")}) : document.body;
          if (!el) return; const avant = el.style.visibility; el.style.visibility = 'hidden'; await raf(); el.style.visibility = avant; await raf(); await raf(); })()`,
      );
      let clip;
      if (selecteur) {
        const r = await p.eval(
          `(() => { const el = document.querySelector(${JSON.stringify(selecteur)}); if (!el) return null;
            const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`,
        );
        if (!r) throw new Error("élément introuvable : " + selecteur);
        clip = { ...r, scale: echelle };
      }
      const r = await envoyer("Page.captureScreenshot", {
        format: "png",
        ...(clip ? { clip, captureBeyondViewport: true } : {}),
      });
      writeFileSync(fichier, Buffer.from(r.data, "base64"));
      return fichier;
    },
    async erreurs() {
      return p.eval("window.__erreurs || []");
    },
  };
  return p;
}
