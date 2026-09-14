#!/usr/bin/env bash
#
# Sauvegarde la boutique : la base ET les fichiers téléversés.
#
# À lancer sur le serveur, depuis ~/memoryline. Sans argument, tous les jours,
# par le planificateur (voir tout en bas).
#
# CE QUE ÇA PROTÈGE, ET CE QUE ÇA NE PROTÈGE PAS — il faut le dire clairement,
# parce qu'une sauvegarde mal comprise est plus dangereuse que pas de
# sauvegarde du tout :
#
#   ✓ une suppression par erreur, une mauvaise manipulation au back-office,
#     une mise à jour qui tourne mal, un tableau vidé sans le vouloir ;
#   ✗ la perte de la machine elle-même. Ces copies vivent sur le MÊME disque
#     que ce qu'elles sauvegardent. Si le serveur brûle, elles brûlent avec.
#
# Le second point se règle en emportant les copies ailleurs. La dernière ligne
# affichée par ce script donne la commande exacte, à lancer depuis votre
# ordinateur. Une fois par semaine suffit ; le jour où vous en aurez besoin,
# vous serez content de l'avoir fait.
#
# Et une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde : c'est
# un fichier dont on espère quelque chose. `restaurer.sh` existe pour l'essayer
# sans rien casser.
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
RACINE="$(pwd)"
COPIES="$RACINE/sauvegardes"
# Passé en argument par le planificateur, sinon la date du jour. Écrit à
# l'envers (année-mois-jour) pour que l'ordre alphabétique soit l'ordre du
# temps : « ls » suffit alors à lire l'historique.
JOUR="${1:-$(date +%Y-%m-%d)}"

if [ ! -f docker-compose.prod.yml ]; then
  echo "À lancer depuis ~/memoryline (docker-compose.prod.yml introuvable)." >&2
  exit 1
fi

mkdir -p "$COPIES/base" "$COPIES/fichiers"

# --- La base --------------------------------------------------------------
# Le format « plain », compressé : il se lit dans un éditeur de texte, se
# restaure avec psql seul, et ne dépend pas de la version de pg_dump qui l'a
# produit. Un format binaire serait plus compact et illisible le jour où l'on
# n'aurait justement plus l'outil pour le lire.
echo "→ La base."
FICHIER_BASE="$COPIES/base/$JOUR.sql.gz"
$COMPOSE exec -T db pg_dump --no-owner --no-privileges --no-comments \
  -U memoryline -d memoryline | gzip -9 > "$FICHIER_BASE.en-cours"

# Le fichier ne prend son nom définitif QU'UNE FOIS VÉRIFIÉ. Une sauvegarde
# interrompue à la moitié porterait sinon le même nom qu'une bonne, et
# prendrait sa place dans la rotation en repoussant la dernière valable.
#
# On compte les tables plutôt que les octets. Un seuil en octets ne dit rien :
# une copie coupée aux trois quarts le franchit sans peine, et c'est justement
# celle-là qui trompe. Une copie qui contient les 49 tables attendues a, elle,
# été écrite jusqu'au bout — pg_dump les écrit dans l'ordre et ne s'arrête pas
# au milieu sans raison.
TABLES=$(gzip -dc "$FICHIER_BASE.en-cours" 2>/dev/null | grep -c '^CREATE TABLE ' || true)
if [ "$TABLES" -lt 40 ]; then
  rm -f "$FICHIER_BASE.en-cours"
  echo "   ✗ La copie ne contient que $TABLES tables, on en attend une" >&2
  echo "     cinquantaine. Rien n'a été enregistré : l'ancienne copie reste" >&2
  echo "     en place, elle vaut mieux qu'une neuve incomplète." >&2
  echo "     Vérifiez que la base répond :  $COMPOSE ps db" >&2
  exit 1
fi
mv "$FICHIER_BASE.en-cours" "$FICHIER_BASE"
echo "   $(du -h "$FICHIER_BASE" | cut -f1) — $TABLES tables — $FICHIER_BASE"

# --- Les fichiers téléversés ---------------------------------------------
# 1,5 Go : en faire une copie entière chaque jour remplirait le disque en trois
# semaines. `--link-dest` compare avec la copie de la veille et ne réécrit que
# ce qui a changé ; le reste n'est qu'un second nom donné au même fichier sur
# le disque. Chaque jour se relit pourtant comme une copie complète.
echo "→ Les fichiers téléversés."
FICHIERS_FAITS=0
if [ ! -d data/assets ]; then
  echo "   (aucun dossier data/assets — rien à copier)"
elif ! command -v rsync >/dev/null 2>&1; then
  # On ne s'arrête PAS : la base, elle, est sauvegardée, et c'est elle qui
  # porte les commandes. Mieux vaut une sauvegarde partielle annoncée qu'un
  # script qui meurt en laissant croire que rien n'a marché.
  echo "   ✗ rsync n'est pas installé sur cette machine : les fichiers n'ont" >&2
  echo "     PAS été copiés. La base, elle, l'a été." >&2
  echo >&2
  echo "     Pour l'installer, une fois pour toutes :" >&2
  echo "         sudo apt-get update && sudo apt-get install -y rsync" >&2
  echo >&2
else
  VEILLE=$(ls -1d "$COPIES/fichiers"/*/ 2>/dev/null | sort | tail -1 || true)
  rsync -a --delete \
    ${VEILLE:+--link-dest="$VEILLE"} \
    data/assets/ "$COPIES/fichiers/$JOUR/"
  echo "   $(du -sh --apparent-size "$COPIES/fichiers/$JOUR" | cut -f1) de fichiers"
  echo "   (n'occupent réellement que ce qui a changé depuis la veille)"
  FICHIERS_FAITS=1
fi

# --- La rotation ----------------------------------------------------------
# Quatorze jours pour la base, sept pour les fichiers. Une erreur se remarque
# rarement au-delà de deux semaines, et garder tout indéfiniment finit par
# remplir le disque — ce qui arrête la boutique pour de bon.
echo "→ Ménage."
ls -1 "$COPIES/base"/*.sql.gz 2>/dev/null | sort | head -n -14 | while read -r v; do
  rm -f "$v" && echo "   retiré $(basename "$v")"
done
ls -1d "$COPIES/fichiers"/*/ 2>/dev/null | sort | head -n -7 | while read -r v; do
  rm -rf "$v" && echo "   retiré $(basename "$v")"
done

RESTE=$(df -h "$RACINE" | awk 'NR==2 {print $4}')
echo
if [ "$FICHIERS_FAITS" = 1 ]; then
  echo "✓ Sauvegarde du $JOUR terminée : la base ET les fichiers."
else
  echo "⚠ Sauvegarde du $JOUR PARTIELLE : la base seulement."
  echo "  Les fichiers téléversés — 1,5 Go d'images, de visuels et de fichiers"
  echo "  d'impression — ne sont toujours copiés nulle part."
fi
echo "  $RESTE encore libres sur le disque."
echo
echo "  Ces copies sont sur LE MÊME DISQUE que la boutique : elles vous"
echo "  protègent d'une fausse manœuvre, pas de la perte du serveur."
echo "  Pour les emporter, depuis VOTRE ordinateur :"
echo
echo "      scp -r debian@51.255.34.187:~/memoryline/sauvegardes ."
echo
