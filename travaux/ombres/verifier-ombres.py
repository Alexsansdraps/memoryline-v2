"""Vérifie le ciel-ombres-2.ts régénéré (28/11) contre celui d'avant.

- les scènes d'avant : mêmes id, nom, gauche, droite, haut et d, octet pour octet
  (le texte des champs, pas seulement leur valeur) ; seul le groupe des familles change ;
- les nouvelles : d identique à celui de ombres-familles.json (donc à la case de la planche),
  emprise identique ;
- l'emprise déclarée contient la courbe (rien ne dépasse) pour les nouvelles.

Usage (racine du dépôt) :
  git show HEAD:apps/api/src/ciel-ombres-2.ts > /tmp/avant.ts
  python -I travaux/ombres/verifier-ombres.py /tmp/avant.ts apps/api/src/ciel-ombres-2.ts travaux/ombres/ombres-familles.json
"""
import json
import math
import re
import sys


def entrees(chemin):
    """Les entrées d'un fichier d'ombres généré, champ par champ (texte brut et valeur)."""
    out, cur = [], None
    for ligne in open(chemin, encoding='utf-8').read().split('\n'):
        s = ligne.strip()
        if s == '{':
            cur = {}
        elif s in ('},', '}') and cur is not None:
            out.append(cur)
            cur = None
        elif cur is not None:
            cle, _, val = s.partition(': ')
            cur[cle] = val.rstrip(',')
    return out


def emprise(d):
    # Même calcul exact que faire-ombres-familles.py (extremums des Bézier).
    jetons = re.findall(r'[MCZ]|-?\d+(?:\.\d+)?', d)
    xs, ys, cur, i = [], [], None, 0
    while i < len(jetons):
        t = jetons[i]
        if t == 'M':
            cur = (float(jetons[i + 1]), float(jetons[i + 2]))
            xs.append(cur[0]), ys.append(cur[1])
            i += 3
        elif t == 'C':
            p = [cur] + [(float(jetons[i + k]), float(jetons[i + k + 1])) for k in (1, 3, 5)]
            for axe, liste in ((0, xs), (1, ys)):
                p0, p1, p2, p3 = (q[axe] for q in p)
                liste.append(p3)
                a, b, c = p1 - p0, p2 - p1, p3 - p2
                A, B, C = a - 2 * b + c, 2 * (b - a), a
                rac = []
                if abs(A) < 1e-12:
                    if abs(B) > 1e-12:
                        rac.append(-C / B)
                elif B * B - 4 * A * C >= 0:
                    r = math.sqrt(B * B - 4 * A * C)
                    rac += [(-B + r) / (2 * A), (-B - r) / (2 * A)]
                for s in rac:
                    if 0 < s < 1:
                        u = 1 - s
                        liste.append(u ** 3 * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s ** 3 * p3)
            cur = p[3]
            i += 7
        else:
            i += 1
    return min(xs), max(xs), min(ys)


avant = {json.loads(e['id']): e for e in entrees(sys.argv[1])}
apres = {json.loads(e['id']): e for e in entrees(sys.argv[2])}
familles = {o['id']: o for o in json.load(open(sys.argv[3], encoding='utf-8'))}
erreurs = []
print(f'avant {len(avant)} scènes, après {len(apres)}, nouvelles attendues {len(familles)}')
for sid, e in avant.items():
    f = apres.get(sid)
    if f is None:
        erreurs.append(f'{sid} a disparu')
        continue
    for cle in ('nom', 'gauche', 'droite', 'haut', 'd'):
        if e[cle] != f[cle]:
            erreurs.append(f'{sid} : {cle} a changé')
    if e['groupe'] != f['groupe']:
        print(f'  groupe {sid:28s} {e["groupe"]} -> {f["groupe"]}')
nouvelles = [s for s in apres if s not in avant]
assert sorted(nouvelles) == sorted(familles), (sorted(nouvelles), sorted(familles))
for sid in nouvelles:
    f, o = apres[sid], familles[sid]
    if json.loads(f['d']) != o['d']:
        erreurs.append(f'{sid} : d différent de ombres-familles.json')
    for cle in ('gauche', 'droite', 'haut'):
        if float(f[cle]) != o[cle]:
            erreurs.append(f'{sid} : {cle} différent')
    if json.loads(f['groupe']) != o['groupe'] or json.loads(f['nom']) != o['nom']:
        erreurs.append(f'{sid} : groupe ou nom différent')
    g, d, h = emprise(o['d'])
    if g < o['gauche'] - 1e-9 or d > o['droite'] + 1e-9 or h < o['haut'] - 1e-9:
        erreurs.append(f'{sid} : la courbe sort de son emprise')
print(f'scènes d\'avant identiques (nom, gauche, droite, haut, d) : {len(avant) - len([x for x in erreurs if "changé" in x or "disparu" in x])}/{len(avant)}')
print(f'nouvelles conformes à ombres-familles.json : {len(nouvelles)}')
print('ERREURS :' if erreurs else 'aucune erreur', *erreurs, sep='\n  ')
sys.exit(1 if erreurs else 0)
