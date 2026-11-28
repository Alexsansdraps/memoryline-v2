"""Découpe et vectorisation des motifs « Marché de Noël de Mulhouse ».

Sources (Documents/memory-line/protos) :
  - motifs-alsace-noel.webp : 4 rangées de 4 motifs noirs sur blanc (16 motifs) ;
  - motifs-mulhouse-2.png   : 3 rangées de 4 motifs noirs sur blanc (12 motifs).
Sorties (à côté de ce fichier) :
  - motifs/motif-<id>.svg   : un SVG par motif, viewBox serrée sur le motif, zones .stN
                              (st0 = trait sombre, puis façades colorées, puis crème) ;
  - motifs/index.json       : [{id, fichier, categorie, nom, noms (7 langues), zones,
                              zones_noms, source}], dans l'ordre proposé aux clients ;
  - motifs/categories.json  : les catégories dans l'ordre, libellés en 7 langues ;
  - planche-motifs.jpg      : contrôle, original | rendu du SVG sur un fond coloré.

Rejouable : python decoupe.py                     (tous les motifs)
            python decoupe.py bretzel sapin       (seulement ceux-là, planche non refaite)
            python decoupe.py --debug             (+ debug/ : cartes intérieur/extérieur)
Dépendances : numpy, PIL, scipy, scikit-image.

Méthode
  1. Encre = gris < 110. Les composantes connexes sont rangées par case de la grille ;
     les petits fragments vont à la case la plus proche, les poussières sont ignorées.
  2. Trait (.st0) : marching squares sur le GRIS lissé (gauss 0.6) au niveau 110 — le
     bord antialiasé donne une position sous le pixel —, RDP 0.7 px (un contour fermé
     est coupé en deux au point le plus éloigné), Catmull-Rom -> Bézier avec angles vifs
     gardés. Les trous (détails blancs) restent des trous : fill-rule evenodd.
  3. Intérieur / extérieur : sur la planche, le blanc sert à la fois de fond et de
     peinture blanche. On épaissit le trait (fermeture de rayon r, réglée par motif, plus
     quelques « sceaux » tracés à la main là où un contour reste ouvert, au pied d'un
     bâtiment par exemple) :
       - mode « enveloppe » (défaut, bâtiments et objets) : tout le blanc pris dans le
         dessin ainsi fermé est intérieur, y compris les fins liserés blancs ouverts à
         un bout (rives de toit, mèches de cheveux) ; le blanc sans aucun trait au-dessus
         de lui (le ciel) reste du fond ;
       - mode « graines » (feuillages) : le blanc libre après fermeture donne des graines
         (fond / poches) et une propagation (ligne de partage des eaux sur fond plat)
         répartit le reste : les jours entre aiguilles et branches restent du fond.
  4. Remplissages sous le trait : l'« enveloppe » du motif (tout sauf le fond et les vides
     voulus : boucles du bretzel, centre de la couronne...), rentrée d'un pixel, est
     remplie en crème — ou, pour les maisons, découpée par façade (une poche blanche va
     à la façade qui en contient la majorité, puis chaque pixel prend la couleur de la
     poche la plus proche). Le trait sombre passe par-dessus : aucun liseré entre le
     trait et le remplissage, et les blancs restent lisibles sur n'importe quel fond.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from html import escape

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage import measure, morphology, segmentation

ICI = os.path.dirname(os.path.abspath(__file__))
PROTOS = os.path.normpath(os.path.join(ICI, '..', '..', '..', 'protos'))
SORTIE = os.path.join(ICI, 'motifs')
PLANCHE = os.path.join(ICI, 'planche-motifs.jpg')
DEBUG = os.path.join(ICI, 'debug')

SEUIL = 110          # gris < SEUIL = encre
SIGMA_TRAIT = 0.4    # lissage du gris avant marching squares (trait), en px source
SUR_TRAIT = 2        # suréchantillonnage du gris avant marching squares
SIGMA_ZONE = 0.8     # lissage des masques de remplissage
RDP_TRAIT = 0.7      # tolérance de simplification (px source)
RDP_ZONE = 1.0
AIRE_MIN = 5.0       # contours plus petits ignorés (px²)
COMPO_MIN = 12       # composantes d'encre plus petites : poussières (hors boîte d'un motif)
PETIT_MIN = 4        # dans la boîte d'un motif, on garde les traits dès 4 px
TROU_MIN = 5         # points blancs plus petits dans l'encre : bouchés
MAIN_MIN = 1500      # composante « principale » d'une case (px)
RATTACHE_MAX = 40    # distance max (px) d'un fragment à la boîte d'une case
MARGE = 8            # marge blanche autour d'un motif découpé (px)
COTE_SVG = 1024      # taille intrinsèque (plus grand côté) : net à l'impression

SOMBRE = '#2B2B2B'
CREME = '#FFF8EC'
OCRE = '#E9C46A'
SAUMON = '#E8A598'
CIEL = '#9CC3D5'
SAUGE = '#A9C5A0'

PLANCHES = [
    ('motifs-alsace-noel.webp', 4, 4, [
        'hotel-de-ville', 'temple-saint-etienne', 'maisons-alsaciennes', 'chalet-de-noel',
        'tour-ronde', 'tissu-fleuri', 'bobine-et-tissu', 'poinsettia',
        'sapin', 'coeur-pain-epice', 'etoile', 'lanterne',
        'bonhomme-pain-epice', 'kougelhopf', 'bretzel', 'couronne-avent',
    ]),
    ('motifs-mulhouse-2.png', 3, 4, [
        'tour-bollwerk', 'tour-de-l-europe', 'locomotive', 'voiture-ancienne',
        'usine-textile', 'tampon-textile', 'metier-a-tisser', 'chapelle',
        'klapperstein', 'maisons-ouvrieres', 'vignoble', 'cigogne',
    ]),
]

# Rangement proposé aux clients : catégories dans l'ordre (slug, libellé), puis motifs, avec
# le nom affiché dans les 7 langues du site (fr, en, de, it, es, ja, zh ; les noms propres
# restent). Les slugs sont ceux de motifs-3/index.json (3e et 4e planches, découpées à
# part par decoupe3.py) : « strasbourg-colmar » n'a ici aucun motif.
LANGUES = ('fr', 'en', 'de', 'it', 'es', 'ja', 'zh')


def _n(*noms: str) -> dict[str, str]:
    return dict(zip(LANGUES, noms))


CATEGORIES = [
    ('mulhouse', _n(*['Mulhouse'] * 7), [
        ('hotel-de-ville', _n('Hôtel de ville', 'Town Hall', 'Rathaus', 'Municipio',
                              'Ayuntamiento', '市庁舎', '市政厅')),
        ('temple-saint-etienne', _n(*['Temple Saint-Étienne'] * 7)),
        ('tour-de-l-europe', _n(*["Tour de l'Europe"] * 7)),
        ('tour-bollwerk', _n(*['Tour du Bollwerk'] * 7)),
        ('tour-ronde', _n('Tour ronde', 'Round Tower', 'Runder Turm', 'Torre rotonda',
                          'Torre redonda', '円塔', '圆塔')),
        ('klapperstein', _n(*['Klapperstein'] * 7)),
        ('chapelle', _n('Chapelle', 'Chapel', 'Kapelle', 'Cappella', 'Capilla', '礼拝堂', '小教堂')),
        ('maisons-ouvrieres', _n('Cité ouvrière', "Workers' Houses", 'Arbeitersiedlung',
                                 'Quartiere operaio', 'Barrio obrero', '労働者住宅', '工人住宅')),
    ]),
    ('textile-musees', _n('Textile et musées', 'Textiles & Museums', 'Textil & Museen',
                          'Tessile e musei', 'Textil y museos', '織物と博物館', '纺织与博物馆'), [
        ('usine-textile', _n('Usine textile', 'Textile Mill', 'Textilfabrik', 'Fabbrica tessile',
                             'Fábrica textil', '織物工場', '纺织厂')),
        ('metier-a-tisser', _n('Métier à tisser', 'Loom', 'Webstuhl', 'Telaio', 'Telar',
                               '織機', '织布机')),
        ('tampon-textile', _n('Impression sur étoffes', 'Fabric Printing', 'Stoffdruck',
                              'Stampa su tessuto', 'Estampado textil', '布のプリント', '织物印花')),
        ('bobine-et-tissu', _n('Bobine et tissu', 'Spool and Fabric', 'Garnrolle und Stoff',
                               'Rocchetto e tessuto', 'Carrete y tela', '糸巻きと布', '线轴与布料')),
        ('tissu-fleuri', _n('Tissu fleuri', 'Floral Fabric', 'Blumenstoff', 'Tessuto a fiori',
                            'Tela floreada', '花柄の布', '花布')),
        ('locomotive', _n('Locomotive', 'Locomotive', 'Lokomotive', 'Locomotiva', 'Locomotora',
                          '蒸気機関車', '蒸汽机车')),
        ('voiture-ancienne', _n('Voiture ancienne', 'Vintage Car', 'Oldtimer', "Auto d'epoca",
                                'Coche antiguo', 'クラシックカー', '老爷车')),
    ]),
    ('strasbourg-colmar', _n('Strasbourg et Colmar', 'Strasbourg & Colmar', 'Straßburg & Colmar',
                             'Strasburgo e Colmar', 'Estrasburgo y Colmar',
                             'ストラスブールとコルマール', '斯特拉斯堡与科尔马'), []),
    ('maisons-alsace', _n("Maisons d'Alsace", 'Alsatian Houses', 'Elsässer Häuser',
                          "Case d'Alsazia", 'Casas de Alsacia', 'アルザスの家', '阿尔萨斯民居'), [
        ('maisons-alsaciennes', _n('Maisons alsaciennes', 'Alsatian Houses', 'Elsässer Fachwerkhäuser',
                                   'Case alsaziane', 'Casas alsacianas', 'アルザスの家並み',
                                   '阿尔萨斯民居')),
    ]),
    ('noel', _n('Noël', 'Christmas', 'Weihnachten', 'Natale', 'Navidad', 'クリスマス', '圣诞'), [
        ('chalet-de-noel', _n('Chalet de Noël', 'Christmas Market Stall', 'Weihnachtsmarktbude',
                              'Casetta di Natale', 'Caseta navideña', 'クリスマスマーケットの屋台',
                              '圣诞集市小屋')),
        ('sapin', _n('Sapin de Noël', 'Christmas Tree', 'Weihnachtsbaum', 'Albero di Natale',
                     'Árbol de Navidad', 'クリスマスツリー', '圣诞树')),
        ('etoile', _n('Étoile', 'Star', 'Stern', 'Stella', 'Estrella', '星', '星星')),
        ('lanterne', _n('Lanterne', 'Lantern', 'Laterne', 'Lanterna', 'Farol', 'ランタン', '提灯')),
        ('couronne-avent', _n("Couronne de l'Avent", 'Advent Wreath', 'Adventskranz',
                              "Corona dell'Avvento", 'Corona de Adviento', 'アドベントリース',
                              '将临期花环')),
        ('poinsettia', _n('Poinsettia', 'Poinsettia', 'Weihnachtsstern', 'Stella di Natale',
                          'Flor de Pascua', 'ポインセチア', '一品红')),
    ]),
    ('gourmandises', _n('Gourmandises', 'Treats', 'Leckereien', 'Golosità', 'Dulces', 'お菓子',
                        '美食'), [
        ('bonhomme-pain-epice', _n("Bonhomme en pain d'épices", 'Gingerbread Man', 'Lebkuchenmann',
                                   'Omino di pan di zenzero', 'Hombre de jengibre',
                                   'ジンジャーブレッドマン', '姜饼人')),
        ('coeur-pain-epice', _n("Cœur en pain d'épices", 'Gingerbread Heart', 'Lebkuchenherz',
                                'Cuore di pan di zenzero', 'Corazón de jengibre',
                                'ハートのジンジャーブレッド', '姜饼心')),
        ('kougelhopf', _n('Kougelhopf', 'Kougelhopf', 'Gugelhupf', 'Kougelhopf', 'Kougelhopf',
                          'クグロフ', 'Kougelhopf')),
        ('bretzel', _n('Bretzel', 'Pretzel', 'Brezel', 'Bretzel', 'Pretzel', 'プレッツェル',
                       '椒盐卷饼')),
    ]),
    ('alsace', _n('Alsace', 'Alsace', 'Elsass', 'Alsazia', 'Alsacia', 'アルザス', '阿尔萨斯'), [
        ('cigogne', _n('Cigogne', 'Stork', 'Storch', 'Cicogna', 'Cigüeña', 'コウノトリ', '白鹳')),
        ('vignoble', _n('Vignoble', 'Vineyard', 'Weinberg', 'Vigneto', 'Viñedo', 'ブドウ畑',
                        '葡萄园')),
    ]),
]

# Réglages par motif (coordonnées en px de la planche source) :
#   mode     : 'enveloppe' (défaut) ou 'graines' (feuillages), cf. l'en-tête ;
#   r        : rayon de fermeture du trait pour séparer intérieur et fond (défaut 3) ;
#   sceaux   : lignes [(x, y), ...] ajoutées au trait (seulement pour cette séparation),
#              pour fermer un contour ouvert ;
#   sol      : (mode enveloppe) le blanc sans trait au-dessous de lui reste du fond ;
#   vides    : points (x, y) dont la poche blanche reste transparente ;
#   vides_fins: rayon r : dans ces poches vides, les liserés plus fins que 2r restent crème ;
#   vide_aire: poches d'au moins cette aire (px²) transparentes ;
#   pleins   : points dont la poche reste remplie même si elle dépasse vide_aire ;
#   facades  : [(classe, couleur, nom, polygone)] : une poche blanche dont la majorité
#              des pixels tombe dans le polygone prend la couleur de cette façade ; le
#              reste de l'intérieur est crème (classe suivante) ;
#   creme    : False pour ne rien remplir en crème ; nom_creme : libellé de la zone crème.
R_DEFAUT = 3
MODE_DEFAUT = 'enveloppe'
REGLAGES: dict[str, dict] = {
    'maisons-alsaciennes': {
        # la façade de la maison de gauche n'a pas de trait sur son flanc gauche, et le
        # bas de la terrasse (pilier blanc, pieds de chaises) s'ouvre sur le dehors
        'sceaux': [[(675, 183), (675, 277)], [(700, 322), (968, 322)]],
        'facades': [
            ('st1', SAUMON, 'façade de la maison de gauche (étroite), rose saumon',
             [(668, 186), (713, 176), (713, 300), (668, 300)]),
            ('st2', OCRE, 'façade de la grande maison du milieu, jaune ocre',
             [(716, 262), (716, 182), (790, 100), (867, 190), (867, 262)]),
            ('st3', CIEL, 'façade de la maison de droite, bleu ciel',
             [(869, 262), (869, 190), (920, 110), (970, 196), (970, 262)]),
        ],
        'nom_creme': 'parasols, chaises, porte et liserés des toits (crème)',
    },
    'maisons-ouvrieres': {
        # la palissade descend jusqu'au bas du dessin : on la ferme pour que les piquets
        # blancs soient remplis (crème) et non transparents
        'sceaux': [[(755, 950), (756, 960), (756, 991), (362, 991)]],
        'facades': [
            ('st1', OCRE, 'grande maison de gauche (et son auvent), jaune ocre',
             [(356, 960), (356, 826), (400, 826), (400, 792), (477, 756), (540, 850), (540, 960)]),
            ('st2', SAUMON, 'deuxième maison, rose saumon',
             [(540, 960), (540, 850), (588, 800), (631, 868), (631, 960)]),
            ('st3', CIEL, 'troisième maison, bleu ciel',
             [(631, 960), (631, 868), (659, 830), (691, 880), (691, 960)]),
            ('st4', SAUGE, 'quatrième maison (la plus petite), vert sauge',
             [(691, 960), (691, 880), (713, 852), (742, 902), (742, 960)]),
        ],
        'nom_creme': 'palissade, fenêtres et liserés des toits (crème)',
    },
    # contours ouverts en bas (pas de ligne de sol) : on ferme le pied des bâtiments,
    # le sceau chevauchant le bas du trait
    'hotel-de-ville': {'sceaux': [[(184, 322), (232, 322)]]},   # piliers de la porte
    'tissu-fleuri': {'sceaux': [[(463, 621), (489, 621)]]},     # pied de la tige, bord cranté
    # tour du Bollwerk : du pied de l'arbre au bas de la tour, puis tout le pied à y = 354
    'tour-bollwerk': {'sceaux': [[(119, 343), (120, 354), (364, 354)]]},
    'tour-de-l-europe': {'sceaux': [[(434, 346), (691, 346)]]},
    # vides : poches blanches qui sont du fond vu à travers le dessin
    'bretzel': {'vides': [(749, 1066), (865, 1063), (807, 1127)], 'vides_fins': 4},
    'coeur-pain-epice': {'vides': [(454, 680), (538, 680), (481, 719), (505, 719)]},
    'etoile': {'vides': [(823, 675)]},
    'bobine-et-tissu': {'vides': [(840, 499)]},
    # feuillages : mode graines, r = 0 : les jours entre aiguilles et branches restent du
    # fond (une fermeture même légère en faisait des taches crème au hasard)
    'poinsettia': {'mode': 'graines', 'r': 0},
    # sapin : deux sceaux autour de l'attache de la boule de gauche (sinon le crochet et
    # la calotte, reliés au dehors par un jour entre deux branches, restaient vides)
    'sapin': {'mode': 'graines', 'r': 0,
              'sceaux': [[(107, 817), (107, 831)], [(125, 809), (125, 823)]]},
    'couronne-avent': {'mode': 'graines', 'r': 0, 'vides': [(1140, 1075)]},
    'lanterne': {'mode': 'graines', 'r': 0, 'vides': [(1135, 672)]},
    # chalet : les branches de sapin de part et d'autre restent ajourées
    'chalet-de-noel': {'mode': 'graines'},
    # paysage : collines et champs entre les rangs de vigne remplis (vignette crème), le
    # ciel reste vide ; un sceau ferme le bas entre le dernier rang et la grappe
    'vignoble': {'mode': 'enveloppe', 'r': 20, 'sceaux': [[(948, 996), (1062, 1001)]],
                 'nom_creme': 'collines et champs (crème)'},
}


# ---------------------------------------------------------------- géométrie

def rdp(pts: np.ndarray, eps: float) -> np.ndarray:
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    n = math.hypot(*ab)
    if n == 0:
        d = np.hypot(*(pts - a).T)
    else:
        d = np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / n
    i = int(np.argmax(d))
    if d[i] > eps:
        g = rdp(pts[: i + 1], eps)
        h = rdp(pts[i:], eps)
        return np.vstack([g[:-1], h])
    return np.vstack([a, b])


def rdp_ferme(pts: np.ndarray, eps: float) -> np.ndarray:
    """Contour fermé : coupé en deux au point le plus éloigné du départ."""
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) < 4:
        return pts
    j = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    g = rdp(pts[: j + 1], eps)
    h = rdp(np.vstack([pts[j:], pts[:1]]), eps)
    return np.vstack([g[:-1], h[:-1]])


def aire(xy: np.ndarray) -> float:
    x, y = xy[:, 0], xy[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def nombre(v: float) -> str:
    t = f'{v:.1f}'
    if t.endswith('.0'):
        t = t[:-2]
    return '0' if t == '-0' else t


def bezier_d(pts: np.ndarray) -> str:
    """Polygone fermé -> chemin Catmull-Rom en Bézier, angles vifs gardés."""
    n = len(pts)
    if n < 3:
        return ''
    tang = np.zeros_like(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        u, v = p1 - p0, p2 - p1
        nu, nv = math.hypot(*u), math.hypot(*v)
        if nu == 0 or nv == 0:
            continue
        if float(np.dot(u, v) / (nu * nv)) < 0.5:     # virage > 60° : angle vif
            continue
        tang[i] = (p2 - p0) / 6.0
    f = lambda q: f'{nombre(q[0])} {nombre(q[1])}'
    out = [f'M{f(pts[0])}']
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        seg = math.hypot(*(b - a))

        def borne(t):  # poignées bornées au tiers du segment : pas de boucle parasite
            lt = math.hypot(*t)
            return t * ((seg / 3) / lt) if lt > seg / 3 else t
        ta, tb = borne(tang[i].copy()), borne(tang[(i + 1) % n].copy())
        if not ta.any() and not tb.any():
            out.append(f'L{f(b)}')
        else:
            out.append(f'C{f(a + ta)} {f(b - tb)} {f(b)}')
    out.append('Z')
    return ''.join(out)


def contours_de(champ: np.ndarray, niveau: float, ox: float, oy: float, eps: float,
                sur: int = 1) -> list[np.ndarray]:
    """Contours fermés (x, y) du champ au niveau donné, en coordonnées planche.
    (ox, oy) = position planche du bord du pixel source [0, 0] ; le champ peut être
    suréchantillonné `sur` fois (centre du pixel j du champ = (j + 0.5) / sur)."""
    res = []
    for c in measure.find_contours(champ, niveau):
        xy = np.stack([(c[:, 1] + 0.5) / sur + ox, (c[:, 0] + 0.5) / sur + oy], 1)
        if aire(xy) < AIRE_MIN:
            continue
        s = rdp_ferme(xy, eps)
        if len(s) >= 3:
            res.append(s)
    return res


def disque(r: int) -> np.ndarray:
    return morphology.disk(r).astype(bool)


def trace_lignes(masque: np.ndarray, lignes, x0: int, y0: int, largeur: int = 3) -> None:
    if not lignes:
        return
    im = Image.fromarray(masque.astype(np.uint8) * 255)
    dr = ImageDraw.Draw(im)
    for ligne in lignes:
        dr.line([(x - x0, y - y0) for x, y in ligne], fill=255, width=largeur)
    masque |= np.array(im) > 0


def polygone(forme, x0: int, y0: int) -> np.ndarray:
    im = Image.new('1', forme[0], 0)
    ImageDraw.Draw(im).polygon([(x - x0, y - y0) for x, y in forme[1]], fill=1)
    return np.array(im, bool)


# ---------------------------------------------------------------- découpe

def cases(gris: np.ndarray, nr: int, nc: int, ids: list[str]):
    """Repère les nr x nc motifs : composantes principales par case de la grille nominale
    (centre dans la case), puis chaque fragment va à la case dont la boîte est la plus
    proche (fragments trop loin de tout motif = poussières, ignorés)."""
    encre = gris < SEUIL
    lab, n = ndi.label(encre, np.ones((3, 3)))
    objs = ndi.find_objects(lab)
    aires = ndi.sum(encre, lab, range(1, n + 1))
    H, W = gris.shape
    groupes = [[] for _ in range(nr * nc)]
    boites = [None] * (nr * nc)
    for i in range(n):
        if aires[i] < MAIN_MIN:
            continue
        s = objs[i]
        cx, cy = (s[1].start + s[1].stop) / 2, (s[0].start + s[0].stop) / 2
        k = min(int(cy * nr / H), nr - 1) * nc + min(int(cx * nc / W), nc - 1)
        groupes[k].append(i + 1)
        b = (s[1].start, s[0].start, s[1].stop, s[0].stop)
        o = boites[k]
        boites[k] = b if o is None else (min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3]))
    ignores = []
    for i in range(n):
        if aires[i] >= MAIN_MIN:
            continue
        s = objs[i]
        cx, cy = (s[1].start + s[1].stop) / 2, (s[0].start + s[0].stop) / 2
        dist = []
        for k, b in enumerate(boites):
            if b is None:
                continue
            dx = max(b[0] - cx, 0, cx - b[2])
            dy = max(b[1] - cy, 0, cy - b[3])
            dist.append((math.hypot(dx, dy), k))
        d, k = min(dist)
        # petits traits DANS la boîte d'un motif (briques, points de décor) : gardés ;
        # ailleurs, seuls les fragments assez gros et assez proches sont rattachés.
        if (aires[i] >= COMPO_MIN and d <= RATTACHE_MAX) or (aires[i] >= PETIT_MIN and d == 0):
            groupes[k].append(i + 1)
        else:
            ignores.append((int(aires[i]), int(cx), int(cy)))
    for k, g in enumerate(groupes):
        if not g:
            raise SystemExit(f'case vide : {ids[k]}')
    return lab, list(zip(ids, groupes)), ignores


def separer(encre: np.ndarray, r: int, sceaux, x0: int, y0: int, mode: str = MODE_DEFAUT,
            sol: bool = False):
    """Étiquettes des pixels blancs : 1 = fond (relié au bord), >= 2 = poches intérieures ;
    + le masque des sceaux tracés.

    mode 'enveloppe' (défaut) : tout le blanc compris dans le dessin fermé (fermeture de
      rayon r + sceaux, trous bouchés) est intérieur, fins liserés ouverts à un bout
      compris ; on retire le blanc qui n'a aucun trait au-dessus de lui (le ciel, les
      creux autour d'une flèche) et, avec sol=True, celui qui n'en a aucun au-dessous.
    mode 'graines' (feuillages) : le blanc libre après fermeture donne les graines (fond /
      poches) ; la propagation répartit ensuite le reste du blanc : une échancrure étroite
      du contour extérieur reste du fond, une poche à peine entrouverte devient intérieure."""
    H, W = encre.shape
    P = r + 3
    b = np.pad(encre, P)
    if r > 0:
        b = ndi.binary_closing(b, disque(r))
    b = b[P:-P, P:-P].copy()
    sceau = np.zeros((H, W), bool)
    trace_lignes(sceau, sceaux, x0, y0)
    b |= sceau
    blanc = ~encre
    if mode == 'enveloppe':
        dedans = ndi.binary_fill_holes(np.pad(b, 1))[1:-1, 1:-1]
        t = (encre | sceau).astype(np.int32)
        dedans &= np.cumsum(t, 0) > 0                       # du trait au-dessus
        if sol:
            dedans &= np.cumsum(t[::-1], 0)[::-1] > 0       # du trait au-dessous
        ws = np.zeros((H, W), np.int32)
        ws[blanc & ~dedans] = 1
        poches, n = ndi.label(blanc & dedans)
        ws[poches > 0] = poches[poches > 0] + 1
        return ws, sceau
    libre = np.pad(~b, 1, constant_values=True)      # le cadre relie tout le fond
    lab, n = ndi.label(libre)                         # 4-connexité
    fond = lab[0, 0]
    lab = lab[1:-1, 1:-1]
    present = np.zeros(n + 1, bool)
    present[np.unique(lab)] = True
    present[0] = False
    table = np.zeros(n + 1, np.int32)
    autres = [e for e in range(1, n + 1) if present[e] and e != fond]
    table[autres] = np.arange(2, len(autres) + 2)
    table[fond] = 1
    marqueurs = table[lab]
    # les sceaux arrêtent aussi la propagation : le fond ne repasse pas sous eux
    ws = segmentation.watershed(np.zeros((H, W)), marqueurs, mask=blanc & ~sceau)
    # blanc qu'aucune graine n'atteint (bouché par la fermeture, ou derrière un sceau) :
    # intérieur
    reste, nr_ = ndi.label(blanc & (ws == 0))
    if nr_:
        ws[reste > 0] = reste[reste > 0] + len(autres) + 1
    return ws, sceau


def decouper(ident: str, gris: np.ndarray, lab: np.ndarray, gids: list[int], debug: bool):
    rg = REGLAGES.get(ident, {})
    ys, xs = np.nonzero(np.isin(lab, gids))
    x0, x1 = max(int(xs.min()) - MARGE, 0), min(int(xs.max()) + MARGE + 1, lab.shape[1])
    y0, y1 = max(int(ys.min()) - MARGE, 0), min(int(ys.max()) + MARGE + 1, lab.shape[0])
    g = gris[y0:y1, x0:x1].astype(float)
    brut = np.isin(lab[y0:y1, x0:x1], gids)
    # encre nettoyée : points blancs minuscules bouchés
    trous, nt = ndi.label(~brut)
    if nt:
        at = ndi.sum(np.ones_like(trous), trous, range(1, nt + 1))
        petits = np.zeros(nt + 1, bool)
        petits[1:] = at < TROU_MIN
        petits[trous[0, 0]] = False
        encre = brut | petits[trous]
    else:
        encre = brut
    H, W = encre.shape

    # ---- séparation intérieur / fond
    ws, sceau = separer(encre, rg.get('r', R_DEFAUT), rg.get('sceaux'), x0, y0,
                        rg.get('mode', MODE_DEFAUT), rg.get('sol', False))
    fond = ws == 1
    vide = np.zeros_like(fond)
    poches = [k for k in np.unique(ws) if k >= 2]
    if poches:
        aires = dict(zip(poches, ndi.sum(np.ones_like(ws), ws, poches)))
        pleins = {ws[y - y0, x - x0] for x, y in rg.get('pleins', [])}
        va = rg.get('vide_aire')
        for k in poches:
            if va is not None and aires[k] >= va and k not in pleins:
                vide |= ws == k
        ouv = rg.get('vides_fins')   # rayon : les fins liserés d'une poche vide restent crème
        for x, y in rg.get('vides', []):
            k = ws[y - y0, x - x0]
            if k >= 2:
                m = ws == k
                if ouv:
                    m = ndi.binary_opening(np.pad(m, ouv + 1), disque(ouv))[ouv + 1:-ouv - 1, ouv + 1:-ouv - 1]
                vide |= m
            elif k == 0:
                print(f'  ! {ident} : le point vide ({x},{y}) tombe sur le trait')
    # un sceau ferme le dessin : le remplissage descend jusqu'à lui (pas de liseré de fond
    # entre le bas du trait et le remplissage)
    enveloppe = ~(fond | vide) | (sceau & ~vide)
    enveloppe = ndi.binary_erosion(np.pad(enveloppe, 1), np.ones((3, 3)))[1:-1, 1:-1]
    interieur_blanc = (ws >= 2) & ~vide

    # ---- classes de remplissage
    facades = rg.get('facades', [])
    zones: list[tuple[str, str, str, np.ndarray]] = []
    if facades:
        # chaque poche blanche va, entière, à la façade qui en contient la majorité
        graines = np.zeros((H, W), np.int16)          # 0 = crème
        polys = [polygone(((W, H), poly), x0, y0) for *_, poly in facades]
        poches_int = [k for k in poches if (ws == k).any() and not (vide & (ws == k)).any()]
        for k in poches_int:
            m = ws == k
            n = m.sum()
            parts = [(p & m).sum() for p in polys]
            i = int(np.argmax(parts))
            if parts[i] > n / 2:
                graines[m] = i + 1
        # chaque pixel de l'enveloppe prend la classe du blanc intérieur le plus proche
        _, (iy, ix) = ndi.distance_transform_edt(~interieur_blanc, return_indices=True)
        carte = graines[iy, ix]
        for i, (cl, col, nom, _) in enumerate(facades, start=1):
            zones.append((cl, col, nom, enveloppe & (carte == i)))
        creme = enveloppe & (carte == 0)
        cl_creme = f'st{len(facades) + 1}'
    else:
        creme = enveloppe
        cl_creme = 'st1'
    if rg.get('creme', True) and creme.any():
        zones.append((cl_creme, CREME, rg.get('nom_creme', 'blancs intérieurs (crème)'), creme))

    # ---- vectorisation
    P = 3
    gt = g.copy()
    proche = ndi.binary_dilation(encre, disque(2))
    gt[~proche] = 255.0
    gt[(g < SEUIL) & ~encre] = 255.0      # encre d'une autre case ou poussière
    gt[encre & (g >= SEUIL)] = 0.0        # points blancs bouchés
    # suréchantillonnage x2 (cubique) avant le lissage : les fins liserés blancs (reflets,
    # rives) gardent leur largeur au lieu de se boucher
    gt = ndi.zoom(np.pad(gt, P, constant_values=255.0), SUR_TRAIT, order=3,
                  mode='nearest', grid_mode=True)
    gt = ndi.gaussian_filter(gt, SIGMA_TRAIT * SUR_TRAIT)
    trait = contours_de(gt, SEUIL, x0 - P, y0 - P, RDP_TRAIT, SUR_TRAIT)
    remplis = []
    for cl, col, nom, m in zones:
        mm = ndi.gaussian_filter(np.pad(m.astype(float), P), SIGMA_ZONE)
        cs = contours_de(mm, 0.5, x0 - P, y0 - P, RDP_ZONE)
        if cs:
            remplis.append((cl, col, nom, cs))

    toutes = np.vstack(trait + [c for *_, cs in remplis for c in cs])
    bx0, by0 = np.floor(toutes.min(0) - 1)
    bx1, by1 = np.ceil(toutes.max(0) + 1)
    Wv, Hv = bx1 - bx0, by1 - by0
    dec = np.array([bx0, by0])
    d = lambda cs: ''.join(bezier_d(c - dec) for c in cs)
    e = COTE_SVG / max(Wv, Hv)
    css = ''.join(f'.{cl}{{fill:{col};fill-rule:evenodd}}' for cl, col, _, _ in remplis)
    css = f'.st0{{fill:{SOMBRE};fill-rule:evenodd}}' + css
    lignes = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wv:.0f} {Hv:.0f}" '
        f'width="{Wv * e:.0f}" height="{Hv * e:.0f}">',
        f'<!-- motif {ident} : remplissages sous le trait, puis trait sombre .st0 -->',
        f'<defs><style>{css}</style></defs>',
    ]
    for cl, col, nom, cs in remplis:
        lignes.append(f'<g data-zone="{escape(nom)}"><path class="{cl}" fill-rule="evenodd" d="{d(cs)}"/></g>')
    lignes.append(f'<g data-zone="silhouette (trait sombre)"><path class="st0" fill-rule="evenodd" d="{d(trait)}"/></g>')
    lignes.append('</svg>')
    svg = '\n'.join(lignes) + '\n'
    with open(os.path.join(SORTIE, f'motif-{ident}.svg'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(svg)

    if debug:
        os.makedirs(DEBUG, exist_ok=True)
        vis = np.full((H, W, 3), 255, np.uint8)
        vis[fond] = (190, 225, 255)                  # fond : bleu pâle
        vis[vide & ~encre] = (255, 170, 200)         # vides voulus : rose
        rng = np.random.default_rng(3)
        for k in np.unique(ws[interieur_blanc]):
            vis[(ws == k) & interieur_blanc] = rng.integers(150, 250, 3)
        vis[encre] = (0, 0, 0)
        im = Image.fromarray(vis).resize((W * 3, H * 3), Image.NEAREST)
        dr = ImageDraw.Draw(im)
        for x in range((x0 // 25 + 1) * 25, x0 + W, 25):
            dr.line([((x - x0) * 3, 0), ((x - x0) * 3, 6)], fill=(255, 0, 0))
            if x % 50 == 0:
                dr.text(((x - x0) * 3 + 2, 6), str(x), fill=(255, 0, 0))
        for y in range((y0 // 25 + 1) * 25, y0 + H, 25):
            dr.line([(0, (y - y0) * 3), (6, (y - y0) * 3)], fill=(255, 0, 0))
            if y % 50 == 0:
                dr.text((8, (y - y0) * 3 - 5), str(y), fill=(255, 0, 0))
        im.save(os.path.join(DEBUG, f'{ident}.png'))
        with open(os.path.join(DEBUG, f'{ident}.json'), 'w', encoding='utf-8') as fh:
            json.dump({'x': int(bx0), 'y': int(by0), 'w': int(Wv), 'h': int(Hv)}, fh)

    return svg, (x0, y0, encre), (int(bx0), int(by0)), {cl: (col, nom) for cl, col, nom, _ in remplis}


# ---------------------------------------------------------------- rendu de contrôle

def lire_svg(svg: str):
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    css = dict(re.findall(r'\.(st\d+)\{fill:(#[0-9A-Fa-f]{6})', svg))
    chemins = re.findall(r'<path class="(st\d+)"[^>]* d="([^"]+)"', svg)
    return vb, css, chemins


def aplatir(d: str):
    polys, cur, pos = [], [], None
    toks = re.findall(r'[MCLZ]|-?\d+(?:\.\d+)?', d)
    i = 0
    while i < len(toks):
        t = toks[i]
        if t == 'M':
            pos = np.array([float(toks[i + 1]), float(toks[i + 2])]); cur = [pos]; i += 3
        elif t == 'L':
            pos = np.array([float(toks[i + 1]), float(toks[i + 2])]); cur.append(pos); i += 3
        elif t == 'C':
            c1, c2, p = (np.array([float(toks[i + 1 + 2 * k]), float(toks[i + 2 + 2 * k])]) for k in range(3))
            for s in np.linspace(0, 1, 9)[1:]:
                cur.append((1 - s) ** 3 * pos + 3 * (1 - s) ** 2 * s * c1 + 3 * (1 - s) * s ** 2 * c2 + s ** 3 * p)
            pos = p; i += 7
        else:  # Z
            polys.append(np.array(cur)); cur = []; i += 1
    return polys


def rendre(svg: str, echelle: float, fond_rgb, taille=None, sur=3):
    """Rendu evenodd (XOR des sous-chemins), suréchantillonné ; ordre du fichier."""
    vb, css, chemins = lire_svg(svg)
    W, H = vb[2], vb[3]
    tw, th = taille if taille else (int(round(W * echelle)), int(round(H * echelle)))
    ox, oy = (tw - W * echelle) / 2, (th - H * echelle) / 2
    s = echelle * sur
    img = np.zeros((th * sur, tw * sur, 3), float)
    img[:] = fond_rgb
    for cl, d in chemins:
        acc = np.zeros((th * sur, tw * sur), bool)
        for p in aplatir(d):
            mm = Image.new('1', (tw * sur, th * sur), 0)
            ImageDraw.Draw(mm).polygon([(x * s + ox * sur, y * s + oy * sur) for x, y in p], fill=1)
            acc ^= np.array(mm, bool)
        col = css[cl]
        img[acc] = [int(col[k:k + 2], 16) for k in (1, 3, 5)]
    return Image.fromarray(img.astype(np.uint8)).resize((tw, th), Image.LANCZOS)


def cle_zone(cl: str) -> int:
    return int(cl[2:])


def index_json(zones_par_id: dict) -> None:
    """motifs/index.json : [{id, fichier, categorie, nom, noms, zones, zones_noms, source}]
    dans l'ordre de présentation aux clients (mêmes clés que motifs-3/index.json, plus
    nom = libellé français et zones_noms) ; motifs/categories.json : toutes les catégories
    dans l'ordre, leurs libellés (7 langues) et les motifs de ces planches-ci."""
    source = {}
    for p, (_, nr, nc, ids) in enumerate(PLANCHES, start=1):
        for k, ident in enumerate(ids):
            source[ident] = f'planche {p} r{k // nc + 1}c{k % nc + 1}'
    ordre, cats = [], []
    for slug, cat, motifs in CATEGORIES:
        cats.append({'id': slug, 'noms': cat, 'motifs': [i for i, _ in motifs]})
        for ident, noms in motifs:
            z = sorted(zones_par_id[ident].items(), key=lambda t: cle_zone(t[0]))
            ordre.append({
                'id': ident, 'fichier': f'motif-{ident}.svg', 'categorie': slug,
                'nom': noms['fr'], 'noms': noms,
                'zones': {'st0': SOMBRE, **{cl: col for cl, (col, _) in z}},
                'zones_noms': {'st0': 'silhouette (trait sombre)', **{cl: nom_z for cl, (_, nom_z) in z}},
                'source': source[ident],
            })
    for nom, donnees in (('index.json', ordre), ('categories.json', cats)):
        with open(os.path.join(SORTIE, nom), 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(donnees, fh, ensure_ascii=False, indent=2)
            fh.write('\n')


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    debug = '--debug' in sys.argv
    os.makedirs(SORTIE, exist_ok=True)
    tous = [i for *_, ids in PLANCHES for i in ids]
    connus = [i for _, _, ms in CATEGORIES for i, _ in ms]
    assert sorted(connus) == sorted(tous), set(connus) ^ set(tous)
    assert all(len(n) == len(LANGUES) for _, c, ms in CATEGORIES for n in [c] + [m for _, m in ms])
    choisis = set(args) if args else set(tous)
    inconnus = choisis - set(tous)
    if inconnus:
        raise SystemExit(f'motifs inconnus : {sorted(inconnus)}')
    fonds = [(196, 30, 58), (31, 77, 58), (232, 220, 200), (27, 42, 74)]
    cw, ch = 300, 280
    nrang = (len(tous) + 3) // 4
    planche = Image.new('RGB', (cw * 2 * 4 + 50, ch * nrang + 10 * (nrang + 1)), (255, 255, 255))
    rapport, zones_par_id = [], {}
    k = -1
    for fichier, nr, nc, ids in PLANCHES:
        src = Image.open(os.path.join(PROTOS, fichier)).convert('RGB')
        gris = np.array(src.convert('L'))
        lab, groupes, ignores = cases(gris, nr, nc, ids)
        for a, x, y in ignores:
            if a >= PETIT_MIN:
                print(f'  poussière ignorée ({fichier}) : {a} px en ({x},{y})')
        for ident, gids in groupes:
            k += 1
            if ident not in choisis:
                continue
            svg, (x0, y0, encre), (bx0, by0), zones = decouper(ident, gris, lab, gids, debug)
            zones_par_id[ident] = zones
            # fidélité : trait sombre rendu vs encre d'origine, au pixel près
            vb, _, _ = lire_svg(svg)
            r = np.array(rendre(svg, 1, (255, 255, 255), taille=(int(vb[2]), int(vb[3]))))
            sombre = np.abs(r.astype(int) - [0x2B, 0x2B, 0x2B]).sum(2) < 60
            ref = np.zeros_like(sombre)
            ys_, xs_ = np.nonzero(encre)
            ys_, xs_ = ys_ + y0 - by0, xs_ + x0 - bx0
            ok = (ys_ >= 0) & (ys_ < ref.shape[0]) & (xs_ >= 0) & (xs_ < ref.shape[1])
            ref[ys_[ok], xs_[ok]] = True
            iou = (sombre & ref).sum() / max((sombre | ref).sum(), 1)
            rapport.append((ident, svg, zones, iou))
            R, C = divmod(k, 4)
            px, py = 10 + C * (2 * cw + 10), 10 + R * (ch + 10)
            hy, hx = encre.shape
            zone = gris[y0:y0 + hy, x0:x0 + hx]
            orig = np.full((hy, hx, 3), 255, np.uint8)
            orig[(zone < SEUIL) & ~encre] = (240, 190, 190)   # encre d'une autre case : rose pâle
            orig[encre] = 0
            orig = Image.fromarray(orig)
            orig.thumbnail((cw - 10, ch - 10))
            planche.paste(orig, (px + (cw - orig.width) // 2, py + (ch - orig.height) // 2))
            e = min((cw - 20) / vb[2], (ch - 20) / vb[3])
            planche.paste(rendre(svg, e, fonds[k % 4], taille=(cw, ch)), (px + cw, py))
    if not args:
        planche.save(PLANCHE, quality=90)
        index_json(zones_par_id)
    for ident, svg, zones, iou in rapport:
        z = ', '.join(f'{cl} {col}' for cl, (col, _) in sorted(zones.items(), key=lambda t: cle_zone(t[0])))
        print(f'{ident:22s} IoU {iou:.3f} {len(svg) / 1024:6.1f} Ko  st0 {SOMBRE}; {z}')


if __name__ == '__main__':
    main()
