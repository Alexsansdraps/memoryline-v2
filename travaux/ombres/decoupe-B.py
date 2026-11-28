"""Planche B des familles d'Alexandra (28/11 vers 1 h 30 : « il faut que tu prennes
ce qui n'existe pas encore [...] une femme avec 2 enfants, une femme avec 2 filles,
une femme avec 2 garçons, une femme avec un garçon et une fille, un homme seul avec
ses 2 enfants, etc. »). Image source : Documents/memory-line/protos/ombres-familles-b.png
(1536 x 1024, hors dépôt) : 6 rangées de 6 scènes, silhouettes noires sur blanc, une
ombre portée noire au sol sous chaque groupe.

Même fabrication que decoupe-ombres.py / decoupe4.py (scripts-precedents/) :
- masque : gris < 110 ;
- l'ombre portée : une lentille de 3 rangées sous l'assise, plus large que les jambes,
  avec 1 rangée d'anticrénelage au-dessus qui touche les jambes : on coupe les
  4 dernières rangées de chaque case (vérifié case par case : la dernière rangée gardée
  n'est jamais plus large que celle du dessus) ;
- composantes connexes (8-connexité) ; les poussières de moins de 40 px partent ;
- contour par marching squares (skimage.measure.find_contours) sur le masque lissé
  (gaussien 0,6) ; contour fermé coupé en deux au point le plus éloigné, RDP 0,8 px ;
  Catmull-Rom -> Bézier (angles de plus de 70° gardés pointus), bras des points de
  contrôle bornés à la moitié de leur segment (sinon la courbe gonfle aux coins de la
  base, voir courbe()) ; les trous tournent dans l'autre sens (la règle « nonzero » les creuse).
- échelle PAR CASE : la moyenne des adultes de la case, du sol au sommet du crâne (sans
  le chignon), mesure 90 cm ; les enfants gardent leur taille relative. Base sur y = 0
  (à 0,3 cm près, comme les planches précédentes), haut en négatif, x centré sur la case.
  Si une lecture douteuse change (adulte <-> ado), changer le type et le drapeau F/H du
  membre dans SCENES puis relancer : l'échelle de la case suit.

Retouche du chat (28/11 après-midi, B r5c1 « Papa, trois enfants et un chat ») : sur la
planche, la tête du chat touche le bras du papa (l'écart y fait moins d'un pixel) et son
oreille gauche s'y fond ; en vignette et à l'échelle de l'affiche, on lisait une bosse à
une seule oreille, un 4e enfant. Alexandra a choisi « Retoucher le chat » : la tête est
redessinée dans le masque de la case (RETOUCHES, retouche_chat), un peu plus étroite et
détachée du bras par un jour de 3 à 4 px (2,6 à 3,2 cm une fois vectorisée), avec ses
deux oreilles pointues et son cou ; le corps du chat, le papa et les enfants ne bougent
pas. Le tracé garde les sommets d'avant partout où le masque n'a pas changé (raccorder) :
dans `d`, seul le chat change. Contrôles : travaux/ombres/retouche-chat/.

Usage :  python -I decoupe-B.py <ombres-familles-b.png> <dossier planche-B> <controle-B.jpg>
Sorties : <dossier>/case-r<rangée>c<colonne>.json (une scène par fichier), <dossier>/ombres-B.json
(les 36 dans une liste, pour ecrire-ombres2.py) et la planche de contrôle (chaque case originale
à côté de son tracé rendu, avec la case et la composition dessous).
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage import draw, measure

SRC, SORTIE, CONTROLE = sys.argv[1], sys.argv[2], sys.argv[3]
SEUIL = 110
OMBRE = 4  # 3 rangées de lentille + 1 rangée d'anticrénelage
POUSSIERE = 40

# ------------------------------------------------------------------------------------
# Composition, case par case, de gauche à droite (relue sur chaque case agrandie).
# Chaque membre : (type, détail, x de la tête dans la case, adulte de référence pour
# l'échelle). Pour un chignon, x pointe à côté du chignon, là où le crâne affleure.
# ------------------------------------------------------------------------------------
F, H = True, False  # lisibilité : adulte de référence ou non
SCENES = {
    (1, 1): dict(id='famille-maman-fille-garcon', groupe='famille', nom='Maman, fille et garçon', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 63, F), ('fille', 'couettes', 118, H), ('garcon', 'cheveux courts', 173, H)]),
    (1, 2): dict(id='famille-deux-mamans-garcon', groupe='famille', nom='Deux mamans et un garçon', certitude='probable',
                 membres=[('femme', 'cheveux longs ondulés', 56, F), ('garcon', 'petit, cheveux courts', 106, H),
                          ('femme', 'chignon haut décoiffé, mèche dans le cou', 170, F)]),
    (1, 3): dict(id='famille-maman-deux-filles-couettes', groupe='famille', nom='Maman et deux filles à couettes', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 56, F), ('fille', 'couettes', 111, H), ('fille', 'couettes', 169, H)]),
    (1, 4): dict(id='famille-deux-mamans-fille', groupe='famille', nom='Deux mamans et une fille', certitude='probable',
                 membres=[('femme', 'cheveux longs ondulés', 60, F), ('fille', 'petites couettes basses', 119, H),
                          ('femme', 'cheveux courts bouclés (afro)', 182, F)]),
    (1, 5): dict(id='famille-maman-deux-garcons', groupe='famille', nom='Maman et deux garçons', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 58, F), ('garcon', 'grand, cheveux courts', 119, H),
                          ('garcon', 'petit, cheveux courts bouclés', 174, H)]),
    (1, 6): dict(id='famille-maman-garcon-enfant-boucle', groupe='famille', nom='Maman, garçon et enfant aux boucles', certitude='probable',
                 membres=[('femme', 'cheveux longs ondulés', 62, F), ('garcon', 'petit, cheveux courts', 111, H),
                          ('enfant', 'grand, boucles volumineuses jusqu\'à la mâchoire', 166, H)]),
    (2, 1): dict(id='famille-maman-deux-garcons-2', groupe='famille', nom='Maman et deux garçons', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 66, F), ('garcon', 'petit, cheveux courts', 118, H),
                          ('garcon', 'grand, cheveux courts, tête tournée', 169, H)]),
    (2, 2): dict(id='famille-maman-deux-filles', groupe='famille', nom='Maman et deux filles', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 58, F), ('fille', 'cheveux mi-longs ondulés', 109, H),
                          ('fille', 'cheveux mi-longs ondulés', 166, H)]),
    (2, 3): dict(id='famille-maman-tout-petit-garcon', groupe='famille', nom='Maman, tout-petit et garçon', certitude='probable',
                 membres=[('femme', 'cheveux longs ondulés', 69, F), ('enfant', 'tout-petit, cheveux courts bouclés, une mèche à la nuque', 111, H),
                          ('garcon', 'cheveux courts bouclés', 164, H)]),
    (2, 4): dict(id='famille-maman-grande-fille-garcon', groupe='famille', nom='Maman, grande fille et garçon', certitude='probable',
                 membres=[('femme', 'cheveux longs ondulés', 57, F), ('fille', 'grande, cheveux mi-longs ondulés', 125, H),
                          ('garcon', 'cheveux courts', 187, H)]),
    (2, 5): dict(id='famille-maman-ado', groupe='famille', nom='Maman et son ado', certitude='douteuse',
                 membres=[('femme', 'cheveux longs ondulés', 59, F), ('ado-garcon', 'cheveux courts, aussi grand qu\'elle', 150, H)]),
    (2, 6): dict(id='famille-maman-ado-2', groupe='famille', nom='Maman et son ado', certitude='douteuse',
                 membres=[('femme', 'cheveux longs ondulés', 60, F), ('ado-garcon', 'cheveux courts, tête tournée vers elle', 137, H)]),
    (3, 1): dict(id='famille-papa-deux-garcons', groupe='famille', nom='Papa et deux garçons', certitude='sure',
                 membres=[('homme', 'cheveux courts', 75, F), ('garcon', 'cheveux courts', 126, H), ('garcon', 'petit, cheveux courts bouclés', 175, H)]),
    (3, 2): dict(id='famille-papa-fille-garcon', groupe='famille', nom='Papa, fille et garçon', certitude='sure',
                 membres=[('homme', 'cheveux courts', 72, F), ('fille', 'couettes', 125, H), ('garcon', 'cheveux courts', 173, H)]),
    (3, 3): dict(id='famille-papa-garcon-enfant-boucle', groupe='famille', nom='Papa, garçon et enfant aux boucles', certitude='probable',
                 membres=[('homme', 'cheveux courts', 70, F), ('garcon', 'cheveux courts', 128, H),
                          ('enfant', 'boucles jusqu\'à la mâchoire', 177, H)]),
    (3, 4): dict(id='famille-papa-petit-garcon', groupe='famille', nom='Papa et petit garçon', certitude='sure',
                 membres=[('homme', 'cheveux courts', 72, F), ('garcon', 'petit, cheveux courts bouclés', 140, H)]),
    (3, 5): dict(id='famille-papa-fille-queue', groupe='famille', nom='Papa et sa fille', certitude='sure',
                 membres=[('homme', 'cheveux courts', 71, F), ('fille', 'queue de cheval, de profil vers lui', 143, H)]),
    (3, 6): dict(id='famille-papa-grand-garcon', groupe='famille', nom='Papa et grand garçon', certitude='sure',
                 membres=[('homme', 'cheveux courts', 72, F), ('garcon', 'grand, cheveux courts en épis, tête baissée', 164, H)]),
    (4, 1): dict(id='famille-papa-fille-enfant-boucle', groupe='famille', nom='Papa, fille et enfant aux boucles', certitude='probable',
                 membres=[('homme', 'cheveux courts', 74, F), ('fille', 'couettes', 132, H), ('enfant', 'boucles jusqu\'à la mâchoire', 182, H)]),
    (4, 2): dict(id='famille-papa-maman-garcon', groupe='famille', nom='Papa, maman et garçon', certitude='douteuse',
                 membres=[('homme', 'cheveux courts', 72, F), ('femme', 'cheveux longs ondulés', 124, F),
                          ('garcon', 'petit, cheveux courts bouclés', 182, H)]),
    (4, 3): dict(id='famille-papa-casquette-fille-maman', groupe='famille', nom='Papa, fille et maman', certitude='douteuse',
                 membres=[('homme', 'casquette, visière à gauche', 69, F), ('fille', 'cheveux mi-longs ondulés', 125, H),
                          ('femme', 'cheveux longs ondulés', 168, F)]),
    (4, 4): dict(id='famille-deux-papas-garcon', groupe='famille', nom='Deux papas et un garçon', certitude='douteuse',
                 membres=[('homme', 'cheveux courts', 76, F), ('garcon', 'cheveux courts', 124, H), ('homme', 'cheveux courts, un peu plus petit', 182, F)]),
    (4, 5): dict(id='famille-deux-papas-fille', groupe='famille', nom='Deux papas et une fille', certitude='douteuse',
                 membres=[('homme', 'casquette, visière à droite', 68, F), ('fille', 'couettes', 120, H),
                          ('homme', 'cheveux courts, un peu plus petit', 175, F)]),
    (4, 6): dict(id='famille-deux-papas-garcon-2', groupe='famille', nom='Deux papas et un garçon', certitude='douteuse',
                 membres=[('homme', 'cheveux courts', 65, F), ('garcon', 'cheveux courts', 113, H),
                          ('homme', 'cheveux courts, penché vers l\'enfant', 155, F)]),
    (5, 1): dict(id='famille-papa-chat-trois-enfants', groupe='animal', nom='Papa, chat et trois enfants', certitude='probable',
                 membres=[('homme', 'cheveux courts', 66, F), ('chat', 'assis, de dos, oreilles pointues', 108, H), ('garcon', 'cheveux courts', 134, H),
                          ('bebe', 'tout-petit, cheveux courts', 166, H), ('garcon', 'cheveux courts bouclés', 200, H)]),
    (5, 2): dict(id='famille-papa-trois-enfants', groupe='famille', nom='Papa et trois enfants', certitude='sure',
                 membres=[('homme', 'cheveux courts', 61, F), ('garcon', 'cheveux courts bouclés', 121, H), ('bebe', 'tout-petit', 155, H),
                          ('fille', 'deux macarons', 205, H)]),
    (5, 3): dict(id='famille-maman-trois-garcons', groupe='famille', nom='Maman et trois garçons', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 64, F), ('garcon', 'cheveux courts', 116, H), ('garcon', 'cheveux courts', 157, H),
                          ('garcon', 'cheveux courts', 197, H)]),
    (5, 4): dict(id='famille-maman-doudou-papa-garcon', groupe='famille', nom='Maman, doudou, papa et garçon', certitude='douteuse',
                 membres=[('femme', 'cheveux longs ondulés', 52, F),
                          ('bebe', 'pas un enfant : ours en peluche (doudou) de dos, deux oreilles rondes ; à défaut bébé en bonnet à oreilles', 88, H),
                          ('homme', 'cheveux courts', 122, F), ('garcon', 'petit, cheveux courts', 176, H)]),
    (5, 5): dict(id='famille-papa-enfant-chien', groupe='animal', nom='Papa, enfant et chien', certitude='probable',
                 membres=[('homme', 'cheveux courts', 67, F), ('enfant', 'boucles volumineuses jusqu\'à la mâchoire', 117, H),
                          ('chien', 'assis, de profil, tourné vers eux', 168, H)]),
    (5, 6): dict(id='famille-maman-bebe-papa', groupe='famille', nom='Maman, bébé et papa', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 56, F), ('bebe', 'tout-petit', 94, H), ('homme', 'cheveux courts', 141, F)]),
    (6, 1): dict(id='famille-cinq', groupe='famille', nom='Maman, papa et trois enfants', certitude='probable',
                 membres=[('femme', 'cheveux longs ondulés', 51, F), ('garcon', 'petit, cheveux courts', 84, H), ('homme', 'cheveux courts', 130, F),
                          ('enfant', 'boucles volumineuses', 181, H), ('enfant', 'petit, boucles jusqu\'à la nuque (peut-être une fille)', 218, H)]),
    (6, 2): dict(id='famille-ado-papa-bebe-maman', groupe='famille', nom='Ado, papa, bébé et maman', certitude='douteuse',
                 membres=[('ado-garcon', 'cheveux courts bouclés, taille d\'adulte', 45, H), ('homme', 'cheveux courts, une mèche à la tempe', 87, F),
                          ('bebe', 'tout-petit, cheveux bouclés', 135, H), ('femme', 'chignon haut, anneau à l\'oreille', 166, F)]),
    (6, 3): dict(id='famille-maman-garcon-papa', groupe='famille', nom='Maman, garçon et papa', certitude='sure',
                 membres=[('femme', 'cheveux longs ondulés', 48, F), ('garcon', 'cheveux courts', 92, H), ('homme', 'cheveux courts ondulés', 140, F)]),
    (6, 4): dict(id='famille-chat-maman-papa-deux-garcons', groupe='animal', nom='Chat, maman, papa et deux garçons', certitude='probable',
                 membres=[('chat', 'assis, de dos, oreilles pointues', 36, H), ('femme', 'cheveux longs ondulés', 86, F), ('garcon', 'petit, cheveux courts', 118, H),
                          ('homme', 'cheveux bouclés', 168, F), ('garcon', 'cheveux courts', 219, H)]),
    (6, 5): dict(id='famille-deux-mamans-garcon-fille', groupe='famille', nom='Deux mamans, garçon et fille', certitude='douteuse',
                 membres=[('femme', 'carré court bouclé, de profil', 60, F), ('femme', 'cheveux mi-longs, plus petite', 112, F),
                          ('garcon', 'petit, cheveux courts', 158, H), ('fille', 'petit chignon', 180, H)]),
    (6, 6): dict(id='famille-maman-papa-boucle-garcon', groupe='famille', nom='Maman, papa et garçon', certitude='probable',
                 membres=[('femme', 'chignon haut', 62, F), ('homme', 'cheveux bouclés', 111, F), ('garcon', 'cheveux courts', 166, H)]),
}

# ------------------------------------------------------------------------------------
# Retouches du masque, case par case (voir plus haut), en px de la planche (x, y).
# B r5c1 : la tête du chat, son cou et ses deux oreilles, à la place de la tête collée
# au bras du papa ; ellipse (cx, cy, rx, ry) ou polygone, l'union est dessinée.
# ------------------------------------------------------------------------------------
CHAT = [
    ('ellipse', 125.5, 740.0, 8.6, 8.2),                                          # tête
    ('poly', [(119.5, 744.0), (131.5, 744.0), (131.0, 752.6), (118.6, 752.6)]),  # cou, jusqu'au corps
    ('poly', [(117.6, 736.0), (117.2, 726.8), (122.8, 732.6)]),                  # oreille gauche
    ('poly', [(133.4, 736.0), (133.8, 726.8), (128.2, 732.6)]),                  # oreille droite
]


def couverture(formes, xs, ys, ss=8):
    """Part de chaque pixel (centres xs, ys en px de la planche) couverte par l'union des formes (ys x xs)."""
    off = (np.arange(ss) + 0.5) / ss - 0.5
    px = xs[None, :, None, None] + off[None, None, None, :] + 0 * (ys[:, None, None, None] + off[None, None, :, None])
    py = ys[:, None, None, None] + off[None, None, :, None] + 0 * px
    pts = np.stack([px.ravel(), py.ravel()], axis=1)
    dedans = np.zeros(len(pts), bool)
    for f in formes:
        if f[0] == 'ellipse':
            _, cx, cy, rx, ry = f
            dedans |= ((pts[:, 0] - cx) / rx) ** 2 + ((pts[:, 1] - cy) / ry) ** 2 <= 1
        else:
            dedans |= measure.points_in_poly(pts, np.array(f[1]))
    return dedans.reshape(px.shape).mean(axis=(2, 3))


def retouche_chat(m, y0, x0):
    """B r5c1 : tête du chat redessinée, détachée du bras du papa, deux oreilles pointues (28/11).

    Dans le masque m (rangée 0 = y0, colonne 0 = x0 de la planche), rangées 724 à 751 : tout
    est effacé entre le bras du papa (gardé jusqu'à x = 113, puis 112 dès que le jour
    d'origine s'ouvre sous la tête) et le bras du garçon (gardé dès x = 136, puis 135), puis
    CHAT y est dessiné (pixel noir s'il est couvert à moitié au moins).
    """
    ys, xs = np.arange(724, 752), np.arange(113, 136)
    cov = couverture(CHAT, xs, ys)
    for i, y in enumerate(ys):
        xa, xb = (114 if y <= 742 else 113), (135 if y <= 749 else 134)
        for j, x in enumerate(xs):
            if xa <= x <= xb:
                m[y - y0, x - x0] = cov[i, j] >= 0.5


RETOUCHES = {(5, 1): retouche_chat}

img = np.asarray(Image.open(SRC).convert('L')).astype(float)
noir = img < SEUIL
HH, WW = noir.shape


def plages(occ):
    """Plages consécutives de True : [(début, fin exclue)]."""
    out, x = [], 0
    while x < len(occ):
        if occ[x]:
            d = x
            while x < len(occ) and occ[x]:
                x += 1
            out.append((d, x))
        else:
            x += 1
    return out


BANDES = plages(noir.any(axis=1))
assert len(BANDES) == 6, BANDES
CASES = []
for r, (a, b) in enumerate(BANDES):
    segs = plages(noir[a:b].any(axis=0))
    assert len(segs) == 6, (r, segs)
    for c, (x0, x1) in enumerate(segs):
        CASES.append((r + 1, c + 1, a, b, x0, x1))


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
    """Catmull-Rom fermé -> Bézier ; angles > 70° gardés pointus.

    Bras des points de contrôle bornés à la moitié de leur segment (28/11) : la base
    est un seul long segment après RDP, et la tangente au coin genou-sol, calculée
    depuis l'autre bout de la base, faisait gonfler la courbe de ~4 cm hors du genou
    (et hors de gauche/droite). Bornés, le débord tombe de 1797 px à 18 px sur la planche.
    """
    n = len(pts)
    out = [f"M{pts[0][0]:.2f} {pts[0][1]:.2f}"]

    def angle(a, b, c):
        u, v = a - b, c - b
        nu, nv = np.hypot(*u), np.hypot(*v)
        if nu == 0 or nv == 0:
            return 180
        return np.degrees(np.arccos(np.clip(np.dot(u, v) / (nu * nv), -1, 1)))

    def borne(bras, longueur):
        lb = np.hypot(*bras)
        return bras * (0.5 * longueur / lb) if lb > 0.5 * longueur else bras

    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        seg = np.hypot(*(p2 - p1))
        c1 = p1 + borne((p2 - p0) / 6, seg) if angle(p0, p1, p2) > 110 else p1
        c2 = p2 - borne((p3 - p1) / 6, seg) if angle(p1, p2, p3) > 110 else p2
        out.append(f"C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
    return "".join(out) + "Z"


def masque_case(a, b, x0, x1, retouche=None):
    """Masque de la scène, ombre portée coupée, retouché s'il le faut, poussières retirées, recadré en haut."""
    m = noir[max(0, a - 3):min(HH, b + 3), x0:x1]
    yb = int(np.nonzero(m.any(axis=1))[0].max())
    m = m[: yb + 1 - OMBRE].copy()
    if retouche:
        retouche(m, max(0, a - 3), x0)
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    tailles = ndimage.sum(m, lab, range(1, n + 1))
    garde = np.zeros_like(m)
    for i, t in enumerate(tailles):
        if t >= POUSSIERE:
            garde |= lab == (i + 1)
    ys = np.nonzero(garde.any(axis=1))[0]
    y_haut = int(ys.min())
    return garde[y_haut:], max(0, a - 3) + y_haut, max(0, a - 3) + yb


def hauteur_tete(mk, x):
    """Du sol au sommet de la tête, en px, autour de la colonne x (± 3)."""
    col = mk[:, max(0, x - 3):x + 4].any(axis=1)
    return mk.shape[0] - int(np.nonzero(col)[0].min())


def sous_contours(mk):
    """Les sous-chemins du masque : [(contour brut, sommets gardés par RDP)], en px du masque bordé de 2."""
    lisse = ndimage.gaussian_filter(np.pad(mk.astype(float), 2), 0.6)
    out = []
    for cont in measure.find_contours(lisse, 0.5):
        if len(cont) < 8:
            continue
        if np.allclose(cont[0], cont[-1]):
            cont = cont[:-1]
        loin = int(np.argmax(np.hypot(*(cont - cont[0]).T)))
        sommets = np.vstack([rdp(cont[: loin + 1], 0.8)[:-1], rdp(np.vstack([cont[loin:], cont[:1]]), 0.8)[:-1]])
        if len(sommets) < 3:
            continue
        out.append((cont, sommets))
    return out


def raccorder(mk0, mk1, marge=4):
    """Les sommets du masque retouché mk1, raccordés à ceux du masque d'origine mk0.

    Vectoriser mk1 de zéro déplacerait les sommets de RDP tout le long du grand contour
    (jusqu'à 1 cm sur la tête du garçon voisin du chat) : on garde ceux de mk0 partout où le
    masque n'a pas changé, et l'on ne re-simplifie que le tronçon retouché, entre les deux
    sommets d'avant les plus proches restés hors de la retouche (à plus de `marge` px des
    pixels changés, et sur le nouveau contour au point près). Les sous-chemins intacts restent
    tels quels, dans leur ordre ; un trou absorbé par la retouche disparaît (en B r5c1, celui
    entre le bras du papa et le corps du chat, qui s'ouvre désormais sur le jour).
    """
    avant, apres = sous_contours(mk0), sous_contours(mk1)
    meme = lambda p, q: p.shape == q.shape and np.array_equal(p, q)
    changes_avant = [k for k, (c, _) in enumerate(avant) if not any(meme(c, q) for q, _ in apres)]
    changes_apres = [k for k, (c, _) in enumerate(apres) if not any(meme(c, p) for p, _ in avant)]
    assert len(changes_apres) == 1, ('la retouche doit changer un seul sous-chemin', changes_apres)
    neuf = apres[changes_apres[0]][0]
    index = {tuple(p): k for k, p in enumerate(neuf)}
    # L'ancien sous-chemin retouché : celui qui partage le plus de points avec le nouveau.
    i = max(changes_avant, key=lambda k: sum(tuple(p) in index for p in avant[k][0]))
    sommets = avant[i][1]
    zone = ndimage.binary_dilation(np.pad(mk0 ^ mk1, 2), iterations=marge)
    hors = [tuple(p) in index and not zone[int(round(p[0])), int(round(p[1]))] for p in sommets]
    dedans = [k for k, h in enumerate(hors) if not h]
    ia, ib = dedans[0] - 1, dedans[-1] + 1
    assert ia >= 0 and ib < len(sommets) and ib - ia < len(sommets) / 2, ('tronçon retouché inattendu', ia, ib)
    ja, jb = index[tuple(sommets[ia])], index[tuple(sommets[ib])]
    troncon = neuf[ja:jb + 1] if ja < jb else np.vstack([neuf[ja:], neuf[:jb + 1]])
    assert len(troncon) < len(neuf) / 2, 'sens de parcours inattendu'
    retouche = np.vstack([sommets[:ia + 1], rdp(troncon, 0.8)[1:-1], sommets[ib:]])
    return [retouche if k == i else s for k, (_, s) in enumerate(avant) if k == i or k not in changes_avant]


# --- Rendu d'un tracé (pour la planche de contrôle) : Bézier aplaties, règle nonzero ---
def sous_chemins(d):
    nums = lambda s: [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', s)]
    polys = []
    for sp in re.findall(r'M[^M]*', d):
        sp = sp.strip()
        head = re.match(r'M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)', sp)
        cur = np.array([float(head.group(1)), float(head.group(2))])
        pts = [cur]
        for seg in re.findall(r'C[^CZ]*', sp):
            v = nums(seg)
            c1, c2, p = np.array(v[0:2]), np.array(v[2:4]), np.array(v[4:6])
            t = np.linspace(0, 1, 13)[1:, None]
            pts.extend(list((1 - t) ** 3 * cur + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * p))
            cur = p
        polys.append(np.array(pts))
    return polys


def rendre(d, echelle, ox, oy, w, h, ss=4):
    """Rend le tracé (cm) : x_px = ox + x*echelle, y_px = oy + y*echelle ; niveaux de gris 0..1."""
    acc = np.zeros((h * ss, w * ss), np.int32)
    for p in sous_chemins(d):
        xs = (ox + p[:, 0] * echelle) * ss
        ys = (oy + p[:, 1] * echelle) * ss
        aire = 0.5 * np.sum(xs * np.roll(ys, -1) - np.roll(xs, -1) * ys)
        rr, cc = draw.polygon(ys, xs, shape=acc.shape)
        acc[rr, cc] += 1 if aire > 0 else -1
    plein = (acc != 0).astype(float)
    return plein.reshape(h, ss, w, ss).mean(axis=(1, 3))


os.makedirs(SORTIE, exist_ok=True)
resultats = []
for (r, c, a, b, x0, x1) in CASES:
    sc = SCENES[(r, c)]
    retouche = RETOUCHES.get((r, c))
    mk, y_abs_haut, y_abs_bas = masque_case(a, b, x0, x1, retouche)
    hpx, wpx = mk.shape
    adultes = [hauteur_tete(mk, x) for (_, _, x, ref) in sc['membres'] if ref]
    px_par_cm = float(np.mean(adultes)) / 90.0
    tailles_cm = [round(hauteur_tete(mk, x) / px_par_cm) for (_, _, x, _) in sc['membres']]
    if retouche:
        mk0, h0, _ = masque_case(a, b, x0, x1)
        assert mk0.shape == mk.shape and h0 == y_abs_haut, 'la retouche ne doit pas changer le cadre de la case'
        sommets = raccorder(mk0, mk)
    else:
        sommets = [s for _, s in sous_contours(mk)]
    chemins = []
    gauche, droite, haut = 1e9, -1e9, 0.0
    for cont in sommets:
        ycm = (cont[:, 0] - 2 - hpx) / px_par_cm
        xcm = (cont[:, 1] - 2 - wpx / 2) / px_par_cm
        gauche, droite, haut = min(gauche, xcm.min()), max(droite, xcm.max()), min(haut, ycm.min())
        chemins.append(courbe(np.stack([xcm, ycm], axis=1)))
    d = " ".join(chemins)
    # Fidélité : le tracé rendu à l'échelle de la case contre le masque d'origine (retouché s'il l'est).
    rendu = rendre(d, px_par_cm, wpx / 2, hpx, wpx, hpx) > 0.5
    iou = float((rendu & mk).sum() / max(1, (rendu | mk).sum()))
    composition = ' + '.join(f'{t}' for (t, _, _, _) in sc['membres'])
    o = {
        'id': sc['id'], 'gauche': round(gauche, 2), 'droite': round(droite, 2), 'haut': round(haut, 2), 'decalage': 0, 'd': d,
        'groupe': sc['groupe'], 'nom': sc['nom'], 'case': f'B r{r}c{c}',
        'membres': [{'type': t, 'detail': det, 'tailleCm': tc} for (t, det, _, _), tc in zip(sc['membres'], tailles_cm)],
        'certitude': sc['certitude'], 'pxParCm': round(px_par_cm, 4), 'fidelite': round(iou, 4),
    }
    if retouche:
        o['retouche'] = retouche.__doc__.split('\n')[0]
    with open(os.path.join(SORTIE, f'case-r{r}c{c}.json'), 'w', encoding='utf-8') as f:
        json.dump(o, f, ensure_ascii=False)
    resultats.append((o, mk, (a, b, x0, x1, y_abs_haut, y_abs_bas), px_par_cm, composition, tailles_cm))
    print(f"r{r}c{c} {sc['id']:40s} px/cm {px_par_cm:.3f} larg {droite - gauche:6.1f} haut {-haut:5.1f} "
          f"tailles {tailles_cm} fidelite {iou:.4f} sous-chemins {len(chemins)}")

with open(os.path.join(SORTIE, 'ombres-B.json'), 'w', encoding='utf-8') as f:
    json.dump([x[0] for x in resultats], f, ensure_ascii=False)

# --- Planche de contrôle : case originale (ombre comprise) | tracé rendu, légende dessous ---
K = 2           # agrandissement
COLS = 3
# Cellule taillée sur la case la plus large (r6c4 : 260 px) et la plus haute.
LARG_CELL = 2 * (max(x1 - x0 for (_, _, _, _, x0, x1) in CASES) + 8) * K + 40
CH = (max(b - a for (_, _, a, b, _, _) in CASES) + 10) * K + 74
try:
    police = ImageFont.truetype('arial.ttf', 15)
    police_g = ImageFont.truetype('arialbd.ttf', 16)
except OSError:
    police = police_g = ImageFont.load_default()
lignes = (len(resultats) + COLS - 1) // COLS
pl = Image.new('RGB', (COLS * LARG_CELL, lignes * CH), 'white')
dr = ImageDraw.Draw(pl)
for i, (o, mk, (a, b, x0, x1, yh, yb), ppc, compo, tcm) in enumerate(resultats):
    gx, gy = (i % COLS) * LARG_CELL, (i // COLS) * CH
    # Original : de la tête au bas de l'ombre portée, toute la largeur de la case.
    y_bas = min(HH, yb + 3)
    orig = Image.fromarray(img[yh:y_bas, x0 - 4:x1 + 4].astype(np.uint8)).convert('RGB')
    orig = orig.resize((orig.width * K, orig.height * K), Image.LANCZOS)
    pl.paste(orig, (gx + 10, gy + 8))
    # Tracé : même cadrage (la base du tracé tombe sur la base coupée de l'original).
    hpx, wpx = mk.shape
    h_tot, w_tot = (y_bas - yh), (x1 - x0 + 8)
    g = rendre(o['d'], ppc * K, (wpx / 2 + 4) * K, hpx * K, w_tot * K, h_tot * K)
    trace = Image.fromarray((255 - g * 225).astype(np.uint8)).convert('RGB')
    tr = ImageDraw.Draw(trace)
    tr.line([(0, hpx * K), (w_tot * K, hpx * K)], fill=(220, 40, 40), width=1)  # y = 0
    pl.paste(trace, (gx + 20 + orig.width, gy + 8))
    dr.rectangle([gx + 2, gy + 2, gx + LARG_CELL - 4, gy + CH - 4], outline=(200, 200, 200))
    dr.text((gx + 10, gy + CH - 62), f"{o['case']}  ·  {o['id']}  ·  {o['certitude']}" + ('  ·  chat retouché' if 'retouche' in o else ''),
            fill=(0, 0, 0), font=police_g)
    dr.text((gx + 10, gy + CH - 42), ' + '.join(f"{m['type']} {m['tailleCm']}" for m in o['membres']) + ' (cm)', fill=(30, 30, 30), font=police)
    dr.text((gx + 10, gy + CH - 22), f"{o['droite'] - o['gauche']:.0f} x {-o['haut']:.0f} cm  ·  fidélité {o['fidelite']:.3f}", fill=(90, 90, 90), font=police)
pl.save(CONTROLE, quality=88)
print('planche', pl.size, CONTROLE)
