"""Découpe et vectorisation des motifs des planches 3, 4 et 5 (Strasbourg, Colmar, Noël).

Sources (Alexandra, 27/11 vers 23 h 40-23 h 50, « évidemment fais le tri sur ce qui est
déjà ressemblant ») : protos/motifs-alsace-3.png, -4.png, -5.png (1536x1024, noir sur blanc).
Sortie : motifs-3/motif-<id>.svg, motifs-3/index.json, planche-motifs-3.jpg.
index.json : [{id, fichier, categorie, nom, noms (fr en de it es ja zh), zones {stN: couleur},
zones_noms {stN: libellé}, source}], le même schéma que motifs/index.json (decoupe.py).

Rejouable :
  python decoupe3.py                      motifs gardés + index + planche de contrôle
  python decoupe3.py --candidats DOSSIER  vectorise aussi les doublons (versions non
                                          retenues) dans DOSSIER, planche de comparaison
  python decoupe3.py --trous DOSSIER      cartes des trous par motif (réglage des zones)

Mêmes conventions et même rendu que decoupe.py (fonctions recopiées, pour ne pas dépendre
de ses évolutions) : encre = gris < 110 ; trait .st0 #2B2B2B tiré du GRIS (suréchantillonné
x2, lissé 0.4, marching squares au niveau 110 : le bord antialiasé donne une position sous
le pixel), RDP 0.7, Catmull-Rom -> Bézier avec angles vifs, fill-rule evenodd ; viewBox
serrée, plus grand côté 1024 px ; remplissages SOUS le trait : blancs intérieurs en crème
#FFF8EC, grands vides (eau, ciel, entre deux pattes, anse...) laissés transparents ;
maisons à colombages : une couleur alsacienne par maison (.st1, .st2...), deux voisines
jamais de la même couleur, colombages et toits sombres ; le crème vient après les maisons.

Ce qui change par rapport à decoupe.py :
  - les rangées n'ont pas toutes le même nombre de motifs (4, 5 ou 6) et la planche 5 a des
    flocons entre les motifs : chaque motif a sa boîte (px de la planche), les composantes
    dont le centre y tombe lui appartiennent, sauf les flocons (boîtes FLOCONS) ;
  - intérieur / fond : un trou (blanc fermé par le trait) est crème, sauf réglage (vides :
    anneau d'accroche, boucles de vrille, anse, entre les pattes ; zones_vides : l'eau) ; un
    fin canal blanc ouvert sur le dehors (nervure de feuille, liseré du rez-de-chaussée,
    rebord de tasse) peut être fermé à la main (sceller / bouchons) ;
  - maisons : chaque maison est un polygone (px de la planche) ; un trou va à la maison qui
    le contient (s'il est à cheval, il est coupé au bord des polygones) ;
  - cœur vichy : le quadrillage, en gris flou sur la planche, est redessiné en grille nette
    à trois tons (sombre, mi-teinte #95918B, crème) ;
  - remplissages : comme l'« enveloppe » de decoupe.py, ils passent sous le trait (jusqu'à
    ENV_D px de leur trou, jamais à moins d'1 px du fond) et d'1 px sous les zones peintes
    après eux : ni fond visible entre trait et remplissage, ni liseré entre deux zones ;
  - bezier_d garde chaque courbe dans la bande de son contour d'origine (DEV_TOL) : un long
    segment suivi d'un virage de 40-60° ne se bombe plus de 2-3 px.
Le tri (« ce qui est déjà ressemblant ») est écrit dans les listes CANDIDATS (doublons d'un
motif gardé, avec la raison) et ECARTES (sujets déjà pris dans motifs/) : la planche de
contrôle les reprend en bas.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from html import escape

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage import measure, morphology

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, 'motifs-3')
PLANCHE = os.path.join(ICI, 'planche-motifs-3.jpg')
PROTOS = os.path.normpath(os.path.join(ICI, '..', '..', '..', 'protos'))
FICHIERS = {3: 'motifs-alsace-3.png', 4: 'motifs-alsace-4.png', 5: 'motifs-alsace-5.png'}

SEUIL = 110          # gris < SEUIL = encre
SIGMA = 0.6          # lissage des masques de remplissage avant marching squares
RDP_EPS = 0.8        # tolérance de simplification des remplissages (px source)
SIGMA_TRAIT = 0.4    # trait : lissage du gris (px source) ...
SUR_TRAIT = 2        # ... suréchantillonné x2 avant marching squares (comme decoupe.py)
RDP_TRAIT = 0.7
AIRE_MIN = 5.0       # contours plus petits ignorés (poussières), px²
COMPO_MIN = 12       # hors boîte : poussière (contrôle des orphelins)
PETIT_MIN = 4        # dans la boîte d'un motif, les traits sont gardés dès 4 px
TROU_MIN = 5         # points blancs plus petits dans l'encre : bouchés
COTE_SVG = 1024      # taille intrinsèque du SVG (plus grand côté) : net à l'impression
ENV_D = 3            # un remplissage s'étend sous le trait jusqu'à ENV_D px de son trou ...
                     # ... sans approcher à moins d'1 px du fond ni d'un vide (cf. vectoriser)
DEV_TOL = 0.25       # une courbe de Bézier ne s'écarte pas du contour d'origine de plus de
                     # DEV_TOL px au-delà de ce que fait le contour lui-même (cf. bezier_d)
SOMBRE = '#2B2B2B'
CREME = '#FFF8EC'

# Teintes alsaciennes : celles de decoupe.py (maisons-alsaciennes). Trois suffisent : les
# maisons d'une scène sont en file, on alterne pour que deux voisines diffèrent toujours.
NUANCES = {
    'rose': ('#E8A598', 'rose saumon'),
    'ocre': ('#E9C46A', 'jaune ocre'),
    'bleu': ('#9CC3D5', 'bleu ciel'),
}
# Vichy : carreaux « une bande » entre le sombre et le crème (le dessin est en niveaux de gris).
MI_TEINTE = '#95918B'

M = dict
TOUT = [(0, 0), (1536, 0), (1536, 1024), (0, 1024)]   # polygone « toute la planche »

# ------------------------------------------------------------------ motifs gardés
# boite : (x0, y0, x1, y1) en px de la planche ; les composantes dont le centre y tombe sont au
# motif. exclure : boîtes de composantes à ignorer. compo_min : taille mini d'une composante
# (px, défaut PETIT_MIN ; 3 pour garder un œil, un cœur de fleur). Trous (zones blanches
# fermées) : crème par défaut ; vides / cremes : points (px planche) dans des trous forcés
# transparents / crème ; zones_vides / zones_creme : polygones, un trou qui y est pour
# moitié devient transparent / crème ; transparents : aire (px²) à partir de laquelle un
# trou est transparent. sceller : polygones où les fins canaux blancs ouverts sur le bord
# sont fermés (ils deviennent des trous crème) ; bouchons : polygones ajoutés à l'encre pour
# ce calcul seulement. maisons : (nuance, libellé, polygone) ; un trou va à la maison qui
# le contient à 85 % (sinon il est coupé au bord des polygones). vichy : voir vichy().
MOTIFS = [
    # ---- Strasbourg et Colmar
    M(id='cathedrale-strasbourg', planche=3, rc='r1c1', boite=(95, 0, 330, 290),
      categorie='strasbourg-colmar',
      noms=M(fr='Cathédrale de Strasbourg', en='Strasbourg Cathedral', de='Straßburger Münster',
             it='Cattedrale di Strasburgo', es='Catedral de Estrasburgo', ja='ストラスブール大聖堂',
             zh='斯特拉斯堡大教堂')),
    M(id='petite-france', planche=3, rc='r1c2', boite=(380, 20, 745, 300),
      categorie='strasbourg-colmar',
      maisons=[
          ('ocre', "grande maison d'angle à gauche",
           [(380, 18), (559, 18), (559, 264), (380, 264)]),
          ('rose', 'maison du milieu',
           [(559, 60), (618, 60), (651, 152), (643, 160), (643, 207), (629, 207), (629, 264), (559, 264)]),
          ('bleu', 'petite maison de droite, derrière le pont',
           [(643, 126), (692, 126), (692, 208), (643, 208)]),
      ],
      vides=[(698, 242)],                                      # sous l'arche du pont
      zones_vides=[[(380, 264), (559, 264), (559, 252), (745, 252), (745, 300), (380, 300)]],  # l'eau
      noms=M(fr='La Petite France', en='La Petite France', de='La Petite France',
             it='La Petite France', es='La Petite France', ja='プティット・フランス', zh='小法兰西')),
    M(id='ponts-couverts', planche=3, rc='r1c3', boite=(750, 40, 1145, 300),
      categorie='strasbourg-colmar',
      noms=M(fr='Les Ponts couverts', en='Ponts Couverts', de='Gedeckte Brücken',
             it='Ponts Couverts', es='Ponts Couverts', ja='ポン・クヴェール', zh='斯特拉斯堡廊桥')),
    M(id='tram-strasbourg', planche=5, rc='r4c1', boite=(0, 770, 342, 1020),
      categorie='strasbourg-colmar',
      noms=M(fr='Tram de Strasbourg', en='Strasbourg Tram', de='Straßburger Straßenbahn',
             it='Tram di Strasburgo', es='Tranvía de Estrasburgo', ja='ストラスブールのトラム',
             zh='斯特拉斯堡有轨电车')),
    M(id='petite-venise', planche=3, rc='r4c3', boite=(740, 745, 1142, 1010),
      categorie='strasbourg-colmar',
      maisons=[
          ('rose', 'maison du fond, à gauche',
           [(799, 778), (826, 778), (837, 834), (831, 840), (831, 899), (799, 899)]),
          ('bleu', 'deuxième maison du fond',
           [(831, 840), (843, 812), (861, 846), (858, 899), (831, 899)]),
          ('ocre', 'troisième maison du fond',
           [(858, 830), (880, 830), (880, 901), (858, 901)]),
          ('rose', 'quatrième maison du fond',
           [(880, 810), (911, 810), (911, 907), (880, 907)]),
          ('bleu', 'longue maison au toit en croupe',
           [(911, 786), (988, 786), (988, 947), (911, 947)]),
          ('ocre', 'grande maison à pignon',
           [(988, 750), (1080, 750), (1080, 905), (1066, 905), (1066, 951), (988, 951)]),
          ('rose', 'maison-tour à droite',
           [(1080, 733), (1140, 733), (1140, 952), (1066, 952), (1066, 905), (1080, 905)]),
      ],
      vides=[(835, 915)],                                      # sous l'arche du pont
      zones_vides=[[(743, 926), (880, 926), (905, 939), (1065, 952), (1140, 955), (1140, 1004),
                    (743, 1004)]],                             # l'eau
      zones_creme=[[(810, 938), (870, 933), (962, 944), (1004, 963), (992, 1002), (848, 1002),
                    (812, 968)]],                              # la barque
      noms=M(fr='La Petite Venise', en='Little Venice', de='Klein-Venedig', it='Piccola Venezia',
             es='Pequeña Venecia', ja='プティット・ヴニーズ', zh='小威尼斯')),
    # ---- Maisons d'Alsace
    M(id='maison-tourelle', planche=3, rc='r2c3', boite=(805, 288, 1070, 560),
      categorie='maisons-alsace',
      maisons=[('ocre', 'maison', TOUT)],
      # le liseré blanc vertical du rez-de-chaussée (x 899) s'ouvre en bas sur le dehors : fermé,
      # il prend la couleur de la façade au lieu de laisser voir le fond comme une fissure
      bouchons=[[(895, 552), (903, 552), (903, 553), (895, 553)]],
      noms=M(fr='Maison à tourelle', en='House with a Turret', de='Haus mit Türmchen',
             it='Casa con torretta', es='Casa con torreta', ja='小塔のある家', zh='带小塔楼的房子')),
    M(id='maison-colombages', planche=4, rc='r2c3', boite=(791, 293, 1057, 560),
      categorie='maisons-alsace',
      maisons=[('rose', 'maison', TOUT)],
      noms=M(fr='Maison à colombages', en='Half-Timbered House', de='Fachwerkhaus',
             it='Casa a graticcio', es='Casa de entramado', ja='木骨造りの家', zh='半木结构房屋')),
    M(id='maison-pignon-redents', planche=3, rc='r2c4', boite=(1180, 288, 1500, 555),
      categorie='maisons-alsace',
      maisons=[
          ('bleu', 'grande maison à pignon à redents',
           [(1180, 285), (1436, 285), (1436, 556), (1180, 556)]),
          ('ocre', 'petite maison à colombages accolée à droite',
           [(1436, 440), (1502, 440), (1502, 556), (1436, 556)]),
      ],
      noms=M(fr='Maison à pignon à redents', en='House with a Stepped Gable',
             de='Haus mit Treppengiebel', it='Casa con frontone a gradoni',
             es='Casa con hastial escalonado', ja='階段状の破風の家', zh='阶梯山墙房屋')),
    # ---- Noël
    M(id='couronne-bougies', planche=5, rc='r4c4', boite=(1001, 800, 1262, 1020),
      categorie='noel',
      # mêmes mots que couronne-avent de decoupe.py (zh compris) : c'est la vraie couronne de
      # l'Avent (4 bougies) ; celle de la planche 1, sans bougies, porte le même nom
      noms=M(fr="Couronne de l'Avent", en='Advent Wreath', de='Adventskranz',
             it="Corona dell'Avvento", es='Corona de Adviento', ja='アドベントリース',
             zh='将临期花环')),
    M(id='coeur-vichy', planche=4, rc='r4c4', boite=(1142, 782, 1510, 1014),
      categorie='noel',
      # Le vichy, en gris flou sur la planche, ne passe pas au seuil : il est reconstruit en
      # grille propre (bandes repérées sur les profils de gris), trois tons.
      vichy=M(boite=(1265, 875, 1405, 995), bord=4.5, seuil=120),
      noms=M(fr='Cœur vichy', en='Gingham Heart', de='Kariertes Herz', it='Cuore a quadretti',
             es='Corazón de cuadros', ja='ギンガムチェックのハート', zh='格纹爱心')),
    M(id='maison-enneigee', planche=5, rc='r2c1', boite=(6, 352, 294, 578),
      categorie='noel',
      # la façade (pignon et mur de côté), sous le toit : neige, cheminée et lucarne restent crème
      maisons=[('rose', 'maison', [(0, 485), (40, 462), (132, 378), (232, 462), (294, 485),
                                   (294, 580), (0, 580)])],
      cremes=[(30, 470), (195, 374)],                         # neige du toit, de la cheminée
      # la couronne (crème) ; coupée à x = 97 : le panneau de façade juste à sa gauche
      # (x 88-95) reste rose
      zones_creme=[[(max(97.0, 130 + 43 * math.cos(a)), 503 + 46 * math.sin(a))
                    for a in np.linspace(0, 2 * math.pi, 24, endpoint=False)]],
      noms=M(fr='Maison enneigée', en='Snowy House', de='Verschneites Haus', it='Casa innevata',
             es='Casa nevada', ja='雪の積もった家', zh='雪中的房子')),
    M(id='boule-de-noel', planche=5, rc='r2c4', boite=(825, 336, 1027, 593),
      categorie='noel', compo_min=3,
      vides=[(926, 362)],                                      # l'anneau d'accroche (on voit au travers)
      noms=M(fr='Boule de Noël', en='Christmas Bauble', de='Weihnachtskugel',
             it='Pallina di Natale', es='Bola de Navidad', ja='クリスマスボール', zh='圣诞球')),
    M(id='bougie-de-noel', planche=5, rc='r3c6', boite=(1229, 577, 1533, 789),
      categorie='noel',
      noms=M(fr='Bougie de Noël', en='Christmas Candle', de='Weihnachtskerze',
             it='Candela di Natale', es='Vela de Navidad', ja='クリスマスキャンドル', zh='圣诞蜡烛')),
    # ---- Gourmandises
    M(id='bredele', planche=3, rc='r3c3', boite=(733, 560, 1093, 744),
      categorie='gourmandises',
      noms=M(fr='Bredele', en='Bredele Cookies', de='Bredele', it='Biscotti bredele',
             es='Galletas bredele', ja='クリスマスクッキー', zh='圣诞饼干')),
    M(id='coeur-cigognes', planche=5, rc='r2c5', boite=(1045, 361, 1314, 607),
      categorie='gourmandises', compo_min=3,                  # yeux des cigognes
      noms=M(fr='Cœur aux cigognes', en='Heart with Storks', de='Herz mit Störchen',
             it='Cuore con cicogne', es='Corazón con cigüeñas', ja='コウノトリのハート',
             zh='白鹳爱心')),
    M(id='vin-chaud', planche=5, rc='r3c1', boite=(24, 577, 254, 786),
      categorie='gourmandises',
      vides=[(190, 680)],                                      # dans l'anse
      # le bord blanc de la tasse ne communique avec le ciel que par les jours entre la vapeur
      # et le rebord : fermés, il devient crème comme le croissant du dessous (sinon le fond
      # passait au travers du rebord)
      bouchons=[[(109, 621), (115, 621), (115, 630), (109, 630)],
                [(125, 625), (136, 625), (136, 630), (125, 630)],
                [(142, 621), (150, 621), (150, 631), (142, 631)]],
      noms=M(fr='Vin chaud', en='Mulled Wine', de='Glühwein', it='Vin brulé', es='Vino caliente',
             ja='ホットワイン', zh='热红酒')),
    # ---- Alsace
    M(id='cigogne-debout', planche=3, rc='r3c1', boite=(100, 550, 305, 755),
      categorie='alsace',
      vides=[(185, 715)],                                      # entre les pattes
      noms=M(fr='Cigogne', en='Stork', de='Storch', it='Cicogna', es='Cigüeña', ja='コウノトリ',
             zh='白鹳')),
    M(id='grappe-raisin', planche=5, rc='r2c6', boite=(1326, 354, 1534, 577),
      categorie='alsace',
      # nervures des feuilles : blanches et ouvertes sur les échancrures -> crème
      sceller=[[(1326, 384), (1372, 354), (1426, 360), (1428, 424), (1400, 460), (1326, 460)],
               [(1440, 440), (1478, 396), (1534, 400), (1534, 474), (1504, 502), (1444, 500)]],
      bouchons=[[(1460, 424), (1468, 424), (1468, 433), (1460, 433)]],   # tige / centre des nervures
      vides=[(1449, 382), (1343, 494), (1365, 520)],          # boucles des vrilles (on voit au travers)
      noms=M(fr='Grappe de raisin', en='Bunch of Grapes', de='Weintraube', it="Grappolo d'uva",
             es='Racimo de uvas', ja='ブドウの房', zh='葡萄串')),     # ブドウ comme « ブドウ畑 » (vignoble)
    M(id='noeud-alsacien', planche=5, rc='r4c5', boite=(1276, 797, 1533, 1019),
      categorie='alsace', compo_min=3,                        # cœurs des fleurs brodées
      noms=M(fr='Nœud alsacien', en='Alsatian Bow', de='Elsässer Schleife', it='Fiocco alsaziano',
             es='Lazo alsaciano', ja='アルザスのリボン', zh='阿尔萨斯蝴蝶结')),
]

# ------------------------------------------------------------------ doublons (non retenus)
# Même sujet qu'un motif gardé : vectorisés seulement avec --candidats, pour comparer en grand.
# « transition » = px gris / px de bord de l'encre (largeur du flou) : 0,8 sur les planches 3
# et 5, 1,0 à 1,3 sur la planche 4.
CANDIDATS = [
    M(id='cand-cathedrale-p4', planche=4, rc='r1c1', boite=(20, 0, 332, 298), pour='cathedrale-strasbourg',
      raison='plus flou (planche 4) ; la flèche centrée est moins fidèle que la façade à flèche unique'),
    M(id='cand-petite-france-p4', planche=4, rc='r1c2', boite=(362, 30, 726, 302), pour='petite-france',
      raison='plus flou (planche 4)'),
    M(id='cand-ponts-couverts-p4', planche=4, rc='r1c3', boite=(740, 44, 1150, 295), pour='ponts-couverts',
      raison='plus flou (planche 4)'),
    M(id='cand-tram-p3', planche=3, rc='r2c2', boite=(375, 300, 750, 545), pour='tram-strasbourg',
      raison='cathédrale réduite à une flèche ; la version de la planche 5 est plus nette et la cathédrale s\'y reconnaît'),
    M(id='cand-tram-p4', planche=4, rc='r2c2', boite=(336, 325, 744, 540), pour='tram-strasbourg',
      raison='tram seul, sans la cathédrale, et plus flou'),
    M(id='cand-quai-p4', planche=4, rc='r2c4', boite=(1125, 314, 1516, 574), pour='petite-venise',
      raison='même sujet (quai, barque, maisons), plus flou'),
    M(id='cand-grande-maison-p3', planche=3, rc='r4c4', boite=(1190, 745, 1495, 1004), pour='maison-colombages',
      raison='3e maison à colombages, proche de la maison à tourelle ; ses fenêtres se brouillent une fois vectorisées'),
    M(id='cand-oriel-p4', planche=4, rc='r3c1', boite=(56, 548, 325, 788), pour='maison-pignon-redents',
      raison='variante du bâtiment à pignon à redents et arcades (avec oriel), plus floue'),
    M(id='cand-redents-clocheton-p4', planche=4, rc='r3c2', boite=(415, 531, 697, 781), pour='maison-pignon-redents',
      raison='variante du bâtiment à pignon à redents (avec clocheton), plus floue'),
    M(id='cand-cigogne-p4', planche=4, rc='r3c3', boite=(766, 564, 974, 785), pour='cigogne-debout',
      raison='plus floue (planche 4)'),
    M(id='cand-bredele-p4', planche=4, rc='r3c5', boite=(1240, 590, 1526, 785), pour='bredele',
      raison='plaque floue'),
    M(id='cand-bredele-p5', planche=5, rc='r3c5', boite=(966, 593, 1216, 790), pour='bredele',
      raison='quatre biscuits épars ; l\'assiette se lit mieux en petit'),
    M(id='cand-coeur-cigogne-p3', planche=3, rc='r4c1', boite=(60, 755, 312, 1004), pour='coeur-cigognes',
      raison='nœud en haut comme le cœur en pain d\'épice déjà pris'),
    M(id='cand-couronne-p3', planche=3, rc='r4c2', boite=(380, 759, 698, 1005), pour='couronne-bougies',
      raison='3 bougies (la couronne de l\'Avent en a 4)'),
    M(id='cand-couronne-p4', planche=4, rc='r4c3', boite=(701, 788, 1066, 1010), pour='couronne-bougies',
      raison='bougies noires, perdues sur fond sombre ; plus floue'),
]

# ------------------------------------------------------------------ sujets écartés
# (planche, case, boîte, sujet, raison) : les boîtes servent au contrôle des orphelins.
ECARTES = [
    (3, 'r1c4', (1170, 30, 1530, 290), 'chalet de Noël', 'déjà pris (chalet-de-noel)'),
    (4, 'r1c4', (1155, 10, 1530, 298), 'chalet de Noël', 'déjà pris (chalet-de-noel)'),
    (5, 'r2c2', (288, 338, 625, 578), 'chalet de Noël', 'déjà pris (chalet-de-noel)'),
    (3, 'r2c1', (66, 286, 325, 548), 'sapin', 'déjà pris (sapin)'),
    (4, 'r2c1', (45, 296, 283, 551), 'sapin', 'déjà pris (sapin)'),
    (5, 'r2c3', (625, 338, 827, 588), 'sapin', 'déjà pris (sapin)'),
    (3, 'r3c2', (444, 554, 620, 757), 'bonhomme en pain d\'épice', 'déjà pris (bonhomme-pain-epice)'),
    (4, 'r3c4', (1026, 560, 1214, 778), 'bonhomme en pain d\'épice', 'déjà pris (bonhomme-pain-epice)'),
    (5, 'r3c2', (273, 585, 447, 786), 'bonhomme en pain d\'épice', 'déjà pris (bonhomme-pain-epice)'),
    (3, 'r3c4', (1199, 568, 1482, 750), 'bretzel', 'déjà pris (bretzel)'),
    (4, 'r4c1', (59, 811, 328, 1004), 'bretzel', 'déjà pris (bretzel)'),
    (5, 'r3c4', (721, 608, 952, 775), 'bretzel', 'déjà pris (bretzel)'),
    (5, 'r3c3', (453, 597, 715, 782), 'kougelhopf', 'déjà pris (kougelhopf)'),
    (5, 'r4c3', (741, 781, 1001, 1015), 'lanterne', 'déjà pris (lanterne)'),
    (5, 'r1c5', (1370, 14, 1533, 344), 'cigogne sur son nid, sur une cheminée', 'déjà pris (cigogne)'),
    (4, 'r4c2', (427, 785, 638, 1009), 'cœur décoré suspendu',
     'ressemble au cœur en pain d\'épice déjà pris (coeur-pain-epice)'),
    (5, 'r1c1', (0, 0, 342, 346), 'banderole « Strasbourg » (cathédrale, lampadaire, maisons)',
     'même monument que cathedrale-strasbourg, avec un nom écrit dessus (le nom va en ligne 1)'),
    (5, 'r1c2', (334, 20, 760, 355), 'banderole « Colmar » (maisons, pont, fleurs)',
     'même sujet que petite-venise / petite-france, avec un nom écrit dessus'),
    (5, 'r1c3', (761, 7, 1067, 339), 'banderole « Mulhouse » (hôtel de ville)',
     'déjà pris (hotel-de-ville), avec un nom écrit dessus'),
    (5, 'r1c4', (1068, 36, 1385, 342), 'banderole « Route des Vins d\'Alsace » (village, vignes)',
     'ressemble au vignoble déjà pris, avec un nom écrit dessus'),
    (5, 'r4c2', (350, 796, 738, 1015), 'maisons et pont fleuri (Colmar sans banderole)',
     'même sujet que petite-venise / petite-france'),
]
# Flocons décoratifs de la planche 5 (entre les motifs) : ignorés.
FLOCONS = {5: [(40, 798, 85, 848), (323, 796, 387, 865), (723, 789, 785, 857),
               (955, 795, 1002, 850), (1225, 790, 1276, 850)]}


# ---------------------------------------------------------------- géométrie (decoupe.py)

def rdp_indices(pts: np.ndarray, eps: float) -> list[int]:
    """Ramer-Douglas-Peucker (même découpe que rdp() de decoupe.py), mais rend les INDICES
    des points gardés : bezier_d() peut ainsi comparer chaque courbe au contour d'origine."""
    n = len(pts)
    if n < 3:
        return list(range(n))
    garde = np.zeros(n, bool)
    garde[0] = garde[-1] = True
    pile = [(0, n - 1)]
    while pile:
        i, j = pile.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        L = math.hypot(*ab)
        seg = pts[i + 1:j]
        if L == 0:
            d = np.hypot(*(seg - a).T)
        else:
            d = np.abs(ab[0] * (seg[:, 1] - a[1]) - ab[1] * (seg[:, 0] - a[0])) / L
        k = int(np.argmax(d))
        if d[k] > eps:
            m = i + 1 + k
            garde[m] = True
            pile += [(i, m), (m, j)]
    return [int(i) for i in np.nonzero(garde)[0]]


def rdp_ferme(pts: np.ndarray, eps: float):
    """Contour fermé : coupé en deux au point le plus éloigné du départ. Rend (points
    simplifiés, contour d'origine sans le point de fermeture, indices des points gardés)."""
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    n = len(pts)
    if n < 4:
        return pts, pts, list(range(n))
    j = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    g = rdp_indices(pts[: j + 1], eps)
    h = rdp_indices(np.vstack([pts[j:], pts[:1]]), eps)
    idx = g[:-1] + [j + t for t in h[:-1]]
    return pts[idx], pts, idx


def nombre(v: float) -> str:
    t = f'{v:.1f}'
    if t.endswith('.0'):
        t = t[:-2]
    return '0' if t == '-0' else t


_T = np.linspace(0.05, 0.95, 19)
_B1, _B2 = 3 * (1 - _T) ** 2 * _T, 3 * (1 - _T) * _T ** 2   # poids des deux poignées


def bezier_d(pts: np.ndarray, orig: np.ndarray | None = None, idx: list[int] | None = None) -> str:
    """Polygone fermé -> chemin Catmull-Rom en Bézier, angles vifs gardés (comme decoupe.py).
    Avec le contour d'origine (orig, et idx = indices des sommets dans orig) : chaque courbe
    reste dans la bande que le contour d'origine occupe de part et d'autre de sa corde (plus
    DEV_TOL) ; sinon ses poignées sont raccourcies. Sans ce garde-fou, un long segment qui
    aboutit à un virage de 40-60° (le faîte d'un toit) se bombait de 3 px dans le trait et
    laissait passer le fond entre trait et remplissage (boule de Noël)."""
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
        cos = float(np.dot(u, v) / (nu * nv))
        if cos < 0.5:          # virage > 60° : angle vif
            continue
        tang[i] = (p2 - p0) / 6.0
    f = lambda q: f'{nombre(q[0])} {nombre(q[1])}'
    out = [f'M{f(pts[0])}']
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        seg = math.hypot(*(b - a))

        def borne(t):  # handles bornées au tiers du segment (pas de boucle parasite)
            lt = math.hypot(*t)
            return t * ((seg / 3) / lt) if lt > seg / 3 else t
        ta, tb = borne(tang[i].copy()), borne(tang[(i + 1) % n].copy())
        if orig is not None and seg > 0 and (ta.any() or tb.any()):
            # écart (signé) à la corde : celui du contour d'origine entre les deux sommets,
            # celui de la courbe (proportionnel à la longueur des poignées)
            j0, j1 = idx[i], idx[(i + 1) % n]
            o = orig[j0:j1 + 1] if j1 > j0 else np.vstack([orig[j0:], orig[:j1 + 1]])
            nrm = np.array([-(b - a)[1], (b - a)[0]]) / seg
            ec = (o - a) @ nrm
            haut, bas = max(float(ec.max()), 0.0) + DEV_TOL, min(float(ec.min()), 0.0) - DEV_TOL
            fc = _B1 * float(ta @ nrm) - _B2 * float(tb @ nrm)
            k = 1.0
            if (fc > haut).any():
                k = min(k, float((haut / fc[fc > haut]).min()))
            if (fc < bas).any():
                k = min(k, float((bas / fc[fc < bas]).min()))
            ta, tb = ta * k, tb * k
        c1, c2 = a + ta, b - tb
        if not ta.any() and not tb.any():
            out.append(f'L{f(b)}')
        else:
            out.append(f'C{f(c1)} {f(c2)} {f(b)}')
    out.append('Z')
    return ''.join(out)


def contours(mask: np.ndarray, x0: float, y0: float, sigma: float = SIGMA,
             eps: float = RDP_EPS) -> list[tuple]:
    """Contours en coordonnées source, poussières retirées : [(points simplifiés, contour
    d'origine, indices)] (cf. rdp_ferme)."""
    m = np.pad(mask.astype(float), 2)
    m = ndi.gaussian_filter(m, sigma)
    res = []
    for c in measure.find_contours(m, 0.5):
        # +0.5 : le centre du pixel i est en i + 0.5 dans le repère SVG
        xy = np.stack([c[:, 1] - 1.5 + x0, c[:, 0] - 1.5 + y0], 1)
        aire = 0.5 * abs(np.dot(xy[:-1, 0], xy[1:, 1]) - np.dot(xy[1:, 0], xy[:-1, 1]))
        if aire < AIRE_MIN:
            continue
        s = rdp_ferme(xy, eps)
        if len(s[0]) >= 3:
            res.append(s)
    return res


def trous(encre: np.ndarray):
    fond, n = ndi.label(~encre)  # 4-connexité (l'encre est en 8-connexité)
    bord = set(np.unique(np.concatenate([fond[0], fond[-1], fond[:, 0], fond[:, -1]])))
    return fond, [k for k in range(1, n + 1) if k not in bord]


# ---------------------------------------------------------------- découpe

_planches: dict[int, tuple] = {}


def planche(p: int):
    """(gris, étiquettes, boîtes, aires) d'une planche, en cache."""
    if p not in _planches:
        gris = np.array(Image.open(os.path.join(PROTOS, FICHIERS[p])).convert('L'))
        encre = gris < SEUIL
        lab, n = ndi.label(encre, np.ones((3, 3)))
        objs = ndi.find_objects(lab)
        aires = ndi.sum(encre, lab, range(1, n + 1))
        _planches[p] = (gris, lab, objs, aires)
    return _planches[p]


def dedans(b, e):
    return e[0] <= b[0] and e[1] <= b[1] and b[2] <= e[2] and b[3] <= e[3]


def selection(m: dict) -> list[int]:
    """Composantes du motif : centre dans sa boîte, hors flocons et exclusions."""
    _, lab, objs, aires = planche(m['planche'])
    bx = m['boite']
    mini = m.get('compo_min', PETIT_MIN)
    exclure = list(m.get('exclure', [])) + FLOCONS.get(m['planche'], [])
    ids = []
    for i, s in enumerate(objs):
        if aires[i] < mini:
            continue
        cx, cy = (s[1].start + s[1].stop) / 2, (s[0].start + s[0].stop) / 2
        if not (bx[0] <= cx < bx[2] and bx[1] <= cy < bx[3]):
            continue
        b = (s[1].start, s[0].start, s[1].stop, s[0].stop)
        if any(dedans(b, e) for e in exclure):
            continue
        ids.append(i + 1)
    if not ids:
        raise SystemExit(f'motif vide : {m["id"]}')
    return ids


def orphelins():
    """Composantes qui n'appartiennent à aucune boîte (motif, doublon ou sujet écarté)."""
    for p in FICHIERS:
        _, lab, objs, aires = planche(p)
        boites = [m['boite'] for m in MOTIFS + CANDIDATS if m['planche'] == p]
        boites += [b for (q, _, b, _, _) in ECARTES if q == p]
        flocons = FLOCONS.get(p, [])
        for i, s in enumerate(objs):
            if aires[i] < COMPO_MIN:
                continue
            cx, cy = (s[1].start + s[1].stop) / 2, (s[0].start + s[0].stop) / 2
            b = (s[1].start, s[0].start, s[1].stop, s[0].stop)
            if any(dedans(b, e) for e in flocons):
                continue
            n = sum(1 for bx in boites if bx[0] <= cx < bx[2] and bx[1] <= cy < bx[3])
            if n != 1:
                print(f'  planche {p} : composante {int(aires[i])} px en ({cx:.0f},{cy:.0f}) '
                      f'dans {n} boîtes')


def masque_poly(poly, x0, y0, shape) -> np.ndarray:
    im = Image.new('1', (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon([(x - x0, y - y0) for x, y in poly], fill=1)
    return np.array(im, bool)


def sceller(encre: np.ndarray, polys, x0: int, y0: int, r: int = 4, bande: int = 3) -> np.ndarray:
    """Pour le calcul des trous seulement : ferme le débouché des fins canaux blancs
    (nervures d'une feuille) sur le bord de la forme, dans les polygones donnés. La forme
    pleine est la fermeture de l'encre (disque de rayon r) ; on bouche une bande de `bande`
    px le long de son bord. Les canaux deviennent des trous (crème) qui s'arrêtent à
    `bande` px du bord ; le trait sombre ne change pas."""
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disque = xx * xx + yy * yy <= r * r
    e = np.pad(encre, r + 1)
    plein = ndi.binary_fill_holes(ndi.binary_closing(e, disque))[r + 1:-r - 1, r + 1:-r - 1]
    bord = ndi.binary_dilation(~plein, iterations=bande) & plein
    zone = np.zeros_like(encre)
    for poly in polys:
        zone |= masque_poly(poly, x0, y0, encre.shape)
    return encre | (bord & ~encre & zone)


def zones(m: dict, encre: np.ndarray, x0: int, y0: int):
    """Répartit les trous en calques. Rend ({clé: masque}, {clé: (couleur, libellé)}, diag) ;
    clés : ('maison', i) pour la maison n° i, 'creme' ; diag = (étiquettes du blanc, trous,
    aires, attribution, encre utilisée pour ce calcul : scellée et bouchée)."""
    if m.get('sceller'):
        encre = sceller(encre, m['sceller'], x0, y0)
    for poly in m.get('bouchons', []):               # ferme un débouché sur le dehors
        encre = encre | masque_poly(poly, x0, y0, encre.shape)
    fond, liste = trous(encre)
    aires = dict(zip(liste, ndi.sum(np.ones_like(fond), fond, liste))) if liste else {}
    maisons = m.get('maisons', [])
    calques: dict = {}
    infos = {('maison', i): (NUANCES[n][0], f'façade de la {lib}, {NUANCES[n][1]}')
             for i, (n, lib, _) in enumerate(maisons)}
    infos['creme'] = (CREME, m.get('nom_creme', 'blancs intérieurs (crème)'))

    def ajoute(cl, msk):
        calques.setdefault(cl, np.zeros_like(encre))
        calques[cl] |= msk

    def trou_en(pt):
        x, y = pt
        k = 0
        if 0 <= y - y0 < fond.shape[0] and 0 <= x - x0 < fond.shape[1]:
            k = int(fond[int(round(y - y0)), int(round(x - x0))])
        if k == 0 or k not in aires:
            print(f'  ! {m["id"]} : le point {pt} n\'est pas dans un trou')
            return None
        return k

    vides = {trou_en(p) for p in m.get('vides', [])} - {None}
    cremes = {trou_en(p) for p in m.get('cremes', [])} - {None}
    pm = [masque_poly(poly, x0, y0, encre.shape) for (_, _, poly) in maisons]
    zc = [masque_poly(poly, x0, y0, encre.shape) for poly in m.get('zones_creme', [])]
    zv = [masque_poly(poly, x0, y0, encre.shape) for poly in m.get('zones_vides', [])]
    seuil_t = m.get('transparents')
    sl = ndi.find_objects(fond)
    rep = {}
    for k in liste:
        a = aires[k]
        s = sl[k - 1]
        hm = fond[s] == k
        msk = np.zeros_like(encre)
        msk[s] = hm
        if k in vides:
            rep[k] = None
            continue
        if k in cremes or any((z[s] & hm).sum() >= 0.5 * a for z in zc):
            rep[k] = 'creme'
            ajoute('creme', msk)
            continue
        if any((z[s] & hm).sum() >= 0.5 * a for z in zv):
            rep[k] = None
            continue
        if pm:
            ov = [(p[s] & hm).sum() for p in pm]
            j = int(np.argmax(ov))
            if ov[j] >= 0.85 * a:                      # trou dans une seule maison
                rep[k] = ('maison', j)
                ajoute(('maison', j), msk)
                continue
            if sum(ov) >= 0.5 * a:                     # à cheval : coupé au bord des polygones
                rep[k] = 'coupé'
                reste = msk.copy()
                for i, p in enumerate(pm):
                    part = msk & p & reste
                    if part.any():
                        ajoute(('maison', i), part)
                        reste &= ~part
                ajoute(('maison', j), reste)
                continue
        if seuil_t is not None and a >= seuil_t:
            rep[k] = None
            continue
        rep[k] = 'creme'
        ajoute('creme', msk)
    return calques, infos, (fond, liste, aires, rep, encre)


def vichy(v: dict, gris: np.ndarray, encre: np.ndarray, x0: int, y0: int):
    """Carreaux vichy redessinés en grille propre. Dans la boîte v['boite'] : l'anneau blanc
    du cœur (plus grande zone claire fermée) délimite l'intérieur ; une bordure sombre de
    v['bord'] px le long de l'anneau ; dedans, colonnes et rangées dont le gris moyen est
    sous v['seuil'] = bandes. Bande x bande : sombre ; une seule bande : mi-teinte ; aucune :
    crème. Rend (encre corrigée, masque des carreaux mi-teinte, intérieur redessiné)."""
    bx0, by0, bx1, by1 = v['boite']
    sl = (slice(by0 - y0, by1 - y0), slice(bx0 - x0, bx1 - x0))
    sub = gris[sl].astype(float)
    clair = sub > 200
    lab, n = ndi.label(clair)
    aires = ndi.sum(clair, lab, range(1, n + 1))
    anneau = lab == int(np.argmax(aires)) + 1
    inter = ndi.binary_fill_holes(anneau) & ~anneau
    dist = ndi.distance_transform_edt(inter)
    motif = dist > v['bord']

    def bandes(axe):
        s = np.where(motif, sub, 0).sum(axe)
        c = motif.sum(axe)
        moy = np.where(c >= 3, s / np.maximum(c, 1), 255.0)
        return moy < v['seuil']
    V = bandes(0)[None, :]
    H = bandes(1)[:, None]
    e = encre.copy()
    e[sl] = np.where(inter, (~motif) | (V & H), e[sl])
    mi = np.zeros_like(encre)
    mi[sl] = motif & (V ^ H)
    dedans = np.zeros_like(encre)
    dedans[sl] = inter
    return e, mi, dedans


def contours_trait(gt: np.ndarray, ox: float, oy: float) -> list[tuple]:
    """Contours du trait sur le gris suréchantillonné (centre du pixel j = (j + 0.5) / SUR) :
    [(points simplifiés, contour d'origine, indices)]."""
    res = []
    for c in measure.find_contours(gt, SEUIL):
        xy = np.stack([(c[:, 1] + 0.5) / SUR_TRAIT + ox, (c[:, 0] + 0.5) / SUR_TRAIT + oy], 1)
        aire = 0.5 * abs(np.dot(xy[:-1, 0], xy[1:, 1]) - np.dot(xy[1:, 0], xy[:-1, 1]))
        if aire < AIRE_MIN:
            continue
        t = rdp_ferme(xy, RDP_TRAIT)
        if len(t[0]) >= 3:
            res.append(t)
    return res


def vectoriser(m: dict, dossier: str):
    gris, lab, _, _ = planche(m['planche'])
    ids = selection(m)
    ys, xs = np.nonzero(np.isin(lab, ids))
    x0, x1 = max(xs.min() - 3, 0), min(xs.max() + 4, lab.shape[1])
    y0, y1 = max(ys.min() - 3, 0), min(ys.max() + 4, lab.shape[0])
    brut = np.isin(lab[y0:y1, x0:x1], ids)
    # points blancs minuscules dans l'encre : bouchés (comme decoupe.py)
    tr, nt = ndi.label(~brut)
    encre_src = brut
    if nt:
        at = ndi.sum(np.ones_like(tr), tr, range(1, nt + 1))
        petits = np.zeros(nt + 1, bool)
        petits[1:] = at < TROU_MIN
        petits[tr[0, 0]] = False
        encre_src = brut | petits[tr]
    encre, mi, redessine = encre_src, None, None
    if m.get('vichy'):
        encre, mi, redessine = vichy(m['vichy'], gris[y0:y1, x0:x1], encre_src, x0, y0)
    calques, infos, diag = zones(m, encre, x0, y0)
    if mi is not None:
        for c in calques:
            calques[c] &= ~mi
        calques['mi'] = mi
        infos['mi'] = (MI_TEINTE, 'carreaux mi-teinte du vichy')

    # classes .st1, .st2... dans l'ordre : maisons, crème, mi-teinte (sans trou de numéro)
    rang = lambda c: (0, c[1]) if isinstance(c, tuple) else ((1, 0) if c == 'creme' else (2, 0))
    ordre = [c for c in sorted(calques, key=rang) if calques[c].any()]
    # remplissages, comme l'« enveloppe » de decoupe.py : ils passent AUSSI sous le trait, pour
    # qu'aucun écart entre le bord du trait (tiré du gris, sous le pixel) et celui du
    # remplissage (tiré du masque) ne laisse voir le fond. Chaque pixel d'encre (la vraie, pas
    # les bouchons ni les scellés) à moins de ENV_D px d'un trou rempli prend la zone du trou
    # le plus proche, sauf à moins d'1 px d'un blanc non rempli (fond, vide, débouché fermé
    # pour le calcul) : le remplissage ne dépasse jamais du trait vers le dehors.
    zl = np.full(encre.shape, -1, np.int32)
    for i, c in enumerate(ordre):
        zl[calques[c]] = i
    rempli = zl >= 0
    transparent = ~encre & ~rempli
    dist, (iy, ix) = ndi.distance_transform_edt(~rempli, return_indices=True)
    proche = zl[iy, ix]
    marge = ndi.binary_dilation(transparent, np.ones((3, 3), bool))
    env = rempli | (encre & (dist <= ENV_D) & ~marge)
    parts = [env & (proche == i) for i in range(len(ordre))]
    rempl = {}
    for i, c in enumerate(ordre):
        apres = np.zeros_like(encre)
        for p in parts[i + 1:]:
            apres |= p
        # et d'1 px sous les zones peintes après elle : pas de liseré entre deux zones (les
        # carreaux du vichy, deux façades qui se partagent un trou)
        msk = parts[i] | (ndi.binary_dilation(parts[i]) & apres)
        # carreaux mi-teinte du vichy : leur bord contre le crème se voit ; lissage et
        # simplification légers pour garder des carrés nets (coins vifs, côtés droits)
        cs = contours(msk, x0, y0, *((0.3, 0.4) if c == 'mi' else (SIGMA, RDP_EPS)))
        if cs:
            rempl[c] = cs
    ordre = [c for c in ordre if c in rempl]

    # trait : sur le gris (bord antialiasé = position sous le pixel), comme decoupe.py ; on
    # efface l'encre qui n'est pas au motif, on noircit les points blancs bouchés
    P = 3
    g = gris[y0:y1, x0:x1].astype(float)
    gt = g.copy()
    gt[~ndi.binary_dilation(encre_src, morphology.disk(2).astype(bool))] = 255.0
    gt[(g < SEUIL) & ~encre_src] = 255.0
    gt[encre_src & (g >= SEUIL)] = 0.0
    if redessine is not None:                    # vichy redessiné : noir / blanc francs
        gt[redessine] = np.where(encre[redessine], 0.0, 255.0)
    gt = ndi.zoom(np.pad(gt, P, constant_values=255.0), SUR_TRAIT, order=3, mode='nearest',
                  grid_mode=True)
    gt = ndi.gaussian_filter(gt, SIGMA_TRAIT * SUR_TRAIT)
    silh = contours_trait(gt, x0 - P, y0 - P)

    classe = {c: f'st{i + 1}' for i, c in enumerate(ordre)}

    allp = np.vstack([p for p, _, _ in silh])
    bx0, by0 = np.floor(allp.min(0) - 1)
    bx1, by1 = np.ceil(allp.max(0) + 1)
    W, H = bx1 - bx0, by1 - by0
    e = COTE_SVG / max(W, H)
    dec = np.array([bx0, by0])
    d = lambda cs: ''.join(bezier_d(p - dec, o - dec, ix) for p, o, ix in cs)
    css = f'.st0{{fill:{SOMBRE};fill-rule:evenodd}}' + ''.join(
        f'.{classe[c]}{{fill:{infos[c][0]};fill-rule:evenodd}}' for c in ordre)
    lignes = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
        f'width="{W * e:.0f}" height="{H * e:.0f}">',
        f'<!-- motif {m["id"]} : remplissages sous le trait, puis trait sombre .st0 -->',
        f'<defs><style>{css}</style></defs>',
    ]
    for c in ordre:
        cl = classe[c]
        lignes.append(f'<g data-zone="{escape(infos[c][1])}"><path class="{cl}" fill-rule="evenodd" d="{d(rempl[c])}"/></g>')
    lignes.append(f'<g data-zone="silhouette (trait sombre)"><path class="st0" fill-rule="evenodd" d="{d(silh)}"/></g>')
    lignes.append('</svg>')
    svg = '\n'.join(lignes) + '\n'
    os.makedirs(dossier, exist_ok=True)
    with open(os.path.join(dossier, f'motif-{m["id"]}.svg'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(svg)
    zones_idx = {'st0': SOMBRE}
    zones_idx.update({classe[c]: infos[c][0] for c in ordre})
    zones_noms = {'st0': 'silhouette (trait sombre)'}
    zones_noms.update({classe[c]: infos[c][1] for c in ordre})
    return svg, (x0, y0, encre_src), (bx0, by0), zones_idx, (diag, calques, infos, encre), zones_noms


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


def rendre(svg: str, echelle: float, fond_rgb, taille=None, sur=4):
    """Rendu evenodd (XOR des sous-chemins), suréchantillonné ; chaque sous-chemin est
    dessiné dans sa propre boîte (plus rapide que decoupe.rendre, même résultat)."""
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
            q = np.array([(x * s + ox * sur, y * s + oy * sur) for x, y in p])
            qx0, qy0 = np.floor(q.min(0)).astype(int) - 1
            qx1, qy1 = np.ceil(q.max(0)).astype(int) + 2
            qx0, qy0 = max(qx0, 0), max(qy0, 0)
            qx1, qy1 = min(qx1, tw * sur), min(qy1, th * sur)
            if qx1 <= qx0 or qy1 <= qy0:
                continue
            mm = Image.new('1', (qx1 - qx0, qy1 - qy0), 0)
            ImageDraw.Draw(mm).polygon([(x - qx0, y - qy0) for x, y in q], fill=1)
            acc[qy0:qy1, qx0:qx1] ^= np.array(mm, bool)
        col = css[cl]
        img[acc] = [int(col[k:k + 2], 16) for k in (1, 3, 5)]
    return Image.fromarray(img.astype(np.uint8)).resize((tw, th), Image.LANCZOS)


def fidelite(svg, x0, y0, encre, bx0, by0):
    """IoU entre le sombre rendu (échelle 1) et l'encre source."""
    gr = np.array(rendre(svg, 1, (255, 255, 255)))
    sombre = (np.abs(gr.astype(int) - [0x2B, 0x2B, 0x2B]).sum(2) < 90)
    ref = np.zeros_like(sombre)
    dy, dx = int(round(y0 - by0)), int(round(x0 - bx0))
    ys0, xs0 = max(dy, 0), max(dx, 0)
    sub = encre[ys0 - dy: ys0 - dy + ref.shape[0] - ys0, xs0 - dx: xs0 - dx + ref.shape[1] - xs0]
    ref[ys0:ys0 + sub.shape[0], xs0:xs0 + sub.shape[1]] = sub
    return (sombre & ref).sum() / max((sombre | ref).sum(), 1)


def police(t, gras=False):
    for f in (('arialbd.ttf' if gras else 'arial.ttf'), 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(f, t)
        except OSError:
            pass
    return ImageFont.load_default()


def vignette_originale(m, x0, y0, encre, cw, ch):
    """Original en niveaux de gris ; l'encre qui n'est pas au motif (voisin, flocon,
    poussière) en rose pâle."""
    gris = planche(m['planche'])[0]
    hy, hx = encre.shape
    zone = gris[y0:y0 + hy, x0:x0 + hx]
    orig = np.repeat(zone[:, :, None], 3, 2).astype(np.uint8)
    orig[(zone < SEUIL) & ~encre] = (240, 190, 190)
    im = Image.fromarray(orig)
    im.thumbnail((cw - 10, ch - 10), Image.LANCZOS)
    return im


def planche_controle(lots, chemin, ecartes_txt, titre, par_rangee=3):
    cw, ch, lh = 260, 240, 30
    tuile = 3 * cw + 2 * 6
    W = par_rangee * tuile + (par_rangee + 1) * 16
    nr = (len(lots) + par_rangee - 1) // par_rangee
    f_titre, f_lbl, f_txt = police(26, True), police(17), police(17)
    haut_txt = 60 + 24 * len(ecartes_txt) + 20 if ecartes_txt else 0
    H = 50 + nr * (ch + lh + 16) + haut_txt
    pl = Image.new('RGB', (W, H), (255, 255, 255))
    dr = ImageDraw.Draw(pl)
    dr.text((16, 12), titre, fill=(0, 0, 0), font=f_titre)
    clair = (232, 220, 200)
    sombres = [(27, 42, 74), (31, 77, 58), (122, 28, 46)]
    for k, (m, svg, (x0, y0, encre), etiquette) in enumerate(lots):
        R, C = divmod(k, par_rangee)
        px, py = 16 + C * (tuile + 16), 50 + R * (ch + lh + 16)
        o = vignette_originale(m, x0, y0, encre, cw, ch)
        pl.paste(o, (px + (cw - o.width) // 2, py + (ch - o.height) // 2))
        vb, _, _ = lire_svg(svg)
        e = min((cw - 20) / vb[2], (ch - 20) / vb[3])
        pl.paste(rendre(svg, e, clair, taille=(cw, ch)), (px + cw + 6, py))
        pl.paste(rendre(svg, e, sombres[k % 3], taille=(cw, ch)), (px + 2 * cw + 12, py))
        dr.rectangle((px, py, px + cw - 1, py + ch - 1), outline=(210, 210, 210))
        dr.text((px, py + ch + 5), etiquette, fill=(0, 0, 0), font=f_lbl)
    if ecartes_txt:
        y = 50 + nr * (ch + lh + 16) + 10
        dr.text((16, y), 'Écartés (« fais le tri sur ce qui est déjà ressemblant ») :', fill=(0, 0, 0), font=police(20, True))
        y += 34
        for t in ecartes_txt:
            dr.text((24, y), t, fill=(40, 40, 40), font=f_txt)
            y += 24
    pl.save(chemin, quality=90)


# ---------------------------------------------------------------- cartes des trous

def carte_trous(m, dossier, ech=3):
    """Encre (gris foncé) + zones (couleurs ; transparent = bleu clair ; encre d'un autre motif
    = rose) + grille en px de la planche + polygones (maisons violet, crème orange, vides cyan)."""
    gris = planche(m['planche'])[0]
    svg, (x0, y0, encre_src), _, _, ((fond, liste, aires, rep, _), calques, infos, encre), _ = vectoriser(m, dossier)
    y1, x1 = y0 + encre.shape[0], x0 + encre.shape[1]
    img = np.full(encre.shape + (3,), 255, np.uint8)
    for c, msk in calques.items():
        col = infos[c][0]
        img[msk] = [int(col[k:k + 2], 16) for k in (1, 3, 5)]
    for k, c in rep.items():
        if c is None:
            img[fond == k] = (170, 235, 255)     # trou laissé transparent : bleu clair
    img[encre] = (60, 60, 60)
    autre = (gris[y0:y1, x0:x1] < SEUIL) & ~encre_src & ~encre
    img[autre] = (240, 150, 150)
    im = Image.fromarray(img).resize((encre.shape[1] * ech, encre.shape[0] * ech), Image.NEAREST)
    dr = ImageDraw.Draw(im)
    f = police(11)
    for gx in range((x0 // 10 + 1) * 10, x1, 10):
        c = (255, 0, 0) if gx % 50 == 0 else (255, 200, 200)
        dr.line([((gx - x0) * ech, 0), ((gx - x0) * ech, im.height)], fill=c, width=1)
        if gx % 50 == 0:
            dr.text(((gx - x0) * ech + 2, 2), str(gx), fill=(255, 0, 0), font=f)
    for gy in range((y0 // 10 + 1) * 10, y1, 10):
        c = (0, 0, 255) if gy % 50 == 0 else (200, 200, 255)
        dr.line([(0, (gy - y0) * ech), (im.width, (gy - y0) * ech)], fill=c, width=1)
        if gy % 50 == 0:
            dr.text((2, (gy - y0) * ech + 2), str(gy), fill=(0, 0, 255), font=f)

    def trace(poly, col, txt=None):
        pts = [((x - x0) * ech, (y - y0) * ech) for x, y in poly]
        dr.line(pts + [pts[0]], fill=col, width=2)
        if txt:
            cx, cy = np.mean(pts, 0)
            dr.text((cx, cy), txt, fill=col, font=police(16, True))
    for i, (n, lib, poly) in enumerate(m.get('maisons', [])):
        if poly is not TOUT:
            trace(poly, (200, 0, 200), f'M{i}')
    for poly in m.get('zones_creme', []):
        trace(poly, (255, 140, 0))
    for poly in m.get('zones_vides', []):
        trace(poly, (0, 190, 220))
    for poly in m.get('bouchons', []):
        trace(poly, (0, 90, 255))
    for (x, y) in m.get('vides', []) + m.get('cremes', []):
        X, Y = (x - x0) * ech, (y - y0) * ech
        dr.ellipse((X - 5, Y - 5, X + 5, Y + 5), outline=(0, 160, 0), width=2)
    os.makedirs(dossier, exist_ok=True)
    im.save(os.path.join(dossier, f'trous-{m["id"]}.png'))
    coupes = sum(1 for c in rep.values() if c == 'coupé')
    print(f'  {m["id"]} : {len(liste)} trous ({coupes} coupés entre maisons), boîte ({x0},{y0})-({x1},{y1})')


# ---------------------------------------------------------------- principal

def etiquette(m):
    return f'{m["id"]}  [{m["categorie"]}]  P{m["planche"]} {m["rc"]}'


def main(args):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    if '--trous' in args:
        dossier = args[args.index('--trous') + 1]
        quels = args[args.index('--trous') + 2:]
        for m in MOTIFS + CANDIDATS:
            if not quels or m['id'] in quels:
                carte_trous(m, dossier)
        return
    if '--candidats' in args:
        dossier = args[args.index('--candidats') + 1]
        par_id = {m['id']: m for m in MOTIFS}
        lots = []
        for c in CANDIDATS:
            g = par_id[c['pour']]
            for m in (g, c):
                svg, src, *_ = vectoriser(m, dossier)
                lots.append((m, svg, src, f'{m["id"]}  P{m["planche"]} {m["rc"]}'))
        planche_controle(lots, os.path.join(dossier, 'comparaison-candidats.jpg'), [],
                         'Doublons : gardé (à gauche) / candidat (à droite)', par_rangee=2)
        return

    langues = ('fr', 'en', 'de', 'it', 'es', 'ja', 'zh')
    categories = ('mulhouse', 'textile-musees', 'strasbourg-colmar', 'maisons-alsace', 'noel',
                  'gourmandises', 'alsace')                 # ordre de motifs/categories.json
    for m in MOTIFS:
        assert tuple(m['noms']) == langues and all(m['noms'].values()), m['id']
        assert m['categorie'] in categories, m['id']
    assert len({m['id'] for m in MOTIFS}) == len(MOTIFS)
    print('Orphelins (composantes hors de toute boîte, ou dans plusieurs) :')
    orphelins()
    os.makedirs(SORTIE, exist_ok=True)
    attendus = {f'motif-{m["id"]}.svg' for m in MOTIFS}
    for f in os.listdir(SORTIE):   # restes d'un essai précédent
        if f.startswith('motif-') and f.endswith('.svg') and f not in attendus:
            os.remove(os.path.join(SORTIE, f))
    index, lots, rapport = [], [], []
    for m in MOTIFS:
        svg, (x0, y0, encre), (bx0, by0), zones_idx, _, zones_noms = vectoriser(m, SORTIE)
        iou = fidelite(svg, x0, y0, encre, bx0, by0)
        rapport.append((m['id'], iou, len(svg), zones_idx))
        lots.append((m, svg, (x0, y0, encre), etiquette(m)))
        # clés demandées (id, fichier, categorie, noms, zones, source), plus « nom » (libellé
        # français) et « zones_noms » : le même schéma que motifs/index.json (decoupe.py)
        index.append({
            'id': m['id'],
            'fichier': f'motif-{m["id"]}.svg',
            'categorie': m['categorie'],
            'nom': m['noms']['fr'],
            'noms': m['noms'],
            'zones': zones_idx,
            'zones_noms': zones_noms,
            'source': f'planche {m["planche"]} {m["rc"]}',
        })
    with open(os.path.join(SORTIE, 'index.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    txt = []
    for (p, rc, _, sujet, raison) in ECARTES:
        txt.append(f'P{p} {rc} — {sujet} : {raison}')
    for c in CANDIDATS:
        txt.append(f'P{c["planche"]} {c["rc"]} — doublon de {c["pour"]} : {c.get("raison", "version moins nette")}')
    planche_controle(lots, PLANCHE, txt, 'Motifs des planches 3, 4 et 5 : original | fond clair | fond sombre')
    for ident, iou, taille, z in rapport:
        print(f'{ident:24s} IoU {iou:.3f}  {taille / 1024:6.1f} Ko  ' + ', '.join(f'{k} {v}' for k, v in z.items()))


if __name__ == '__main__':
    main(sys.argv[1:])
