"""Planche A des familles d'Alexandra (28/11 vers 1 h 30 : « il faut que tu
prennes ce qui n'existe pas encore [...] une femme avec 2 enfants, une femme
avec 2 filles, une femme avec 2 garçons, une femme avec un garçon et une
fille [...] Vraiment, être précis »).

Image : 1536 x 1024, 6 rangées de 5 scènes, silhouettes noires sur blanc,
une ombre portée noire (ellipse plate) au sol sous chaque groupe.

Même fabrication que decoupe-ombres.py / decoupe4.py :
- masque gris < 110 ;
- ombre portée retirée : on coupe à la « taille », la rangée la plus étroite
  entre le bas des jambes et l'ellipse de l'ombre (juste au-dessus de l'ombre) ;
- composantes connexes (8-connexité), poussières < 40 px retirées ;
- marching squares sur le masque lissé (gaussien 0,6), RDP 0,8 px (contour
  fermé coupé en deux au point le plus éloigné), Catmull-Rom -> Bézier
  (angles < 110° gardés pointus).
Trois retouches, mesurées sur les 30 cases (voir courbe()) : tangentes bornées
au tiers du segment (sinon les deux coins bas débordaient de 4 à 10 px),
points de contrôle jamais sous le sol (la base plongeait de 0,3 à 0,9 cm sous
y = 0), et base exactement sur y = 0 (les planches précédentes la posaient
0,3 cm au-dessus). gauche / droite / haut sont mesurés sur la courbe.
Échelle : la maman aux cheveux longs, présente dans les 30 cases, fait 90 cm
assise (du sol au sommet du crâne), mesurée dans SA case ; les autres
personnages gardent leur taille relative. Base (assise) sur y = 0, haut
négatif, axe x = 0 au milieu de l'emprise.

Usage : python decoupe-A.py <ombres-familles-a.png> <dossier planche-A> <controle-A.jpg> [diagnostic.png]
Écrit planche-A/case-r<rangée>c<colonne>.json (un objet par case) et la
planche de contrôle (case d'origine | tracé rendu, règle nonzero comme le
<path> du produit, mêmes pixels par cm que l'original). Résultat du 28/11 :
recouvrement tracé / masque >= 98,5 % dans chaque case, pire écart 2,2 px.
"""
import json
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage import measure

SRC, SORTIE, CONTROLE = sys.argv[1], sys.argv[2], sys.argv[3]
img = np.asarray(Image.open(SRC).convert('L')).astype(float)
H_IMG, W_IMG = img.shape
noir = img < 110
POUSSIERE = 40  # px : en dessous, ce n'est pas un morceau de silhouette
# (Essayé le 28/11 : un contour sous-pixel pris sur l'image en gris arrondit
# les petites têtes bouclées mais lisse aussi les mèches des cheveux ; gardé
# le masque binaire des planches précédentes.)

# Composition de chaque case, de gauche à droite, vue case par case en grand.
# (type, détail, x approximatif de la tête dans la boîte de la case) ; REF =
# la maman aux cheveux longs qui sert d'étalon (90 cm).
# Les rapports « × la maman » sont recalculés et imprimés par le script.
CASES = {
    'r1c1': ('probable', [('femme', 'cheveux longs ondulés', 73), ('fille', 'petite couette sur le côté', 126),
                          ('femme', 'chignon haut défait, mèches', 207)]),
    'r1c2': ('probable', [('femme', 'cheveux longs ondulés', 71), ('fille', 'cheveux longs', 132),
                          ('femme', 'chignon haut défait, mèches', 184), ('garcon', 'cheveux courts, épi', 251)]),
    'r1c3': ('probable', [('femme', 'cheveux longs ondulés', 73), ('garcon', 'cheveux courts', 130),
                          ('femme', 'chignon rond sur le dessus', 201)]),
    'r1c4': ('douteuse', [('fille', 'deux couettes', 45), ('femme', 'cheveux longs', 108),
                          ('fille', 'petites couettes basses', 174), ('femme', 'carré au menton, frange, profil', 223)]),
    'r1c5': ('douteuse', [('femme', 'cheveux longs ondulés', 82), ('garcon', 'cheveux courts', 137),
                          ('femme', 'boucles courtes volumineuses', 193)]),
    'r2c1': ('probable', [('femme', 'cheveux longs ondulés', 67), ('garcon', 'cheveux courts', 116),
                          ('fille', 'petite couette', 167), ('femme', 'chignon bas, profil', 226)]),
    'r2c2': ('probable', [('femme', 'cheveux longs ondulés', 71), ('fille', 'carré mi-long', 113),
                          ('garcon', 'cheveux courts', 158), ('homme', 'casquette à visière plate', 216)]),
    'r2c3': ('douteuse', [('femme', 'cheveux longs, tête penchée de profil', 68), ('garcon', 'cheveux courts', 113),
                          ('fille', 'cheveux mi-longs ondulés', 164), ('homme', 'cheveux courts bouclés, tête penchée', 210)]),
    'r2c4': ('douteuse', [('femme', 'cheveux longs ondulés', 68), ('garcon', 'cheveux courts', 117),
                          ('fille', 'couettes bouclées', 167), ('femme', 'cheveux mi-longs ramassés dans la nuque', 213)]),
    'r2c5': ('sure', [('fille', 'petite queue de cheval', 38), ('femme', 'cheveux longs', 95),
                      ('fille', 'cheveux longs', 154), ('homme', 'cheveux courts, profil', 208)]),
    'r3c1': ('probable', [('femme', 'cheveux longs ondulés', 73), ('fille', 'cheveux mi-longs bouclés', 129),
                          ('fille', 'cheveux mi-longs bouclés', 166), ('garcon', 'cheveux courts, grand frère', 208)]),
    'r3c2': ('probable', [('femme', 'cheveux longs, profil, main ou mèche devant le menton', 74), ('garcon', 'cheveux courts', 114),
                          ('garcon', 'cheveux courts', 157), ('garcon', 'cheveux courts, grand frère', 198)]),
    'r3c3': ('probable', [('femme', 'cheveux longs ondulés', 72), ('garcon', 'cheveux courts', 119),
                          ('fille', 'carré', 171), ('garcon', 'cheveux bouclés, grand frère', 222)]),
    'r3c4': ('douteuse', [('femme', 'cheveux longs ondulés', 79), ('enfant', 'boucles en boule jusqu\'au menton', 129),
                          ('garcon', 'cheveux courts en bataille, grand frère', 185)]),
    'r3c5': ('sure', [('femme', 'cheveux longs, profil', 79), ('fille', 'couettes basses', 143),
                      ('garcon', 'cheveux courts, grand frère', 197)]),
    'r4c1': ('probable', [('femme', 'cheveux longs ondulés', 80), ('fille', 'cheveux mi-longs ondulés', 140),
                          ('ado-garcon', 'cheveux bouclés', 200)]),
    'r4c2': ('sure', [('femme', 'cheveux longs ondulés', 68), ('fille', 'cheveux mi-longs', 115),
                      ('garcon', 'cheveux courts', 162), ('homme', 'cheveux courts', 208)]),
    'r4c3': ('sure', [('femme', 'cheveux longs ondulés', 79), ('fille', 'cheveux mi-longs', 130),
                      ('garcon', 'cheveux courts', 166), ('homme', 'cheveux courts, penché vers les enfants', 196)]),
    'r4c4': ('probable', [('femme', 'cheveux longs', 68), ('garcon', 'cheveux courts bouclés', 132),
                          ('fille', 'couettes', 196)]),
    'r4c5': ('probable', [('femme', 'cheveux longs ondulés', 82), ('fille', 'carré', 140),
                          ('ado-garcon', 'cheveux courts', 196)]),
    'r5c1': ('sure', [('femme', 'cheveux longs ondulés', 75), ('garcon', 'cheveux courts', 138),
                      ('garcon', 'cheveux courts', 178), ('garcon', 'cheveux courts, grand frère', 211)]),
    'r5c2': ('douteuse', [('femme', 'cheveux longs ondulés', 70), ('garcon', 'cheveux courts', 132),
                          ('ado-garcon', 'cheveux courts, profil, épaules d\'adulte', 194)]),
    'r5c3': ('sure', [('femme', 'cheveux longs ondulés', 72), ('garcon', 'cheveux courts', 126),
                      ('garcon', 'cheveux courts', 175)]),
    'r5c4': ('sure', [('femme', 'cheveux longs ondulés', 84), ('fille', 'cheveux mi-longs ondulés', 149),
                      ('fille', 'cheveux mi-longs ondulés', 195)]),
    'r5c5': ('douteuse', [('femme', 'cheveux longs ondulés', 77), ('enfant', 'cheveux courts, petite mèche ou couette dans la nuque', 138),
                          ('garcon', 'cheveux courts, grand frère', 187)]),
    'r6c1': ('douteuse', [('femme', 'cheveux longs ondulés', 80), ('enfant', 'oreilles de chat (serre-tête ou bonnet)', 140),
                          ('garcon', 'cheveux bouclés, grand frère', 198)]),
    'r6c2': ('probable', [('femme', 'cheveux longs ondulés', 79), ('fille', 'cheveux longs', 135),
                          ('femme', 'carré', 202)]),
    'r6c3': ('probable', [('femme', 'cheveux longs ondulés', 71), ('garcon', 'cheveux courts', 127),
                          ('garcon', 'tout-petit, cheveux courts', 167), ('garcon', 'cheveux courts, grand frère', 205)]),
    'r6c4': ('douteuse', [('femme', 'cheveux longs ondulés', 84), ('garcon', 'cheveux courts, épi', 130),
                          ('enfant', 'boucles en boule', 194)]),
    'r6c5': ('probable', [('femme', 'cheveux longs ondulés', 81), ('fille', 'cheveux longs', 133),
                          ('ado-garcon', 'cheveux bouclés en bataille', 202)]),
}
# La maman aux cheveux longs (étalon) est la 1re à gauche, sauf deux cases.
REF = {'r1c4': 1, 'r2c5': 1}


def segments(occ, trou_min=1, larg_min=1):
    """Plages True d'un vecteur booléen (fusion des trous < trou_min)."""
    segs, x, n = [], 0, len(occ)
    while x < n:
        if occ[x]:
            d = x
            while x < n and occ[x]:
                x += 1
            if segs and d - segs[-1][1] < trou_min:
                segs[-1][1] = x
            else:
                segs.append([d, x])
        else:
            x += 1
    return [s for s in segs if s[1] - s[0] >= larg_min]


# Rangées : bandes de lignes non vides ; cases : colonnes non vides dans la bande.
rangees = segments(noir.any(axis=1), trou_min=8, larg_min=60)
assert len(rangees) == 6, rangees
grille = []
for y0, y1 in rangees:
    cases = segments(noir[y0:y1].any(axis=0), trou_min=8, larg_min=40)
    assert len(cases) == 5, (y0, cases)
    grille.append(cases)


def rdp(points, eps):
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    ab = b - a
    n = np.hypot(*ab) or 1e-9
    v = points - a
    d = np.abs(ab[0] * v[:, 1] - ab[1] * v[:, 0]) / n
    i = int(np.argmax(d))
    if d[i] > eps:
        return np.vstack([rdp(points[: i + 1], eps)[:-1], rdp(points[i:], eps)])
    return np.vstack([a, b])


def courbe(pts):
    """Catmull-Rom fermé -> Bézier ; angles < 110° gardés pointus.

    Seule différence avec decoupe4.py : la tangente est bornée au tiers du
    segment qu'elle courbe. Sans cette borne, quand un segment très long (la
    base plate de l'assise) touche un segment court (le bas du genou), la
    tangente dépasse et le tracé déborde de 4 à 10 px aux deux coins bas
    (mesuré sur les 30 cases). Sur des segments réguliers, (p2 - p0) / 6 est
    déjà sous ce tiers : rien ne change ailleurs.
    """
    n = len(pts)
    out = [f"M{pts[0][0]:.2f} {pts[0][1]:.2f}"]

    def angle(a, b, c):
        u, v = a - b, c - b
        nu, nv = np.hypot(*u), np.hypot(*v)
        if nu == 0 or nv == 0:
            return 180
        return np.degrees(np.arccos(np.clip(np.dot(u, v) / (nu * nv), -1, 1)))

    def borne(t, longueur):
        nt = np.hypot(*t)
        return t * (longueur / 3 / nt) if nt > longueur / 3 else t

    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        seg = np.hypot(*(p2 - p1))
        c1 = p1 + borne((p2 - p0) / 6, seg) if angle(p0, p1, p2) > 110 else p1
        c2 = p2 - borne((p3 - p1) / 6, seg) if angle(p1, p2, p3) > 110 else p2
        # Rien sous le sol : une Bézier reste dans l'enveloppe de ses points
        # de contrôle ; sans ça, la courbe plongeait de 0,3 à 0,9 cm sous
        # y = 0 entre deux points de la base.
        c1, c2 = (np.array([c[0], min(c[1], 0.0)]) for c in (c1, c2))
        out.append(f"C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
    return "".join(out) + "Z"


def polygones(d, pas=10):
    """Le chemin (M, C, Z absolus) aplati en polygones."""
    jetons = re.findall(r'[MCZ]|-?\d+(?:\.\d+)?', d)
    polys, cur, i = [], None, 0
    while i < len(jetons):
        t = jetons[i]
        if t == 'M':
            cur = [(float(jetons[i + 1]), float(jetons[i + 2]))]
            i += 3
        elif t == 'C':
            p0 = np.array(cur[-1])
            c1, c2, p3 = (np.array([float(jetons[i + k]), float(jetons[i + k + 1])]) for k in (1, 3, 5))
            for s in np.linspace(0, 1, pas + 1)[1:]:
                q = (1 - s) ** 3 * p0 + 3 * (1 - s) ** 2 * s * c1 + 3 * (1 - s) * s ** 2 * c2 + s ** 3 * p3
                cur.append((q[0], q[1]))
            i += 7
        elif t == 'Z':
            polys.append(np.array(cur))
            cur = None
            i += 1
        else:
            raise ValueError(t)
    return polys


def rendre(d, s, ox, oy, w, h):
    """Remplissage nonzero (celui du <path> du produit) : px = cm * s + origine."""
    X0, Y0, X1, Y1 = [], [], [], []
    for p in polygones(d):
        q = np.vstack([p, p[:1]])
        X0.append(q[:-1, 0] * s + ox), Y0.append(q[:-1, 1] * s + oy)
        X1.append(q[1:, 0] * s + ox), Y1.append(q[1:, 1] * s + oy)
    X0, Y0, X1, Y1 = (np.concatenate(v) for v in (X0, Y0, X1, Y1))
    out = np.zeros((h, w), bool)
    xc = np.arange(w) + 0.5
    for r in range(h):
        yc = r + 0.5
        sel = ((Y0 <= yc) & (Y1 > yc)) | ((Y1 <= yc) & (Y0 > yc))
        if not sel.any():
            continue
        xi = X0[sel] + (yc - Y0[sel]) * (X1[sel] - X0[sel]) / (Y1[sel] - Y0[sel])
        sens = np.where(Y1[sel] > Y0[sel], 1, -1)
        o = np.argsort(xi)
        cumul = np.cumsum(sens[o])
        k = np.searchsorted(xi[o], xc)
        out[r] = np.where(k > 0, cumul[np.maximum(k - 1, 0)], 0) != 0
    return out


resultats = []
for ri, (y0, y1) in enumerate(rangees):
    for ci, (x0, x1) in enumerate(grille[ri]):
        nom_case = f'r{ri + 1}c{ci + 1}'
        certitude, membres = CASES[nom_case]
        bx0, by0 = x0 - 2, y0 - 2
        m = noir[by0:y1 + 4, bx0:x1 + 3].copy()
        compte = m.sum(axis=1)
        # Bas de l'ombre portée : dernière rangée bien pleine ; la « taille »
        # (rangée la plus étroite juste au-dessus) est le bas des jambes.
        bas_ombre = int(np.nonzero(compte > 50)[0].max())
        taille = min(range(bas_ombre - 14, bas_ombre), key=lambda y: compte[y])
        m = m[: taille + 1]
        lab, n = ndimage.label(m, structure=np.ones((3, 3)))
        tailles = ndimage.sum(m, lab, range(1, n + 1))
        garde = np.zeros_like(m)
        jetes = []
        for i, t in enumerate(tailles):
            if t >= POUSSIERE:
                garde |= lab == (i + 1)
            else:
                jetes.append(int(t))
        ys, xs = np.nonzero(garde)
        haut_y, gx, dx = int(ys.min()), int(xs.min()), int(xs.max())
        garde = garde[haut_y:, gx:dx + 1]
        hpx, wpx = garde.shape
        # Hauteur (du sol au sommet) de chaque personnage, autour de sa tête.
        sommet = np.array([np.nonzero(garde[:, x])[0].min() if garde[:, x].any() else hpx for x in range(wpx)])
        hauteur = hpx - sommet
        # (x de la tête donné dans la boîte de la case, qui commence à bx0.)
        hm = [int(hauteur[max(0, xh - gx - 7): xh - gx + 8].max()) for _, _, xh in membres]
        h_ref = hm[REF.get(nom_case, 0)]
        assert h_ref >= 0.9 * hauteur.max(), (nom_case, h_ref, hauteur.max())
        px_par_cm = h_ref / 90.0
        mk = ndimage.gaussian_filter(np.pad(garde.astype(float), 2), 0.6)
        chemins = []
        gauche, droite, haut = 1e9, -1e9, 0
        for c in measure.find_contours(mk, 0.5):
            if len(c) < 8:
                continue
            if np.allclose(c[0], c[-1]):
                c = c[:-1]
            loin = int(np.argmax(np.hypot(*(c - c[0]).T)))
            c = np.vstack([rdp(c[: loin + 1], 0.8)[:-1], rdp(np.vstack([c[loin:], c[:1]]), 0.8)[:-1]])
            if len(c) < 3:
                continue
            # (ligne, colonne) -> cm : bas de la rangée d'assise sur y = 0,
            # milieu de l'emprise sur x = 0.
            ycm = np.minimum((c[:, 0] - 2 - (hpx - 0.5)) / px_par_cm, 0.0)
            xcm = (c[:, 1] - 2 - (wpx - 1) / 2) / px_par_cm
            chemins.append(courbe(np.stack([xcm, ycm], axis=1)))
        # Emprise mesurée sur la courbe elle-même (pas seulement ses sommets).
        tout = np.vstack(polygones(" ".join(chemins), pas=16))
        gauche, droite, haut = tout[:, 0].min(), tout[:, 0].max(), tout[:, 1].min()
        types = [t for t, _, _ in membres]
        sid = f"a-{nom_case}-" + "-".join(types)
        ombre = {
            'id': sid, 'gauche': round(gauche, 2), 'droite': round(droite, 2), 'haut': round(haut, 2),
            'decalage': 0, 'd': " ".join(chemins),
            # Informations (non lues par ecrire-ombres2.py).
            'case': f'A {nom_case}', 'certitude': certitude,
            'membres': [{'type': t, 'detail': dt, 'taille': round(h / h_ref, 2)} for (t, dt, _), h in zip(membres, hm)],
            'px_par_cm': round(px_par_cm, 4),
        }
        with open(f'{SORTIE}/case-{nom_case}.json', 'w', encoding='utf-8') as f:
            json.dump(ombre, f, ensure_ascii=False, indent=1)
        # Contrôle : le tracé rendu aux mêmes px/cm doit recouvrir le masque.
        # (centre du pixel j en j + 0,5 : x = 0 tombe à wpx / 2, y = 0 à hpx.)
        rendu = rendre(ombre['d'], px_par_cm, wpx / 2, hpx, wpx, hpx)
        inter = (rendu & garde).sum()
        union = (rendu | garde).sum()
        resultats.append({
            'case': nom_case, 'ombre': ombre, 'garde': garde, 'rendu': rendu, 'iou': inter / union,
            'boite': (x0, y0, x1, by0 + bas_ombre + 1), 'jetes': jetes, 'hm': hm, 'ppc': px_par_cm,
            # Dans l'image source : où tombent x = 0 et y = 0 (bords de pixels).
            'x_zero': bx0 + gx + wpx / 2, 'y_zero': by0 + taille + 1,
            'masque_haut': by0 + haut_y, 'masque_gauche': bx0 + gx,
        })
        print(f"{nom_case} base y={by0 + taille} ombre jusqu'à y={by0 + bas_ombre} poussières={jetes} "
              f"maman={h_ref}px ({px_par_cm:.3f} px/cm) tailles={[round(h / h_ref, 2) for h in hm]} "
              f"{round(droite - gauche, 1)}x{round(-haut, 1)} cm sous-chemins={len(chemins)} iou={inter / union:.4f}")

# Planche de contrôle : case d'origine | tracé rendu (mêmes pixels par cm),
# avec la case et la composition dessous.
try:
    police = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
    police_b = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 18)
except OSError:
    police = police_b = ImageFont.load_default()
ECH = 1.35  # agrandissement de la planche de contrôle
SS = 4      # suréchantillonnage du rendu (anticrénelage)
src_rgb = Image.open(SRC).convert('RGB')
CW, CH = 330, 190  # demi-cellule, en pixels de l'image source
PAR_LIGNE = 3
cel_w, cel_h = int(2 * CW * ECH) + 40, int(CH * ECH) + 64
planche = Image.new('RGB', (PAR_LIGNE * cel_w + 20, ((len(resultats) + PAR_LIGNE - 1) // PAR_LIGNE) * cel_h + 20), 'white')
dr = ImageDraw.Draw(planche)
for i, r in enumerate(resultats):
    ox, oy = 10 + (i % PAR_LIGNE) * cel_w, 10 + (i // PAR_LIGNE) * cel_h
    x0, y0, x1, y1 = r['boite']
    # Fenêtre de l'image source montrée à gauche ; le tracé rendu à droite est
    # calé dessus au pixel près (x = 0 et y = 0 là où ils étaient dans la case).
    fx, fy = (x0 + x1) / 2 - CW / 2, y1 + 6 - CH
    # Seulement la case elle-même (rien de la voisine), sur fond blanc.
    orig = Image.new('RGB', (CW, CH), 'white')
    bx, by = max(0, x0 - 6), max(0, y0 - 6)
    orig.paste(src_rgb.crop((bx, by, min(W_IMG, x1 + 6), min(H_IMG, y1 + 6))), (bx - int(fx), by - int(fy)))
    orig = orig.resize((int(CW * ECH), int(CH * ECH)), Image.LANCZOS)
    planche.paste(orig, (ox, oy))
    k = ECH * SS
    g = rendre(r['ombre']['d'], r['ppc'] * k, (r['x_zero'] - int(fx)) * k, (r['y_zero'] - int(fy)) * k,
               int(CW * k), int(CH * k))
    rend = Image.fromarray(np.where(g, 0, 255).astype(np.uint8)).resize((int(CW * ECH), int(CH * ECH)), Image.BOX)
    planche.paste(rend.convert('RGB'), (ox + int(CW * ECH) + 20, oy))
    dr.rectangle([ox - 1, oy - 1, ox + int(CW * ECH), oy + int(CH * ECH)], outline=(210, 210, 210))
    dr.rectangle([ox + int(CW * ECH) + 19, oy - 1, ox + 2 * int(CW * ECH) + 20, oy + int(CH * ECH)], outline=(210, 210, 210))
    o = r['ombre']
    compo = ', '.join(m['type'] for m in o['membres'])
    dr.text((ox, oy + int(CH * ECH) + 6), f"A {r['case']}  ·  {compo}", fill=(20, 20, 20), font=police_b)
    dr.text((ox, oy + int(CH * ECH) + 30),
            f"{o['certitude']}  ·  {round(o['droite'] - o['gauche'])} x {round(-o['haut'])} cm  ·  "
            f"tailles {' / '.join(str(m['taille']) for m in o['membres'])}",
            fill=(110, 110, 110), font=police)
planche.save(CONTROLE, quality=90)
print('planche', planche.size, '->', CONTROLE)
print('iou min', round(min(r['iou'] for r in resultats), 4))

# Diagnostic facultatif (5e argument : un fichier PNG) : noir = gardé et
# tracé, vert = retiré de l'image (ombre portée, poussières), bleu = dans
# l'image mais perdu par le tracé, rouge = ajouté par le tracé.
if len(sys.argv) > 4:
    Z = 3
    vues = []
    for r in resultats:
        x0, y0, x1, y1 = r['boite']
        fx0, fy0 = x0 - 6, y0 - 6
        w, h = x1 - x0 + 12, y1 - y0 + 12
        orig_m = noir[fy0:fy0 + h, fx0:fx0 + w]
        garde_m = np.zeros_like(orig_m)
        rendu_m = np.zeros_like(orig_m)
        gy, gx = r['masque_haut'] - fy0, r['masque_gauche'] - fx0
        gh, gw = r['garde'].shape
        garde_m[gy:gy + gh, gx:gx + gw] = r['garde']
        rendu_m[gy:gy + gh, gx:gx + gw] = r['rendu']
        v = np.full((h, w, 3), 255, np.uint8)
        v[orig_m & ~garde_m] = (40, 170, 60)
        v[garde_m & rendu_m] = (0, 0, 0)
        v[garde_m & ~rendu_m] = (30, 90, 255)
        v[~garde_m & rendu_m] = (230, 30, 30)
        im = Image.fromarray(v).resize((w * Z, h * Z), Image.NEAREST)
        ImageDraw.Draw(im).text((4, 4), r['case'], fill=(200, 0, 200), font=police_b)
        vues.append(im)
    lw = max(im.width for im in vues) + 10
    lh = max(im.height for im in vues) + 10
    diag = Image.new('RGB', (5 * lw, 6 * lh), 'white')
    for i, im in enumerate(vues):
        diag.paste(im, ((i % 5) * lw, (i // 5) * lh))
    diag.save(sys.argv[4])
    print('diagnostic', diag.size, '->', sys.argv[4])
