// Essai de la fiche « Ciel étoilé » dans Chrome sans écran, piloté par CDP (sans bibliothèque),
// 28/11 (vérification des familles d'ombres) : la fiche s'ouvre, « Dessiner mon ciel », étape
// Personnages (onglets, vignettes de chaque onglet), puis trois scènes nouvelles ajoutées une à une
// redessinent le ciel. Captures dans travaux/ombres/captures/ (préfixe « m- » au téléphone).
//
// Rien n'est écrit en base : POST /ia/ciel est intercepté et servi ici même avec le rendu de
// la copie de travail (lireReglagesCiel + svgDuCiel/svgDuSigne, comme la route ; l'aperçu n'a
// pas de filigrane) ; toute autre requête qui n'est pas un GET est bloquée et notée.
//
// Usage (site local lancé, http://localhost:8080), depuis apps/api :
//   DATABASE_URL=postgres://e:e@127.0.0.1:1/e npx tsx ../../travaux/ombres/essai-navigateur-ciel.mts
//   MOBILE=1 DATABASE_URL=postgres://e:e@127.0.0.1:1/e npx tsx ../../travaux/ombres/essai-navigateur-ciel.mts
// (la fausse DATABASE_URL : ciel.ts importe la base sans s'y connecter.)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const S = `${tmpdir().replace(/\\/g, "/")}/essai-navigateur-ciel`;
const CAPTURES = `${REPO}/travaux/ombres/captures`;
const SORTIE = `${S}/rendus`;
mkdirSync(CAPTURES, { recursive: true });
mkdirSync(SORTIE, { recursive: true });
const require = createRequire(`${REPO}/apps/api/package.json`);
const sharp = require("sharp");
const ciel: any = await import(pathToFileURL(`${REPO}/apps/api/src/ciel.ts`).href);
const { lireReglagesCiel, svgDuCiel, svgDuSigne, instantLocal, THEMES_CIEL_DE_BASE } = ciel;

// Port 0 : Chrome prend un port libre et l'écrit dans DevToolsActivePort, dans SON profil.
// (28/11 : avec un port fixe, 9333, le premier essai s'est branché sur le Chrome sans écran
// d'un autre chantier, déjà à l'écoute sur ce port, au lieu du sien.)
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profil = `${S}/chrome-profil`;
rmSync(profil, { recursive: true, force: true });
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--window-size=1400,1000",
    "--hide-scrollbars",
    "--mute-audio",
    "--lang=fr-FR",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
let PORT = 0;
for (let i = 0; i < 100 && !PORT; i++) {
  try {
    PORT = Number(readFileSync(`${profil}/DevToolsActivePort`, "utf8").split(/\r?\n/)[0]);
  } catch {
    /* pas encore écrit */
  }
  if (!PORT) await attendre(200);
}
if (!PORT) throw new Error("Chrome n'a pas ouvert de port de débogage");
let cibles: any[] = [];
for (let i = 0; i < 100; i++) {
  try {
    cibles = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (cibles.some((t) => t.type === "page")) break;
  } catch {
    /* pas encore prêt */
  }
  await attendre(200);
}
const cible = cibles.find((t) => t.type === "page");
if (!cible) throw new Error("Chrome ne répond pas");
// Notre Chrome tout neuf n'a qu'un onglet vide : autre chose, c'est le navigateur de quelqu'un d'autre.
if (cible.url !== "about:blank" || cibles.filter((t) => t.type === "page").length !== 1)
  throw new Error(`ce n'est pas notre Chrome (onglets : ${cibles.map((t) => t.url).join(", ")})`);
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let n = 0;
const enAttente = new Map<number, { r: (x: any) => void; j: (e: Error) => void }>();
const ecouteurs = new Map<string, ((p: any) => void)[]>();
ws.onmessage = (ev: MessageEvent) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && enAttente.has(m.id)) {
    const { r, j } = enAttente.get(m.id)!;
    enAttente.delete(m.id);
    if (m.error) j(new Error(JSON.stringify(m.error)));
    else r(m.result);
  } else if (m.method) for (const f of ecouteurs.get(m.method) ?? []) f(m.params);
};
const cdp = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
  new Promise((r, j) => {
    const id = ++n;
    enAttente.set(id, { r, j });
    ws.send(JSON.stringify({ id, method, params }));
  });
const sur = (method: string, f: (p: any) => void) => ecouteurs.set(method, [...(ecouteurs.get(method) ?? []), f]);

const journal = {
  bloquees: [] as string[],
  postsCiel: [] as any[],
  console: [] as string[],
  exceptions: [] as string[],
  reponsesApi: [] as string[],
  echecs: [] as string[],
};
let numero = 0;
const apercus = new Map<string, Buffer>();
const json = (requestId: string, code: number, corps: unknown) =>
  cdp("Fetch.fulfillRequest", {
    requestId,
    responseCode: code,
    responseHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Cache-Control", value: "no-store" },
    ],
    body: Buffer.from(JSON.stringify(corps)).toString("base64"),
  });
sur("Fetch.requestPaused", async (p) => {
  const { requestId, request } = p;
  const url = new URL(request.url);
  try {
    if (request.method === "POST" && /\/api\/ia\/ciel$/.test(url.pathname)) {
      const corps = JSON.parse(request.postData ?? "{}");
      const lus = lireReglagesCiel(corps);
      const entree: any = { corps, ok: lus.ok, silhouettes: lus.ok ? lus.reglages.silhouettes : null, t: Date.now() };
      journal.postsCiel.push(entree);
      if (!lus.ok) return void (await json(requestId, 400, { error: lus.error }));
      const r = lus.reglages;
      const theme = THEMES_CIEL_DE_BASE.find((t: any) => t.id === corps.theme) ?? THEMES_CIEL_DE_BASE[0];
      let svg: string;
      if (r.style === "nuit") {
        const instant = instantLocal(String(corps.date ?? ""), String(corps.heure ?? ""), String(corps.fuseau ?? "Europe/Paris"));
        const ville = corps.afficherVille === true ? String(corps.ville ?? "").slice(0, 80) : null;
        svg = svgDuCiel(Number(corps.lat), Number(corps.lon), instant, theme, {
          ville,
          texte: r.texte,
          silhouettes: r.silhouettes,
          hauteurTexte: r.hauteurTexte,
          tailleSilhouettes: r.tailleSilhouettes,
        });
      } else svg = svgDuSigne(r, theme);
      const id = `verif-${++numero}`;
      entree.id = id;
      entree.chemins = (svg.match(/<path transform=/g) ?? []).length;
      const pleine = await sharp(Buffer.from(svg)).png().toBuffer();
      writeFileSync(`${SORTIE}/${id}-pleine.png`, pleine);
      writeFileSync(`${SORTIE}/${id}.svg`, svg);
      apercus.set(id, await sharp(pleine).resize({ width: 1000 }).jpeg({ quality: 85 }).toBuffer());
      return void (await json(requestId, 200, { publicId: id, status: "prete", apercu: `/ia/apercu/${id}` }));
    }
    const m = /\/api\/ia\/apercu\/(verif-\d+)$/.exec(url.pathname);
    if (request.method === "GET" && m && apercus.has(m[1]!)) {
      return void (await cdp("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "image/jpeg" },
          { name: "Cache-Control", value: "no-store" },
        ],
        body: apercus.get(m[1]!)!.toString("base64"),
      }));
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      journal.bloquees.push(`${request.method} ${request.url}`);
      return void (await cdp("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }));
    }
    await cdp("Fetch.continueRequest", { requestId });
  } catch (e) {
    console.log("interception : erreur", e);
    try {
      await cdp("Fetch.continueRequest", { requestId });
    } catch {
      /* déjà traitée */
    }
  }
});
sur("Runtime.consoleAPICalled", (p) => {
  if (p.type === "error" || p.type === "warning" || p.type === "assert")
    journal.console.push(`${p.type}: ${p.args.map((a: any) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
});
sur("Runtime.exceptionThrown", (p) =>
  journal.exceptions.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).slice(0, 400)),
);
sur("Log.entryAdded", (p) => {
  if (p.entry.level === "error") journal.console.push(`log ${p.entry.source}: ${p.entry.text} ${p.entry.url ?? ""}`.slice(0, 300));
});
const requetes = new Map<string, string>();
sur("Network.requestWillBeSent", (p) => requetes.set(p.requestId, `${p.request.method} ${p.request.url}`));
sur("Network.responseReceived", (p) => {
  if (/\/api\//.test(p.response.url) || p.response.status >= 400)
    journal.reponsesApi.push(`${p.response.status} ${requetes.get(p.requestId)?.split(" ")[0] ?? ""} ${p.response.url.replace("http://localhost:8080", "")}`);
});
sur("Network.loadingFailed", (p) => journal.echecs.push(`${p.errorText} ${p.blockedReason ?? ""} ${requetes.get(p.requestId) ?? ""}`));

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Log.enable");
await cdp("Network.enable");
await cdp("Network.setCacheDisabled", { cacheDisabled: true });
await cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
// MOBILE=1 : un téléphone de 390 px (captures préfixées « m- »).
const MOBILE = process.env.MOBILE === "1";
const LARGEUR = MOBILE ? 390 : 1400;
const HAUTEUR = MOBILE ? 844 : 1000;
const PREFIXE = MOBILE ? "m-" : "";
const taille = async (largeur: number, hauteur: number) =>
  cdp("Emulation.setDeviceMetricsOverride", { width: largeur, height: hauteur, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE });
if (MOBILE) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await taille(LARGEUR, HAUTEUR);

const evaluer = async (expr: string): Promise<any> => {
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`évaluation : ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
  return r.result.value;
};
const attendreQue = async (expr: string, label: string, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluer(expr)) return Date.now() - t0;
    await attendre(150);
  }
  throw new Error(`délai dépassé : ${label}`);
};
const capture = async (nom: string) => {
  const r = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 86 });
  writeFileSync(`${CAPTURES}/${PREFIXE}${nom.replace(/\.png$/, ".jpg")}`, Buffer.from(r.data, "base64"));
  console.log("  capture", nom.replace(/\.png$/, ".jpg"));
};
/** Un vrai clic de souris au centre de l'élément (après l'avoir amené au milieu de l'écran). */
const cliquer = async (exprElement: string, label: string) => {
  const rect = await evaluer(`(() => { const el = ${exprElement}; if (!el) return null; el.scrollIntoView({ block: "center", inline: "center" }); return true; })()`);
  if (!rect) throw new Error(`introuvable : ${label}`);
  await attendre(250);
  const r = await evaluer(`(() => { const el = ${exprElement}; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, disabled: !!el.disabled }; })()`);
  if (r.disabled) throw new Error(`désactivé : ${label}`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
};

const ETAPE = `document.querySelector('[role=dialog] [id$="-etape-personnages"]')`;
const resultat: any = { onglets: [] };
try {
  console.log("1. la fiche");
  const t0 = Date.now();
  await cdp("Page.navigate", { url: "http://localhost:8080/affiches/ciel-etoile" });
  await attendreQue(`document.readyState === "complete"`, "chargement de la page", 60000);
  // L'île est hydratée quand son bouton « Personnaliser » réagit : on attend qu'astro-island n'ait plus ssr.
  await attendreQue(
    `[...document.querySelectorAll('astro-island[component-url*="AfficheIA"]')].some(i => !i.hasAttribute("ssr") && i.querySelector("button"))`,
    "hydratation de la fiche (île AfficheIA)",
    60000,
  );
  const page = await evaluer(`({ href: location.href, titre: document.title, h1: document.querySelector("h1")?.textContent?.replace(/\\s+/g, " ").trim() })`);
  console.log("  page :", JSON.stringify(page));
  if (!/Ciel étoilé/.test(page.titre ?? "")) throw new Error("ce n'est pas la fiche du ciel étoilé : " + JSON.stringify(page));
  console.log(`  page prête en ${Date.now() - t0} ms`);
  await capture("01-fiche.png");

  console.log("2. la fenêtre du ciel, puis « Dessiner mon ciel » (Mulhouse, ce soir 21 h, par défaut)");
  await cliquer(`[...document.querySelectorAll('astro-island[component-url*="AfficheIA"] button')].find(b => b.textContent.trim() === "Personnaliser")`, "Personnaliser");
  await attendreQue(`!!document.querySelector("[role=dialog]")`, "fenêtre");
  await attendreQue(
    `!![...document.querySelectorAll('[role=dialog] button[type=submit]')].find(b => /Dessiner mon ciel/.test(b.textContent))`,
    "bouton Dessiner mon ciel",
  );
  await attendre(800);
  await capture("02-fenetre-ciel.png");
  await cliquer(`[...document.querySelectorAll('[role=dialog] button[type=submit]')].find(b => /Dessiner mon ciel/.test(b.textContent))`, "Dessiner mon ciel");
  await attendreQue(
    `[...document.querySelectorAll('[role=dialog] img')].some(i => /\\/ia\\/apercu\\/verif-1$/.test(i.src) && i.complete && i.naturalWidth > 0)`,
    "aperçu du premier ciel",
    60000,
  );
  await attendre(600);
  await capture("03-ciel-dessine.png");

  console.log("3. l'étape Personnages");
  await cliquer(`document.querySelector('[role=dialog] [data-etape="personnages"]')`, "pastille Personnages");
  await attendreQue(`!${ETAPE}.hidden`, "étape Personnages visible");
  // Les tracés : la fiche lit /ia/ciel/silhouettes?v=ombres-groupes-5 à la première ouverture.
  await attendreQue(`!!${ETAPE}.querySelector("[role=tablist] + [role=group] button svg path")`, "vignettes chargées", 30000);
  await attendre(700); // les clics de l'instant qui suit un changement d'étape sont avalés
  const onglets: string[] = await evaluer(`[...${ETAPE}.querySelectorAll("[role=tablist] [role=tab]")].map(b => b.textContent.trim())`);
  resultat.ongletsLus = onglets;
  console.log("  onglets :", onglets.join(" | "));
  await taille(LARGEUR, MOBILE ? 1500 : 1700);
  for (let i = 0; i < onglets.length; i++) {
    await cliquer(`${ETAPE}.querySelectorAll("[role=tablist] [role=tab]")[${i}]`, `onglet ${onglets[i]}`);
    await attendreQue(`${ETAPE}.querySelectorAll("[role=tablist] [role=tab]")[${i}].getAttribute("aria-selected") === "true"`, `onglet ${i} choisi`);
    await attendre(300);
    const etat = await evaluer(`(() => {
      const grille = ${ETAPE}.querySelector("[role=tablist] + [role=group]");
      return [...grille.querySelectorAll(":scope > button")].map(b => {
        const svg = b.querySelector("svg");
        const path = svg && svg.querySelector("path");
        let boite = null;
        try { boite = path ? path.getBBox() : null; } catch (e) {}
        const r = svg ? svg.getBoundingClientRect() : null;
        return {
          nom: [...b.querySelectorAll(":scope > span:not(.absolute)")].map(s => s.textContent.trim()).find(Boolean) ?? "",
          trace: !!(path && path.getAttribute("d") && path.getAttribute("d").length > 20),
          boite: boite ? Math.round(boite.width) + "x" + Math.round(boite.height) : null,
          vignette: r ? Math.round(r.width) + "x" + Math.round(r.height) : null,
          visibles: r ? r.width > 10 && r.height > 10 : false,
        };
      });
    })()`);
    const sansTrace = etat.filter((e: any) => !e.trace || !e.visibles);
    resultat.onglets.push({ onglet: onglets[i], scenes: etat.length, sansTrace: sansTrace.map((e: any) => e.nom), noms: etat.map((e: any) => e.nom) });
    console.log(`  ${onglets[i]} : ${etat.length} scènes, ${etat.length - sansTrace.length} vignettes dessinées${sansTrace.length ? ` — SANS TRACÉ : ${sansTrace.map((e: any) => e.nom).join(", ")}` : ""}`);
    // La rangée d'onglets en haut de l'écran, puis la capture.
    await evaluer(`${ETAPE}.querySelector("[role=tablist]").scrollIntoView({ block: "start" })`);
    await attendre(200);
    await capture(`04-onglet-${i + 1}.png`);
  }
  await taille(LARGEUR, HAUTEUR);

  console.log("4. trois scènes nouvelles : Maman et ses deux filles, Papa et son petit garçon, Deux mamans et leur garçon");
  const avant = journal.postsCiel.length;
  const ajouter = async (onglet: string, scene: string) => {
    await cliquer(`[...${ETAPE}.querySelectorAll("[role=tablist] [role=tab]")].find(b => b.textContent.trim() === ${JSON.stringify(onglet)})`, `onglet ${onglet}`);
    await attendre(250);
    await cliquer(
      `[...${ETAPE}.querySelectorAll("[role=tablist] + [role=group] > button")].find(b => [...b.querySelectorAll(":scope > span:not(.absolute)")].map(s => s.textContent.trim()).find(Boolean) === ${JSON.stringify(scene)})`,
      `scène ${scene}`,
    );
    await attendre(150);
  };
  await ajouter("Maman et enfants", "Maman et ses deux filles");
  await ajouter("Papa et enfants", "Papa et son petit garçon");
  await ajouter("Parents et enfants", "Deux mamans et leur garçon");
  const posees = await evaluer(`${ETAPE}.querySelectorAll(".border-dashed .relative.flex.h-16").length`);
  console.log("  scènes posées dans la bande :", posees);
  // Le redessin : 400 ms après le dernier clic, puis le dessin en cours éventuel.
  const t1 = Date.now();
  while (Date.now() - t1 < 30000) {
    const dernier = journal.postsCiel.at(-1);
    if (journal.postsCiel.length > avant && dernier?.silhouettes?.length === 3 && dernier.id) break;
    await attendre(150);
  }
  const dernier = journal.postsCiel.at(-1);
  console.log("  POST /ia/ciel reçus depuis l'ajout :", journal.postsCiel.length - avant, "; dernier :", JSON.stringify(dernier?.corps?.silhouettes), "→", dernier?.id, `(${dernier?.chemins} ombres dans le SVG)`);
  await attendreQue(
    `[...document.querySelectorAll('[role=dialog] img')].some(i => i.src.endsWith(${JSON.stringify(`/ia/apercu/${dernier?.id}`)}) && i.complete && i.naturalWidth > 0)`,
    "nouvel aperçu affiché",
    60000,
  );
  await attendre(800);
  resultat.apercuAffiche = await evaluer(`[...document.querySelectorAll('[role=dialog] img')].filter(i => /\\/ia\\/apercu\\//.test(i.src)).map(i => i.src.replace(location.origin, "") + " " + i.naturalWidth + "x" + i.naturalHeight + (i.getBoundingClientRect().width > 0 ? " visible" : " caché"))`);
  console.log("  aperçus dans la fenêtre :", resultat.apercuAffiche.join(" ; "));
  await capture("05-trois-scenes-ajoutees.png");
  // L'aperçu lui-même, en grand.
  const boite = await evaluer(`(() => { const i = [...document.querySelectorAll('[role=dialog] img')].find(i => i.src.endsWith(${JSON.stringify(`/ia/apercu/${dernier?.id}`)}) && i.getBoundingClientRect().width > 0); if (!i) return null; i.scrollIntoView({block: "center"}); const b = i.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
  if (boite) {
    await attendre(300);
    const b2 = await evaluer(`(() => { const i = [...document.querySelectorAll('[role=dialog] img')].find(i => i.src.endsWith(${JSON.stringify(`/ia/apercu/${dernier?.id}`)}) && i.getBoundingClientRect().width > 0); const b = i.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    // L'écran tel quel, puis découpé autour de l'aperçu (un clip CDP ne voit pas la fenêtre fixe au téléphone).
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    const ecran = Buffer.from(r.data, "base64");
    const m = await sharp(ecran).metadata();
    const k = (m.width ?? LARGEUR) / LARGEUR;
    const left = Math.max(0, Math.round(b2.x * k)), top = Math.max(0, Math.round(b2.y * k));
    const width = Math.min((m.width ?? 0) - left, Math.round(b2.width * k)), height = Math.min((m.height ?? 0) - top, Math.round(b2.height * k));
    await sharp(ecran).extract({ left, top, width, height }).jpeg({ quality: 86 }).toFile(`${CAPTURES}/${PREFIXE}06-apercu-trois-scenes.jpg`);
    console.log("  capture 06-apercu-trois-scenes.jpg");
  }
  resultat.ok = true;
} catch (e) {
  resultat.ok = false;
  resultat.erreur = String(e);
  console.log("ÉCHEC :", e);
  try {
    await capture("99-echec.png");
  } catch {
    /* rien */
  }
} finally {
  resultat.journal = journal;
  writeFileSync(`${SORTIE}/${PREFIXE}resultat.json`, JSON.stringify(resultat, null, 2));
  console.log("requêtes bloquées (non GET) :", journal.bloquees.length ? journal.bloquees : "aucune");
  console.log("POST /ia/ciel interceptés :", journal.postsCiel.map((p) => `${p.id ?? "?"}:${JSON.stringify(p.corps.silhouettes)}:${p.ok}`).join(" "));
  console.log("exceptions :", journal.exceptions.length ? journal.exceptions : "aucune");
  console.log("console (erreurs/avertissements) :", journal.console.length ? journal.console.slice(0, 30) : "aucun");
  console.log("réponses API :", journal.reponsesApi.filter((x) => !/^200 GET/.test(x) || /silhouettes|apercu|ciel/.test(x)).slice(0, 40));
  console.log("échecs réseau :", journal.echecs.length ? journal.echecs.slice(0, 20) : "aucun");
  try {
    await cdp("Browser.close");
  } catch {
    /* fermé */
  }
  ws.close();
  chrome.kill();
}
