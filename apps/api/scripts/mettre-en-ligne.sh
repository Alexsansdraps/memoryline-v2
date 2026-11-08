#!/usr/bin/env bash
#
# Met en ligne une nouvelle version de la boutique, en une seule commande.
#
# Le code arrive dans une archive (~/memoryline-deploiement.tar.gz), envoyée
# depuis l'ordinateur. Ce script fait ensuite, dans l'ordre, ce qu'on tapait
# à la main en trois fois — et qu'on finissait par oublier en partie :
#
#   1. la SAUVEGARDE de la base et des fichiers, AVANT de toucher à quoi que
#      ce soit : si la nouvelle version tourne mal, on revient en arrière ;
#   2. le nouveau code, sorti de l'archive ;
#   3. la construction des images ;
#   4. les MIGRATIONS de la base (nouvelles colonnes, nouvelles tables) ;
#   5. le redémarrage, et l'état des services.
#
# Pendant tout ce temps, le site montre une PAGE DE MAINTENANCE (« On fait une
# petite mise à jour », maintenance/index.html, servie par Caddy tant que le
# fichier maintenance/ACTIVE existe — voir Caddyfile.prod). Le fichier est
# posé en premier et retiré en dernier, QUOI QU'IL ARRIVE (trap EXIT) : une
# mise en ligne qui échoue rend le site tel qu'il était, sans le laisser en
# maintenance. L'API et le back-office n'y passent pas.
#
# Il s'arrête à la première erreur (set -e) : une migration qui échoue ne
# laisse pas redémarrer un site qui chercherait une colonne absente.
#
# Depuis l'ordinateur (PowerShell), en une ligne :
#
#   scp C:\Users\Porhansl\Documents\perso\memoryline-deploiement.tar.gz debian@51.255.34.187:~/ ; ssh debian@51.255.34.187 "tar -xzf ~/memoryline-deploiement.tar.gz -C ~/memoryline apps/api/scripts/mettre-en-ligne.sh && bash ~/memoryline/apps/api/scripts/mettre-en-ligne.sh"
#
# (La première partie de la commande ne sort de l'archive QUE ce script :
# tout le reste attend la sauvegarde.)
set -euo pipefail

ARCHIVE="$HOME/memoryline-deploiement.tar.gz"
cd "$HOME/memoryline"
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f "$ARCHIVE" ]; then
  echo "Archive introuvable : $ARCHIVE — envoyez-la d'abord avec scp."
  exit 1
fi

# Un script enregistré sous Windows porte des fins de ligne que bash refuse
# (« set: pipefail: invalid option name »). On les retire avant de s'en servir.
sed -i 's/\r$//' apps/api/scripts/*.sh

# La page de maintenance, jusqu'à la fin du script, quelle qu'elle soit.
mkdir -p maintenance
touch maintenance/ACTIVE
trap 'rm -f "$HOME/memoryline/maintenance/ACTIVE"; echo "Page de maintenance retirée : le site est de retour."' EXIT
echo "0/5 · Page de maintenance affichée."

echo "1/5 · Sauvegarde de la base et des fichiers…"
bash apps/api/scripts/sauvegarder.sh

echo "2/5 · Nouveau code…"
tar -xzf "$ARCHIVE" -C "$HOME/memoryline"
sed -i 's/\r$//' apps/api/scripts/*.sh

echo "3/5 · Construction (quelques minutes)…"
$COMPOSE build

echo "4/5 · Migrations de la base…"
$COMPOSE run --rm api pnpm --filter @memoryline/api db:migrate

echo "5/5 · Redémarrage…"
$COMPOSE up -d
$COMPOSE ps

# Le site et l'API redémarrés mettent quelques secondes à répondre (l'API une
# dizaine de plus que le site, mesuré le 8/11) : la page de maintenance reste
# jusqu'à ce que les DEUX répondent (une minute et demie au plus), plutôt
# qu'une erreur 502.
pret() {
  $COMPOSE exec -T "$1" node -e "fetch('$2').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" 2>/dev/null
}
for _ in $(seq 1 45); do
  if pret web http://localhost:4321/ && pret api http://localhost:3000/health; then
    break
  fi
  sleep 2
done

echo
echo "Mise en ligne terminée."
