# -*- coding: utf-8 -*-
"""
Ajoute les six libellés de l'affiche à motifs (28/11, stand de Mulhouse) dans
apps/web/src/i18n/ui.ts, juste après « cfg.fond », dans les sept langues
(vouvoiement). Rejouable : une clé déjà présente n'est pas ajoutée deux fois.
Les fins de ligne du fichier sont gardées telles quelles.
"""
import os
import re

ICI = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(ICI, "..", "..", "apps", "web", "src", "i18n", "ui.ts")

TEXTES = {
    "fr": ["Motif", "Son nom s'écrit sur la ligne 1 ; vous pouvez le changer.", "Couleur du motif", "Place du texte", "En haut", "En bas"],
    "en": ["Design", "Its name goes on line 1; you can change it.", "Design colour", "Text position", "Top", "Bottom"],
    "de": ["Motiv", "Sein Name steht dann in Zeile 1; Sie können ihn ändern.", "Farbe des Motivs", "Position des Textes", "Oben", "Unten"],
    "it": ["Motivo", "Il suo nome va nella riga 1; può modificarlo.", "Colore del motivo", "Posizione del testo", "In alto", "In basso"],
    "es": ["Motivo", "Su nombre se escribe en la línea 1; puede cambiarlo.", "Color del motivo", "Posición del texto", "Arriba", "Abajo"],
    "ja": ["モチーフ", "名前が1行目に入ります。変更もできます。", "モチーフの色", "文字の位置", "上", "下"],
    "zh": ["图案", "名称会填入第1行，您可以修改。", "图案颜色", "文字位置", "上方", "下方"],
}
CLES = ["cfg.motif", "cfg.motif_aide", "cfg.couleur_motif", "cfg.texte_place", "cfg.texte_haut", "cfg.texte_bas"]


def chaine(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> None:
    with open(UI, encoding="utf-8", newline="") as f:
        texte = f.read()
    nl = "\r\n" if "\r\n" in texte else "\n"
    # Les sept blocs de langue, dans l'ordre du fichier : « fr: { », « en: { »…
    debuts = [(m.group(1), m.start()) for m in re.finditer(r"^  ([a-z]{2}): \{", texte, re.M)]
    langues = [l for l, _ in debuts]
    assert langues[:7] == ["fr", "en", "de", "it", "es", "ja", "zh"], langues
    morceaux = []
    for i, (langue, debut) in enumerate(debuts):
        fin = debuts[i + 1][1] if i + 1 < len(debuts) else len(texte)
        morceaux.append((langue, debut, fin))
    sortie = texte[: morceaux[0][1]]
    ajoutees = 0
    for langue, debut, fin in morceaux:
        bloc = texte[debut:fin]
        if langue in TEXTES:
            # La ligne sans sa fin (\r\n ou \n) : on insère avant elle.
            m = re.search(r'^    "cfg\.fond": [^\r\n]*', bloc, re.M)
            assert m, f"cfg.fond introuvable en {langue}"
            nouvelles = [
                f"    {chaine(cle)}: {chaine(valeur)},"
                for cle, valeur in zip(CLES, TEXTES[langue])
                if f'"{cle}":' not in bloc
            ]
            if nouvelles:
                fin_ligne = m.end()
                bloc = bloc[:fin_ligne] + nl + nl.join(nouvelles) + bloc[fin_ligne:]
                ajoutees += len(nouvelles)
        sortie += bloc
    with open(UI, "w", encoding="utf-8", newline="") as f:
        f.write(sortie)
    print(f"{ajoutees} libellés ajoutés")


if __name__ == "__main__":
    main()
