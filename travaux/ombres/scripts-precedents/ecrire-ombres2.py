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
    'famille-epaules-bebe': ('famille', 'Parent, enfant sur les épaules et bébé'),
    'famille-femme-enfant': ('famille', 'Maman et enfant'),
    'famille-homme-deux-bebes': ('famille', 'Papa et deux bébés'),
    'famille-homme-bebe-femme': ('famille', 'Papa, bébé et maman'),
    'famille-deux-hommes-enfant': ('famille', 'Deux papas et leur enfant'),
    'enfant-chien': ('animal', 'Enfant et son chien'),
    'femme-chien': ('animal', 'Femme et son chien'),
    'homme-chat': ('animal', 'Homme et son chat'),
    'femme-lapin': ('animal', 'Femme et son lapin'),
    'homme-cheval': ('animal', 'Homme et son cheval'),
    'homme-deux-lapins': ('animal', 'Homme et ses deux lapins'),
}
ORDRE = ['seul', 'couple', 'famille', 'animal', 'animaux']
par = {k: [] for k in ORDRE}
for o in ombres:
    groupe, nom = NOMS[o['id']]
    par[groupe].append((o, nom))
# La 3e planche (27/11 au soir : « tris ceux qui sont redondant tu les prends pas ») : 6 scènes.
for chemin in sys.argv[3:]:
    for o in json.load(open(chemin, encoding='utf-8')):
        g = 'animaux' if o['id'] == 'chien-et-cheval' else o['groupe']
        par[g].append((o, o['nom']))

L = []
L.append('/**')
L.append(" * Les ombres chinoises de la 2e planche d'Alexandra (27/11 au soir : « tiens")
L.append(" * les nouveaux trucs à découper, reconnais les et classe les »), rangées")
L.append(" * par groupe (« faudrait que ça soit plus logique y'a trop de")
L.append(" * possibilités ») : la cliente choisit QUI — seul·e, en couple, en famille,")
L.append(" * avec un animal —, puis UNE scène.")
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
L.append(' * Fichier généré : ne pas retoucher les tracés à la main.')
L.append(' */')
L.append('')
L.append('import type { Silhouette } from "./ciel-silhouettes.js";')
L.append('')
L.append("// Le groupe animaux : les animaux seuls (27/11 au soir, Alexandra : on n'a aucun animal seul).")
L.append('export const GROUPES_OMBRES = ["seul", "couple", "famille", "animal", "animaux"] as const;')
L.append('export type GroupeOmbre = (typeof GROUPES_OMBRES)[number];')
L.append('')
L.append('/** Chaque scène avec son groupe, dans l\'ordre où la fiche les montre. */')
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
print('ok', sum(len(v) for v in par.values()))
