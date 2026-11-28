// Garde-robe sur gabarits, catégorie peau-et-corps.
//
// Contrôle que la peau de chaque gabarit de dos se change comme celle des
// personnages actuels (zone base:st0, premier groupe de la base), publie les
// 4 corps standard en -v2, fabrique les planches de contrôle et l'index.
//
// Se lance dans le conteneur memoryline-api :
//   cd /tmp/gr-peau-et-corps && node gen.mjs
// avec à côté : ref/ (copie de garde-robe/commun/ref).
// Sorties : out/svg/, out/planche.jpg, out/planche-animaux.jpg, out/index.json,
// et les -v2 recopiés dans /app/data/assets (copie locale du conteneur).

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const sharp = createRequire("/app/apps/api/package.json")("sharp");

const ICI = path.dirname(new URL(import.meta.url).pathname);
const REF = path.join(ICI, "ref");
const OUT = path.join(ICI, "out");
const ASSETS = "/app/data/assets";
const MARQUE = "Garde-robe sur gabarits";
const PUBLIER = !process.argv.includes("--sans-copie");

fs.mkdirSync(path.join(OUT, "svg"), { recursive: true });

/* ----------------------------------------------------------------------- */
/* Les gabarits                                                             */
/* ----------------------------------------------------------------------- */

const PREFIXES = {
  femme: "Female", homme: "Male", enfant: "Boy", ado: "Teenage_Boy",
  cheval: "Horse", chat: "Cat", lapin: "Rabbit",
};
const BOTTOM = {
  femme: 0.875, homme: 0.865, enfant: 0.778, ado: 0.821,
  cheval: 0.874, chat: 0.624, lapin: 0.625,
};

// [famille, morphologie, fichier de référence]
const HUMAINS = [
  ["femme", "standard"], ["femme", "fine"], ["femme", "ronde"], ["femme", "agee"],
  ["homme", "standard"], ["homme", "mince"], ["homme", "rond"], ["homme", "age"],
  ["enfant", "standard"], ["enfant", "fin"], ["enfant", "rond"],
  ["ado", "standard"], ["ado", "fin"],
];
const ANIMAUX = [["cheval", "debout"], ["chat", null], ["lapin", null]];
const ZONES_ATTENDUES = { cheval: ["st0", "st2", "st3"], chat: ["st0"], lapin: ["st0", "st2"] };

const NOMS_FAMILLE = { femme: "Femme", homme: "Homme", enfant: "Enfant", ado: "Ado" };
const NOMS_MORPHO = {
  standard: "standard", fine: "fine", ronde: "ronde", agee: "âgée", mince: "mince",
  rond: "rond", age: "âgé", fin: "fin", debout: "debout",
};

const refNom = (f, m) => `gabarit-dos-${f}${m ? "-" + m : ""}.svg`;

/* ----------------------------------------------------------------------- */
/* Contrôle par lecture du texte, points (1) à (5)                          */
/* ----------------------------------------------------------------------- */

// Mêmes motifs que packages/types/src/empilement-personnage.ts (FAMILLES).
const MOTIFS_HABIT = [
  /(?:^|_)Bottoms?(?![a-z])/i, /(?:^|_)Clothes(?![a-z])/i,
  /(?:^|_)Hair(?![a-z])/i, /(?:^|_)Accessor/i,
];
// Même expression que extractColorZones (packages/types/src/svg-color.ts).
const zonesDe = (svg) => {
  const z = {};
  for (const m of svg.matchAll(/\.(st\d+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,8})/g)) z[m[1]] = m[2].toUpperCase();
  return z;
};

function controleTexte(svg, zonesAttendues) {
  const pb = [];
  const styles = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  if (styles.length !== 1) pb.push(`${styles.length} blocs <style>`);
  const regles = styles.length ? [...styles[0][1].matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2].trim()]) : [];
  // (1) .st0{fill} en premier, seule zone de peau
  if (!regles.length || regles[0][0] !== ".st0" || !/^fill\s*:\s*#[0-9A-Fa-f]{6};?$/.test(regles[0][1]))
    pb.push("la première règle n'est pas .st0{fill:#…}");
  for (const [sel] of regles) if (sel.includes(",")) pb.push(`règle groupée ${sel}`);
  const zones = zonesDe(svg);
  const attendu = [...zonesAttendues].sort().join(",");
  if (Object.keys(zones).sort().join(",") !== attendu) pb.push(`zones ${Object.keys(zones).join(",")} au lieu de ${attendu}`);
  // (3) ombre
  const st1 = regles.find(([s]) => s === ".st1");
  if (!st1 || st1[1].replace(/\s/g, "") !== "opacity:0.15;") pb.push(`.st1 vaut « ${st1?.[1]} »`);
  // (4) aucun fill/stroke/style/opacity sur une forme
  if (/\sfill\s*=/.test(svg)) pb.push("attribut fill=");
  if (/\sstroke\s*=/.test(svg)) pb.push("attribut stroke=");
  if (/<(path|g|ellipse|circle|polygon|rect)\b[^>]*\sstyle\s*=/.test(svg)) pb.push("style= sur une forme");
  if (/<(path|g|ellipse|circle|polygon|rect)\b[^>]*\sopacity\s*=/.test(svg)) pb.push("opacity= en attribut");
  if (/<(defs|image|use|linearGradient|radialGradient|clipPath|mask|text)\b/.test(svg)) pb.push("élément interdit (defs, image, use, dégradé…)");
  if (/\stransform\s*=/.test(svg)) pb.push("transform");
  // classes utilisées / déclarées
  const declarees = new Set(regles.map(([s]) => s.replace(/^\./, "")));
  const utilisees = new Set([...svg.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));
  for (const c of utilisees) if (!declarees.has(c)) pb.push(`classe ${c} non déclarée`);
  for (const c of declarees) if (!utilisees.has(c)) pb.push(`classe ${c} jamais utilisée`);
  // formes sans classe
  const sansClasse = [...svg.matchAll(/<(path|ellipse|circle|polygon|rect)\b([^>]*)>/g)].filter((m) => !/\sclass=/.test(m[2]));
  if (sansClasse.length) pb.push(`${sansClasse.length} forme(s) sans classe`);
  // (5) un seul groupe racine *_Base_N, sans mot d'habit
  const groupes = [...svg.matchAll(/<g\b[^>]*>/g)].map((m) => /id="([^"]*)"/.exec(m[0])?.[1] ?? "(sans id)");
  if (groupes.length !== 1) pb.push(`${groupes.length} groupes : ${groupes.join(", ")}`);
  const g = groupes[0] ?? "";
  if (!/^[A-Za-z_]+_Base_\d+$/.test(g)) pb.push(`groupe « ${g} » hors forme <Prefixe>_Base_N`);
  if (MOTIFS_HABIT.some((r) => r.test(g))) pb.push(`le groupe « ${g} » serait pris pour un habit`);
  return { ok: pb.length === 0, problemes: pb, zones, groupe: g, classes: [...declarees] };
}

/* ----------------------------------------------------------------------- */
/* Rastérisation                                                            */
/* ----------------------------------------------------------------------- */

const recolorer = (svg, zones) => {
  let out = svg;
  for (const [z, c] of Object.entries(zones))
    out = out.replace(new RegExp(`(\\.${z}\\s*\\{\\s*fill\\s*:\\s*)#[0-9A-Fa-f]{3,8}`), `$1${c}`);
  return out;
};
const raster = async (svg) =>
  sharp(Buffer.from(svg), { density: 72 }).resize(500, 1000).ensureAlpha().raw().toBuffer();

// Peau en rouge pur (humains) ; pour les animaux, chaque zone dans une
// primaire. Tout pixel opaque doit alors s'expliquer par ces primaires
// assombries par une ou plusieurs ombres : il ne reste aucune couleur
// écrite en dur.
async function controleRaster(svg, zones, humain) {
  const primaires = ["#FF0000", "#00FF00", "#0000FF"];
  const map = {};
  Object.keys(zones).forEach((z, i) => (map[z] = primaires[i]));
  const px = await raster(recolorer(svg, map));
  const pxOrig = await raster(svg);
  let opaques = 0, fautifs = 0, alphaDiff = 0, rouges = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] !== pxOrig[i + 3]) alphaDiff++;
    if (px[i + 3] !== 255) continue;
    opaques++;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    if (humain) {
      // rouge, ou rouge assombri par 1 à 3 ombres superposées (0,85^k)
      if (g <= 6 && b <= 6 && r >= 150) rouges++;
      else fautifs++;
    } else {
      // une primaire, ou le mélange de deux au bord : jamais les trois à la fois
      const n = [r, g, b].filter((v) => v > 12).length;
      if (n === 0 || n === 3) fautifs++;
    }
  }
  return { opaques, fautifs, alpha_identique: alphaDiff === 0, part_peau: humain ? rouges / opaques : null };
}

/* ----------------------------------------------------------------------- */
/* Contrôle et publication                                                  */
/* ----------------------------------------------------------------------- */

const lire = (f) => fs.readFileSync(path.join(REF, f), "utf8");
const dDe = (svg) => [...svg.matchAll(/<(path|ellipse|circle|polygon)\b[^>]*>/g)].map((m) => m[0].replace(/\sid="[^"]*"/, ""));

function versionV2(svg, f) {
  const Fam = NOMS_FAMILLE[f];
  let out = svg
    .replace(/^<!--[\s\S]*?-->\s*/, "")
    .replace(/(<svg\b[^>]*\sid=")[^"]*(")/, `$1Gabarit_Dos_${Fam}_Standard_V2$2`)
    .replace(/(<g\b[^>]*\sid=")[^"]*(")/, `$1${PREFIXES[f]}_Base_1001$2`);
  out = `<!-- ${MARQUE}, generee par garde-robe/peau-et-corps/gen.mjs : ${Fam.toLowerCase()} standard, corps nu de dos, peau en st0 -->\n` + out;
  return out;
}

function publier(nom, contenu) {
  fs.writeFileSync(path.join(OUT, "svg", nom), contenu);
  if (!PUBLIER) return "non copié (--sans-copie)";
  const cible = path.join(ASSETS, nom);
  if (fs.existsSync(cible)) {
    const premiere = fs.readFileSync(cible, "utf8").split("\n", 1)[0];
    if (!premiere.includes(MARQUE)) throw new Error(`${cible} existe sans la marque : arrêt`);
    if (fs.readFileSync(cible, "utf8") === contenu) return "déjà à jour";
    fs.writeFileSync(cible, contenu);
    return "régénéré";
  }
  fs.writeFileSync(cible, contenu);
  return "créé";
}

const rapport = { gabarits: [], v2: [], ombres: {} };
const entrees = [];

for (const [f, m] of [...HUMAINS, ...ANIMAUX]) {
  const fichierRef = refNom(f, m);
  const svg = lire(fichierRef);
  const attendues = ZONES_ATTENDUES[f] ?? ["st0"];
  const t = controleTexte(svg, attendues);
  const r = await controleRaster(svg, t.zones, !ANIMAUX.some(([a]) => a === f));
  const rasterOk = r.fautifs <= 30 && r.alpha_identique;
  const remarques = [...t.problemes];
  if (!rasterOk) remarques.push(`${r.fautifs} pixels hors zones recolorables`);

  let fichier = fichierRef, groupe = t.groupe, svgFinal = svg;
  if (m === "standard") {
    const v2 = versionV2(svg, f);
    const t2 = controleTexte(v2, attendues);
    const memeGeo = JSON.stringify(dDe(v2)) === JSON.stringify(dDe(svg));
    if (!t2.ok || !memeGeo) throw new Error(`v2 ${f} incorrect : ${t2.problemes.join("; ")} géométrie identique=${memeGeo}`);
    fichier = `gabarit-dos-${f}-standard-v2.svg`;
    groupe = t2.groupe;
    svgFinal = v2;
    const etat = publier(fichier, v2);
    rapport.v2.push({ fichier, etat, geometrie_identique: memeGeo, octets: Buffer.byteLength(v2) });
  } else if (!t.ok || !rasterOk) {
    // Correction éventuelle : aucune n'a été nécessaire au 27/11 ; on
    // s'arrête plutôt que d'écrire une version non relue.
    throw new Error(`${fichierRef} échoue : ${remarques.join("; ")}`);
  }
  rapport.gabarits.push({ fichier, texte: t, raster: r });
  entrees.push({
    fichier,
    url: `/assets/${fichier}`,
    famille: f,
    morphologie: m ?? f,
    groupe,
    base_color_zones: t.zones,
    zone_peau: "st0",
    ombre: "st1",
    bottom_pct: BOTTOM[f],
    facteur_taille: 1,
    decalage_x: 0,
    slot_adjust: {},
    orientation: "back",
    controle: {
      ok: t.ok && rasterOk,
      remarques: remarques.join("; ") ||
        (ANIMAUX.some(([a]) => a === f)
          ? `zones ${Object.keys(t.zones).join(", ")} seules ; ${r.opaques} px opaques, ${r.fautifs} hors zones`
          : `peau st0 = ${(r.part_peau * 100).toFixed(1)} % des ${r.opaques} px opaques, ${r.fautifs} px hors peau`),
    },
    _svg: svgFinal,
  });
}

/* ----------------------------------------------------------------------- */
/* Teintes de peau et lisibilité de l'ombre                                 */
/* ----------------------------------------------------------------------- */

const TEINTES = ["#FFEEE0", "#FFE2C0", "#F6D2A9", "#E1B480", "#B88A6C", "#8B5B38", "#F8AA4C", "#C87446"];
const ROBES = {
  cheval: { "alezan": "#C57745", "bai": "#7A4A2A", "gris": "#B8B2A8", "noir": "#2F2A2B" },
  chat: { "noir": "#2F2A2B", "roux": "#D9822B", "gris": "#8E8A84", "crème": "#EAD7B7" },
  lapin: { "fauve": "#C9B39A", "blanc cassé": "#E6E0D8", "gris": "#8E8A84", "brun": "#7A5A3E" },
};

// Crins du cheval : brun d'origine, noir, lavé (gris clair), blond.
const CRINS = ["#5B392E", "#2F2A2B", "#D8D2C8", "#E0C48A"];

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function lab([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
// L'ombre est un aplat noir à 15 % composé en sRGB : couleur × 0,85.
const ombre = (c) => c.map((v) => Math.round(v * 0.85));
const dRef = deltaE(hexRgb("#F8AA4C"), ombre(hexRgb("#F8AA4C")));
for (const t of [...TEINTES, ...Object.values(ROBES).flatMap(Object.values)]) {
  const c = hexRgb(t);
  const d = deltaE(c, ombre(c));
  rapport.ombres[t] = { deltaE: +d.toFixed(2), rapport_a_la_peau_actuelle: +(d / dRef).toFixed(2) };
}

/* ----------------------------------------------------------------------- */
/* Planches                                                                 */
/* ----------------------------------------------------------------------- */

const echapper = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const texte = (w, h, lignes, taille = 15, fond = "#FFFFFF") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${fond}"/>` +
    lignes.map((l, i) => `<text x="${w / 2}" y="${h / 2 - ((lignes.length - 1) * taille * 0.6) + i * taille * 1.2 + taille * 0.35}" font-family="DejaVu Sans, sans-serif" font-size="${taille}" text-anchor="middle" fill="#333">${echapper(l)}</text>`).join("") + `</svg>`);

async function vignette(svg, w, h, recadrage) {
  let img = sharp(Buffer.from(svg), { density: 72 }).resize(500, 1000);
  if (recadrage) {
    const buf = await img.png().toBuffer();
    img = sharp(buf).extract(recadrage);
  }
  return img.resize(w, h, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
}

async function planche(fichier, lignes, colonnes, cw, ch, cellule) {
  const gauche = 150, haut = 46;
  const W = gauche + colonnes.length * cw, H = haut + lignes.length * ch;
  const calques = [];
  colonnes.forEach((c, j) => calques.push({ input: texte(cw, haut, c), left: gauche + j * cw, top: 0 }));
  for (let i = 0; i < lignes.length; i++) {
    calques.push({ input: texte(gauche, ch, lignes[i].titre), left: 0, top: haut + i * ch });
    for (let j = 0; j < colonnes.length; j++) {
      const fond = (i + j) % 2 ? "#F3F1EE" : "#FFFFFF";
      calques.push({ input: texte(cw, ch, [], 10, fond), left: gauche + j * cw, top: haut + i * ch });
      calques.push({ input: await cellule(i, j), left: gauche + j * cw, top: haut + i * ch });
    }
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#FFFFFF" } })
    .composite(calques).jpeg({ quality: 88 }).toFile(path.join(OUT, fichier));
}

const humains = entrees.slice(0, HUMAINS.length);
await planche(
  "planche.jpg",
  humains.map((e) => ({ titre: [`${NOMS_FAMILLE[e.famille]} ${NOMS_MORPHO[e.morphologie]}`, e.fichier.replace(/^gabarit-dos-|\.svg$/g, "")] })),
  TEINTES.map((t) => [t, `ombre dE ${rapport.ombres[t].deltaE}`]),
  160, 320,
  // On recadre sur la zone y 140-940 où vivent tous les corps humains.
  (i, j) => vignette(recolorer(humains[i]._svg, { st0: TEINTES[j] }), 160, 320, { left: 50, top: 140, width: 400, height: 800 }),
);

const animaux = entrees.slice(HUMAINS.length);
// Queue (st2) et crinière (st3, nuance telle que couleursDuGroupe la calcule) :
// alezan aux crins lavés, bai aux crins noirs, gris aux crins clairs, noir.
const CRINS_ASSORTIS = [["#E0C48A", "#E2D4A5"], ["#2F2A2B", "#595051"], ["#D8D2C8", "#DFDCD3"], ["#2F2A2B", "#595051"]];
const CADRES = {
  cheval: { left: 110, top: 140, width: 280, height: 750 },
  chat: { left: 170, top: 420, width: 220, height: 220 },
  lapin: { left: 160, top: 370, width: 180, height: 270 },
};
await planche(
  "planche-animaux.jpg",
  animaux.map((e) => ({ titre: [e.famille === "cheval" ? "Cheval debout" : e.famille === "chat" ? "Chat" : "Lapin", e.fichier.replace(/^gabarit-dos-|\.svg$/g, "")] })),
  [0, 1, 2, 3].map((k) => [`robe ${k + 1}`]),
  220, 300,
  (i, j) => {
    const e = animaux[i];
    const [nom, couleur] = Object.entries(ROBES[e.famille])[j];
    const crins = e.famille === "cheval" ? { st2: CRINS_ASSORTIS[j][0], st3: CRINS_ASSORTIS[j][1] } : {};
    return vignette(recolorer(e._svg, { st0: couleur, ...crins }), 220, 300, CADRES[e.famille]).then(async (b) =>
      sharp(b).composite([{ input: texte(220, 22, [`${nom} ${couleur}`], 13, "#FFFFFF"), left: 0, top: 278 }]).png().toBuffer());
  },
);

/* ----------------------------------------------------------------------- */
/* Index                                                                    */
/* ----------------------------------------------------------------------- */

const P = (f, m) => m === "standard" ? `gabarit-dos-${f}-standard-v2.svg` : refNom(f, m);
const personnages = [
  // Femmes
  ["Mamie aux cheveux blancs", P("femme", "agee"), "#F6D2A9", "coiffures/femme/chignon-grand-mere", "hauts/femme/gilet", "bas/femme/jupe", "accessoires/femme/chale"],
  ["Mamie au carré gris", P("femme", "agee"), "#8B5B38", "coiffures/femme/carre-court", "hauts/femme/pull-col-rond", "bas/femme/pantalon", "accessoires/femme/lunettes"],
  ["Femme aux longs cheveux", P("femme", "standard"), "#FFE2C0", "coiffures/femme/longs-lisses", "hauts/femme/pull-col-rond", "bas/femme/jean", "accessoires/femme/sac-a-main"],
  ["Femme à la queue de cheval", P("femme", "fine"), "#E1B480", "coiffures/femme/queue-de-cheval", "hauts/femme/t-shirt", "bas/femme/legging", "accessoires/femme/casquette"],
  ["Femme aux cheveux frisés", P("femme", "ronde"), "#8B5B38", "coiffures/femme/afro", "hauts/femme/robe", "bas/femme/jupe", "accessoires/femme/foulard"],
  ["Femme au chapeau de paille", P("femme", "standard"), "#B88A6C", "coiffures/femme/carre-court", "hauts/femme/debardeur", "bas/femme/short", "accessoires/femme/chapeau-de-paille"],
  ["Jeune maman", P("femme", "fine"), "#FFEEE0", "coiffures/femme/chignon-flou", "hauts/femme/chemise", "bas/femme/jean", "accessoires/femme/sac-a-dos"],
  // Hommes
  ["Papi chauve", P("homme", "age"), "#F6D2A9", "coiffures/homme/calvitie-couronne-blanche", "hauts/homme/gilet", "bas/homme/pantalon-velours", "accessoires/homme/casquette-plate"],
  ["Papi à la barbe blanche", P("homme", "age"), "#B88A6C", "coiffures/homme/calvitie-barbe-blanche", "hauts/homme/chemise", "bas/homme/pantalon", "accessoires/homme/lunettes"],
  ["Homme barbu", P("homme", "standard"), "#E1B480", "coiffures/homme/courts-barbe", "hauts/homme/chemise-a-carreaux", "bas/homme/jean", "accessoires/homme/bonnet"],
  ["Homme en sweat à capuche", P("homme", "mince"), "#8B5B38", "coiffures/homme/rases", "hauts/homme/sweat-capuche", "bas/homme/jogging", "accessoires/homme/casque-audio"],
  ["Homme au costume", P("homme", "rond"), "#FFE2C0", "coiffures/homme/raie-de-cote", "hauts/homme/veste-costume", "bas/homme/pantalon", "accessoires/homme/chapeau"],
  ["Homme en polo", P("homme", "standard"), "#C87446", "coiffures/homme/courts", "hauts/homme/polo", "bas/homme/short", "accessoires/homme/casquette"],
  // Enfants
  ["Petite fille aux couettes", P("enfant", "standard"), "#FFEEE0", "coiffures/enfant/couettes", "hauts/enfant/robe", "bas/enfant/collant", "accessoires/enfant/noeud"],
  ["Petite fille aux tresses", P("enfant", "fin"), "#8B5B38", "coiffures/enfant/tresses", "hauts/enfant/t-shirt", "bas/enfant/salopette", "accessoires/enfant/sac-a-dos"],
  ["Petit garçon à la casquette", P("enfant", "rond"), "#F6D2A9", "coiffures/enfant/courts", "hauts/enfant/t-shirt-rayures", "bas/enfant/short", "accessoires/enfant/casquette"],
  ["Petit garçon au bonnet", P("enfant", "standard"), "#B88A6C", "coiffures/enfant/frange", "hauts/enfant/pull", "bas/enfant/pantalon", "accessoires/enfant/bonnet-pompon"],
  // Ados
  ["Ado au sweat", P("ado", "standard"), "#E1B480", "coiffures/ado/meche", "hauts/ado/sweat-capuche", "bas/ado/jean", "accessoires/ado/casque-audio"],
  ["Ado sportif", P("ado", "fin"), "#8B5B38", "coiffures/ado/rases", "hauts/ado/maillot", "bas/ado/jogging", "accessoires/ado/casquette"],
  // Animaux
  ["Cheval alezan", refNom("cheval", "debout"), "#C57745", null, null, null, "accessoires/cheval/licol"],
  ["Chat noir", refNom("chat"), "#2F2A2B", null, null, null, "accessoires/chat/collier-grelot"],
  ["Lapin fauve", refNom("lapin"), "#C9B39A", null, null, null, "accessoires/lapin/noeud"],
].map(([nom, gabarit, peau, hair, clothes, pants, accessory]) => {
  const tenue = {};
  if (hair) tenue.hair = hair;
  if (clothes) tenue.clothes = clothes;
  if (pants) tenue.pants = pants;
  if (accessory) tenue.accessory = accessory;
  return { nom, gabarit, peau, tenue_souhaitee: tenue };
});

const gabaritsIndex = entrees.map(({ _svg, ...e }) => {
  const animal = ROBES[e.famille];
  if (animal) {
    // Sans réglage, la première rangée de la base reçoit le nuancier peau :
    // pour un animal, on conseille de lui donner sa propre liste de robes.
    e.base_groupes_couleurs_conseilles = [{ zone: "st0", nom: "Robe", couleurs: Object.values(animal) }];
    e.base_zones_proposees_conseillees = ["st0"];
    if (e.famille === "cheval") {
      // Crins : la queue (st2) mène, la crinière (st3, même teinte plus
      // claire de 0,14) suit en nuance. Sans cette rangée, les crins restent
      // bruns sur la robe grise ou noire.
      e.base_groupes_couleurs_conseilles.push({ zone: "st2", nuances: ["st3"], nom: "Crins", couleurs: CRINS });
      e.base_zones_proposees_conseillees = ["st0", "st2"];
    }
  }
  return e;
});

const index = {
  categorie: "peau-et-corps",
  date: "2026-11-27",
  generateur: "garde-robe/peau-et-corps/gen.mjs",
  teintes_peau: TEINTES,
  lisibilite_ombre: rapport.ombres,
  robes_animaux: Object.fromEntries(Object.entries(ROBES).map(([k, v]) => [k, Object.values(v)])),
  gabarits: gabaritsIndex,
  exclus: [{ fichier: "gabarit-dos-cheval.svg", raison: "cheval couché, pas proposé" }],
  personnages_proposes: personnages,
};
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1) + "\n");
fs.writeFileSync(path.join(OUT, "rapport.json"), JSON.stringify({ ...rapport, gabarits: rapport.gabarits.map((g) => ({ fichier: g.fichier, problemes: g.texte.problemes, raster: g.raster })) }, null, 1));

for (const g of rapport.gabarits)
  console.log(g.fichier.padEnd(36), g.texte.ok ? "texte ok" : "TEXTE " + g.texte.problemes.join("; "),
    "| raster", g.raster.fautifs, "fautifs /", g.raster.opaques, g.raster.part_peau != null ? `peau ${(g.raster.part_peau * 100).toFixed(1)} %` : "");
for (const v of rapport.v2) console.log("v2", v.fichier, v.etat, v.octets, "o");
for (const [t, o] of Object.entries(rapport.ombres)) console.log("ombre", t, "ΔE", o.deltaE, "×", o.rapport_a_la_peau_actuelle);
