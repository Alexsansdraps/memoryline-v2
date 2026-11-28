"""Animaux SEULS, détachés de leurs scènes dans la 2e planche (27/11 au soir,
Alexandra : « on n'a aucun animal seul, alors que je t'avais filé des
animaux seuls dans les ombres »). Même fabrication que decoupe-ombres.py."""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

SRC, SORTIE = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(SRC).convert('L')).astype(float)
noir = img < 110
HERBE = 34
PX_PAR_CM = 2.367  # même échelle que la planche (adultes seuls de la 1re rangée = 90 cm)

# (id, nom, x0, x1, haut de bande, sol, facteur de la rangée)
ANIMAUX = [
    ('chien-assis', 'Chien', 1384, 1471, 480, 707, 1.2),
    ('chat-assis', 'Chat', 457, 508, 712, 969, 1.12),
    ('lapin', 'Lapin', 685, 729, 712, 969, 1.12),
    ('deux-lapins', 'Deux lapins', 1236, 1329, 712, 969, 1.12),
]


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
for sid, nom, x0, x1, y0, sol, f in ANIMAUX:
    m = noir[y0:sol, x0:x1].copy()
    hb = m.shape[0]
    m[hb - HERBE:] = ndimage.binary_opening(m[hb - HERBE:], structure=np.ones((7, 7)))
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    tailles = ndimage.sum(m, lab, range(1, n + 1))
    garde = np.zeros_like(m)
    # Seulement les formes de l'animal : un bout du voisin (genou, épaule)
    # coupé au bord de la boîte est bien plus petit.
    plus = max(tailles) if len(tailles) else 0
    for i, t in enumerate(tailles):
        if t >= 0.3 * plus:
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
        ycm = (c[:, 0] - 2 - hpx) / PX_PAR_CM * f
        xcm = (c[:, 1] - 2 - wpx / 2) / PX_PAR_CM * f
        gauche, droite, haut = min(gauche, xcm.min()), max(droite, xcm.max()), min(haut, ycm.min())
        chemins.append(courbe(np.stack([xcm, ycm], axis=1)))
    ombres.append({'id': sid, 'groupe': 'animaux', 'nom': nom, 'gauche': round(gauche, 2), 'droite': round(droite, 2),
                   'haut': round(haut, 2), 'decalage': 0, 'd': " ".join(chemins)})
    print(sid, 'larg', round(droite - gauche, 1), 'haut', round(-haut, 1))
json.dump(ombres, open(SORTIE + '/ombres-animaux.json', 'w', encoding='utf-8'), ensure_ascii=False)
