"""Tri des 66 scènes des planches familles A et B (28/11 vers 1 h 30, Alexandra : « il faut que
tu prennes ce qui n'existe pas encore [...] une femme avec 2 enfants, une femme avec 2 filles, une
femme avec 2 garçons, une femme avec un garçon et une fille, un homme seul avec ses 2 enfants, etc.
Vraiment, être précis quand même. »).

Décisions relues case par case, en grand (original agrandi x3 et tracé rendu en vignette 104 x 56 px,
la taille de la fenêtre du ciel) :
- CLÉ d'une scène = ses membres, sans ordre (la cliente peut retourner la scène en miroir), dans
  l'ordre femme, homme, ado, fille, garcon, enfant, bebe, doudou, chat, chien ;
- une clé déjà au catalogue est écartée ; « enfant » (sexe indéterminé) est couvert dès que la
  version fille ET la version garçon existent ou sont gardées ; mais maman + fille n'est pas un
  doublon de maman + garçon ;
- une seule scène par clé nouvelle : celle qui se lit le mieux en petit.

Usage (depuis travaux/ombres) :  python -I tri-ombres.py
Sorties : tri.json, TRI.md, planche-retenues.jpg (dans ce dossier).
"""
import glob
import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage import draw

ICI = os.path.dirname(os.path.abspath(__file__))
DEPOT = os.path.abspath(os.path.join(ICI, '..', '..'))
ORDRE_TYPES = ['femme', 'homme', 'ado', 'fille', 'garcon', 'enfant', 'bebe', 'doudou', 'chat', 'chien']

# ---------------------------------------------------------------------------------------------
# Ce qui existe déjà (planche-ombres-existantes.jpg), lu sur les tracés et pas seulement sur le nom.
# ---------------------------------------------------------------------------------------------
EXISTANTES = {
    'famille-femme-enfant': ('femme+garcon', "maman et un garçon (l'enfant a les cheveux courts)"),
    'famille-maman-montre-ciel': ('femme+enfant', "maman et un enfant qui montre le ciel"),
    'famille-papa-bebe': ('homme+fille', "nommée « Papa et bébé », mais c'est une petite fille au chignon, à 0,66 du papa"),
    'famille-homme-deux-bebes': ('homme+bebe+bebe', "deux tout-petits à 0,50 et 0,54 du papa"),
    'famille-papa-ado': ('homme+ado', "l'ado fait 0,80 du papa"),
    'famille-epaules-bebe': ('homme+enfant+bebe', "pose à part : un enfant sur les épaules"),
    'famille-homme-bebe-femme': ('femme+homme+bebe', "papa, bébé et maman"),
    'famille-deux-hommes-enfant': ('homme+homme+enfant', "l'enfant, presque caché entre les deux papas, n'a pas de sexe lisible"),
    'famille-quatre': ('femme+homme+fille+fille', "papa, maman et deux filles à couettes"),
    'couple-homme-femme': ('femme+homme', 'couple'),
    'couple-femmes-queue': ('femme+femme', 'couple'),
    'couple-hommes-epaule': ('homme+homme', 'couple'),
}

# ---------------------------------------------------------------------------------------------
# Les 21 scènes gardées, dans l'ordre des onglets.
# ---------------------------------------------------------------------------------------------
def noms(fr, en, de, it, es, ja, zh):
    return dict(fr=fr, en=en, de=de, it=it, es=es, ja=ja, zh=zh)


GARDEES = [
    # --- Maman et enfants ---
    dict(case='B r1c1', id='maman-fille-garcon', onglet='maman', candidates=['A r3c5', 'A r4c4', 'B r1c1', 'B r2c4'],
         noms=noms('Maman, une fille et un garçon', 'Mum, a girl and a boy', 'Mama, Tochter und Sohn',
                   'Mamma, una figlia e un figlio', 'Mamá, una hija y un hijo', 'ママと女の子と男の子', '妈妈、女儿和儿子'),
         pourquoi="les couettes disent « fille » même en vignette, le garçon aux cheveux courts aussi ; scène compacte (134 cm)"),
    dict(case='B r1c3', id='maman-deux-filles', onglet='maman', candidates=['A r5c4', 'B r1c3', 'B r2c2'],
         noms=noms('Maman et ses deux filles', 'Mum and her two girls', 'Mama und ihre beiden Töchter',
                   'Mamma e le sue due figlie', 'Mamá y sus dos hijas', 'ママと女の子ふたり', '妈妈和两个女儿'),
         pourquoi="deux paires de couettes : on lit deux filles au premier coup d'œil"),
    dict(case='B r2c1', id='maman-deux-garcons', onglet='maman', candidates=['A r5c3', 'B r1c5', 'B r2c1'],
         noms=noms('Maman et ses deux garçons', 'Mum and her two boys', 'Mama und ihre beiden Söhne',
                   'Mamma e i suoi due figli', 'Mamá y sus dos hijos', 'ママと男の子ふたり', '妈妈和两个儿子'),
         pourquoi="deux garçons aux cheveux courts bien séparés, du plus petit au plus grand ; en B r1c5 le petit bouclé peut passer pour une fille, en A r5c3 les deux se collent"),
    dict(case='A r6c5', id='maman-fille-ado', onglet='maman', candidates=['A r4c1', 'A r4c5', 'A r6c5'],
         noms=noms('Maman, une fille et un ado', 'Mum, a girl and a teen', 'Mama, Tochter und Teenager',
                   'Mamma, una figlia e un ragazzo', 'Mamá, una hija y un adolescente', 'ママと女の子と10代の子', '妈妈、女儿和少年'),
         pourquoi="la fille aux cheveux longs se lit sans hésiter (au carré en A r4c5) ; l'ado reste plus petit que la maman (0,88)"),
    dict(case='A r3c1', id='maman-deux-filles-garcon', onglet='maman', candidates=['A r3c1'],
         noms=noms('Maman, deux filles et un garçon', 'Mum, two girls and a boy', 'Mama, zwei Töchter und ein Sohn',
                   'Mamma, due figlie e un figlio', 'Mamá, dos hijas y un hijo', 'ママと女の子ふたりと男の子', '妈妈、两个女儿和儿子'),
         pourquoi="seule case de cette composition ; deux petites aux cheveux mi-longs et un grand frère"),
    dict(case='A r3c3', id='maman-fille-deux-garcons', onglet='maman', candidates=['A r3c3'],
         noms=noms('Maman, une fille et deux garçons', 'Mum, a girl and two boys', 'Mama, eine Tochter und zwei Söhne',
                   'Mamma, una figlia e due figli', 'Mamá, una hija y dos hijos', 'ママと女の子と男の子ふたり', '妈妈、女儿和两个儿子'),
         pourquoi="seule case de cette composition ; la fille au carré, plus petite, entre ses deux frères"),
    dict(case='A r3c2', id='maman-trois-garcons', onglet='maman', candidates=['A r3c2', 'A r5c1', 'A r6c3', 'B r5c3'],
         noms=noms('Maman et ses trois garçons', 'Mum and her three boys', 'Mama und ihre drei Söhne',
                   'Mamma e i suoi tre figli', 'Mamá y sus tres hijos', 'ママと男の子3人', '妈妈和三个儿子'),
         pourquoi="trois têtes bien séparées, deux petits et un grand ; en A r5c1 et A r6c3 deux garçons se chevauchent, en B r5c3 ce sont des triplés"),
    # --- Papa et enfants ---
    dict(case='B r3c4', id='papa-garcon', onglet='papa', candidates=['B r3c4', 'B r3c6'],
         noms=noms('Papa et son petit garçon', 'Dad and his little boy', 'Papa und sein kleiner Sohn',
                   'Papà e il suo bambino', 'Papá y su hijo pequeño', 'パパと小さな男の子', '爸爸和小男孩'),
         pourquoi="le petit garçon (0,6 du papa) ; le grand garçon de B r3c6 (0,77) a presque la taille de l'ado de famille-papa-ado (0,80)"),
    dict(case='B r3c1', id='papa-deux-garcons', onglet='papa', candidates=['B r3c1'],
         noms=noms('Papa et ses deux garçons', 'Dad and his two boys', 'Papa und seine beiden Söhne',
                   'Papà e i suoi due figli', 'Papá y sus dos hijos', 'パパと男の子ふたり', '爸爸和两个儿子'),
         pourquoi="seule case nette (en B r3c3 le 2e enfant, bouclé, n'a pas de sexe lisible) ; ces garçons (0,6 et 0,7 du papa) sont plus grands que les « deux bébés » existants (0,50 et 0,54)"),
    dict(case='B r3c2', id='papa-fille-garcon', onglet='papa', candidates=['B r3c2'],
         noms=noms('Papa, une fille et un garçon', 'Dad, a girl and a boy', 'Papa, Tochter und Sohn',
                   'Papà, una figlia e un figlio', 'Papá, una hija y un hijo', 'パパと女の子と男の子', '爸爸、女儿和儿子'),
         pourquoi="seule case nette : couettes pour la fille, cheveux courts pour le garçon"),
    dict(case='B r5c2', id='papa-trois-enfants', onglet='papa', candidates=['B r5c2'],
         noms=noms('Papa et ses trois enfants', 'Dad and his three children', 'Papa und seine drei Kinder',
                   'Papà e i suoi tre bambini', 'Papá y sus tres hijos', 'パパと子ども3人', '爸爸和三个孩子'),
         pourquoi="seule case : un garçon, un bébé et une fille à macarons"),
    # --- Parents et enfants ---
    dict(case='A r6c2', id='deux-mamans-fille', onglet='parents', candidates=['A r1c1', 'A r6c2', 'B r1c4'],
         noms=noms('Deux mamans et leur fille', 'Two mums and their daughter', 'Zwei Mamas und ihre Tochter',
                   'Due mamme e la loro figlia', 'Dos mamás y su hija', 'ママふたりと女の子', '两位妈妈和女儿'),
         pourquoi="la fille aux cheveux longs se lit, la 2e maman au carré aussi ; en A r1c1 l'enfant ne se lit pas fille en petit, en B r1c4 l'adulte afro peut passer pour un homme"),
    dict(case='B r1c2', id='deux-mamans-garcon', onglet='parents', candidates=['A r1c3', 'A r1c5', 'B r1c2'],
         noms=noms('Deux mamans et leur garçon', 'Two mums and their son', 'Zwei Mamas und ihr Sohn',
                   'Due mamme e il loro figlio', 'Dos mamás y su hijo', 'ママふたりと男の子', '两位妈妈和儿子'),
         pourquoi="2e maman au chignon décoiffé, mèche dans le cou, plus fine que celle de A r1c3 ; A r1c5 (adulte bouclé) peut être un papa"),
    dict(case='A r1c2', id='deux-mamans-fille-garcon', onglet='parents', candidates=['A r1c2', 'A r2c1', 'A r2c4', 'B r6c5'],
         noms=noms('Deux mamans, une fille et un garçon', 'Two mums, a girl and a boy', 'Zwei Mamas, Tochter und Sohn',
                   'Due mamme, una figlia e un figlio', 'Dos mamás, una hija y un hijo', 'ママふたりと女の子と男の子', '两位妈妈、女儿和儿子'),
         pourquoi="fille aux cheveux longs et 2e maman au chignon haut, lisibles en petit ; en A r2c1 la couette de la fille disparaît, A r2c4 et B r6c5 ont un adulte incertain"),
    dict(case='B r4c3', id='parents-fille', onglet='parents', candidates=['B r4c3'],
         noms=noms('Papa, maman et leur fille', 'Dad, mum and their daughter', 'Papa, Mama und ihre Tochter',
                   'Papà, mamma e la loro figlia', 'Papá, mamá y su hija', 'パパとママと女の子', '爸爸、妈妈和女儿'),
         certitude='probable',
         pourquoi="seule case de cette composition. Douteuse au départ : la femme fait 0,86 du papa (maman ou grande sœur ?) ; c'est le rapport de la maman de B r6c4 (les mamans de la planche B font de 0,86 à 0,94 du papa), donc maman. Dans les deux lectures la composition est nouvelle"),
    dict(case='B r6c3', id='parents-garcon', onglet='parents', candidates=['B r4c2', 'B r6c3', 'B r6c6'],
         noms=noms('Papa, maman et leur garçon', 'Dad, mum and their son', 'Papa, Mama und ihr Sohn',
                   'Papà, mamma e il loro figlio', 'Papá, mamá y su hijo', 'パパとママと男の子', '爸爸、妈妈和儿子'),
         pourquoi="le garçon entre ses parents, le papa nettement plus grand ; en B r6c6 les parents se chevauchent, en B r4c2 la maman peut passer pour une grande sœur"),
    dict(case='A r4c2', id='parents-fille-garcon', onglet='parents', candidates=['A r2c2', 'A r2c3', 'A r4c2', 'A r4c3'],
         noms=noms('Papa, maman, une fille et un garçon', 'Dad, mum, a girl and a boy', 'Papa, Mama, Tochter und Sohn',
                   'Papà, mamma, una figlia e un figlio', 'Papá, mamá, una hija y un hijo', 'パパとママと女の子と男の子', '爸爸、妈妈、女儿和儿子'),
         pourquoi="la fille aux cheveux mi-longs se distingue du garçon ; en A r2c2 la fille au carré se lit garçon en vignette, en A r4c3 le garçon est à moitié caché. La plus large des gardées (195 cm)"),
    dict(case='B r6c1', id='parents-trois-enfants', onglet='parents', candidates=['B r6c1'],
         noms=noms('Papa, maman et trois enfants', 'Dad, mum and three children', 'Papa, Mama und drei Kinder',
                   'Papà, mamma e tre bambini', 'Papá, mamá y tres hijos', 'パパとママと子ども3人', '爸爸、妈妈和三个孩子'),
         pourquoi="seule case à cinq ; deux des enfants bouclés sans sexe lisible, d'où « trois enfants »"),
    # --- Avec un animal ---
    dict(case='B r5c5', id='papa-enfant-chien', onglet='animal', candidates=['B r5c5'],
         noms=noms('Papa, un enfant et un chien', 'Dad, a child and a dog', 'Papa, ein Kind und ein Hund',
                   'Papà, un bambino e un cane', 'Papá, un niño y un perro', 'パパと子どもと犬', '爸爸、孩子和狗'),
         pourquoi="seule case ; le chien assis de profil se lit très bien. Il y avait homme + chien et enfant + chien, pas les trois"),
    dict(case='B r5c1', id='papa-trois-enfants-chat', onglet='animal', candidates=['B r5c1'],
         noms=noms('Papa, trois enfants et un chat', 'Dad, three children and a cat', 'Papa, drei Kinder und eine Katze',
                   'Papà, tre bambini e un gatto', 'Papá, tres niños y un gato', 'パパと子ども3人と猫', '爸爸、三个孩子和猫'),
         certitude='probable',
         pourquoi="seule case ; le chat, collé au papa, se reconnaît à ses oreilles pointues"),
    dict(case='B r6c4', id='parents-deux-garcons-chat', onglet='animal', candidates=['B r6c4'],
         noms=noms('Papa, maman, deux garçons et un chat', 'Dad, mum, two boys and a cat', 'Papa, Mama, zwei Söhne und eine Katze',
                   'Papà, mamma, due figli e un gatto', 'Papá, mamá, dos hijos y un gato', 'パパとママと男の子ふたりと猫', '爸爸、妈妈、两个儿子和猫'),
         pourquoi="seule case ; le chat, bien détaché à gauche, se lit tout de suite"),
]

# ---------------------------------------------------------------------------------------------
# Les 45 écartées : la raison, et la scène qui couvre déjà la composition.
# `cle` : quand la relecture change la composition du JSON de la case.
# ---------------------------------------------------------------------------------------------
ECARTEES = {
    'A r1c1': dict(voir='deux-mamans-fille', raison="même composition que A r6c2, gardée ; la petite couette sur le côté ne se voit plus en vignette, l'enfant se lit garçon"),
    'A r1c3': dict(voir='deux-mamans-garcon', raison="même composition que B r1c2, gardée ; ici la 2e maman au chignon a une carrure plus masculine"),
    'A r1c4': dict(voir='famille-quatre', raison="douteuse et illisible en petit : l'adulte au carré à frange peut être un papa (ce serait famille-quatre, déjà au catalogue) et la 2e petite, aux couettes minuscules, se lit garçon. Deux mamans et deux filles reste à dessiner"),
    'A r1c5': dict(voir='deux-mamans-garcon', autre='femme+homme+garcon', raison="douteuse : l'adulte aux boucles en boule peut être une maman ou un papa ; les deux lectures sont déjà gardées (B r1c2, B r6c3)"),
    'A r2c1': dict(voir='deux-mamans-fille-garcon', raison="même composition que A r1c2, gardée ; la couette de la fille disparaît en vignette"),
    'A r2c2': dict(voir='parents-fille-garcon', raison="même composition que A r4c2, gardée ; la fille au carré se lit garçon en vignette (le papa à casquette, lui, est très lisible)"),
    'A r2c3': dict(voir='parents-fille-garcon', autre='femme+femme+fille+garcon', raison="douteuse (l'adulte bouclé peut être une maman) ; les deux lectures sont déjà gardées (A r4c2, A r1c2)"),
    'A r2c4': dict(voir='deux-mamans-fille-garcon', autre='femme+homme+fille+garcon', raison="douteuse (2e adulte aux cheveux mi-longs) ; les deux lectures sont déjà gardées (A r1c2, A r4c2)"),
    'A r2c5': dict(voir='famille-quatre', raison="papa, maman et deux filles : déjà au catalogue (famille-quatre)"),
    'A r3c4': dict(voir='maman-fille-garcon', raison="le petit bouclé peut être une fille ou un garçon : maman et deux enfants, couverte par maman-fille-garcon et maman-deux-garcons"),
    'A r3c5': dict(voir='maman-fille-garcon', raison="même composition que B r1c1, gardée ; la toute petite fille aux couettes basses (0,54) se lit mal"),
    'A r4c1': dict(voir='maman-fille-ado', raison="même composition que A r6c5, gardée ; le haut de la tête bouclée de l'ado sort un peu plat"),
    'A r4c3': dict(voir='parents-fille-garcon', raison="même composition que A r4c2, gardée ; le garçon est à moitié caché par l'épaule du papa"),
    'A r4c4': dict(voir='maman-fille-garcon', raison="même composition que B r1c1, gardée ; le petit bouclé se lit moins bien garçon"),
    'A r4c5': dict(voir='maman-fille-ado', raison="même composition que A r6c5, gardée ; la fille au carré se lit moins bien"),
    'A r5c1': dict(voir='maman-trois-garcons', raison="même composition que A r3c2, gardée ; les deux grands se chevauchent, on compte deux enfants"),
    'A r5c2': dict(voir='parents-garcon', autre='femme+homme+garcon', raison="douteuse : le grand (0,92 de la maman, carrure d'adulte) se lit papa ; papa, maman et garçon est déjà gardée (B r6c3)"),
    'A r5c3': dict(voir='maman-deux-garcons', raison="même composition que B r2c1, gardée ; les deux garçons se collent"),
    'A r5c4': dict(voir='maman-deux-filles', raison="même composition que B r1c3, gardée (les couettes se lisent mieux que ces cheveux mi-longs)"),
    'A r5c5': dict(voir='maman-fille-garcon', raison="le petit (mèche ou couette ?) n'a pas de sexe lisible : couverte par maman-fille-garcon et maman-deux-garcons"),
    'A r6c1': dict(voir='maman-fille-garcon', raison="l'enfant aux oreilles de chat n'a pas de sexe lisible : couverte par maman-fille-garcon et maman-deux-garcons"),
    'A r6c3': dict(voir='maman-trois-garcons', raison="même composition que A r3c2, gardée ; le tout-petit est caché entre les deux autres"),
    'A r6c4': dict(voir='maman-deux-garcons', raison="le grand bouclé n'a pas de sexe lisible : couverte par maman-deux-garcons et maman-fille-garcon"),
    'B r1c4': dict(voir='deux-mamans-fille', autre='femme+homme+fille', raison="même composition que A r6c2, gardée ; l'adulte afro peut passer pour un papa"),
    'B r1c5': dict(voir='maman-deux-garcons', raison="même composition que B r2c1, gardée ; le petit bouclé peut passer pour une fille"),
    'B r1c6': dict(voir='maman-deux-garcons', raison="le grand aux boucles volumineuses n'a pas de sexe lisible : couverte par maman-deux-garcons et maman-fille-garcon"),
    'B r2c2': dict(voir='maman-deux-filles', raison="même composition que B r1c3, gardée"),
    'B r2c3': dict(voir='maman-deux-garcons', raison="le tout-petit bouclé n'a pas de sexe lisible : couverte par maman-deux-garcons et maman-fille-garcon"),
    'B r2c4': dict(voir='maman-fille-garcon', raison="même composition que B r1c1, gardée ; la grande fille aux cheveux longs peut passer pour une 2e maman"),
    'B r2c5': dict(voir='couple-homme-femme', raison="douteuse : l'ado a la taille (0,94) et la carrure d'un adulte, en vignette on lit un couple homme-femme (déjà au catalogue). Prête si Alexandra veut une « Maman et son ado »"),
    'B r2c6': dict(voir='couple-homme-femme', raison="même lecture que B r2c5, garçon encore plus grand (0,99)"),
    'B r3c3': dict(voir='papa-deux-garcons', raison="l'enfant bouclé n'a pas de sexe lisible : couverte par papa-deux-garcons et papa-fille-garcon"),
    'B r3c5': dict(voir='famille-papa-bebe', raison="famille-papa-bebe montre déjà un papa et une petite fille au chignon, de la même taille (0,66 du papa, contre 0,67 ici). Prête si Alexandra veut une « Papa et sa fille » en plus"),
    'B r3c6': dict(voir='papa-garcon', raison="même composition que B r3c4, gardée ; ce grand garçon (0,77) a presque la taille de l'ado de famille-papa-ado (0,80)"),
    'B r4c1': dict(voir='papa-fille-garcon', raison="l'enfant bouclé a exactement les boucles des petits garçons de la planche (B r1c5, B r3c1) : papa, fille et garçon, déjà gardée (B r3c2). « Papa et ses deux filles » ne se lit pas"),
    'B r4c2': dict(voir='parents-garcon', raison="même composition que B r6c3, gardée ; la maman (0,86) peut passer pour une grande sœur"),
    'B r4c4': dict(voir='famille-deux-hommes-enfant', raison="deux papas et un enfant : déjà au catalogue (famille-deux-hommes-enfant, enfant de sexe non lisible)"),
    'B r4c5': dict(voir='famille-deux-hommes-enfant', raison="couverte par famille-deux-hommes-enfant (enfant de sexe non lisible) ; et le 2e homme (0,92) peut être un ado. Prête si Alexandra veut deux papas où l'enfant se voit"),
    'B r4c6': dict(voir='famille-deux-hommes-enfant', raison="comme B r4c4"),
    'B r5c3': dict(voir='maman-trois-garcons', raison="même composition que A r3c2, gardée ; trois garçons identiques, comme des triplés"),
    'B r5c4': dict(voir='parents-garcon', cle='femme+homme+garcon+doudou',
                   raison="la petite forme aux deux oreilles rondes est un ours en peluche vu de dos, pas un bébé ; sans lui c'est papa, maman et garçon, déjà gardée (B r6c3)"),
    'B r5c6': dict(voir='famille-homme-bebe-femme', raison="papa, bébé et maman : déjà au catalogue (famille-homme-bebe-femme)"),
    'B r6c2': dict(voir=None, raison="douteuse : trois silhouettes de taille adulte autour du bébé (ado ? 2e maman ? papa aux cheveux courts ?), on ne sait pas dire qui est qui"),
    'B r6c5': dict(voir='deux-mamans-fille-garcon', autre='femme+homme+fille+garcon', raison="douteuse (deux mamans, maman et grande ado, ou papa aux cheveux mi-longs) ; les lectures possibles sont déjà gardées (A r1c2, A r4c2)"),
    'B r6c6': dict(voir='parents-garcon', raison="même composition que B r6c3, gardée ; les deux parents se chevauchent"),
}

# ---------------------------------------------------------------------------------------------
# Les onglets : Famille (trop long) remplacé par Maman / Papa / Parents. Plus d'onglet Animaux
# (retiré le 28/11 vers 1 h 45 : « enlève les animaux seuls ils sont mal faits »).
# ---------------------------------------------------------------------------------------------
ONGLETS = [
    dict(id='seul', libelles=noms('Seul·e', 'On my own', 'Allein', 'Da solo', 'Solo', 'ひとり', '一个人'),
         scenes=['femme-ondulee', 'femme-longs', 'femme-carre', 'femme-tres-longs-boucles', 'femme-bouclee-courte',
                 'femme-chignon-haut', 'femme-queue-de-cheval', 'homme-court', 'homme-boucle', 'homme-capuche',
                 'homme-casquette', 'homme-bonnet-laine', 'enfant-boucle', 'enfant-casquette', 'fillette-couettes',
                 'fillette-cheveux-longs', 'fillette-chignon']),
    dict(id='couple', libelles=noms('En couple', 'As a couple', 'Zu zweit', 'In coppia', 'En pareja', 'ふたり', '情侣'),
         scenes=['couple-homme-femme', 'couple-frises', 'couple-femmes-queue', 'couple-femmes-chignon',
                 'couple-hommes-epaule', 'couple-hommes-front']),
    dict(id='maman', libelles=noms('Maman et enfants', 'Mum and kids', 'Mama und Kinder', 'Mamma e figli', 'Mamá e hijos',
                                   'ママと子どもたち', '妈妈和孩子们'),
         scenes=['famille-femme-enfant', 'famille-maman-montre-ciel', 'maman-fille-garcon', 'maman-deux-filles',
                 'maman-deux-garcons', 'maman-fille-ado', 'maman-deux-filles-garcon', 'maman-fille-deux-garcons',
                 'maman-trois-garcons']),
    dict(id='papa', libelles=noms('Papa et enfants', 'Dad and kids', 'Papa und Kinder', 'Papà e figli', 'Papá e hijos',
                                  'パパと子どもたち', '爸爸和孩子们'),
         scenes=['famille-papa-bebe', 'papa-garcon', 'famille-papa-ado', 'famille-homme-deux-bebes', 'papa-fille-garcon',
                 'papa-deux-garcons', 'famille-epaules-bebe', 'papa-trois-enfants']),
    dict(id='parents', libelles=noms('Parents et enfants', 'Parents and kids', 'Eltern und Kinder', 'Genitori e figli',
                                     'Padres e hijos', '両親と子どもたち', '父母和孩子们'),
         scenes=['famille-homme-bebe-femme', 'parents-fille', 'parents-garcon', 'deux-mamans-fille', 'deux-mamans-garcon',
                 'famille-deux-hommes-enfant', 'parents-fille-garcon', 'famille-quatre', 'deux-mamans-fille-garcon',
                 'parents-trois-enfants']),
    dict(id='animal', libelles=noms('Avec un animal', 'With a pet', 'Mit Tier', 'Con un animale', 'Con una mascota', 'ペットと', '和宠物'),
         scenes=['femme-chien', 'homme-chien', 'femme-petit-chien', 'homme-petit-chien', 'homme-grand-chien', 'enfant-chien',
                 'deux-enfants-chien', 'papa-enfant-chien', 'femme-chat', 'homme-chat', 'femme-chat-chien',
                 'papa-trois-enfants-chat', 'parents-deux-garcons-chat', 'femme-lapin', 'homme-deux-lapins',
                 'femme-cheval-couche', 'homme-cheval']),
]

A_VOIR = [
    "B r2c5 « Maman et son ado » : composition nouvelle mais l'ado a une taille et une carrure d'adulte, on lit un couple en vignette. Écartée ; le tracé est prêt si Alexandra la veut (id proposé maman-ado).",
    "B r3c5 « Papa et sa fille » (fillette à queue de cheval) : écartée parce que famille-papa-bebe, nommée « Papa et bébé », montre en fait une petite fille au chignon de la même taille. Tracé prêt (id proposé papa-fille) si Alexandra la veut en plus.",
    "B r4c5 « Deux papas et leur fille » : l'existante famille-deux-hommes-enfant cache presque l'enfant ; si Alexandra veut une scène deux papas où l'enfant se voit, B r4c5 (fille) et B r4c4 (garçon) sont prêtes.",
    "Toujours sans dessin net : papa et ses deux filles, deux mamans et leurs deux filles, maman et sa fille seule, deux papas avec deux enfants.",
]


# ---------------------------------------------------------------------------------------------
def cle(types):
    t = ['ado' if x.startswith('ado') else x for x in types]
    return '+'.join(sorted(t, key=lambda x: (ORDRE_TYPES.index(x), x)))


def lire_cases():
    out = {}
    for planche in 'AB':
        for p in sorted(glob.glob(os.path.join(ICI, f'planche-{planche}', 'case-r*c*.json'))):
            o = json.load(open(p, encoding='utf-8'))
            m = re.search(r'case-r(\d)c(\d)', p)
            o['_json'] = f'travaux/ombres/planche-{planche}/case-r{m.group(1)}c{m.group(2)}.json'
            out[f'{planche} r{m.group(1)}c{m.group(2)}'] = o
    return out


def lire_ts(chemin):
    t = open(chemin, encoding='utf-8').read()
    motif = (r'\{\s*id:\s*"([^"]+)",\s*nom:\s*"([^"]*)",(?:\s*groupe:\s*"([^"]+)",)?\s*gauche:\s*(-?[\d.]+),'
             r'\s*droite:\s*(-?[\d.]+),\s*haut:\s*(-?[\d.]+),(?:\s*decalage:\s*(-?[\d.]+),)?\s*d:\s*"([^"]+)"')
    return {m.group(1): dict(id=m.group(1), nom=m.group(2), gauche=float(m.group(4)), droite=float(m.group(5)),
                             haut=float(m.group(6)), d=m.group(8)) for m in re.finditer(motif, t)}


def nom_fr_existant():
    """Les libellés fr actuels de la fenêtre (ui.ts, bloc fr), pour la planche."""
    t = open(os.path.join(DEPOT, 'apps/web/src/i18n/ui.ts'), encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'"ciel\.silh\.([a-z-]+)":\s*"([^"]*)"', t):
        out.setdefault(m.group(1), m.group(2))  # le 1er bloc est le français
    return out


CASES = lire_cases()
EXIST = {**lire_ts(os.path.join(DEPOT, 'apps/api/src/ciel-ombres.ts')), **lire_ts(os.path.join(DEPOT, 'apps/api/src/ciel-ombres-2.ts'))}
NOMS_FR = nom_fr_existant()

# --- Vérifications ---------------------------------------------------------------------------
assert len(CASES) == 66, len(CASES)
gardees_cases = {g['case'] for g in GARDEES}
assert not gardees_cases & set(ECARTEES), gardees_cases & set(ECARTEES)
assert gardees_cases | set(ECARTEES) == set(CASES), set(CASES) ^ (gardees_cases | set(ECARTEES))
ids = [g['id'] for g in GARDEES]
assert len(set(ids)) == len(ids)
for i in ids:
    assert re.fullmatch(r'[a-z-]+', i), i          # l'API refuse les chiffres (/^[a-z-]+(:m)?$/)
    assert i not in EXIST, i
cles_existantes = {v[0] for v in EXISTANTES.values()}
for g in GARDEES:
    o = CASES[g['case']]
    g['cle'] = cle([m['type'] for m in o['membres']])
    assert g['cle'] not in cles_existantes, (g['case'], g['cle'])
    for c in g['candidates']:
        assert c in CASES, c
cles_gardees = [g['cle'] for g in GARDEES]
assert len(set(cles_gardees)) == len(cles_gardees), cles_gardees
for c, e in ECARTEES.items():
    e['cle'] = e.get('cle') or cle([m['type'] for m in CASES[c]['membres']])
    assert e['voir'] is None or e['voir'] in ids or e['voir'] in EXIST, (c, e['voir'])
toutes = [s for o in ONGLETS for s in o['scenes']]
assert len(set(toutes)) == len(toutes)
assert set(ids) <= set(toutes), set(ids) - set(toutes)
for s in toutes:
    assert s in ids or s in EXIST, s
for g in GARDEES:
    assert g['id'] in next(o for o in ONGLETS if o['id'] == g['onglet'])['scenes'], g['id']

# --- tri.json ---------------------------------------------------------------------------------
def dims(o):
    return round(o['droite'] - o['gauche']), round(-o['haut'])


def membres(o):
    out = []
    for m in o['membres']:
        x = {'type': m['type'], 'detail': m['detail']}
        if 'tailleCm' in m:
            x['tailleCm'] = m['tailleCm']
        if 'taille' in m:
            x['taille'] = m['taille']
        out.append(x)
    return out


sortie = {
    'date': '2026-11-28',
    'demande': "« il faut que tu prennes ce qui n'existe pas encore [...] une femme avec 2 enfants, une femme avec 2 filles, "
               "une femme avec 2 garçons, une femme avec un garçon et une fille, un homme seul avec ses 2 enfants, etc. "
               "Vraiment, être précis quand même. »",
    'planches': {
        'A': 'Documents/memory-line/protos/ombres-familles-a.png (= Téléchargements/Galerie de silhouettes familiales inclusives.png), 6 x 5 scènes',
        'B': 'Documents/memory-line/protos/ombres-familles-b.png (= Téléchargements/Planche de silhouettes familiales diverses.png), 6 x 6 scènes',
    },
    'regle': "clé = membres sans ordre (miroir possible) ; écartée si la clé existe déjà ; « enfant » de sexe non lisible "
             "couvert par les versions fille et garçon ; une scène par clé nouvelle, la plus lisible en vignette (104 x 56 px)",
    'compte': {'cases': len(CASES), 'gardees': len(GARDEES), 'ecartees': len(ECARTEES)},
    'gardees': [],
    'ecartees': [],
    'onglets': ONGLETS,
    'existantes': {k: {'cle': v[0], 'lecture': v[1]} for k, v in EXISTANTES.items()},
    'aVoir': A_VOIR,
}
for g in GARDEES:
    o = CASES[g['case']]
    l, h = dims(o)
    sortie['gardees'].append({
        'case': g['case'], 'id': g['id'], 'cle': g['cle'], 'onglet': g['onglet'], 'json': o['_json'],
        'idProvisoire': o['id'], 'certitude': g.get('certitude', o['certitude']), 'largeurCm': l, 'hauteurCm': h,
        'membres': membres(o), 'noms': g['noms'], 'candidates': g['candidates'], 'pourquoi': g['pourquoi'],
    })
for c in sorted(ECARTEES, key=lambda k: (k[0], k)):
    e = ECARTEES[c]
    x = {'case': c, 'cle': e['cle'], 'raison': e['raison'], 'voir': e['voir']}
    if e.get('autre'):
        x['autreLecture'] = e['autre']
    sortie['ecartees'].append(x)
with open(os.path.join(ICI, 'tri.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(sortie, f, ensure_ascii=False, indent=1)

# --- TRI.md -----------------------------------------------------------------------------------
par_case = {g['case']: g for g in GARDEES}
L = []
L.append('# Ombres familles : tri des planches A et B (28/11)')
L.append('')
L.append("Demande d'Alexandra (28/11 vers 1 h 30) : " + sortie['demande'])
L.append('')
L.append(f"**{len(GARDEES)} scènes gardées, {len(ECARTEES)} écartées** sur {len(CASES)} "
         "(A = Galerie de silhouettes familiales inclusives, 6 x 5 ; B = Planche de silhouettes familiales diverses, 6 x 6).")
L.append('')
L.append("Règle : la clé d'une scène, ce sont ses membres sans ordre (la cliente peut retourner une scène en miroir). "
         "Une clé déjà au catalogue est écartée. Un enfant dont on ne lit pas le sexe est couvert quand la version fille et la "
         "version garçon existent ; mais maman + fille n'est pas un doublon de maman + garçon. Une scène par clé nouvelle : "
         "celle qui se lit le mieux en vignette (104 x 56 px dans la fenêtre du ciel). Toutes les cases douteuses ont été "
         "relues en grand. Planche des gardées : `planche-retenues.jpg`.")
L.append('')
L.append('## Case par case')
L.append('')
L.append('| Case | Clé | Décision | Pourquoi |')
L.append('|---|---|---|---|')
for c in sorted(CASES, key=lambda k: (k[0], k)):
    if c in par_case:
        g = par_case[c]
        L.append(f"| {c} | {g['cle']} | **gardée** : `{g['id']}` « {g['noms']['fr']} » | {g['pourquoi']} |")
    else:
        e = ECARTEES[c]
        k = e['cle'] + (f" (ou {e['autre']})" if e.get('autre') else '')
        L.append(f"| {c} | {k} | écartée | {e['raison']} |")
L.append('')
L.append('## Les onglets')
L.append('')
n_familles = sum(len(o['scenes']) for o in ONGLETS if o['id'] in ('maman', 'papa', 'parents'))
L.append(f"L'onglet Famille (9 scènes, {n_familles} avec les nouvelles) est remplacé par trois onglets : une maman avec ses enfants, "
         "un papa avec ses enfants, deux adultes avec leurs enfants (papa et maman, deux mamans, deux papas). "
         "Les familles avec un animal vont dans Avec un animal. Pas d'onglet Animaux (retiré le 28/11 vers 1 h 45). "
         "Dans chaque onglet, du plus simple au plus nombreux ; Avec un animal garde son rangement par animal, "
         "les nouvelles à la fin de leur animal.")
L.append('')
L.append('| Onglet | fr | en | de | it | es | ja | zh |')
L.append('|---|---|---|---|---|---|---|---|')
for o in ONGLETS:
    lb = o['libelles']
    L.append(f"| `{o['id']}` | {lb['fr']} | {lb['en']} | {lb['de']} | {lb['it']} | {lb['es']} | {lb['ja']} | {lb['zh']} |")
L.append('')
for o in ONGLETS:
    L.append(f"- **{o['libelles']['fr']}** (`{o['id']}`, {len(o['scenes'])}) : " + ', '.join(
        (f"**{s}**" if s in ids else s) for s in o['scenes']))
L.append('')
L.append('En gras : les nouvelles.')
L.append('')
L.append('## Noms des scènes gardées')
L.append('')
L.append('| id | case | fr | en | de | it | es | ja | zh |')
L.append('|---|---|---|---|---|---|---|---|---|')
for g in GARDEES:
    n = g['noms']
    L.append(f"| `{g['id']}` | {g['case']} | {n['fr']} | {n['en']} | {n['de']} | {n['it']} | {n['es']} | {n['ja']} | {n['zh']} |")
L.append('')
L.append('## À trancher par Alexandra')
L.append('')
for a in A_VOIR:
    L.append(f'- {a}')
L.append('')
L.append("## Pour l'intégration")
L.append('')
L.append("- Les tracés : le JSON de chaque case gardée (`json` dans tri.json), à renommer avec son `id` ; l'API refuse les "
         "chiffres dans un id (`/^[a-z-]+(:m)?$/`).")
L.append("- `GROUPES_SILHOUETTES` (AfficheIA.tsx) : les six onglets ci-dessus, dans cet ordre ; changer `?v=ombres-groupes-4` ; "
         "clés `ciel.groupe.maman`, `ciel.groupe.papa`, `ciel.groupe.parents` et `ciel.silh.<id>` dans les 7 langues.")
L.append("- Côté API, `GROUPES_OMBRES` ne sert qu'à la réponse de `/ia/ciel/silhouettes` : y ajouter maman, papa, parents si "
         "les nouvelles scènes prennent leur onglet comme groupe.")
L.append('')
with open(os.path.join(ICI, 'TRI.md'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(L))

# --- planche-retenues.jpg ---------------------------------------------------------------------
def sous_chemins(d):
    polys = []
    for sp in re.findall(r'M[^M]*', d):
        toks = re.findall(r'[MCLZ]|-?\d+(?:\.\d+)?', sp)
        i, cmd, cur, pts = 0, None, None, []
        while i < len(toks):
            if toks[i] in 'MCLZ':
                cmd = toks[i]
                i += 1
                continue
            if cmd in ('M', 'L'):
                cur = np.array([float(toks[i]), float(toks[i + 1])])
                pts.append(cur)
                i += 2
                cmd = 'L'
            elif cmd == 'C':
                v = [float(x) for x in toks[i:i + 6]]
                c1, c2, p = np.array(v[0:2]), np.array(v[2:4]), np.array(v[4:6])
                t = np.linspace(0, 1, 13)[1:, None]
                pts.extend(list((1 - t) ** 3 * cur + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * p))
                cur = p
                i += 6
            else:
                i += 1
        if len(pts) > 2:
            polys.append(np.array(pts))
    return polys


def rendre(o, s, ss=3):
    """La scène o (cm, base y = 0) à s px/cm ; masque 0..1, la base en bas de l'image."""
    W = int((o['droite'] - o['gauche']) * s) + 4
    H = int(-o['haut'] * s) + 4
    ox, oy = 2 - o['gauche'] * s, H - 2
    acc = np.zeros((H * ss, W * ss), np.int32)
    for p in sous_chemins(o['d']):
        xs, ys = (ox + p[:, 0] * s) * ss, (oy + p[:, 1] * s) * ss
        aire = 0.5 * np.sum(xs * np.roll(ys, -1) - np.roll(xs, -1) * ys)
        rr, cc = draw.polygon(ys, xs, shape=acc.shape)
        acc[rr, cc] += 1 if aire > 0 else -1
    return (acc != 0).astype(float).reshape(H, ss, W, ss).mean(axis=(1, 3))


def police(taille, gras=False):
    for nom in (('arialbd.ttf', 'C:/Windows/Fonts/arialbd.ttf') if gras else ('arial.ttf', 'C:/Windows/Fonts/arial.ttf')):
        try:
            return ImageFont.truetype(nom, taille)
        except OSError:
            pass
    return ImageFont.load_default()


S = 1.75                       # px par cm, la même pour toutes : les tailles se comparent
COLS, CW, IMG_H, LEG = 4, 380, int(112 * S), 92
CH = IMG_H + LEG
F_TITRE, F_SOUS, F_SECTION = police(30, True), police(17), police(22, True)
F_ID, F_NOM, F_DET = police(16, True), police(16), police(13)
NOIR, GRIS, GRIS_TEXTE = (20, 20, 20), (178, 178, 178), (120, 120, 120)
sections = [o for o in ONGLETS if o['id'] in ('maman', 'papa', 'parents', 'animal')]
H_TOTAL = 110 + sum(50 + ((len(o['scenes']) + COLS - 1) // COLS) * CH for o in sections) + 20
pl = Image.new('RGB', (COLS * CW + 40, H_TOTAL), 'white')
dr = ImageDraw.Draw(pl)
dr.text((20, 18), 'Ombres familles : les 21 scènes retenues des planches A et B', font=F_TITRE, fill=NOIR)
dr.text((20, 60), "En noir les nouvelles, avec leur id, leur nom et leur case ; en gris, les scènes déjà au catalogue, "
                  "à leur place dans l'onglet. Même échelle pour toutes (1,75 px par cm).", font=F_SOUS, fill=GRIS_TEXTE)
y = 110
for o in sections:
    n_new = sum(1 for s in o['scenes'] if s in ids)
    dr.text((20, y + 10), f"{o['libelles']['fr']}  ·  {n_new} nouvelles, {len(o['scenes']) - n_new} déjà au catalogue",
            font=F_SECTION, fill=NOIR)
    y += 50
    for k, s in enumerate(o['scenes']):
        x0, y0 = 20 + (k % COLS) * CW, y + (k // COLS) * CH
        nouvelle = s in ids
        if nouvelle:
            g = next(g for g in GARDEES if g['id'] == s)
            sc = CASES[g['case']]
        else:
            sc = EXIST[s]
        m = rendre(sc, S)
        coul = NOIR if nouvelle else GRIS
        calque = Image.new('RGB', (m.shape[1], m.shape[0]), coul)
        masque = Image.fromarray((m * 255).astype(np.uint8), 'L')
        px = x0 + (CW - 10 - m.shape[1]) // 2
        py = y0 + IMG_H - m.shape[0]
        pl.paste(calque, (px, py), masque)
        dr.rectangle([x0, y0, x0 + CW - 10, y0 + CH - 8], outline=(225, 225, 225))
        if nouvelle:
            l, h = dims(sc)
            dr.text((x0 + 8, y0 + IMG_H + 6), g['id'], font=F_ID, fill=NOIR)
            dr.text((x0 + 8, y0 + IMG_H + 27), g['noms']['fr'], font=F_NOM, fill=NOIR)
            dr.text((x0 + 8, y0 + IMG_H + 49), f"{g['case']}  ·  {l} x {h} cm", font=F_DET, fill=GRIS_TEXTE)
            dr.text((x0 + 8, y0 + IMG_H + 66), g['cle'], font=F_DET, fill=GRIS_TEXTE)
        else:
            dr.text((x0 + 8, y0 + IMG_H + 6), s, font=F_ID, fill=GRIS_TEXTE)
            dr.text((x0 + 8, y0 + IMG_H + 27), NOMS_FR.get(s, sc['nom']), font=F_NOM, fill=GRIS_TEXTE)
            dr.text((x0 + 8, y0 + IMG_H + 49), 'déjà au catalogue', font=F_DET, fill=GRIS_TEXTE)
    y += ((len(o['scenes']) + COLS - 1) // COLS) * CH
pl.save(os.path.join(ICI, 'planche-retenues.jpg'), quality=88)
print('gardées', len(GARDEES), 'écartées', len(ECARTEES), 'planche', pl.size)
for g in GARDEES:
    print(f"  {g['case']}  {g['id']:28s} {g['cle']:34s} {g['onglet']:8s} {g['noms']['fr']}")
