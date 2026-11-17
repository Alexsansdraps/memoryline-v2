#!/usr/bin/env bash
#
# Vide le cache de Docker chaque nuit, à 1 h du matin, heure de Paris (17/11).
#
# Chaque mise en ligne reconstruit les images et laisse derrière elle du cache
# de construction et les images d'avant. Sans ménage, ça finit par remplir le
# disque (19,8 Go de cache le 17/11), et un disque plein arrête la boutique.
#
# Ce que ça retire :
#   - le cache de construction, au-delà des 3 Go les plus récents (gardés pour
#     que la mise en ligne suivante reste rapide) ;
#   - les images d'avant, restées sans nom, qu'aucun conteneur n'utilise.
# Ce que ça ne touche JAMAIS : les conteneurs, les images en service, les
# volumes (la base), les fichiers téléversés, les sauvegardes.
#
# Planifié dans le crontab de debian, à 23 h ET à minuit UTC, parce que le
# serveur vit à l'heure UTC : 1 h à Paris tombe à minuit UTC l'hiver et à 23 h
# l'été. À l'autre heure, le script s'arrête tout de suite sans rien faire.
#   0 23,0 * * * /bin/bash /home/debian/memoryline/apps/api/scripts/vider-cache-docker.sh >> /home/debian/memoryline/sauvegardes/journal-cache.txt 2>&1
#
# À la main, tout de suite, depuis ~/memoryline :
#   bash apps/api/scripts/vider-cache-docker.sh maintenant
set -euo pipefail

if [ "${1:-}" != "maintenant" ] && [ "$(TZ=Europe/Paris date +%H)" != "01" ]; then
  exit 0
fi

libre() { df -h / | awk 'NR==2 {print $4}'; }
AVANT=$(libre)
docker builder prune -f --max-used-space 3GB > /dev/null
docker image prune -f > /dev/null
echo "$(TZ=Europe/Paris date '+%Y-%m-%d %H:%M') cache vidé : $AVANT libres avant, $(libre) après."
