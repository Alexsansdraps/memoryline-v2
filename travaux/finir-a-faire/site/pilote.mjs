// Pilote de Chrome sans écran (protocole CDP), sans dépendance (Node 22+),
// pour le chantier « site » de « finis le à faire » (28/11) : bandeau cookies
// et en-tête. Inspiré de travaux/affiche-stand-mulhouse/navigateur/cdp.mjs,
// mais garde UNE connexion du début à la fin : la taille d'écran émulée
// (Emulation.setDeviceMetricsOverride) se perd quand la connexion se ferme.
//
// Chrome est lancé à part, sur son propre port (d'autres essais tournent en
// même temps sur 9333) :
//   chrome.exe --headless=new --remote-debugging-port=9361 --user-data-dir=<dossier>
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9361);
const BASE = `http://127.0.0.1:${PORT}`;

export const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Une commande au navigateur entier (créer un contexte isolé, un onglet). */
async function auNavigateur(method, params = {}) {
  const v = await (await fetch(`${BASE}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = ko;
  });
  const r = await new Promise((ok, ko) => {
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === 1) (d.error ? ko(new Error(JSON.stringify(d.error))) : ok(d.result));
    };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return r;
}

/**
 * Un onglet neuf, à nous. `isole` : dans un contexte de navigation à part
 * (comme une fenêtre privée), au stockage vierge — le choix du bandeau
 * cookies n'y traîne pas d'un essai à l'autre, ni d'un onglet à l'autre.
 */
export async function brancher({ isole = false } = {}) {
  let page;
  let contexte = null;
  if (isole) {
    contexte = (await auNavigateur("Target.createBrowserContext", { disposeOnDetach: false })).browserContextId;
    const { targetId } = await auNavigateur("Target.createTarget", { url: "about:blank", browserContextId: contexte });
    page = { id: targetId, webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/${targetId}` };
  } else {
    page = await (await fetch(`${BASE}/json/new?about:blank`, { method: "PUT" })).json();
  }
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
  await envoyer("Runtime.enable");
  // Les erreurs JS de chaque page, relevées dès son chargement.
  await envoyer("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__erreurs = [];
      window.addEventListener("error", (e) => window.__erreurs.push(String(e.message || e)));
      window.addEventListener("unhandledrejection", (e) => window.__erreurs.push("rejet : " + String(e.reason)));
      window.__consentements = [];
      document.addEventListener("ml:consent", (e) => window.__consentements.push(e.detail && e.detail.consent));`,
  });

  const c = {
    envoyer,
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
    /** Un script joué au début de chaque page, avant les siens. */
    async avantChaquePage(source) {
      await envoyer("Page.addScriptToEvaluateOnNewDocument", { source });
    },
    async taille(largeur, hauteur = 900, mobile = false) {
      await envoyer("Emulation.setDeviceMetricsOverride", {
        width: largeur,
        height: hauteur,
        deviceScaleFactor: 1,
        mobile,
      });
    },
    async aller(url, apres = 600) {
      const charge = new Promise((ok) => {
        const f = (d) => {
          if (d.method === "Page.loadEventFired") {
            ecouteurs.splice(ecouteurs.indexOf(f), 1);
            ok();
          }
        };
        ecouteurs.push(f);
      });
      await envoyer("Page.navigate", { url });
      await Promise.race([charge, pause(30000)]);
      // L'écran d'accueil (premier affichage de la visite) part en ~1 s.
      await pause(apres);
    },
    async attendre(expression, ms = 10000) {
      const fin = Date.now() + ms;
      for (;;) {
        let v = false;
        try {
          v = await c.eval(`(async () => !!(${expression}))()`);
        } catch {
          v = false;
        }
        if (v) return true;
        if (Date.now() > fin) return false;
        await pause(150);
      }
    },
    async clic(x, y) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await envoyer("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    },
    async touche(key, code = key, keyCode = 0) {
      for (const type of ["keyDown", "keyUp"])
        await envoyer("Input.dispatchKeyEvent", {
          type,
          key,
          code,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
        });
    },
    async capture(fichier, clip) {
      // Un nouveau dessin avant la capture (Chrome sans écran garde parfois
      // un calque périmé, vu le 28/11 sur l'affiche du stand).
      await c.eval(
        "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
      );
      const r = await envoyer("Page.captureScreenshot", {
        format: "png",
        ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}),
      });
      writeFileSync(fichier, Buffer.from(r.data, "base64"));
      return fichier;
    },
    async fermer() {
      try {
        await fetch(`${BASE}/json/close/${page.id}`);
      } catch {}
      ws.close();
      if (contexte)
        try {
          await auNavigateur("Target.disposeBrowserContext", { browserContextId: contexte });
        } catch {}
    },
  };
  return c;
}
