// Fabrique apps/api/drizzle/0123_pages_legales_japonais_chinois.sql (28/11).
//
//   node generer-0123.mjs verifier   (contrôles et relecture, n'écrit rien)
//   node generer-0123.mjs ecrire     (contrôles, puis écrit la migration)
//
// Le français est relu dans la base locale (conteneur memoryline-db18, copie
// de la prod du 27/11 au soir) : chaque traduction doit avoir exactement la
// forme de son bloc français (genre, ordre, balises, liens, « À COMPLÉTER »),
// sans quoi rien n'est écrit.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "./traductions-pages-legales.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(ICI, "../../../apps/api/drizzle/0123_pages_legales_japonais_chinois.sql");
const SLUGS = ["conditions-de-vente", "confidentialite", "cookies", "mentions-legales"];
const ANCIENNES = ["en", "de", "it", "es"];

function psql(requete) {
  return execFileSync(
    "docker",
    ["exec", "memoryline-db18", "psql", "-U", "memoryline", "-d", "memoryline", "-At", "-c", requete],
    { encoding: "utf8" },
  ).trim();
}

const base = {};
for (const slug of SLUGS) {
  const ligne = psql(
    `SELECT json_build_object('title', title, 'blocks', blocks, 'translations', translations, 'empreinte', md5(blocks::text), 'empreintes', json_build_object('en', md5((translations->'en'->'blocks')::text), 'de', md5((translations->'de'->'blocks')::text), 'it', md5((translations->'it'->'blocks')::text), 'es', md5((translations->'es'->'blocks')::text))) FROM page WHERE slug = '${slug}'`,
  );
  base[slug] = JSON.parse(ligne);
}

let erreurs = 0;
const erreur = (m) => {
  erreurs++;
  console.log("ERREUR", m);
};

/** La suite des balises ouvrantes d'un HTML : sa forme, sans son texte. */
const forme = (html) => (html.match(/<(p|h2|h3|ul|ol|li|strong|em|a|br)\b/g) ?? []).join("");
const liens = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const AVERT = /^<p><em>[^<]+<\/em><\/p>/;
const A_COMPLETER = { ja: /要記入：/g, zh: /待补充：/g };

/** Un lien interne du français, dans la langue de la traduction. */
function lienTraduit(href, langue) {
  return href.startsWith("/") ? `/${langue}${href}` : href;
}

function verifierLangue(slug, langue, trad, lienAttendu) {
  const fr = base[slug];
  if (!trad.title?.trim() || !trad.seoTitle?.trim() || !trad.seoDescription?.trim())
    erreur(`${slug} ${langue} : titre ou référencement vide`);
  if (trad.blocks.length !== fr.blocks.length)
    erreur(`${slug} ${langue} : ${trad.blocks.length} blocs pour ${fr.blocks.length} en français`);
  fr.blocks.forEach((f, i) => {
    const b = trad.blocks[i];
    if (!b || b.type !== f.type) return erreur(`${slug} ${langue} bloc ${i} : genre ${b?.type} ≠ ${f.type}`);
    if (f.type === "titre") {
      if (!b.texte?.trim()) erreur(`${slug} ${langue} bloc ${i} : titre vide`);
      if (b.niveau !== f.niveau) erreur(`${slug} ${langue} bloc ${i} : niveau ${b.niveau} ≠ ${f.niveau}`);
      return;
    }
    let html = b.html;
    if (i === 0) {
      if (!AVERT.test(html)) erreur(`${slug} ${langue} : pas d'avertissement en tête`);
      html = html.replace(AVERT, "");
    }
    if (forme(html) !== forme(f.html))
      erreur(`${slug} ${langue} bloc ${i} : forme différente\n   fr ${forme(f.html)}\n   ${langue} ${forme(html)}`);
    const attendus = liens(f.html).map((l) => lienAttendu(l, langue));
    if (JSON.stringify(liens(html)) !== JSON.stringify(attendus))
      erreur(`${slug} ${langue} bloc ${i} : liens ${liens(html)} ≠ ${attendus}`);
    const nbFr = (f.html.match(/À COMPLÉTER/g) ?? []).length;
    const reg = A_COMPLETER[langue];
    if (reg) {
      const nb = (html.match(reg) ?? []).length;
      if (nb !== nbFr) erreur(`${slug} ${langue} bloc ${i} : ${nb} « à compléter » pour ${nbFr}`);
    }
    // Ce qui ne se traduit pas doit se retrouver tel quel.
    for (const jeton of f.html.match(/877 919 852 00047|FR48877919852|memoryline\.contact@gmail\.com|L\d{3}-\d+|\b1641\b|2004-575|424 761 419|Saint-Crépin-aux-Bois|Kellermann|TSA 80715|www\.cnil\.fr|Stripe|PayPal|Mondial Relay|Colissimo|SendCloud|Resend|OVH|Twemoji|CC-BY 4\.0|Alexandra Porhansl/g) ?? [])
      if (!html.includes(jeton)) erreur(`${slug} ${langue} bloc ${i} : « ${jeton} » manque`);
  });
}

// 1. Japonais et chinois, les 4 pages.
for (const slug of SLUGS)
  for (const langue of ["ja", "zh"]) verifierLangue(slug, langue, PAGES[slug][langue], lienTraduit);

// 2. La politique de confidentialité en anglais, allemand, italien, espagnol :
//    ses 17 blocs (forme d'avant le 22/11) remis en UN bloc, comme le
//    français, avec ce que le français a retiré le 22/11 retiré aussi
//    (l'adresse postale, la ligne OpenAI) et ses deux liens défaits (le
//    français n'en a plus).
const ADRESSE = {
  en: ", and by post at 7 chemin du Jeu d'Arc, 60170 Saint-Crépin-aux-Bois.",
  de: " und postalisch unter 7 chemin du Jeu d'Arc, 60170 Saint-Crépin-aux-Bois.",
  it: " e per posta al 7 chemin du Jeu d'Arc, 60170 Saint-Crépin-aux-Bois.",
  es: " y por correo postal en 7 chemin du Jeu d'Arc, 60170 Saint-Crépin-aux-Bois.",
};
const confidentialite = {};
for (const langue of ANCIENNES) {
  const blocs = base.confidentialite.translations[langue].blocks;
  let html = blocs.map((b) => (b.type === "titre" ? `<h2>${b.texte}</h2>` : b.html)).join("");
  const avant = html;
  if (!html.includes(ADRESSE[langue])) erreur(`confidentialite ${langue} : adresse postale introuvable`);
  html = html.replace(ADRESSE[langue], ".");
  const openai = html.match(/<li><strong>OpenAI<\/strong>.*?<\/li>/g) ?? [];
  if (openai.length !== 1) erreur(`confidentialite ${langue} : ${openai.length} ligne(s) OpenAI`);
  html = html.replace(/<li><strong>OpenAI<\/strong>.*?<\/li>/, "");
  html = html.replace(/<a href="\/(contact|pages\/cookies)">([^<]*)<\/a>/g, "$2");
  confidentialite[langue] = { blocks: [{ type: "texte", html }], avant };
  verifierLangue("confidentialite", langue, { title: "-", seoTitle: "-", seoDescription: "-", blocks: [{ type: "texte", html }] }, (l) => l);
}

// Relecture : chaque paragraphe, élément de liste ou intertitre du français
// face au même rang de chaque traduction.
const morceaux = (html) =>
  html
    .replace(AVERT, "")
    .split(/(?=<p>|<h2>|<li>)/)
    .map((m) => m.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
if (process.argv[2] === "verifier") {
  const fr = morceaux(base.confidentialite.blocks[0].html);
  const parLangue = {
    ...Object.fromEntries(ANCIENNES.map((l) => [l, morceaux(confidentialite[l].blocks[0].html)])),
    ja: morceaux(PAGES.confidentialite.ja.blocks[0].html),
    zh: morceaux(PAGES.confidentialite.zh.blocks[0].html),
  };
  for (const [l, m] of Object.entries(parLangue))
    if (m.length !== fr.length) erreur(`confidentialite ${l} : ${m.length} morceaux pour ${fr.length}`);
  fr.forEach((f, i) => {
    console.log(`\n[${i}] FR ${f}`);
    for (const [l, m] of Object.entries(parLangue)) console.log(`    ${l} ${m[i]}`);
  });
}

console.log(`\n${erreurs} erreur(s).`);
if (erreurs) process.exit(1);
if (process.argv[2] !== "ecrire") process.exit(0);

/* -------------------------------------------------------------------------- */
/*  Écriture de la migration                                                  */
/* -------------------------------------------------------------------------- */

const sqlTexte = (s) => `'${s.replace(/'/g, "''")}'`;
const json = (v) => sqlTexte(JSON.stringify(v));

const lignesJaZh = SLUGS.map((slug) => {
  const trad = { ja: PAGES[slug].ja, zh: PAGES[slug].zh };
  return `  (${sqlTexte(slug)}, ${sqlTexte(base[slug].title)}, ${sqlTexte(base[slug].empreinte)}, ${json(trad)}::jsonb)`;
}).join(",\n");

const blocConfidentialite = (langue) => `UPDATE "page" x
SET "translations" = jsonb_set(x."translations", '{${langue},blocks}', ${json(confidentialite[langue].blocks)}::jsonb)
WHERE x."slug" = 'confidentialite'
  AND md5(x."blocks"::text) = ${sqlTexte(base.confidentialite.empreinte)}
  AND md5((x."translations" -> '${langue}' -> 'blocks')::text) = ${sqlTexte(base.confidentialite.empreintes[langue])};`;

const sql = `-- Les 4 pages légales en japonais et en chinois simplifié (28/11). Alexandra :
-- « finis le à faire sauf la partie personnages » ; dans le fichier À FAIRE,
-- « Japonais et chinois, encore à faire : les 4 pages légales, l'anglais
-- s'affiche à leur place » (traductionDe, traductions.ts : faute de japonais
-- ou de chinois, la page retombe sur l'anglais).
--
-- 1. Conditions de vente, confidentialité, cookies, mentions légales :
--    traduites BLOC POUR BLOC depuis le français, comme la 0098 l'a fait pour
--    l'anglais, l'allemand, l'italien et l'espagnol (fusionnerBlocs, cms.ts,
--    associe chaque bloc traduit au bloc français de même rang et de même
--    genre). L'avertissement « la version française fait foi » ouvre le
--    premier paragraphe. Les « À COMPLÉTER » restent signalés, en gras, à leur
--    place (要記入 / 待补充). Les liens internes mènent à la page de la même
--    langue (/ja/…, /zh/…).
--    Seulement si le français est encore celui qui a été traduit (empreinte
--    de ses blocs, relevée sur la copie de la prod du 27/11 au soir) : une
--    page retouchée au BO depuis garde son repli sur l'anglais plutôt que de
--    recevoir la traduction d'un autre texte. Et rien n'est écrasé : un champ
--    japonais ou chinois déjà rempli reste tel quel (même fusion que la 0095).
--
-- 2. La politique de confidentialité en anglais, allemand, italien et
--    espagnol : le français a été réécrit le 22/11 en UN seul bloc (intertitres
--    en <h2>), et ces quatre langues avaient encore 17 blocs : seul le premier
--    collait (même rang, même genre), et la page s'arrêtait après son
--    introduction, sans rien de ce qu'elle doit dire. Leurs 17 blocs sont
--    remis en un, avec ce que le français a retiré le 22/11 (l'adresse postale
--    du responsable, la ligne OpenAI des destinataires, les deux liens).
--    Seulement si le français et chaque traduction sont encore exactement
--    ceux du 27/11 au soir.
--
-- Rejouable : une seconde fois, il n'y a plus rien à changer.
UPDATE "page" x
SET "translations" = coalesce(x."translations", '{}'::jsonb) || (
    SELECT jsonb_object_agg(l.key, l.value || coalesce((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(CASE WHEN jsonb_typeof(x."translations" -> l.key) = 'object' THEN x."translations" -> l.key ELSE '{}'::jsonb END) e
      WHERE (jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') <> '')
         OR (jsonb_typeof(e.value) = 'array' AND jsonb_array_length(e.value) > 0)
    ), '{}'::jsonb))
    FROM jsonb_each(t.trad) l
  )
FROM (VALUES
${lignesJaZh}
) AS t(slug, titre, empreinte, trad)
WHERE x."slug" = t.slug
  AND x."title" = t.titre
  AND md5(x."blocks"::text) = t.empreinte;
--> statement-breakpoint
${ANCIENNES.map(blocConfidentialite).join("\n--> statement-breakpoint\n")}
`;

writeFileSync(MIGRATION, sql);
console.log("Écrit :", MIGRATION, `(${Buffer.byteLength(sql)} octets)`);
