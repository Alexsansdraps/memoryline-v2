# -*- coding: utf-8 -*-
"""
Les fonds de l'affiche du stand de Mulhouse (28/11, Alexandra : « les fonds
peuvent être unis ou dégradé ou une image genre un motif tu vois le délire »).

19 VRAIS fichiers de fond, rangés et rattachés au produit comme tous les
autres fonds : 8 unis, 6 dégradés verticaux, 5 motifs répétés. Margaux en
ajoute ou en archive dans la fiche produit › Visuels, comme d'habitude.

Rien que des formes simples (rect, path, circle, linearGradient vertical,
pattern en userSpaceOnUse) : ni filtre, ni image, ni texte, ni référence
externe. L'aperçu (l'API convertit le SVG en webp, ?l=) et l'impression
(pdf.ts) passent tous deux par sharp/librsvg : ce qu'on voit est ce qu'on
imprime.

Rejouable : python generer_fonds.py  (réécrit les 19 fichiers et index.json
dans ce dossier ; la copie vers data/assets est faite par
../generer_migration.py). Un fond corrigé plus tard change de NOM (-v2) :
/assets est servi « immutable ».
"""
import json
import math
import os

ICI = os.path.dirname(os.path.abspath(__file__))
L, H = 1000, 1414  # la proportion A4/A3 (1:√2)


def entete(contenu_defs: str, corps: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{L}" height="{H}" viewBox="0 0 {L} {H}">'
        + (f"<defs>{contenu_defs}</defs>" if contenu_defs else "")
        + corps
        + "</svg>\n"
    )


def uni(couleur: str) -> str:
    return entete("", f'<rect width="{L}" height="{H}" fill="{couleur}"/>')


def degrade(haut: str, bas: str) -> str:
    defs = (
        '<linearGradient id="d" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{haut}"/><stop offset="1" stop-color="{bas}"/>'
        "</linearGradient>"
    )
    return entete(defs, f'<rect width="{L}" height="{H}" fill="url(#d)"/>')


def repete(fond: str, tuile: int, motif: str) -> str:
    defs = (
        f'<pattern id="p" patternUnits="userSpaceOnUse" x="0" y="0" width="{tuile}" height="{tuile}">'
        f"{motif}</pattern>"
    )
    return entete(
        defs,
        f'<rect width="{L}" height="{H}" fill="{fond}"/><rect width="{L}" height="{H}" fill="url(#p)"/>',
    )


def r(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def flocon(cx: float, cy: float, rayon: float, epaisseur: float) -> str:
    """Un flocon à six branches, chaque branche avec deux petites ramures."""
    d = []
    for k in range(6):
        a = math.radians(90 + 60 * k)
        ex, ey = cx + rayon * math.cos(a), cy - rayon * math.sin(a)
        d.append(f"M{r(cx)} {r(cy)}L{r(ex)} {r(ey)}")
        # ramures aux deux tiers de la branche
        mx, my = cx + 0.62 * rayon * math.cos(a), cy - 0.62 * rayon * math.sin(a)
        for s in (-1, 1):
            b = a + s * math.radians(42)
            fx, fy = mx + 0.32 * rayon * math.cos(b), my - 0.32 * rayon * math.sin(b)
            d.append(f"M{r(mx)} {r(my)}L{r(fx)} {r(fy)}")
    return (
        f'<path d="{"".join(d)}" fill="none" stroke="#FFFFFF" stroke-width="{r(epaisseur)}" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
    )


def etoile(cx: float, cy: float, rayon: float, couleur: str, branches: int = 5) -> str:
    pts = []
    for k in range(branches * 2):
        a = math.radians(90 + 180 * k / branches)
        rr = rayon if k % 2 == 0 else rayon * 0.42
        pts.append(f"{r(cx + rr * math.cos(a))} {r(cy - rr * math.sin(a))}")
    return f'<path d="M{"L".join(pts)}Z" fill="{couleur}"/>'


def coeur(cx: float, cy: float, t: float, couleur: str) -> str:
    """Un petit cœur plein, de largeur ~2t, centré en (cx, cy)."""
    d = (
        f"M{r(cx)} {r(cy + 0.9 * t)}"
        f"C{r(cx - 0.15 * t)} {r(cy + 0.75 * t)} {r(cx - t)} {r(cy + 0.2 * t)} {r(cx - t)} {r(cy - 0.3 * t)}"
        f"C{r(cx - t)} {r(cy - 0.85 * t)} {r(cx - 0.3 * t)} {r(cy - 1.0 * t)} {r(cx)} {r(cy - 0.5 * t)}"
        f"C{r(cx + 0.3 * t)} {r(cy - 1.0 * t)} {r(cx + t)} {r(cy - 0.85 * t)} {r(cx + t)} {r(cy - 0.3 * t)}"
        f"C{r(cx + t)} {r(cy + 0.2 * t)} {r(cx + 0.15 * t)} {r(cy + 0.75 * t)} {r(cx)} {r(cy + 0.9 * t)}Z"
    )
    return f'<path d="{d}" fill="{couleur}"/>'


FONDS = [
    ("uni-rouge-noel", "Rouge Noël (uni)", "uni", uni("#A4161A")),
    ("uni-vert-sapin", "Vert sapin (uni)", "uni", uni("#1F4D3A")),
    ("uni-bleu-nuit", "Bleu nuit (uni)", "uni", uni("#1B2A4A")),
    ("uni-bordeaux", "Bordeaux (uni)", "uni", uni("#6B1F2A")),
    ("uni-creme", "Crème (uni)", "uni", uni("#F4ECDD")),
    ("uni-ocre", "Ocre (uni)", "uni", uni("#E2B659")),
    ("uni-rose-saumon", "Rose saumon (uni)", "uni", uni("#E8A598")),
    ("uni-bleu-ciel", "Bleu ciel (uni)", "uni", uni("#CFE3EE")),
    ("degrade-nuit-d-hiver", "Nuit d'hiver (dégradé)", "degrade", degrade("#0E1A33", "#36598C")),
    ("degrade-braise", "Braise (dégradé)", "degrade", degrade("#6E0F17", "#C0392B")),
    ("degrade-foret", "Forêt (dégradé)", "degrade", degrade("#10382A", "#2F6B4F")),
    ("degrade-crepuscule", "Crépuscule (dégradé)", "degrade", degrade("#28224C", "#C46B6B")),
    ("degrade-neige", "Neige (dégradé)", "degrade", degrade("#FFFFFF", "#D9E6EF")),
    ("degrade-aube", "Aube rosée (dégradé)", "degrade", degrade("#F5D3C6", "#FBF4EA")),
    # Motifs répétés : deux éléments par tuile, décalés d'une demi-tuile (en quinconce).
    (
        "repete-flocons",
        "Flocons",
        "motif",
        repete("#1B2A4A", 125, flocon(31.25, 31.25, 17, 3.2) + flocon(93.75, 93.75, 11, 2.6)),
    ),
    (
        "repete-vichy-rouge",
        "Vichy rouge",
        "motif",
        repete(
            "#F4ECDD",
            60,
            '<rect x="0" y="0" width="30" height="60" fill="#A4161A" fill-opacity="0.45"/>'
            '<rect x="0" y="0" width="60" height="30" fill="#A4161A" fill-opacity="0.45"/>',
        ),
    ),
    (
        "repete-etoiles",
        "Étoiles dorées",
        "motif",
        repete("#8E1B1F", 110, etoile(27.5, 27.5, 11, "#D4A73B") + etoile(82.5, 82.5, 6.5, "#D4A73B")),
    ),
    (
        "repete-coeurs",
        "Cœurs alsaciens",
        "motif",
        repete("#F4ECDD", 100, coeur(25, 25, 11, "#B3262E") + coeur(75, 75, 11, "#B3262E")),
    ),
    (
        "repete-pois-neige",
        "Pois de neige",
        "motif",
        repete(
            "#1F4D3A",
            64,
            '<circle cx="16" cy="16" r="6.5" fill="#FFFFFF"/><circle cx="48" cy="48" r="6.5" fill="#FFFFFF"/>',
        ),
    ),
]


def main() -> None:
    index = []
    for position, (ident, nom, genre, svg) in enumerate(FONDS):
        fichier = f"fond-noel-{ident}-v1.svg"
        with open(os.path.join(ICI, fichier), "w", encoding="utf-8", newline="\n") as f:
            f.write(svg)
        index.append({"id": ident, "fichier": fichier, "nom": nom, "genre": genre, "position": position})
    with open(os.path.join(ICI, "index.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(index)} fonds écrits dans {ICI}")


if __name__ == "__main__":
    main()
