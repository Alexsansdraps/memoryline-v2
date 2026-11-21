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
# maintenance. L'API et le back-office n'y passent pas. Seule exception : une
# nouvelle version déjà lancée qui ne répond pas — le script le dit alors en
# toutes lettres, jusque dans sa dernière ligne.
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
# MISE_EN_LIGNE_RATEE : posée quand la NOUVELLE version, déjà lancée, ne
# répond pas (plus bas). La dernière ligne ne dit plus alors « le site est de
# retour » : en pleine nuit, c'est celle qu'on lit (relecture du 21/11).
MISE_EN_LIGNE_RATEE=0
trap 'rm -f "$HOME/memoryline/maintenance/ACTIVE"; if [ "$MISE_EN_LIGNE_RATEE" = 1 ]; then echo "Page de maintenance retirée. ATTENTION : la nouvelle version ne répond pas (voir plus haut) : le site est EN PANNE."; else echo "Page de maintenance retirée : le site est de retour."; fi' EXIT
echo "0/5 · Page de maintenance affichée."

echo "1/5 · Sauvegarde de la base et des fichiers…"
bash apps/api/scripts/sauvegarder.sh

echo "2/5 · Nouveau code…"
tar -xzf "$ARCHIVE" -C "$HOME/memoryline"
sed -i 's/\r$//' apps/api/scripts/*.sh

# L'archive ajoute et remplace, elle n'efface jamais : un fichier retiré du
# dépôt restait sur le serveur, et partait encore dans le site construit.
# Le 18/11, une vieille page products/[...slug].astro, retirée du dépôt le
# 7/10, était toujours là. On efface donc ce que l'archive ne contient plus,
# mais seulement dans le code (apps, packages, docs) et parmi les .md de la
# racine. data/, sauvegardes/, maintenance/ et les .env ne sont jamais
# touchés, ni les polices « Another Shabby », qui voyagent hors de git.
# Garde-fou : une archive illisible ou presque vide ne fait rien effacer.
DANS_ARCHIVE="$(mktemp)"
tar -tzf "$ARCHIVE" | sed 's#^\./##' | grep -v '/$' | LC_ALL=C sort -u > "$DANS_ARCHIVE"
if [ "$(wc -l < "$DANS_ARCHIVE")" -gt 300 ]; then
  {
    find apps packages docs -type f \
      -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.astro/*' \
      -not -name 'AnotherShabby-*' 2>/dev/null || true
    find . -maxdepth 1 -type f -name '*.md' | sed 's#^\./##'
  } | LC_ALL=C sort | LC_ALL=C comm -23 - "$DANS_ARCHIVE" | while IFS= read -r f; do
    rm -f -- "$f" && echo "   retiré (plus dans le dépôt) : $f"
  done
  find apps packages docs -type d -empty -not -path '*/node_modules/*' -delete 2>/dev/null || true
fi
rm -f "$DANS_ARCHIVE"

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
REPONDENT=0
for _ in $(seq 1 45); do
  if pret web http://localhost:4321/ && pret api http://localhost:3000/health; then
    REPONDENT=1
    break
  fi
  sleep 2
done

# Toujours muets au bout de la minute et demie : la mise en ligne a ÉCHOUÉ,
# et le script le dit (21/11). Avant, il écrivait quand même « Mise en ligne
# terminée ». Or une API qui meurt au démarrage passe toutes les étapes
# d'avant : l'image se construit sans rien compiler (tsx src/index.ts), et
# les migrations n'importent pas les routes. Un fichier nouveau oublié dans
# le commit suffit : elle redémarre en boucle, et panier, paiement et ventes
# du stand tombent sans un mot. On montre donc la fin du journal du service
# qui ne répond pas, et l'on sort en erreur. La page de maintenance part
# quand même (trap EXIT), comme pour toute autre erreur.
if [ "$REPONDENT" -ne 1 ]; then
  EN_PANNE=""
  pret web http://localhost:4321/ || EN_PANNE="$EN_PANNE web"
  pret api http://localhost:3000/health || EN_PANNE="$EN_PANNE api"
  if [ -n "$EN_PANNE" ]; then
    for service in $EN_PANNE; do
      echo
      echo "--- $service ne répond pas : fin de son journal ---"
      $COMPOSE logs --tail 40 "$service" 2>&1 || true
    done
    echo
    echo "ÉCHEC DE LA MISE EN LIGNE : ne répond toujours pas après une minute et demie :$EN_PANNE."
    echo "C'est pourtant la nouvelle version qui tourne. Lire le journal ci-dessus (un fichier nouveau oublié dans le commit ?), corriger, puis remettre en ligne."
    MISE_EN_LIGNE_RATEE=1
    exit 1
  fi
fi

echo
echo "Mise en ligne terminée."
