// Description des gabarits (27/11) : points d'accroche en coordonnées du cadre 500×1000.
// Alexandra : « et pas de calage sur les nouveaux ».
import { readFileSync, writeFileSync } from "node:fs";
const [mesures, sortie] = process.argv.slice(2);
const res = JSON.parse(readFileSync(mesures, "utf8"));
const familles = {};
for (const r of res) (familles[r.d.famille] ||= []).push(r);

const humain = (f) => ["femme", "homme", "enfant", "ado", "bebe"].includes(f);
const out = {
  date: "2026-11-27",
  cadre: { largeur: 500, hauteur: 1000, viewBox: "0 0 500 1000", axe_x: 250 },
  regles: [
    "Tous assis, de dos. Un gabarit = un corps nu (peau .st0 + ombres noires à 15 % .st1), un seul groupe <Préfixe>_Base_N.",
    "Une pièce (coiffure, haut, bas, accessoire) se dessine UNE fois par famille, plein cadre 500×1000, aux coordonnées ci-dessous, et tombe juste sur tous les gabarits de la famille : aucun calage (slot_adjust vide).",
    "Dans une famille, la tête, le crâne, le cou (hors voûte des âgés) et la ligne d'assise sont IDENTIQUES au pixel près ; seules la taille, les hanches, les bras et la voûte du haut du dos varient.",
    "Un haut doit couvrir l'enveloppe de la famille entre la ligne d'encolure (encolure_haute_y, imposée par le gabarit âgé) et la taille ; un bas doit couvrir l'enveloppe entre la taille et l'assise. Hors de l'enveloppe, la peau du gabarit se voit (avant-bras, mains).",
    "Réglages des personnages : bottom_pct = assise_y / 1000, facteur_taille = 1, decalage_x = 0, slot_adjust = {}.",
  ],
  familles: {},
  gabarits: [],
};
for (const [fam, rs] of Object.entries(familles)) {
  const ref = rs.find((r) => r.d.morpho === "standard" || r.d.morpho === "couche") || rs[0];
  const m = ref.m;
  // enveloppe : union, ligne par ligne (tous les 10 px), des corps de la famille
  const env = [];
  for (let y = 0; y < 1000; y += 10) {
    let g = 9999, d = -1;
    for (const r of rs) { const l = r.m.lignes[y]; if (l) { g = Math.min(g, l[0]); d = Math.max(d, l[1]); } }
    if (d >= 0) env.push([y, g, d]);
  }
  const F = {
    gabarits: rs.map((r) => r.d.fichier),
    assise_y: m.bas,
    bottom_pct: +(m.bas / 1000).toFixed(4),
    crane_y: m.haut,
    enveloppe: env,
  };
  if (humain(fam) && fam !== "bebe") {
    Object.assign(F, {
      tete: { y_plus_large: m.teteY, x: m.tete, largeur: m.teteW },
      cou: { y: m.couY, x: m.cou, largeur: m.couW },
      naissance_epaules_y: m.epY,
      encolure_haute_y: Math.min(...rs.map((r) => r.m.epY)),
      epaules_x: m.ep,
    });
    if (ref.pieces) {
      F.reperes_pieces_du_dessin_source = {
        source: ref.d.source,
        coiffure_y: ref.pieces.coiffure && [ref.pieces.coiffure.haut, ref.pieces.coiffure.bas],
        haut_y: ref.pieces.haut && [ref.pieces.haut.haut, ref.pieces.haut.bas],
        bas_y: ref.pieces.bas && [ref.pieces.bas.haut, ref.pieces.bas.bas],
        accessoire_y: ref.pieces.accessoire && [ref.pieces.accessoire.haut, ref.pieces.accessoire.bas],
      };
      F.taille_y = ref.pieces.bas ? ref.pieces.bas.haut : null;
    }
    F.largeur_au_ras_de_l_assise = { y: m.bas - 15, x: m.lignes[Math.floor((m.bas - 15) / 10) * 10] };
  }
  if (fam === "bebe") Object.assign(F, { tete: { y_plus_large: m.teteY, x: m.tete, largeur: m.teteW } });
  out.familles[fam] = F;
}
// repères propres aux animaux (collier, crinière, oreilles)
const ajoutAnimal = {
  "grand-chien": { collier: { y: [366, 379], x: [197, 305], note: "position du collier de Big_Dog (pièce Accessories)" } },
  "petit-chien": { collier: { y: [469, 474], x: [215, 261], note: "position du collier de Small_Dog" } },
  chat: { collier: "voir Cat_Collar_1 de Cat_1.svg : mêmes coordonnées" },
  cheval: { posture: "couché de dos, pattes repliées (exception à « assis » : un cheval ne s'assoit pas)", nuque: { y: [246, 382], x: [184, 316] }, oreilles_y: [194, 268], encolure: { y: [352, 600], x_haut: [194, 306], x_bas: [170, 330] }, croupe: { y: [540, 822], x: [82, 418] }, queue: { y: [564, 818], x: [226, 276] } },
  lapin: { tete: { y: [452, 526], x: [208, 292] }, oreilles_y: [372, 472], corps: { y: [508, 625], x: [170, 330] }, queue: { centre: [250, 605], rayon: 17 } },
};
for (const [k, v] of Object.entries(ajoutAnimal)) if (out.familles[k]) Object.assign(out.familles[k], v);

for (const r of res) {
  out.gabarits.push({
    fichier: r.d.fichier,
    url: "/assets/" + r.d.fichier,
    famille: r.d.famille,
    nom: r.d.nom,
    morphologie: r.d.morpho,
    groupe: r.d.idGroupe,
    dessin_source: r.d.source || "dessiné à la main",
    base_color_zones: r.d.zones,
    orientation: "back",
    bottom_pct: +(r.m.bas / 1000).toFixed(4),
    facteur_taille: 1,
    decalage_x: 0,
    slot_adjust: {},
    mesures: { haut: r.m.haut, bas: r.m.bas, tete: r.m.tete, cou: r.m.cou, cou_y: r.m.couY, naissance_epaules_y: r.m.epY },
  });
}
writeFileSync(sortie, JSON.stringify(out, null, 1));
console.log(Object.entries(out.familles).map(([k, v]) => `${k}: ${v.gabarits.length} | assise ${v.assise_y} | crane ${v.crane_y} | encolure ${v.encolure_haute_y ?? "-"} | taille ${v.taille_y ?? "-"}`).join("\n"));
