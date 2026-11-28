// Patron d'un haut sur l'enveloppe d'une famille (27/11).
// Le contour se lit dans l'ordre : encolure (de gauche à droite), côté droit en
// descendant, ourlet (de droite à gauche), côté gauche en remontant.
//   - au-dessus de la fin de manche : l'enveloppe des corps, plus une marge ;
//   - fin de manche : un bord légèrement en biais, comme sur les pièces d'origine ;
//   - sous la manche : le bord du torse (pli des bras, ligne des mains, puis hanches).

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * o.manche : "courte" | "longue" | "34" | "aucune"
 * o.marge : écart à l'enveloppe ; o.bombe(y) : gonflant en plus (doudoune)
 * o.hs, o.hc : ourlet au bord et au milieu (y) ; o.robe : descend jusqu'à l'assise
 * o.ns, o.nc : encolure au bord et au milieu ; o.colHaut : haut d'un col montant
 */
export function patron(F, o) {
  const m = o.marge ?? 1.5;
  const bombe = o.bombe ?? (() => 0);
  const ns = o.ns ?? F.encSide, nc = o.nc ?? F.enc - 1;
  const hs = o.hs, hc = o.hc ?? hs;
  const yNeckTop = o.colHaut ?? ns;
  const pas = 1;
  const evase = o.evase ?? (() => 0);
  const yLim = o.robe ? (o.limRobe ?? F.rasAssise) : 999;

  const ysDe = (cote) => {
    if (o.manche === "longue") return F.poignet[cote] - 2;
    if (o.manche === "34") return o.ys34 ?? Math.round((F.mancheCourte + F.poignet[cote]) / 2 + 10);
    if (o.manche === "courte") return o.ys ?? F.mancheCourte;
    return null;
  };
  const dy = o.biais ?? (o.manche === "courte" ? 12 : 6);

  // bord extérieur et bord du torse, côté s (-1 gauche, +1 droite)
  const cote = (s) => {
    const nom = s < 0 ? "g" : "d";
    const env = s < 0 ? F.envG : F.envD;
    const torse0 = s < 0 ? F.torseG : F.torseD;
    const torse = (y) => torse0(Math.min(y, yLim), m) + s * evase(y);
    const ext = (y) => {
      // col montant : on suit le cou
      const mm = y < ns ? (o.margeCou ?? 3) : m;
      return env(y) + s * (mm + bombe(y));
    };
    const ys = ysDe(nom);
    const pts = [];
    if (o.manche === "aucune") {
      const yAH = o.emmanchureY ?? (F.aisselleMax + 12);
      const xH = F.cx + s * (o.bretelle ?? 70);
      const xB = torse(yAH);
      const AH = (y) => { const u = Math.max(0, Math.min(1, (y - ns) / (yAH - ns))); return lerp(xH, xB, 1 - (1 - u) * (1 - u)); };
      for (let y = yNeckTop; y <= hs; y += pas) {
        const x = y < yAH ? (s < 0 ? Math.max(ext(y), AH(y)) : Math.min(ext(y), AH(y))) : torse(y);
        pts.push([x, y]);
      }
      return { pts, ys: null, ext, torse, AH, yAH };
    }
    const yb = ys - dy;
    // manche plus longue que le haut : sous l'ourlet, elle pend seule le long du bras
    const brasInt = s < 0 ? F.brasG : F.brasD;
    const inner = (y) => (ys > hs && y >= hs ? brasInt(y) : torse(y));
    for (let y = yNeckTop; y < yb; y += pas) pts.push([ext(y), y]);
    const xa = ext(yb), xb = inner(ys);
    for (let k = 0; k <= 6; k++) pts.push([lerp(xa, xb, k / 6), lerp(yb, ys, k / 6)]);
    if (ys <= hs) for (let y = ys + pas; y <= hs; y += pas) pts.push([inner(y), y]);
    else for (let y = ys - pas; y >= hs; y -= pas) pts.push([inner(y), y]);
    if (pts[pts.length - 1][1] !== hs) pts.push([inner(hs), hs]);
    return { pts, ys, ext, torse, inner, yb };
  };
  const G = cote(-1), D = cote(1);

  // encolure
  const xg = G.pts[0][0], xd = D.pts[0][0];
  const cxN = o.cxCol ?? F.cx;
  const neckY = (x) => {
    const t = (x - cxN) / ((x < cxN ? cxN - xg : xd - cxN) || 1);
    return yNeckTop + (nc - ns) * Math.pow(Math.max(0, 1 - t * t), 1.1);
  };
  const neck = [];
  for (let x = xg; x <= xd; x += 2) neck.push([x, neckY(x)]);
  neck.push([xd, neckY(xd)]);

  // ourlet
  const hg = G.pts[G.pts.length - 1][0], hd = D.pts[D.pts.length - 1][0];
  const cxH = (hg + hd) / 2, demi = (hd - hg) / 2;
  const formeOurlet = o.formeOurlet ?? ((t) => Math.pow(Math.max(0, 1 - t * t), 0.7));
  const hemY = (x) => hs + (hc - hs) * formeOurlet((x - cxH) / demi);
  const hem = [];
  for (let x = hd; x >= hg; x -= 2) hem.push([x, hemY(x)]);
  hem.push([hg, hemY(hg)]);

  const contour = [...neck.slice(0, -1), ...D.pts, ...hem.slice(1, -1), ...[...G.pts].reverse().slice(0, -1)];
  return { F, o, contour, neck, neckY, hem, hemY, G, D, ns, nc, hs, hc, yNeckTop, xg, xd, hg, hd };
}
