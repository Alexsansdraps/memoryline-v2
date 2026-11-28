// Mesure des gabarits nus, rang par rang, pour poser un bas UNIQUE par famille.
// Pour chaque corps et chaque rang y (lu au milieu du pixel) :
//   aG / aD : limite que le bas ne doit pas franchir (main, avant-bras), -Infinity / +Infinity sinon ;
//   cG / cD : bord du bassin à couvrir.
// Le bord du bas de la famille vaut, à gauche, max(min des cG, max des aG) : on couvre le bassin
// le plus large sans jamais toucher la main du corps le plus fin.
import { readFileSync } from "node:fs";
import { aplatir, intervallesY } from "./geom.mjs";

export const FAMILLES = {
  femme: {
    prefixe: "Female", axe: 250, taille: 732, haut: 717, assise: 875,
    corps: [["gabarit-dos-femme-standard-v2.svg", "gabarit-dos-femme-standard.svg"], ["gabarit-dos-femme-fine.svg"], ["gabarit-dos-femme-ronde.svg"], ["gabarit-dos-femme-agee.svg"]],
    source: "Female_2", habits: "Female_Clothes_2", basOrigine: "Female_Bottoms_2",
    ombreBras: 0, modes: ["pendante", "pendante"], finCotes: 0.92, revers: [0.8, 1],
  },
  homme: {
    prefixe: "Male", axe: 250, taille: 703, haut: 688, assise: 865,
    corps: [["gabarit-dos-homme-standard-v2.svg", "gabarit-dos-homme-standard.svg"], ["gabarit-dos-homme-mince.svg"], ["gabarit-dos-homme-rond.svg"], ["gabarit-dos-homme-age.svg"]],
    source: "Male_2", habits: "Male_Clothes_2", basOrigine: "Male_Bottoms_2",
    ombreBras: 1, modes: ["homme", "homme"], finCotes: 0.64, revers: [0.86, 1],
  },
  enfant: {
    prefixe: "Boy", axe: 250, taille: 672, haut: 657, assise: 778,
    corps: [["gabarit-dos-enfant-standard-v2.svg", "gabarit-dos-enfant-standard.svg"], ["gabarit-dos-enfant-fin.svg"], ["gabarit-dos-enfant-rond.svg"]],
    source: "Boys_2", habits: "Boy_Clothes_2", basOrigine: "Boy_Bottoms_2",
    ombreBras: 0, modes: ["pendante", "pendante"], finCotes: 0.88, revers: [0.76, 1],
  },
  ado: {
    prefixe: "Teenage_Boy", axe: 275.7, taille: 677, haut: 662, assise: 821,
    corps: [["gabarit-dos-ado-standard-v2.svg", "gabarit-dos-ado-standard.svg"], ["gabarit-dos-ado-fin.svg"]],
    source: "Teenage_Boys_1", habits: "Teenage_Boy_Clothes_1", basOrigine: "Teenage_Boy_Bottoms_1",
    ombreBras: 1, modes: ["ado-gauche", "pendante"], finCotes: 0.62, revers: [0.8, 1],
  },
};

const chemins = (svg, cls) => [...svg.matchAll(new RegExp(`<path class="${cls}" d="([^"]*)"`, "g"))].map((m) => m[1]);
const miroirIv = (iv) => iv.map(([a, b]) => [500 - b, 500 - a]).reverse();

/** Données brutes d'un corps : intervalles du corps et du pli du bras, rang par rang (côté gauche ou miroir). */
function rangs(svg, F, miroir) {
  const corps = aplatir(chemins(svg, "st0")[0], 24);
  const pli = aplatir(chemins(svg, "st1")[F.ombreBras], 24);
  const axe = miroir ? 500 - F.axe : F.axe;
  const out = [];
  for (let y = F.haut; y < F.assise; y++) {
    let c = intervallesY(corps, y + 0.5), p = intervallesY(pli, y + 0.5);
    if (miroir) { c = miroirIv(c); p = miroirIv(p); }
    p = p.filter(([a, b]) => (a + b) / 2 < axe - 20);
    out.push({ y, corps: c, pli: p.length ? p[p.length - 1] : null, axe });
  }
  return out;
}

/** Limites d'un côté (toujours exprimé comme le côté gauche). */
function cote(R, mode, F) {
  const n = R.length, a = new Array(n).fill(-Infinity), c = new Array(n).fill(null), libre = new Array(n).fill(false);
  const bordG = (r) => r.corps.length ? r.corps[0][0] : null;
  if (mode === "pendante") {
    // Main le long du corps : pli du bras jusqu'à sa pointe, puis droite jusqu'au creux sous la main.
    // Le creux est le coin du dessin où le bas de la main rejoint la hanche : le premier rang, après la
    // pointe, où le bord cesse de rentrer vite (moins de 0,5 px par rang). Prendre le bord le plus
    // rentré sur 45 rangs, comme avant, tombait bien plus bas chez l'enfant, dont la hanche rentre
    // encore doucement sous la main : toute la hanche de l'enfant rond passait pour de la main et
    // restait nue (7 px de peau de y 694 à 737).
    let fin = -1; for (let i = 0; i < Math.min(n, 90); i++) if (R[i].pli) fin = i;
    const pointe = R[fin].pli[1];
    let creux = fin;
    for (let i = fin; i + 1 < Math.min(n, fin + 45); i++) {
      const g0 = bordG(R[i]), g1 = bordG(R[i + 1]);
      if (g0 === null || g1 === null) break;
      creux = i;
      if (g1 - g0 < 0.5) break;
    }
    const xc = bordG(R[creux]);
    for (let i = 0; i < n; i++) {
      if (i <= fin) a[i] = R[i].pli ? R[i].pli[1] : pointe;
      else if (i < creux) a[i] = pointe + (xc - pointe) * (i - fin) / (creux - fin);
      if (i < creux) c[i] = a[i]; else c[i] = bordG(R[i]);
    }
  } else if (mode === "homme") {
    // Avant-bras sur les côtés, mains à plat sur l'assise. Entre les deux, le bord n'est pas dessiné :
    // c'est le bas qui le fait (rangs « libres », bord commun de la famille).
    let fin = -1; for (let i = 0; i < Math.min(n, 80); i++) if (R[i].pli) fin = i;
    const main = (r) => r.corps.length >= 2 && r.corps[0][1] < r.axe - 60;
    let split = -1; for (let i = 0; i < n; i++) if (main(R[i]) && R[i].corps[0][1] - R[i].corps[0][0] > 4) { split = i; break; }
    for (let i = 0; i < n; i++) {
      if (i <= fin) { a[i] = R[i].pli[1]; c[i] = a[i]; }
      else if (split >= 0 && i >= split && main(R[i])) {
        const k = R[i].corps.findIndex(([x0, x1]) => x1 > R[i].axe - 60);
        a[i] = R[i].corps[k - 1][1]; c[i] = R[i].corps[k][0];
      } else if (split >= 0 && i >= split) { c[i] = bordG(R[i]); }
      else if (split >= 0 && i >= split - 22) { a[i] = R[split].corps[0][1]; libre[i] = true; }
      else libre[i] = true;
    }
  } else if (mode === "ado-gauche") {
    // Bras gauche tendu jusqu'à la main posée sur l'assise : pli du bras, puis écart main / bassin.
    for (let i = 0; i < n; i++) {
      const r = R[i];
      if (r.corps.length >= 2 && r.corps[0][1] < r.axe - 60) { const k = r.corps.findIndex(([, x1]) => x1 > r.axe - 60); a[i] = r.corps[k - 1][1]; c[i] = r.corps[k][0]; }
      else if (r.pli) { a[i] = r.pli[1]; c[i] = a[i]; }
      else c[i] = bordG(r);
    }
  }
  return { a, c, libre };
}

/** Bord gauche du bas d'origine (rangs) pour les rangs libres des hommes. */
function bordOrigine(F, miroir) {
  const svg = readFileSync(new URL(`./orig/${F.source}.svg`, import.meta.url), "utf8");
  const g = svg.match(new RegExp(`<g id="${F.basOrigine}">([\\s\\S]*?)</g>`))[1];
  const d = [...g.matchAll(/<path d="([^"]*)"[^>]*class="st2"/g)][0][1].replace(/\s+/g, " ");
  const polys = aplatir(d, 24);
  const out = [];
  for (let y = F.haut; y < F.assise; y++) {
    let iv = intervallesY(polys, y + 0.5);
    if (miroir) iv = miroirIv(iv);
    out.push(iv.length ? iv[0][0] : null);
  }
  return out;
}

/**
 * Lissage d'un bord (côté gauche, x croissant vers l'intérieur) entre deux bornes dures : lo, qu'il ne
 * franchit jamais vers l'extérieur (une main), et hi, qu'il ne franchit jamais vers l'intérieur (un
 * bassin dessiné à couvrir). Quand elles se croisent, la main l'emporte. Ressort discret : chaque rang
 * tire vers la moyenne de ses voisins et, un peu, vers sa valeur de départ ; les transitions s'étalent
 * sur une quinzaine de rangs.
 */
function lisserBord(x0, lo, hi, poids = 0.003, tours = 6000) {
  const n = x0.length;
  const bas = lo.map((v) => (v === -Infinity ? -1e9 : v));
  const haut = hi.map((v, i) => Math.max(v === Infinity ? 1e9 : v, bas[i]));
  let x = x0.map((v, i) => Math.min(haut[i], Math.max(bas[i], v)));
  for (let t = 0; t < tours; t++) {
    const y = x.slice();
    for (let i = 1; i < n - 1; i++) {
      const v = poids * x0[i] + (1 - poids) * (x[i - 1] + x[i + 1]) / 2;
      y[i] = Math.min(haut[i], Math.max(bas[i], v));
    }
    x = y;
  }
  return x;
}

/** Mesure toute une famille : bords du pantalon, détail par corps pour le contrôle. */
export function mesurerFamille(nomFam, dossierRef) {
  const F = FAMILLES[nomFam];
  const corps = F.corps.map(([nom, ref]) => ({ nom, ref: ref || nom, svg: readFileSync(dossierRef + (ref || nom), "utf8") }));
  const cotes = [0, 1].map((s) => {
    const miroir = s === 1;
    const parCorps = corps.map((b) => { const R = rangs(b.svg, F, miroir); return { R, ...cote(R, F.modes[s], F) }; });
    const n = parCorps[0].R.length;
    // Bornes vraies, avant de remplir les rangs libres : lo = la main ou le pli le plus rentré (le bord
    // ne passe jamais au-delà, vers l'extérieur), hi = le bassin le plus large (le bord n'a pas à
    // rentrer plus loin), seulement là où un bassin est dessiné.
    const lo = [], hi = [];
    for (let i = 0; i < n; i++) {
      const amax = Math.max(...parCorps.map((p) => p.a[i]));
      lo.push(amax > -Infinity ? amax + 0.4 : -Infinity);
      hi.push(parCorps.some((p) => p.libre[i]) ? Infinity : Math.min(...parCorps.map((p) => p.c[i] ?? Infinity)) - 0.6);
    }
    // Rangs libres (hommes) : le bord est celui du bas d'origine, jamais en deçà des plis de bras.
    if (F.modes[s] === "homme") {
      const orig = bordOrigine(F, miroir);
      for (let i = 0; i < n; i++) {
        if (!parCorps.some((p) => p.libre[i])) continue;
        let x = orig[i] ?? -Infinity;
        for (const p of parCorps) if (!p.libre[i]) x = Math.max(x, p.a[i]);
        for (const p of parCorps) if (p.libre[i]) {
          if (p.a[i] === -Infinity) { p.a[i] = x; p.c[i] = x; } else { p.c[i] = Math.max(p.a[i], x); }
        }
      }
    }
    const bordFam = [], contrainte = [];
    for (let i = 0; i < n; i++) {
      const cmin = Math.min(...parCorps.map((p) => p.c[i] ?? Infinity));
      const amax = Math.max(...parCorps.map((p) => p.a[i]));
      const libre = parCorps.some((p) => p.libre[i]);
      // Un demi-pixel de recouvrement contre le liseré de peau, sauf contre une main.
      let x = cmin - (libre ? 0 : 0.6);
      if (amax > -Infinity) x = Math.max(x, amax + 0.4);
      bordFam.push(x); contrainte.push(amax);
    }
    // Hommes : le bord sautait de 6 px à la fin du pli du bras (y 725), rentrait d'un coup de 13 px
    // au-dessus de la main (y 800-814) et faisait un cran à la pointe de la main (y 838) ; on le voyait
    // sous l'ourlet des hauts. On le lisse entre ses deux bornes dures (cf. lisserBord) : il ne passe
    // jamais sur une main et ne découvre aucun bassin dessiné de plus qu'avant, seuls les rangs
    // libres (où le bord du bas EST la limite du bassin) bougent.
    if (F.modes[s] === "homme") {
      const lisse = lisserBord(bordFam, lo, hi);
      for (let i = 0; i < n; i++) bordFam[i] = lisse[i];
    }
    for (let i = 0; i < n; i++) {
      if (!parCorps.some((p) => p.libre[i])) continue;
      for (const p of parCorps) if (p.libre[i]) { p.a[i] = bordFam[i] - 0.4; p.c[i] = bordFam[i]; }
    }
    return { parCorps, bordFam, contrainte };
  });
  const n = cotes[0].bordFam.length;
  const L = cotes[0].bordFam, R = cotes[1].bordFam.map((x) => 500 - x);
  // Par corps, pour le contrôle : bornes de couverture et de main, en x réels.
  const parCorps = corps.map((b, k) => {
    const g = cotes[0].parCorps[k], d = cotes[1].parCorps[k];
    return {
      nom: b.nom, ref: b.ref, svg: b.svg,
      rangs: Array.from({ length: n }, (_, i) => ({
        y: F.haut + i,
        cG: g.c[i], cD: d.c[i] === null ? null : 500 - d.c[i],
        aG: g.a[i], aD: d.a[i] === -Infinity ? Infinity : 500 - d.a[i],
      })),
    };
  });
  return { F, L, R, parCorps };
}

/** Cadre lissé intérieur (pour les motifs) à partir des bords vrais. */
export function cadre(L, R, fen = 22, moy = 14) {
  const n = L.length;
  const run = (arr, f) => arr.map((_, i) => { let m = arr[i]; for (let d = -fen; d <= fen; d++) { const j = i + d; if (j >= 0 && j < n) m = f(m, arr[j]); } return m; });
  const lis = (arr) => arr.map((_, i) => { let s = 0, c = 0; for (let d = -moy; d <= moy; d++) { const j = Math.min(n - 1, Math.max(0, i + d)); s += arr[j]; c++; } return s / c; });
  const Lf = lis(run(L, Math.max)).map((x, i) => Math.max(x, L[i]));
  const Rf = lis(run(R, Math.min)).map((x, i) => Math.min(x, R[i]));
  return { Lf, Rf };
}
