"""3e planche d'Alexandra (27/11 au soir) : seulement les 6 scènes qui ne
font pas doublon avec la 2e planche. Fond blanc, ombre portée au sol (retirée :
on coupe les 8 dernières lignes de chaque rangée)."""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

SRC, SORTIE = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(SRC).convert('L')).astype(float)
noir = img < 110
OMBRE = 8

# (id, groupe, nom, x0, x1, haut de la rangée, bas de la rangée)
SCENES = [
    ('femme-cheval-couche', 'animal', 'Femme et cheval couché', 60, 515, 13, 365),
    ('femme-cheval-debout', 'animal', 'Femme debout et cheval', 525, 909, 13, 365),
    ('homme-chien', 'animal', 'Homme et son chien', 943, 1216, 13, 365),
    ('femme-chat', 'animal', 'Femme et son chat', 1242, 1488, 13, 365),
    ('homme-bonnet-laine', 'seul', 'Homme au bonnet', 984, 1168, 430, 695),
    ('famille-papa-bebe', 'famille', 'Papa et bébé', 959, 1207, 723, 1013),
]
# Échelle : les personnes seules de la 2e rangée (sauf l'homme aux lapins) = 90 cm assises.
SEULS = [(40, 231), (256, 424), (446, 591), (620, 779), (792, 964), (984, 1168)]
hauteurs = []
for a, b in SEULS:
    m = noir[430:695 - OMBRE, a:b]
    ys = np.nonzero(m.any(axis=1))[0]
    hauteurs.append(m.shape[0] - ys.min())
px_par_cm = float(np.median(hauteurs)) / 90.0
print('px/cm', round(px_par_cm, 3), hauteurs)


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
    n = len(pts)
    out = [f"M{pts[0][0]:.2f} {pts[0][1]:.2f}"]

    def angle(a, b, c):
        u, v = a - b, c - b
        nu, nv = np.hypot(*u), np.hypot(*v)
        if nu == 0 or nv == 0:
            return 180
        return np.degrees(np.arccos(np.clip(np.dot(u, v) / (nu * nv), -1, 1)))

    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = p1 + (p2 - p0) / 6 if angle(p0, p1, p2) > 110 else p1
        c2 = p2 - (p3 - p1) / 6 if angle(p1, p2, p3) > 110 else p2
        out.append(f"C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
    return "".join(out) + "Z"


ombres = []
for sid, groupe, nom, x0, x1, y0, y1 in SCENES:
    m = noir[y0:y1 - OMBRE, x0:x1].copy()
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    tailles = ndimage.sum(m, lab, range(1, n + 1))
    garde = np.zeros_like(m)
    for i, t in enumerate(tailles):
        if t >= 40:
            garde |= lab == (i + 1)
    ys = np.nonzero(garde.any(axis=1))[0]
    garde = garde[ys.min():]
    hpx, wpx = garde.shape
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
        ycm = (c[:, 0] - 2 - hpx) / px_par_cm
        xcm = (c[:, 1] - 2 - wpx / 2) / px_par_cm
        gauche, droite, haut = min(gauche, xcm.min()), max(droite, xcm.max()), min(haut, ycm.min())
        chemins.append(courbe(np.stack([xcm, ycm], axis=1)))
    ombres.append({'id': sid, 'groupe': groupe, 'nom': nom, 'gauche': round(gauche, 2), 'droite': round(droite, 2),
                   'haut': round(haut, 2), 'decalage': 0, 'd': " ".join(chemins)})
    print(sid, 'larg', round(droite - gauche, 1), 'haut', round(-haut, 1))
json.dump(ombres, open(SORTIE + '/ombres-3.json', 'w', encoding='utf-8'), ensure_ascii=False)
