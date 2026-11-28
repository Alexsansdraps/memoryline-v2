"""Découpe des ombres chinoises de l'image d'Alexandra (27/11, 2e planche).

Sortie : un JSON des silhouettes (tracés en cm, pieds sur y = 0) et une
planche de contrôle PNG.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure

SRC, SORTIE = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(SRC).convert('L')).astype(float)
H, W = img.shape
noir = img < 110

# Les quatre lignes de sol (traits noirs sur toute la largeur).
part = (img < 90).mean(axis=1)
sols = []
for y in range(H):
    if part[y] > 0.88:
        if sols and y - sols[-1][1] <= 3:
            sols[-1][1] = y
        else:
            sols.append([y, y])
assert len(sols) == 4, sols

IDS = [
    ['femme-ondulee', 'femme-bouclee-courte', 'femme-carre', 'femme-tres-longs-boucles', 'femme-chignon-haut',
     'enfant-boucle', 'homme-boucle', 'homme-capuche', 'homme-court', 'homme-casquette'],
    ['couple-homme-femme', 'couple-femmes-queue', 'couple-hommes-epaule', 'couple-hommes-front',
     'couple-femmes-chignon', 'couple-frises'],
    ['famille-epaules-bebe', 'famille-femme-enfant', 'famille-homme-deux-bebes', 'famille-homme-bebe-femme',
     'famille-deux-hommes-enfant', 'enfant-chien'],
    ['femme-chien', 'homme-chat', 'femme-lapin', 'homme-cheval', 'femme-longs', 'homme-deux-lapins'],
]

# Les groupes de l'image sont dessinés plus petits que les personnes seules :
# chaque rangée est ramenée à des adultes d'environ 90 cm assis.
FACTEURS = [1.0, 1.18, 1.2, 1.12]
# L'enfant seul est dessiné presque à la taille d'un adulte dans l'image :
# ramené à 70 % (27/11 au soir, « l'enfant doit être plus petit que les adultes »).
ECHELLE_ID = {'enfant-boucle': 0.7}
HERBE = 34  # hauteur de la bande d'herbe au pied, en px, nettoyée à part

resultats = []
for r, (s0, s1) in enumerate(sols):
    y_haut = 0 if r == 0 else sols[r - 1][1] + 5
    y_sol = s0  # haut du trait de sol
    m = noir[y_haut:y_sol].copy()
    hb = m.shape[0]
    # L'herbe : brins fins au pied. Une ouverture (rayon 3) ne garde que ce
    # qui est épais ; seulement dans la bande du bas, pour ne pas manger les
    # mèches ni le doigt levé.
    bas = m[hb - HERBE:]
    ouvert = ndimage.binary_opening(bas, structure=np.ones((7, 7)))
    m[hb - HERBE:] = ouvert
    # Composantes ; on retire les petites (restes d'herbe).
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    tailles = ndimage.sum(m, lab, range(1, n + 1))
    garde = np.zeros_like(m)
    for i, t in enumerate(tailles):
        if t >= 60:
            garde |= lab == (i + 1)
    # Découpe en groupes par projection, avec fusion des petits trous.
    # Projection SANS la bande d'herbe : l'herbe relie les groupes entre eux.
    occ = garde[: hb - HERBE - 8].sum(axis=0) > 0
    segs = []
    x = 0
    while x < W:
        if occ[x]:
            d = x
            while x < W and occ[x]:
                x += 1
            segs.append([d, x])
        else:
            x += 1
    # Les brins d'herbe isolés (moins de 15 px de large) ne sont pas des personnages.
    segs = [g for g in segs if g[1] - g[0] >= 15]
    print('rangee', r, 'y', y_haut, y_sol, 'segs', segs)
    voulus = len(IDS[r])
    # Rangée des animaux : la femme seule touche presque le cheval (12 px)
    # alors que le lapin est à 14 px de sa maîtresse ; les groupes sont
    # donnés à la main (bornes vérifiées sur l'image).
    if r == 3:
        segs = [[56, 226], [328, 508], [569, 726], [782, 1068], [1080, 1183], [1239, 1480]]
    # Fusionner les trous les plus petits jusqu'à avoir le bon nombre.
    while len(segs) > voulus:
        trous = [(segs[i + 1][0] - segs[i][1], i) for i in range(len(segs) - 1)]
        _, i = min(trous)
        segs[i][1] = segs[i + 1][1]
        del segs[i + 1]
    assert len(segs) == voulus, (r, len(segs))
    for k, (a, b) in enumerate(segs):
        sous = np.zeros_like(garde)
        sous[:, a:b] = garde[:, a:b]
        ys, xs = np.nonzero(sous)
        resultats.append({
            'id': IDS[r][k], 'rangee': r, 'a': int(a), 'b': int(b),
            'haut_px': int(hb - ys.min()), 'masque': sous[ys.min():, a:b],
            'y0': int(y_haut + ys.min()),
        })

# Échelle : la moyenne des adultes seuls de la rangée 1 (sauf l'enfant) = 90 cm.
adultes = [x['haut_px'] for x in resultats if x['rangee'] == 0 and x['id'] != 'enfant-boucle']
px_par_cm = np.mean(adultes) / 90.0
print('hauteur moyenne adulte (px):', round(np.mean(adultes), 1), '-> px/cm', round(px_par_cm, 3))


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
    """Catmull-Rom fermé → Bézier ; angles > 70° gardés pointus."""
    n = len(pts)
    out = [f"M{pts[0][0]:.2f} {pts[0][1]:.2f}"]
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]

        def angle(a, b, c):
            u, v = a - b, c - b
            nu, nv = np.hypot(*u), np.hypot(*v)
            if nu == 0 or nv == 0:
                return 180
            return np.degrees(np.arccos(np.clip(np.dot(u, v) / (nu * nv), -1, 1)))

        c1 = p1 + (p2 - p0) / 6 if angle(p0, p1, p2) > 110 else p1
        c2 = p2 - (p3 - p1) / 6 if angle(p1, p2, p3) > 110 else p2
        out.append(f"C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
    return "".join(out) + "Z"


ombres = []
for x in resultats:
    mk = x['masque'].astype(float)
    mk = np.pad(mk, 2)
    mk = ndimage.gaussian_filter(mk, 0.6)
    contours = measure.find_contours(mk, 0.5)
    hpx, wpx = x['masque'].shape
    chemins = []
    gauche, droite, haut = 1e9, -1e9, 0
    for c in contours:
        if len(c) < 8:
            continue
        # Contour fermé : on le coupe au point le plus loin du départ, puis
        # Ramer-Douglas-Peucker sur chaque moitié.
        if np.allclose(c[0], c[-1]):
            c = c[:-1]
        loin = int(np.argmax(np.hypot(*(c - c[0]).T)))
        c = np.vstack([rdp(c[: loin + 1], 0.8)[:-1], rdp(np.vstack([c[loin:], c[:1]]), 0.8)[:-1]])
        if len(c) < 3:
            continue
        # (ligne, colonne) → cm ; pieds (bas du masque) sur y = 0, centré en x.
        f = FACTEURS[x['rangee']] * ECHELLE_ID.get(x['id'], 1.0)
        ycm = (c[:, 0] - 2 - hpx) / px_par_cm * f
        xcm = (c[:, 1] - 2 - wpx / 2) / px_par_cm * f
        pts = np.stack([xcm, ycm], axis=1)
        gauche, droite, haut = min(gauche, xcm.min()), max(droite, xcm.max()), min(haut, ycm.min())
        chemins.append(courbe(pts))
    # Centrer sur la largeur réelle.
    centre = 0.0  # le tracé garde son origine ; gauche/droite disent son emprise
    d = " ".join(chemins)
    ombres.append({'id': x['id'], 'gauche': round(gauche - centre, 2), 'droite': round(droite - centre, 2),
                   'haut': round(haut, 2), 'decalage': round(centre, 3), 'd': d, 'rangee': x['rangee'],
                   'largeur_px': x['b'] - x['a'], 'haut_px': x['haut_px']})

json.dump(ombres, open(SORTIE + '/ombres-2.json', 'w', encoding='utf-8'), ensure_ascii=False)

# Planche de contrôle : chaque silhouette redessinée depuis son masque, avec son id.
pl = Image.new('RGB', (1600, 1100), 'white')
dr = ImageDraw.Draw(pl)
for i, x in enumerate(resultats):
    col, lig = i % 7, i // 7
    mk = Image.fromarray((~x['masque']).astype(np.uint8) * 255)
    mk.thumbnail((200, 200))
    pl.paste(mk, (10 + col * 225, 10 + lig * 270))
    dr.text((10 + col * 225, 220 + lig * 270), x['id'], fill='red')
pl.save(SORTIE + '/planche-masques.png')
for o in ombres:
    print(o['id'], 'larg cm', round(o['droite'] - o['gauche'], 1), 'haut cm', -o['haut'], 'len d', len(o['d']))
