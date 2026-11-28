"""Les 21 scènes gardées des planches A et B (tri du 28/11, tri.json / TRI.md) au
format ombres2, sous leur id définitif : ombres-familles.json, que lit
ecrire-ombres.py.

- le tracé `d` est celui de la case (planche-A/ ou planche-B/), sans un octet de changé ;
- `groupe` = l'onglet de la fiche (maman, papa, parents, animal), `nom` = le libellé fr ;
- `gauche`, `droite`, `haut` sont remesurés sur la courbe elle-même (extremums exacts
  des Bézier), arrondis vers l'extérieur au centième : decoupe-B.py les prenait sur
  les sommets du polygone, la courbe sortait jusqu'à 0,46 cm de cette emprise
  (poserSilhouettes s'en sert pour l'écart entre scènes et pour le plafond des têtes) ;
- l'ordre : celui des onglets de la fiche (tri.json, onglets).

Usage (depuis la racine du dépôt) : python -I travaux/ombres/faire-ombres-familles.py
"""
import json
import math
import re

TRI = 'travaux/ombres/tri.json'
SORTIE = 'travaux/ombres/ombres-familles.json'
JETON = re.compile(r'[MCZ]|-?\d+(?:\.\d+)?')


def emprise(d):
    """Emprise exacte d'un chemin fait de M, C (absolus) et Z : extremums des Bézier cubiques."""
    jetons = JETON.findall(d)
    assert set(re.findall(r'[A-Za-z]', d)) <= {'M', 'C', 'Z'}, 'commande inattendue'
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
                # B'(t) / 3 = A t² + B t + C
                a, b, c = p1 - p0, p2 - p1, p3 - p2
                A, B, C = a - 2 * b + c, 2 * (b - a), a
                racines = []
                if abs(A) < 1e-12:
                    if abs(B) > 1e-12:
                        racines.append(-C / B)
                else:
                    disc = B * B - 4 * A * C
                    if disc >= 0:
                        r = math.sqrt(disc)
                        racines += [(-B + r) / (2 * A), (-B - r) / (2 * A)]
                for s in racines:
                    if 0 < s < 1:
                        u = 1 - s
                        liste.append(u ** 3 * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s ** 3 * p3)
            cur = p[3]
            i += 7
        elif t == 'Z':
            i += 1
        else:
            raise ValueError(t)
    return min(xs), max(xs), min(ys)


tri = json.load(open(TRI, encoding='utf-8'))
ordre = [sid for onglet in tri['onglets'] for sid in onglet['scenes']]
gardees = sorted(tri['gardees'], key=lambda g: ordre.index(g['id']))
sortie = []
for g in gardees:
    case = json.load(open(g['json'], encoding='utf-8'))
    assert re.fullmatch(r'[a-z-]+', g['id']), g['id']  # l'API refuse les chiffres (/^[a-z-]+(:m)?$/)
    gauche, droite, haut = emprise(case['d'])
    o = {
        'id': g['id'],
        'groupe': g['onglet'],
        'nom': g['noms']['fr'],
        'gauche': round(math.floor(gauche * 100 + 1e-9) / 100, 2),
        'droite': round(math.ceil(droite * 100 - 1e-9) / 100, 2),
        'haut': round(math.floor(haut * 100 + 1e-9) / 100, 2),
        'decalage': 0,
        'd': case['d'],
        # Informations (non lues par ecrire-ombres.py).
        'case': g['case'],
        'cle': g['cle'],
    }
    print(f"{o['case']:7s} {o['id']:28s} {o['groupe']:8s} emprise case g={case['gauche']:8.2f} d={case['droite']:7.2f} "
          f"h={case['haut']:7.2f} -> courbe g={o['gauche']:8.2f} d={o['droite']:7.2f} h={o['haut']:7.2f}")
    sortie.append(o)
with open(SORTIE, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(sortie, f, ensure_ascii=False, indent=1)
    f.write('\n')
print(len(sortie), 'scènes ->', SORTIE)
