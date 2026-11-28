// Essai du code de base du pixel Meta tel qu'il est écrit dans
// apps/web/src/layouts/Base.astro (28/11) : le script « is:inline » est lu dans
// le fichier (Astro le recopie tel quel dans la page) et joué dans un bac à
// sable avec un faux document. Aucun réseau : « charger » le script de Meta,
// ici, c'est seulement l'ajouter à un faux <head>.
//
//   apps/api/node_modules/.bin/tsx --test travaux/pixel-meta/base-pixel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ici = dirname(fileURLToPath(import.meta.url));
const BASE = readFileSync(resolve(ici, "../../apps/web/src/layouts/Base.astro"), "utf8");
const debut = BASE.indexOf("{/* Le pixel Meta (28/11");
assert.ok(debut > 0, "bloc du pixel introuvable dans Base.astro");
const ouverture = BASE.indexOf("<script is:inline>", debut) + "<script is:inline>".length;
const CODE = BASE.slice(ouverture, BASE.indexOf("</script>", ouverture));
const FBEVENTS = "https://connect.facebook.net/en_US/fbevents.js";

type Options = {
  hostname?: string;
  search?: string;
  referrer?: string;
  stand?: boolean;
  choix?: string | null;
  readyState?: "loading" | "complete";
};

function monde(o: Options = {}) {
  const minuteries: (() => void)[] = [];
  const ecouteurs: Record<string, ((e: unknown) => void)[]> = {};
  const surLaFenetre: Record<string, (() => void)[]> = {};
  const ajoutes: { src?: string; async?: boolean }[] = [];
  const stockage = new Map<string, string>();
  if (o.choix) stockage.set("ml_cookie_consent", o.choix);
  const hostname = o.hostname ?? "memoryline.fr";
  const location = { hostname, search: o.search ?? "", origin: `https://${hostname}` };
  const document = {
    readyState: o.readyState ?? "loading",
    referrer: o.referrer ?? "",
    documentElement: {
      getAttribute: (n: string) => (n === "data-stand" && o.stand ? "1" : null),
    },
    createElement: () => ({}) as { src?: string; async?: boolean },
    head: { appendChild: (el: { src?: string }) => void ajoutes.push(el) },
    addEventListener: (t: string, f: (e: unknown) => void) => void (ecouteurs[t] ??= []).push(f),
  };
  const bac: Record<string, unknown> = {
    document,
    location,
    localStorage: { getItem: (k: string) => stockage.get(k) ?? null },
    setTimeout: (f: () => void) => void minuteries.push(f),
    addEventListener: (t: string, f: () => void) => void (surLaFenetre[t] ??= []).push(f),
  };
  vm.createContext(bac);
  bac.window = vm.runInContext("this", bac);
  vm.runInContext(CODE, bac);
  const m = {
    bac,
    ajoutes,
    /** Les appels en file d'attente de `fbq` (avant le script de Meta). */
    // Array.from d'ici : les tableaux du bac à sable ont un autre prototype.
    file: () =>
      Array.from((bac.fbq as { queue?: ArrayLike<unknown>[] } | undefined)?.queue ?? [], (a) => Array.from(a)),
    /** La page finit de charger, et les minuteries tournent (n tours). */
    finir(tours = 1) {
      document.readyState = "complete";
      for (const f of surLaFenetre.load ?? []) f();
      surLaFenetre.load = [];
      m.tourner(tours);
    },
    tourner(tours = 1) {
      for (let i = 0; i < tours; i++) {
        const a = minuteries.splice(0);
        for (const f of a) f();
      }
    },
    /** Comme CookieBanner.astro : le choix est gardé, PUIS l'évènement part. */
    choisir(valeur: string) {
      stockage.set("ml_cookie_consent", valeur);
      for (const f of ecouteurs["ml:consent"] ?? []) f({ detail: { consent: valeur } });
    },
    charge: () => ajoutes.some((s) => s.src === FBEVENTS),
    location,
    document,
  };
  return m;
}

const BASE_ATTENDUE = [
  ["set", "autoConfig", false, "1156538100082754"],
  ["init", "1156538100082754"],
  ["track", "PageView"],
];

test("le bloc est réservé à la production et n'a pas de <noscript>", () => {
  const avant = BASE.slice(debut, ouverture);
  assert.match(avant, /\{import\.meta\.env\.PROD && \(\s*<script is:inline>$/);
  // Un vrai élément <noscript> qui mènerait à Meta (les commentaires en parlent).
  assert.ok(
    !/<noscript>(?:(?!<\/noscript>)[\s\S])*facebook[\s\S]*?<\/noscript>/i.test(BASE),
    "un <noscript> enverrait sans accord",
  );
  assert.equal((BASE.match(/facebook\.(?:com|net)/g) ?? []).length, 1, "une seule adresse de Meta : le script");
});

test("sans choix : rien (ni fbq, ni _fbq, ni script), même après chargement", () => {
  const m = monde();
  m.finir(3);
  assert.equal(m.bac.fbq, undefined);
  assert.equal(m.bac._fbq, undefined);
  assert.equal(m.ajoutes.length, 0);
});

test("« Accepter » : fbq (file d'attente) aussitôt, le script de Meta après la page", () => {
  const m = monde();
  m.choisir("accept");
  assert.equal(typeof m.bac.fbq, "function");
  assert.deepEqual(m.file(), BASE_ATTENDUE);
  assert.equal(m.charge(), false, "rien de chargé avant la fin de la page");
  m.finir();
  assert.equal(m.charge(), true);
  assert.equal(m.ajoutes[0]!.async, true);
});

test("« Accepter » cliqué une fois la page chargée : le script vient au tour suivant", () => {
  const m = monde({ readyState: "complete" });
  m.choisir("accept");
  assert.equal(m.charge(), false);
  m.tourner();
  assert.equal(m.charge(), true);
  assert.equal(m.ajoutes.length, 1);
});

test("choix déjà enregistré « accept » : le pixel vient dès la page suivante", () => {
  const m = monde({ choix: "accept" });
  assert.deepEqual(m.file(), BASE_ATTENDUE, "fbq posé pendant la lecture de l'en-tête");
  m.finir();
  assert.equal(m.charge(), true);
});

test("« refuse » enregistré : rien ; « Refuser » cliqué : rien", () => {
  const a = monde({ choix: "refuse" });
  a.finir(3);
  assert.equal(a.bac.fbq, undefined);
  assert.equal(a.ajoutes.length, 0);
  const b = monde();
  b.choisir("refuse");
  b.finir(3);
  assert.equal(b.bac.fbq, undefined);
  assert.equal(b.ajoutes.length, 0);
});

test("refuser après avoir accepté : consent revoke ; ré-accepter : consent grant, sans second script", () => {
  const m = monde({ choix: "accept" });
  m.finir();
  m.choisir("refuse");
  assert.deepEqual(m.file().at(-1), ["consent", "revoke"]);
  m.choisir("accept");
  m.tourner(3);
  assert.deepEqual(m.file().at(-1), ["consent", "grant"]);
  assert.equal(m.ajoutes.length, 1);
  assert.equal(m.file().filter((a) => a[0] === "init").length, 1, "un seul init");
});

test("tablette d'un stand : rien, même avec « accept »", () => {
  const m = monde({ choix: "accept", stand: true });
  m.choisir("accept");
  m.finir(3);
  assert.equal(m.bac.fbq, undefined);
  assert.equal(m.ajoutes.length, 0);
});

test("ailleurs que sur memoryline.fr (www, serveur de test, local) : rien", () => {
  for (const hostname of ["www.memoryline.fr", "test.memoryline.fr", "localhost", "memoryline.fr.evil.com"]) {
    const m = monde({ hostname, choix: "accept" });
    m.choisir("accept");
    m.finir(3);
    assert.equal(m.bac.fbq, undefined, hostname);
    assert.equal(m.ajoutes.length, 0, hostname);
  }
});

test("retour de la banque (secret dans l'adresse) : Meta attend que la caisse l'ait effacé", () => {
  const m = monde({
    choix: "accept",
    search: "?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_X&redirect_status=succeeded",
  });
  m.finir(10);
  assert.equal(m.charge(), false, "pas de script tant que le secret est dans l'adresse");
  // La caisse a vérifié le paiement : history.replaceState(…, pathname).
  m.location.search = "";
  m.tourner();
  assert.equal(m.charge(), true);
});

test("lien d'un courrier (jeton de mot de passe ou de panier) : Meta ne vient pas", () => {
  for (const search of ["?jeton=abc", "?lang=en&jeton=abc", "?token=abc"]) {
    const m = monde({ choix: "accept", search });
    m.finir(200);
    assert.equal(m.charge(), false, search);
  }
});

test("page ouverte depuis une adresse du site à secret : Meta ne vient pas ; d'un autre site : si", () => {
  const a = monde({ choix: "accept", referrer: "https://memoryline.fr/panier/recuperer?jeton=abc" });
  a.finir(3);
  assert.equal(a.charge(), false);
  const b = monde({ choix: "accept", referrer: "https://hooks.stripe.com/redirect/complete?token=x" });
  b.finir(3);
  assert.equal(b.charge(), true);
  const c = monde({ choix: "accept", referrer: "https://memoryline.fr/" });
  c.finir(3);
  assert.equal(c.charge(), true);
});

test("paramètres ordinaires (fbclid, utm, recherche) : le pixel vient", () => {
  const m = monde({ choix: "accept", search: "?fbclid=abc&utm_source=meta&q=chat" });
  m.finir();
  assert.equal(m.charge(), true);
});
