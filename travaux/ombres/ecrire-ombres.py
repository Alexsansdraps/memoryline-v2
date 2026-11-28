"""Écrit apps/api/src/ciel-ombres-2.ts (GROUPES_OMBRES, OMBRES_2) à partir des JSON des planches.

Copie de scripts-precedents/ecrire-ombres2.py (27/11), étendue le 28/11 aux familles des
planches A et B (ombres-familles.json, fait par faire-ombres-familles.py depuis tri.json) :
- l'onglet famille devient maman, papa et parents ; les neuf familles d'avant y sont
  rangées (REGROUPES, NOMS), sous leurs ids d'avant ;
- dans chaque groupe, les scènes suivent l'ordre de la fiche (FICHE = GROUPES_SILHOUETTES
  de apps/web/src/islands/AfficheIA.tsx) ; celles que la fiche ne propose plus (chevaux
  debout, animaux seuls) restent après, dans l'ordre des planches, pour les ciels déjà créés ;
- les tracés et les emprises des scènes d'avant sont recopiés tels quels.

Usage, depuis travaux/ombres :
  python -I ecrire-ombres.py scripts-precedents/ombres2/ombres-2.json ../../apps/api/src/ciel-ombres-2.ts \\
      scripts-precedents/ombres2/ombres-3.json scripts-precedents/ombres2/ombres-4.json \\
      scripts-precedents/ombres2/ombres-animaux.json ombres-familles.json
"""
import json
import sys

src, dst = sys.argv[1], sys.argv[2]
ombres = json.load(open(src, encoding='utf-8'))

NOMS = {
    'femme-ondulee': ('seul', 'Femme aux cheveux ondulés'),
    'femme-bouclee-courte': ('seul', 'Femme aux cheveux courts bouclés'),
    'femme-carre': ('seul', 'Femme au carré'),
    'femme-tres-longs-boucles': ('seul', 'Femme aux longues boucles'),
    'femme-chignon-haut': ('seul', 'Femme au chignon haut'),
    'femme-longs': ('seul', 'Femme aux cheveux longs'),
    'homme-boucle': ('seul', 'Homme aux cheveux bouclés'),
    'homme-capuche': ('seul', 'Homme en sweat à capuche'),
    'homme-court': ('seul', 'Homme aux cheveux courts'),
    'homme-casquette': ('seul', 'Homme à la casquette'),
    'enfant-boucle': ('seul', 'Enfant'),
    'couple-homme-femme': ('couple', 'Homme et femme'),
    'couple-femmes-queue': ('couple', 'Deux femmes'),
    'couple-femmes-chignon': ('couple', 'Deux femmes, tête contre tête'),
    'couple-hommes-epaule': ('couple', "Deux hommes, bras sur l'épaule"),
    'couple-hommes-front': ('couple', 'Deux hommes, front contre front'),
    'couple-frises': ('couple', 'Couple aux cheveux bouclés'),
    # L'onglet famille partagé en trois (28/11) : maman, papa, parents.
    'famille-epaules-bebe': ('papa', 'Parent, enfant sur les épaules et bébé'),
    'famille-femme-enfant': ('maman', 'Maman et enfant'),
    'famille-homme-deux-bebes': ('papa', 'Papa et deux bébés'),
    'famille-homme-bebe-femme': ('parents', 'Papa, bébé et maman'),
    'famille-deux-hommes-enfant': ('parents', 'Deux papas et leur enfant'),
    'enfant-chien': ('animal', 'Enfant et son chien'),
    'femme-chien': ('animal', 'Femme et son chien'),
    'homme-chat': ('animal', 'Homme et son chat'),
    'femme-lapin': ('animal', 'Femme et son lapin'),
    'homme-cheval': ('animal', 'Homme et son cheval'),
    'homme-deux-lapins': ('animal', 'Homme et ses deux lapins'),
}
# Les familles des planches 3 et 4 (ombres-3.json, ombres-4.json), rangées dans les
# trois onglets qui remplacent famille (28/11).
REGROUPES = {
    'famille-papa-bebe': 'papa',
    'famille-quatre': 'parents',
    'famille-maman-montre-ciel': 'maman',
    'famille-papa-ado': 'papa',
}
ORDRE = ['seul', 'couple', 'maman', 'papa', 'parents', 'animal', 'animaux']
# L'ordre de la fiche, onglet par onglet (tri.json, onglets ; GROUPES_SILHOUETTES de
# AfficheIA.tsx) : du plus simple au plus nombreux ; Avec un animal rangé par animal.
FICHE = {
    'seul': [
        'femme-ondulee', 'femme-longs', 'femme-carre', 'femme-tres-longs-boucles', 'femme-bouclee-courte',
        'femme-chignon-haut', 'femme-queue-de-cheval', 'homme-court', 'homme-boucle', 'homme-capuche',
        'homme-casquette', 'homme-bonnet-laine', 'enfant-boucle', 'enfant-casquette', 'fillette-couettes',
        'fillette-cheveux-longs', 'fillette-chignon',
    ],
    'couple': [
        'couple-homme-femme', 'couple-frises', 'couple-femmes-queue', 'couple-femmes-chignon',
        'couple-hommes-epaule', 'couple-hommes-front',
    ],
    'maman': [
        'famille-femme-enfant', 'famille-maman-montre-ciel', 'maman-fille-garcon', 'maman-deux-filles',
        'maman-deux-garcons', 'maman-fille-ado', 'maman-deux-filles-garcon', 'maman-fille-deux-garcons',
        'maman-trois-garcons',
    ],
    'papa': [
        'famille-papa-bebe', 'papa-garcon', 'famille-papa-ado', 'famille-homme-deux-bebes', 'papa-fille-garcon',
        'papa-deux-garcons', 'famille-epaules-bebe', 'papa-trois-enfants',
    ],
    'parents': [
        'famille-homme-bebe-femme', 'parents-fille', 'parents-garcon', 'deux-mamans-fille', 'deux-mamans-garcon',
        'famille-deux-hommes-enfant', 'parents-fille-garcon', 'famille-quatre', 'deux-mamans-fille-garcon',
        'parents-trois-enfants',
    ],
    'animal': [
        'femme-chien', 'homme-chien', 'femme-petit-chien', 'homme-petit-chien', 'homme-grand-chien',
        'enfant-chien', 'deux-enfants-chien', 'papa-enfant-chien', 'femme-chat', 'homme-chat',
        'femme-chat-chien', 'papa-trois-enfants-chat', 'parents-deux-garcons-chat', 'femme-lapin',
        'homme-deux-lapins', 'femme-cheval-couche', 'homme-cheval',
    ],
    # Plus proposé (28/11 vers 1 h 45, Alexandra : « enlève les animaux seuls »).
    'animaux': [],
}
par = {k: [] for k in ORDRE}
for o in ombres:
    groupe, nom = NOMS[o['id']]
    par[groupe].append((o, nom))
# La 3e planche (27/11 au soir : « tris ceux qui sont redondant tu les prends pas ») : 6 scènes.
# Puis la 4e, les animaux seuls et les familles du 28/11.
for chemin in sys.argv[3:]:
    for o in json.load(open(chemin, encoding='utf-8')):
        g = 'animaux' if o['id'] == 'chien-et-cheval' else REGROUPES.get(o['id'], o['groupe'])
        if g not in par:
            sys.exit(f"{o['id']} : groupe {g!r} inconnu (groupes : {', '.join(ORDRE)})")
        par[g].append((o, o['nom']))

# Contrôles : un id une seule fois ; chaque scène de la fiche existe, dans son groupe ;
# l'API refuse les chiffres dans un id (/^[a-z-]+(:m)?$/, lireReglagesCiel).
ids = [o['id'] for g in ORDRE for o, _ in par[g]]
assert len(ids) == len(set(ids)), 'id en double'
for o_id in ids:
    assert o_id.replace('-', '').isalpha() and o_id == o_id.lower(), o_id
for g in ORDRE:
    dans = [o['id'] for o, _ in par[g]]
    manque = [s for s in FICHE[g] if s not in dans]
    assert not manque, (g, manque)
    rang = {s: i for i, s in enumerate(FICHE[g])}
    # Tri stable : les scènes que la fiche ne propose pas gardent l'ordre des planches, à la fin.
    par[g].sort(key=lambda x: rang.get(x[0]['id'], len(rang)))

L = []
L.append('/**')
L.append(" * Les ombres chinoises de la 2e planche d'Alexandra (27/11 au soir : « tiens")
L.append(" * les nouveaux trucs à découper, reconnais les et classe les »), rangées")
L.append(" * par groupe (« faudrait que ça soit plus logique y'a trop de")
L.append(" * possibilités ») : la cliente choisit QUI — seul·e, en couple, maman et")
L.append(" * enfants, papa et enfants, parents et enfants, avec un animal —, puis UNE")
L.append(" * scène.")
L.append(' *')
L.append(" * Fabrication : comme ciel-ombres.ts (masque, marching squares, RDP 0,8 px,")
L.append(" * Catmull-Rom), herbe retirée au pied ; 90 cm pour un adulte assis seul ; les")
L.append(" * rangées des groupes, dessinées plus petites dans l'image, ramenées à la même")
L.append(" * échelle (× 1,18 couples, × 1,2 familles, × 1,12 animaux). Base sur y = 0.")
L.append(' * Images sources : Documents/memory-line/protos/ombres-2.png et, pour six')
L.append(' * scènes sans doublon (chevaux couché et debout, homme et chien, femme et chat,')
L.append(' * homme au bonnet, papa et bébé), ombres-3.png (hors dépôt ; fond blanc, ombre')
L.append(' * portée au sol retirée, même échelle de 90 cm), et 15 scènes sans doublon de')
L.append(' * ombres-4.png (enfants seuls, petits et grand chiens, chevaux, familles).')
L.append(' *')
L.append(" * Les familles du 28/11 (Alexandra : « il faut que tu prennes ce qui n'existe")
L.append(" * pas encore [...] Vraiment, être précis quand même ») : 21 scènes des planches")
L.append(' * ombres-familles-a.png et ombres-familles-b.png (hors dépôt), une par')
L.append(' * composition qui manquait (tri : travaux/ombres/TRI.md). Même fabrication ;')
L.append(' * 90 cm pour la maman de la case (planche A) ou pour la moyenne des adultes de')
L.append(' * la case (planche B), les enfants gardent leur taille ; gauche, droite et haut')
L.append(" * mesurés sur la courbe. L'onglet famille devient maman, papa et parents : les")
L.append(" * familles d'avant y sont rangées, sous leurs ids.")
L.append(' * Fichier généré (travaux/ombres/ecrire-ombres.py) : ne pas retoucher les')
L.append(' * tracés à la main.')
L.append(' */')
L.append('')
L.append('import type { Silhouette } from "./ciel-silhouettes.js";')
L.append('')
L.append("// maman, papa, parents : l'onglet famille partagé en trois (28/11). Le groupe")
L.append("// animaux (les animaux seuls) n'est plus proposé par la fiche depuis le 28/11 ;")
L.append('// ses scènes restent pour redessiner les ciels déjà créés.')
L.append('export const GROUPES_OMBRES = ["seul", "couple", "maman", "papa", "parents", "animal", "animaux"] as const;')
L.append('export type GroupeOmbre = (typeof GROUPES_OMBRES)[number];')
L.append('')
L.append("/** Chaque scène avec son groupe, dans l'ordre où la fiche les montre (puis celles qu'elle ne propose plus). */")
L.append('export const OMBRES_2: readonly (Silhouette & { groupe: GroupeOmbre })[] = [')
for g in ORDRE:
    for o, nom in par[g]:
        L.append('  {')
        L.append(f'    id: {json.dumps(o["id"])},')
        L.append(f'    nom: {json.dumps(nom, ensure_ascii=False)},')
        L.append(f'    groupe: {json.dumps(g)},')
        L.append(f'    gauche: {o["gauche"]},')
        L.append(f'    droite: {o["droite"]},')
        L.append(f'    haut: {o["haut"]},')
        L.append(f'    d: {json.dumps(o["d"])},')
        L.append('  },')
L.append('];')
open(dst, 'w', encoding='utf-8', newline='\n').write('\n'.join(L) + '\n')
print('ok', sum(len(v) for v in par.values()), {g: len(par[g]) for g in ORDRE})
