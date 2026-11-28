#!/bin/bash
# Usage : avant-apres.sh <slug> <prefixe-capture>
# Ouvre le configurateur d'une affiche classique, capture l'aperçu (textes par
# défaut), ajoute un personnage, recapture. Sert au contrôle G9 (avant/après).
set -e
cd "$(dirname "$0")"
SLUG="$1"; PRE="$2"
node cdp.mjs goto "http://localhost:8080/affiches/$SLUG" 1500 > /dev/null
node cdp.mjs eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Refuser')?.click(); [...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Personnaliser')?.click(); 'ok'" > /dev/null
node cdp.mjs wait "document.querySelector('.ml-cfg-poster img') && [...document.querySelectorAll('.ml-cfg-poster img')].every(i => i.complete) && document.fonts.status === 'loaded'" 20000
sleep 2.5
node cdp.mjs shot "../captures/$PRE-textes.png" ".ml-cfg-poster"
node cdp.mjs eval "[...document.querySelectorAll('button')].find(b => /Personnages/.test(b.textContent))?.click(); 'ok'" > /dev/null
sleep 1
node cdp.mjs eval "[...document.querySelectorAll('button')].find(b => /Ajouter un personnage/.test(b.textContent))?.click(); 'ok'" > /dev/null
sleep 2
node cdp.mjs eval "[...document.querySelectorAll('button')].find(b => /Valider mon personnage/.test(b.textContent))?.click(); 'ok'" > /dev/null
node cdp.mjs wait "document.querySelector('.ml-cfg-poster .ml-cfg-charstack svg')" 15000
sleep 2.5
node cdp.mjs shot "../captures/$PRE-1perso.png" ".ml-cfg-poster"
node cdp.mjs eval "JSON.stringify({motif: /Motif/.test(document.querySelector('.ml-cfg-panel')?.textContent||''), place: /Place du texte/.test(document.querySelector('.ml-cfg-panel')?.textContent||'')})"
node cdp.mjs erreurs
