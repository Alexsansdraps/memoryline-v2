// Rendu de contrôle des familles du 28/11 sur le ciel étoilé (portrait, ciel de cette nuit) :
// 4 nouvelles scènes en tailles s, m, l ; des anciennes posées à côté des nouvelles ; 8 scènes
// texte en bas (plafond). Pour chaque rendu : l'échelle (px par cm), où tombe chaque scène, et,
// au pixel près (le groupe des ombres rendu seul), que rien ne sort de l'image ni ne passe le
// plafond des têtes.
// Lancer depuis apps/api :
//   DATABASE_URL=postgres://e:e@127.0.0.1:1/e npx tsx ../../travaux/ombres/rendu-ciel-familles.mts <dossier des rendus>
// Écrit travaux/ombres/controle-ciel-familles.jpg (les bandes du bas, plafond en rouge) et, dans
// <dossier des rendus>, chaque ciel entier en JPEG.
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const racine = resolve(process.cwd(), "..", "..");
const dossier = resolve(process.argv[2] ?? resolve(racine, "travaux/ombres/rendus"));
mkdirSync(dossier, { recursive: true });
const ciel = await import(pathToFileURL(resolve(racine, "apps/api/src/ciel.ts")).href);
const { SILHOUETTES_ASSISES_PAR_ID } = await import(pathToFileURL(resolve(racine, "apps/api/src/ciel-silhouettes-assises.ts")).href);
const sharp = createRequire(resolve(racine, "apps/api/package.json"))("sharp");
const W: number = ciel.LARGEUR_CIEL;
const H: number = ciel.HAUTEUR_CIEL;
const instant = new Date(Date.UTC(2025, 5, 14, 21, 10));

type Rendu = { nom: string; ids: string[]; taille?: "s" | "m" | "l"; texte?: "haut" | "bas"; hauteurTexte?: number };
const QUATRE = ["maman-deux-filles", "papa-garcon", "parents-fille", "papa-enfant-chien"];
const rendus: Rendu[] = [
  ...(["s", "m", "l"] as const).map((taille) => ({ nom: `4 nouvelles, taille ${taille}`, ids: QUATRE, taille, hauteurTexte: 0.1 })),
  { nom: "anciennes seules (homme-court, femme-longs) à côté de nouvelles, m", ids: ["homme-court", "papa-deux-garcons", "femme-longs", "maman-deux-garcons"], taille: "m", hauteurTexte: 0.1 },
  { nom: "anciennes familles (famille-homme-bebe-femme, famille-quatre) à côté de nouvelles, m", ids: ["famille-homme-bebe-femme", "parents-garcon", "famille-quatre", "parents-fille-garcon"], taille: "m", hauteurTexte: 0.1 },
  { nom: "ancien couple et ancienne scène animal à côté de nouvelles, l", ids: ["couple-homme-femme", "maman-fille-garcon", "homme-chien", "papa-trois-enfants-chat"], taille: "l", hauteurTexte: 0.1 },
  {
    nom: "8 scènes, texte en bas, l (dont 2 retournées)",
    ids: ["parents-fille-garcon", "parents-deux-garcons-chat:m", "parents-trois-enfants", "maman-fille-deux-garcons", "deux-mamans-fille-garcon:m", "papa-trois-enfants-chat", "maman-deux-filles-garcon", "deux-mamans-fille"],
    taille: "l",
    texte: "bas",
  },
  { nom: "2 nouvelles, texte en haut, l", ids: ["maman-trois-garcons", "deux-mamans-garcon"], taille: "l", texte: "haut" },
];

const groupeDe = (svg: string) => svg.match(/<g fill="[^"]*" data-silhouettes="1">(.*?)<\/g>/)?.[1] ?? "";
const bandes: { png: Buffer; legende: string[]; y0: number; plafond: number }[] = [];
let problemes = 0;
for (const r of rendus) {
  const svg: string = ciel.svgDuCiel(47.75, 7.34, instant, undefined, {
    silhouettes: r.ids,
    tailleSilhouettes: r.taille,
    ...(r.texte ? { texte: r.texte } : {}),
    ...(r.hauteurTexte !== undefined ? { hauteurTexte: r.hauteurTexte } : {}),
  });
  // Le plafond appliqué (mêmes règles que silhouettesDuCiel).
  const plafond =
    r.hauteurTexte !== undefined
      ? (ciel.basDeLaPlace(true) + 0.005) * H
      : r.texte === "bas"
        ? ciel.plafondDesSilhouettes("nuit", false) * H
        : (ciel.dispositionDuCiel("nuit", "haut", false, true).bas + 0.015) * H;
  const groupe = groupeDe(svg);
  const chemins = [...groupe.matchAll(/<path transform="translate\(([-\d.]+) ([-\d.]+)\) scale\((-?[\d.]+)(?: ([\d.]+))?\)" d="([^"]+)"\/>/g)];
  if (chemins.length !== r.ids.length) throw new Error(`${r.nom} : ${chemins.length} chemins pour ${r.ids.length} scènes`);
  const lignes: string[] = [];
  let echelle = 0;
  chemins.forEach((m, i) => {
    const [id, sens] = r.ids[i]!.split(":");
    const s = SILHOUETTES_ASSISES_PAR_ID.get(id!)!;
    if (s.d !== m[5]) throw new Error(`${r.nom} : le tracé n° ${i} n'est pas ${id}`);
    const k = Math.abs(Number(m[3]));
    echelle = k;
    const x = Number(m[1]);
    const g = sens === "m" ? x - s.droite * k : x + s.gauche * k;
    const d = sens === "m" ? x - s.gauche * k : x + s.droite * k;
    lignes.push(`${id}${sens ? " (retournée)" : ""} : x ${g.toFixed(0)} à ${d.toFixed(0)}, sommet ${(Number(m[2]) + s.haut * k).toFixed(0)}`);
  });
  // Au pixel près : le groupe des ombres seul, sur fond transparent, à la taille du ciel.
  const seul = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g fill="#000">${groupe}</g></svg>`;
  const { data, info } = await sharp(Buffer.from(seul)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const ok = x0 >= 0 && x1 < W && y0 >= Math.floor(plafond) && y1 < H;
  if (!ok) problemes++;
  const largeurCm = r.ids.reduce((t, id) => {
    const s = SILHOUETTES_ASSISES_PAR_ID.get(id.split(":")[0]!)!;
    return t + s.droite - s.gauche;
  }, 0) + 6 * (r.ids.length - 1);
  const legende = [
    `${bandes.length + 1}. ${r.nom} : ${r.ids.join(", ")}`,
    `${echelle.toFixed(3)} px/cm, un adulte de 90 cm = ${(90 * echelle).toFixed(0)} px (taille demandée ` +
      `${((H * 0.22 * (r.taille === "s" ? 0.8 : r.taille === "l" ? 1.25 : 1)) / 175).toFixed(3)} px/cm ; groupe de ` +
      `${largeurCm.toFixed(0)} cm = ${(((largeurCm * echelle) / W) * 100).toFixed(1)} % de la largeur, 92 % au plus)`,
    `pixels des ombres : x ${x0} à ${x1} sur ${W}, y ${y0} à ${y1} sur ${H}, plafond des têtes ${plafond.toFixed(0)} (en rouge) : ` +
      `${ok ? "rien ne dépasse" : "DÉPASSE"}`,
  ];
  const resume = legende.join(" — ");
  console.log(resume);
  for (const l of lignes) console.log("   ", l);
  const fichier = resolve(dossier, `ciel-${bandes.length + 1}.jpg`);
  const image = sharp(Buffer.from(svg));
  await image.clone().jpeg({ quality: 85 }).toFile(fichier);
  // La bande du bas (le plafond est tracé en rouge sur la planche), éclaircie pour qu'on lise
  // les ombres, sombres sur le ciel sombre du thème Nuit.
  const haut = Math.max(0, Math.floor(plafond) - 120);
  const bande = await sharp(await image.clone().extract({ left: 0, top: haut, width: W, height: H - haut }).png().toBuffer())
    .resize({ width: 1240 })
    .modulate({ brightness: 2.2 })
    .png()
    .toBuffer();
  bandes.push({ png: bande, legende, y0: haut, plafond });
}

// La planche : les bandes l'une sous l'autre, avec leur légende.
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
let y = 20;
let corps = "";
for (const b of bandes) {
  const meta = await sharp(b.png).metadata();
  corps += `<text x="20" y="${y + 20}" font-family="Arial" font-size="17" font-weight="bold">${esc(b.legende[0]!)}</text>`;
  corps += `<text x="20" y="${y + 42}" font-family="Arial" font-size="14" fill="#444">${esc(b.legende[1]!)}</text>`;
  corps += `<text x="20" y="${y + 62}" font-family="Arial" font-size="14" fill="#444">${esc(b.legende[2]!)}</text>`;
  corps += `<image x="20" y="${y + 74}" width="${meta.width}" height="${meta.height}" href="data:image/png;base64,${b.png.toString("base64")}"/>`;
  const yp = y + 74 + ((b.plafond - b.y0) * meta.width!) / W;
  corps += `<line x1="20" x2="${20 + meta.width!}" y1="${yp}" y2="${yp}" stroke="#e33" stroke-width="1.5" stroke-dasharray="9 5"/>`;
  y += 74 + meta.height! + 30;
}
const titre =
  `<text x="20" y="34" font-family="Arial" font-size="22" font-weight="bold">Familles du 28/11 sur le ciel étoilé (portrait, rendu de l'API)</text>` +
  `<text x="20" y="58" font-family="Arial" font-size="14" fill="#444">Bas de chaque affiche, éclairci ×2,2 pour la lecture ; ` +
  `les mêmes px/cm pour toutes les scènes d'un ciel (poserSilhouettes).</text>`;
y += 50;
const planche = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${y}"><rect width="100%" height="100%" fill="#fff"/>${titre}<g transform="translate(0 50)">${corps}</g></svg>`;
await sharp(Buffer.from(planche)).jpeg({ quality: 84 }).toFile(resolve(racine, "travaux/ombres/controle-ciel-familles.jpg"));
writeFileSync(resolve(dossier, "rendus.txt"), bandes.map((b) => b.legende.join(" — ")).join("\n") + "\n");
console.log(problemes ? `${problemes} rendu(s) où ça dépasse` : "aucun dépassement", "->", resolve(racine, "travaux/ombres/controle-ciel-familles.jpg"));
process.exit(problemes ? 1 : 0);
