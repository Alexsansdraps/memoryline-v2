# -*- coding: utf-8 -*-
"""Planche de contrôle de la palette des motifs (demande 7 du 28/11) : les dix
couleurs de base sur les dix-neuf fonds de l'affiche, avec la règle du
configurateur (couleursDuMotif, store.ts) : la silhouette (.st0) prend la
couleur ; les zones crème restent crème si elles se lisent mieux que le trait
sombre sur la couleur, sinon passent au trait sombre #2B2B2B ; les autres zones
(façades) gardent leurs couleurs.

python planche_palette.py <motif> <sortie.html>
Écrit une page HTML (fonds servis par l'API locale), que pilote.mjs capture.
"""
import json
import re
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
TRAVAUX = ICI.parent
DEPOT = TRAVAUX.parent.parent
ASSETS = DEPOT / "data" / "assets"

COULEURS = [
    ("Anthracite", "#2B2B2B"),
    ("Crème", "#F4ECDD"),
    ("Rouge Noël", "#A4161A"),
    ("Vert sapin", "#1F4D3A"),
    ("Bleu nuit", "#1B2A4A"),
    ("Or", "#D4A73B"),
    ("Bordeaux", "#6B1F2A"),
    ("Ocre", "#C27A2C"),
    ("Bleu ciel", "#9CC3D5"),
    ("Rose poudré", "#E3A6A0"),
]
TRAIT = "#2B2B2B"


def lum(h):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def contraste(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def tres_claire(h):
    h = h.lstrip("#")
    return all(int(h[i : i + 2], 16) >= 0xE6 for i in (0, 2, 4))


def recolorer(svg, couleur):
    def remplace(m):
        cls, hexa = m.group(1), m.group(2)
        if cls == "st0":
            return ".%s{fill:%s" % (cls, couleur)
        if tres_claire(hexa) and contraste(couleur, "#" + hexa.lstrip("#")) < contraste(couleur, TRAIT):
            return ".%s{fill:%s" % (cls, TRAIT)
        return m.group(0)

    return re.sub(r"\.(st\d+)\{fill:(#[0-9A-Fa-f]{6})", remplace, svg)


def main():
    motif, sortie = sys.argv[1], sys.argv[2]
    svg = (ASSETS / f"motif-alsace-{motif}-v1.svg").read_text(encoding="utf-8")
    fonds = json.loads((TRAVAUX / "fonds" / "index.json").read_text(encoding="utf-8"))
    lignes = []
    entete = "".join(f"<th>{n}<br><small>{h}</small></th>" for n, h in COULEURS)
    for f in fonds:
        cases = []
        for n, h in COULEURS:
            # Un identifiant de classe propre à chaque case : les styles des SVG
            # en ligne s'appliquent à toute la page.
            pre = f"c{len(lignes)}x{len(cases)}"
            s = recolorer(svg, h).replace(".st", f".{pre}st").replace('class="st', f'class="{pre}st')
            cases.append(
                f'<td><div class="case" style="background-image:url(http://localhost:3000/assets/{f["fichier"]}?l=400)">{s}</div></td>'
            )
        lignes.append(f'<tr><th class="nom">{f["nom"]}</th>{"".join(cases)}</tr>')
    html = f"""<!doctype html><meta charset="utf-8"><title>Palette des motifs</title>
<style>
body {{ margin: 0; font: 12px system-ui, sans-serif; background: #fff; }}
table {{ border-collapse: collapse; }}
th {{ font-weight: 600; padding: 4px; }}
th.nom {{ text-align: right; width: 120px; }}
td {{ padding: 3px; }}
.case {{ width: 88px; height: 124px; background-size: cover; display: flex; align-items: center; justify-content: center; border-radius: 3px; }}
.case svg {{ width: 74px; height: auto; }}
</style>
<table id="planche"><tr><th></th>{entete}</tr>{"".join(lignes)}</table>"""
    Path(sortie).write_text(html, encoding="utf-8")
    print(sortie)


if __name__ == "__main__":
    main()
