#!/usr/bin/env node
/**
 * REJOUE LES ANCIENNES ADRESSES DE MEMORYLINE.FR CONTRE UN SITE, ET DIT OÙ
 * CHACUNE MÈNE.
 *
 *   node apps/web/scripts/verifier-anciennes-adresses.mjs https://memoryline.fr
 *   node apps/web/scripts/verifier-anciennes-adresses.mjs https://vps-5c917e9d.vps.ovh.net
 *   node apps/web/scripts/verifier-anciennes-adresses.mjs http://localhost:8080
 *
 * Le jour de la bascule, Google connaît 216 adresses de la boutique Shopify
 * (son plan du site, relevé dans anciennes-adresses-shopify.txt). Chacune doit
 * mener à une page qui répond, EN UN SEUL SAUT et par une redirection
 * permanente : c'est ce qui transmet le référencement de l'ancienne adresse à
 * la nouvelle (AUDIT-SEO.md, MIG-9 et MIG-10). Ce script le vérifie, adresse
 * par adresse, plus quelques variantes que Google et les liens portent aussi
 * (barre finale, majuscules, /fr, ?variant=, suivi utm_*, fiche vue depuis
 * une collection).
 *
 * Il ne fait que lire, à deux requêtes par seconde au plus — la politesse
 * promise au serveur —, et rend la main avec le code 1 s'il trouve un
 * problème. Aucune dépendance : le fetch de Node (18 ou plus).
 */
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error(
    "Usage : node apps/web/scripts/verifier-anciennes-adresses.mjs https://memoryline.fr",
  );
  process.exit(2);
}

/** Deux requêtes par seconde au plus. */
const ATTENTE_MS = 500;
/** Les codes d'une redirection permanente : les seuls qui transmettent le référencement. */
const PERMANENTES = new Set([301, 308]);
/**
 * Les adresses qui PEUVENT ne mener nulle part : un fichier technique de
 * Shopify, sans visiteur ni référencement (relevé de l'audit du 22/10).
 */
const INTROUVABLES_ADMISES = new Set(["/agents.md"]);

const chemins = readFileSync(new URL("./anciennes-adresses-shopify.txt", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

/**
 * Les variantes d'une fiche et d'une collection : ce que Google a aussi en
 * mémoire. `garder` : un paramètre qui doit survivre à la redirection.
 */
const fiche = chemins.find((c) => c.startsWith("/products/"));
const collection = chemins.find((c) => c.startsWith("/collections/") && c !== "/collections/all");
const variantes = [];
if (fiche) {
  const handle = fiche.slice("/products/".length);
  variantes.push(
    { chemin: `${fiche}/` },
    { chemin: fiche.toUpperCase() },
    { chemin: `/fr${fiche}` },
    { chemin: `${fiche}?variant=123456789` },
    { chemin: `${fiche}?utm_source=pinterest&utm_medium=social`, garder: "utm_source=pinterest" },
    { chemin: `/collections/villes/products/${handle}` },
  );
}
if (collection) variantes.push({ chemin: `${collection}/` }, { chemin: `/fr${collection}` });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function demander(url) {
  await pause(ATTENTE_MS);
  return fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "memoryline-verifier-anciennes-adresses" },
  });
}

/**
 * Suit une adresse jusqu'à deux sauts. Rend le premier code, le nombre de
 * sauts, l'adresse finale et son code.
 */
async function suivre(chemin) {
  let url = base + chemin;
  const codes = [];
  for (let saut = 0; saut < 3; saut++) {
    const res = await demander(url);
    codes.push(res.status);
    const vers = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !vers) return { codes, finale: url };
    url = new URL(vers, url).toString();
  }
  return { codes, finale: url };
}

const relevé = [];
const problemes = [];
const versAccueil = [];
const tout = [...chemins.map((c) => ({ chemin: c })), ...variantes];
let n = 0;

for (const { chemin, garder } of tout) {
  n++;
  if (n % 25 === 0) process.stderr.write(`  … ${n}/${tout.length}\n`);
  let r;
  try {
    r = await suivre(chemin);
  } catch (err) {
    problemes.push(`${chemin} : pas de réponse (${String(err)})`);
    continue;
  }
  const { codes, finale } = r;
  const finalCode = codes[codes.length - 1];
  const sauts = codes.length - 1;
  relevé.push({ chemin, codes, finale });

  if (INTROUVABLES_ADMISES.has(chemin) && finalCode === 404) continue;
  if (finalCode !== 200) problemes.push(`${chemin} : ${codes.join(" → ")} (${finale})`);
  else if (sauts > 1) problemes.push(`${chemin} : ${sauts} sauts (${codes.join(" → ")}) jusqu'à ${finale}`);
  else if (sauts === 1 && !PERMANENTES.has(codes[0]))
    problemes.push(`${chemin} : redirection ${codes[0]}, non permanente (${finale})`);
  else if (chemin !== "/" && sauts === 0 && chemin.startsWith("/products/"))
    // Une ancienne fiche qui répond sans redirection : la page est servie
    // sous l'adresse de Shopify, en double de /affiches/….
    problemes.push(`${chemin} : 200 sans redirection vers /affiches/…`);
  else if (garder && !finale.includes(garder))
    problemes.push(`${chemin} : le suivi « ${garder} » est perdu (${finale})`);
  if (finalCode === 200 && new URL(finale).pathname === "/" && chemin !== "/") versAccueil.push(chemin);
}

const admises = relevé.filter(
  (r) => INTROUVABLES_ADMISES.has(r.chemin) && r.codes[r.codes.length - 1] === 404,
);
const bons = relevé.length - problemes.length - admises.length;
console.log(`\nSite vérifié : ${base}`);
console.log(`${tout.length} adresses (${chemins.length} du plan Shopify, ${variantes.length} variantes)`);
console.log(`  ${bons} mènent à une page qui répond, en un saut au plus`);
if (versAccueil.length)
  console.log(`  dont ${versAccueil.length} vers l'accueil : ${versAccueil.join(", ")}`);
for (const r of admises) console.log(`  ${r.chemin} : ${r.codes.join(" → ")} (admis)`);
if (problemes.length) {
  console.log(`\n${problemes.length} problème(s) :`);
  for (const p of problemes) console.log(`  - ${p}`);
  console.log(
    "\nChaque ancienne adresse en erreur s'ajoute dans BO › Boutique en ligne › Redirections.",
  );
  process.exit(1);
}
console.log("\nAucun problème.");
