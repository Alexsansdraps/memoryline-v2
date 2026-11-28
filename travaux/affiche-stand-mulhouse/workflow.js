export const meta = {
  name: 'affiche-stand-mulhouse',
  description: 'Affiche éphémère du stand de Mulhouse : 16 motifs alsaciens découpés, un produit, fond au choix, texte en haut ou en bas',
  phases: [
    { title: 'Relevé', detail: 'produits, fonds, textes, personnages, collections' },
    { title: 'Découpe', detail: 'vectoriser les 16 motifs, maisons en couleurs' },
    { title: 'Plan', detail: 'architecture la plus simple' },
    { title: 'Réalisation', detail: 'code + migration, en local' },
    { title: 'Vérification', detail: 'parcours navigateur, impression, relecture' },
  ],
}

const REPO = 'C:/Users/Alexandra/Documents/memory-line/memoryline-v2'
const IMG = 'C:/Users/Alexandra/Documents/memory-line/protos/motifs-alsace-noel.webp'
const SORTIE = REPO + '/travaux/affiche-stand-mulhouse'
const CONTEXTE = `
CONTEXTE : Memory Line v2 (dépôt ${REPO}, Windows, Git Bash ; Python avec numpy, PIL, scipy, skimage). Boutique d'affiches EN PRODUCTION
(paiements réels). API Hono + Drizzle + PostgreSQL (apps/api), site Astro SSR + îlots Solid (apps/web), BO Astro (apps/admin, /bo), configurateur partagé
(packages/configurator), types (packages/types). Pile Docker LOCALE = copie neutralisée de la prod (site http://localhost:8080, BO http://localhost:4322/bo,
conteneur memoryline-api, base conteneur memoryline-db18). Marché de Noël de Mulhouse du 20/11 au 27/12, stand n° 1 (tablette ?stand=1).

DEMANDE D'ALEXANDRA (27/11, 23 h 25), mot pour mot : « tu peux faire des affiches temporaires pour un stand genre un produit par stand, on choisi l'image ?
Genre là c'est l'alsace c'est simple : un fond margaux peut choisir comme d'hab les fonds dispo je te donne la plaquette de svg à découper. Ca sera dans une
collection ephémère marché de noel de mulhouse texte en bas ou en haut par contre les maisons doivent être colorées alsacienne donc une maison une couleur
l'autre une autre couleur ».
Interprétation retenue : UN produit « Marché de Noël de Mulhouse » (affiche personnalisable), rangé dans une collection ÉPHÉMÈRE « Marché de Noël de Mulhouse »
(proposée sur la page du stand et sur le site tant qu'elle est active) ; le CLIENT choisit l'image parmi les motifs des planches (16, puis 12 de plus) ; le fond se choisit parmi les
fonds que Margaux a rattachés au produit, comme pour les autres affiches ; le texte (lignes habituelles) se place en haut OU en bas au choix du client ; les motifs
sont des silhouettes en aplat, SAUF les maisons à colombages alsaciennes : chaque maison d'une couleur alsacienne différente (ocre jaune, rose saumon, bleu ciel,
vert sauge, rouge brique…), les colombages restant sombres. La planche : ${IMG} (1312x1199, 4 rangées de 4 motifs noirs sur blanc) :
rangée 1 : hôtel de ville (Mulhouse), église/temple Saint-Étienne (flèche gothique), maisons à colombages avec terrasse et parasols, chalet du marché de Noël ;
rangée 2 : tour (tour de l'Europe / tour du Bollwerk ronde avec toit conique), tissu imprimé (fleur et oiseau, bord cranté), bobine de fil + tissu (Mulhouse ville
du textile), poinsettia (étoile de Noël) ; rangée 3 : sapin décoré, cœur en pain d'épice avec rouage, étoile à 8 branches, lanterne avec bougie et pommes de pin ;
rangée 4 : bonhomme en pain d'épice, kougelhopf, bretzel, couronne de l'Avent.

RÈGLES ABSOLUES :
- Ne JAMAIS toucher la prod (VPS) ni la déployer : l'agent principal le fait. Ne pas commiter (l'agent principal commite).
- « Touche pas aux commandes » : aucune modification de la logique de panier, caisse, paiement, factures, stand-caisse, ni des données de commandes.
- Ne pas modifier packages/types/src/*, apps/api/src/pdf.ts, apps/api/src/fichiers-impression.ts, apps/api/src/couleurs-image-fichier.ts (empreinte d'impression :
  les changer refait tous les fichiers d'impression). Si c'est vraiment indispensable, le dire, ne pas le faire.
- Ne jamais lire ni afficher un .env. Ne pas taper de mot de passe. Pas de compte BO à créer.
- Base : écritures permises SEULEMENT sur la base LOCALE (memoryline-db18) et seulement via une migration Drizzle neuve (apps/api/drizzle, journal _journal.json :
  son "when" doit dépasser le plus grand du journal, entrée en dernier ; relire la fin du journal juste avant) qui doit être rejouable sans danger en prod.
- Textes du site dans apps/web/src/i18n/ui.ts en 7 langues (fr, en, de, it, es, ja, zh), vouvoiement ; pas de tics de gabarit IA (surtitres à filet, capitales espacées).
- Un autre chantier (garde-robe, dossier travaux/personnages-unifies/garde-robe) tourne en parallèle dans le même conteneur : ne pas y toucher, utiliser /tmp/stand-mulhouse-* dans le conteneur.
- Vérifs : npx tsc --noEmit -p . dans apps/api et apps/web (3 erreurs anciennes de StandSalon.tsx tolérées), npx astro check dans apps/admin, tsc dans packages/configurator.
- Éditer les fichiers avec l'outil Edit ou des scripts Python écrits dans un fichier (les heredocs bash cassent les guillemets).`

const AJOUT = `
AJOUT D'ALEXANDRA (27/11, 23 h 30) : « et mettre les personnages comme d'hab » : sur cette affiche, le client ajoute aussi ses PERSONNAGES comme sur les autres affiches personnalisables (même étape, mêmes personnages, mêmes réglages). Le motif et les personnages doivent cohabiter (le motif ne doit pas être caché par la rangée de personnages, ni l'inverse : prévoir sa place et sa taille en conséquence), avec le texte en haut ou en bas.
AJOUT D'ALEXANDRA (27/11, 23 h 35) : « donc vraiment ça doit être rattaché au stand et le produit doit disparaître quand le stand sera clôturé donc désactivé ».
Le produit (et sa collection éphémère) est RATTACHÉ AU STAND (stand n° 1, Mulhouse) : il est proposé (site et tablette) tant que le stand est ACTIVÉ, et
DISPARAÎT tout seul (fiche, collection, recherche, page du stand, plan du site) quand le stand est désactivé, archivé ou clôturé — sans que Margaux ait à
toucher au produit. Lis comment un stand est activé/désactivé/archivé (apps/api/src/db/schema.ts autour de la table stand, stands-calendrier.ts, lieux-retrait.ts,
BO Ventes stand) et prévois un lien produit→stand (colonne neuve via migration, ou réglage) vérifié côté serveur partout où le produit est listé ou ouvert.
Un panier qui contient déjà ce produit n'est PAS touché (« touche pas aux commandes ») : seule l'offre disparaît. Au BO, la fiche produit montre à quel stand
elle est liée. Un stand simplement FERMÉ pour la nuit (horaires) ne fait PAS disparaître le produit : seulement désactivé/archivé/clôturé.
AJOUT D'ALEXANDRA (27/11, 23 h 40) : « et les fonds peuvent être unis ou dégradé ou une image genre un motif tu vois le délire ». Pour cette affiche, le FOND
peut être : une couleur UNIE, un DÉGRADÉ (deux couleurs, sens vertical par défaut), ou une IMAGE (les fonds habituels rattachés au produit, y compris des
images de motif répété : flocons, carreaux, etc.). Regarde d'abord ce que le système de fonds sait déjà faire (fond = fichier image ? couleur ?). La solution
la plus sûre côté impression : produire les unis et dégradés comme de VRAIS fichiers de fond (SVG ou PNG générés, rangés comme des fonds normaux et rattachés
au produit, une petite palette de 8 à 12 unis et 6 à 8 dégradés aux couleurs de Noël/Alsace, plus 4 à 6 motifs répétés de Noël générés en SVG), plutôt que de
changer pdf.ts ou packages/types (interdits). Si un choix de couleur LIBRE par le client est faisable sans toucher aux fichiers interdits, le signaler dans le plan
comme option, sans l'imposer. Margaux doit pouvoir ajouter/retirer ces fonds au BO comme les autres.
AJOUTS D'ALEXANDRA (27/11, vers 23 h 40) :
1) « par défaut quand on en sélectionne un ça met dans le titre 1 ce que c'est comme ça, ça aide » : choisir un motif REMPLIT la ligne 1 avec le nom du
   motif, dans la langue du client (7 langues ; les noms propres restent : « Tour de l'Europe », « Klapperstein »…), sauf si le client a déjà tapé quelque
   chose de différent dans la ligne 1 (on ne l'écrase jamais) ; changer de motif remplace le nom précédent s'il n'a pas été modifié. Il reste modifiable/effaçable.
2) « tu les classes en plus pour les clients stp » : dans le choix du motif, les motifs sont RANGÉS PAR CATÉGORIES (onglets ou intertitres, comme les
   catégories de personnages), dans cet ordre, libellés traduits en 7 langues :
   Mulhouse (hotel-de-ville, temple-saint-etienne, tour-de-l-europe, tour-bollwerk, tour-ronde, klapperstein, chapelle, maisons-ouvrieres) ;
   Textile et musées (usine-textile, metier-a-tisser, tampon-textile, bobine-et-tissu, tissu-fleuri, locomotive, voiture-ancienne) ;
   Strasbourg et Colmar (motifs de la 3e/4e planche : cathédrale, Petite France, Ponts couverts, tram, Petite Venise…) ;
   Maisons d'Alsace (maisons-alsaciennes + maisons des 3e/4e planches) ;
   Noël (chalet-de-noel, sapin, etoile, lanterne, couronne-avent, poinsettia + ceux des 3e/4e planches) ;
   Gourmandises (bonhomme-pain-epice, coeur-pain-epice, kougelhopf, bretzel + bredeles… des 3e/4e planches) ;
   Alsace (cigogne, vignoble + cigogne seule… des 3e/4e planches).
   Margaux doit pouvoir changer le rangement plus tard sans code si c'est simple (sinon une liste dans un seul fichier/une migration).
3) DEUX PLANCHES DE PLUS arrivent (Documents/memory-line/protos/motifs-alsace-3.png et motifs-alsace-4.png, noir sur blanc) : un AUTRE agent les découpe
   EN CE MOMENT dans ${SORTIE}/motifs-3/ (mêmes conventions SVG que motifs/, avec ${SORTIE}/motifs-3/index.json : [{id, nom, categorie, fichier}]). Conçois
   l'ajout de motifs comme une simple liste de données (fichiers + entrées) : à la réalisation, si motifs-3/index.json existe et est complet, intègre-les ; sinon
   laisse une procédure écrite d'une ligne dans PLAN.md pour les ajouter ensuite (l'agent principal le fera).`
const NOTE = { type: 'object', properties: { resume: { type: 'string' }, faits: { type: 'array', items: { type: 'string' } } }, required: ['resume', 'faits'] }

phase('Relevé')
const [relevePlan, decoupe] = await parallel([
  () => parallel([
    () => agent(`${CONTEXTE}
TA TÂCHE (lecture seule) : comment fonctionne aujourd'hui une affiche PERSONNALISABLE classique, de bout en bout : la fiche produit (apps/web, configurateur
packages/configurator), le choix du FOND parmi ceux rattachés au produit (tables, BO, route /backgrounds), les LIGNES DE TEXTE et leur place (y a-t-il déjà un
choix haut/bas ? positions x/y libres ? stack en haut ?), les personnages/pièces (character_type, catégories, recoloration par zones .stN), le décor de premier plan
(foregroundUrl / muret), les collections (table, page, collection « éphémère » ou dates d'activité ?), la page du stand (stand.page_id, page /mulhouse et sa grille
d'affiches), et comment le PDF d'impression compose tout ça (lire pdf.ts sans le modifier). Dis précisément, chemins et lignes à l'appui, quel MOYEN EXISTANT
permettrait au client de choisir UNE image parmi 16 motifs SVG posée en grand au centre de l'affiche, recolorable par zones, SANS toucher aux fichiers interdits
(ex. : motif = un « personnage » d'une catégorie dédiée, placé/échelonné par x,y,scale ; ou motif = décor de premier plan ; ou autre). Évalue chaque option.`, { label: 'relevé:affiche', phase: 'Relevé', schema: NOTE }),
    () => agent(`${CONTEXTE}
TA TÂCHE (lecture seule) : côté BO et données : comment Margaux crée un produit personnalisable, lui rattache des fonds, le range dans une collection, le met
sur la page d'un stand ; comment une collection pourrait être « éphémère » (dates, statut, archivage) ; comment se créent les catégories de personnages et les
personnages (SVG, zones de couleur, nuanciers) au BO ; les migrations récentes qui créent des données (exemples à imiter : apps/api/drizzle/*.sql récents, ex.
0101_page_mulhouse.sql, 0120). Donne ce qu'une migration NEUVE et rejouable devrait insérer pour créer le produit, la collection et les motifs, sans casser la prod
(idempotence : ON CONFLICT / WHERE NOT EXISTS). Lis la base LOCALE en lecture (docker exec memoryline-db18 psql -U memoryline -d memoryline -c ...) pour les
noms de colonnes exacts. Chemins et lignes.`, { label: 'relevé:données', phase: 'Relevé', schema: NOTE }),
  ]),
  () => agent(`${CONTEXTE}
TA TÂCHE : DÉCOUPER et VECTORISER les motifs (16 + 12) de ${IMG} en 16 fichiers SVG propres dans ${SORTIE}/motifs/ (nommés motif-<id>.svg : hotel-de-ville,
temple-saint-etienne, maisons-alsaciennes, chalet-de-noel, tour, tissu-fleuri, bobine-et-tissu, poinsettia, sapin, coeur-pain-epice, etoile, lanterne,
bonhomme-pain-epice, kougelhopf, bretzel, couronne-avent), PUIS les 12 motifs de la DEUXIÈME planche C:/Users/Alexandra/Documents/memory-line/protos/motifs-mulhouse-2.png
(1536x1024, 3 rangées de 4, envoyée par Alexandra à 23 h 45 : « voilà d'autres ») : rangée 1 : tour-bollwerk (tour ronde à toit conique avec arbre et muraille :
si elle fait doublon avec « tour » de la 1re planche, garder les deux mais nommer la 1re tour-ronde), tour-de-l-europe (gratte-ciel rond), locomotive (Cité du
train), voiture-ancienne (Cité de l'automobile) ; rangée 2 : usine-textile (cheminée et toits en dents de scie), tampon-textile (bloc d'impression fleuri et tissu),
metier-a-tisser (avec navette et bobine), chapelle ; rangée 3 : klapperstein (masque de pierre des bavards avec chaîne et boule), maisons-ouvrieres (cité ouvrière,
rangée de maisons : COLORÉES comme les maisons alsaciennes, une couleur par maison, encadrements et toits sombres), vignoble (collines, rangs de vigne, raisin),
cigogne (sur son nid, sur une cheminée). Soit 28 motifs en tout, plus un générateur Python rejouable ${SORTIE}/decoupe.py et une planche de contrôle ${SORTIE}/planche-motifs.jpg.
Méthode qui a marché sur ce projet pour des ombres chinoises : seuil (gris < 110) → masque, découpe par boîtes (repère les 16 cases), composantes connexes,
marching squares (skimage.measure.find_contours sur le masque lissé gaussien 0.6), simplification RDP ~0.8 px (un contour fermé : le couper en 2 au point le
plus éloigné avant RDP), courbes Catmull-Rom → Bézier ; GARDER LES TROUS (détails blancs : fenêtres, colombages, décor) avec fill-rule="evenodd" ou des chemins
séparés. Chaque SVG : viewBox serrée sur le motif, un groupe par zone de couleur avec des classes .st0 (silhouette principale) etc.
MAISONS (motif maisons-alsaciennes) : chaque maison d'une couleur alsacienne différente (ex. maison de gauche rose saumon #E8A598, maison de droite jaune ocre
#E9C46A, une troisième si visible bleu ciel #9CC3D5), les colombages, toits, fenêtres et la terrasse restant sombres (#2B2B2B) : il faut donc séparer les
FAÇADES (les zones blanches entre les colombages) en remplissage coloré par maison, sous le dessin noir. Une classe par maison (.st1, .st2…) pour qu'elles
restent recolorables. Pour les autres motifs : silhouette sombre (.st0 #2B2B2B) et, si c'est joli, les blancs intérieurs en .st? crème #FFF8EC (pas transparents,
pour rester lisibles sur n'importe quel fond). Regarde la planche (outil Read sur le jpg) et ITÈRE jusqu'à ce que chaque motif soit fidèle, net, sans
morceau de la case voisine, sans tache. Renvoie la liste des fichiers, leurs zones/classes et les problèmes restants.`, { label: 'découpe:motifs', phase: 'Découpe', schema: {
    type: 'object', properties: { fichiers: { type: 'array', items: { type: 'string' } }, zones: { type: 'string' }, problemes: { type: 'array', items: { type: 'string' } } }, required: ['fichiers', 'problemes'] } }),
])

const texteReleve = (relevePlan || []).filter(Boolean).map((r) => r.resume + '\n- ' + r.faits.join('\n- ')).join('\n\n')

phase('Plan')
const plan = await agent(`${CONTEXTE}${AJOUT}
RELEVÉ :
${texteReleve}

MOTIFS DÉCOUPÉS : ${JSON.stringify(decoupe)}

TA TÂCHE : choisir l'architecture la PLUS SIMPLE et la plus sûre (réutiliser l'existant, zéro changement des fichiers interdits, zéro changement de la logique de
commande) et écrire le plan d'exécution précis pour UN agent : fichiers à créer/modifier (chemins), migration (contenu), textes ui.ts (7 langues), comment le
client choisit le motif (vignettes), comment le texte va en haut ou en bas, comment Margaux choisit les fonds (comme d'habitude), comment la collection est
éphémère (la retirer après le 27/12 doit se faire au BO sans code), ce que la tablette du stand montre, et le parcours de vérification (navigateur local
jusqu'au panier SANS payer, et rendu d'un fichier d'impression avec un motif et du texte en bas en local par un script tsx qui appelle renderPosterPng). Écris le
plan dans ${SORTIE}/PLAN.md et renvoie-le aussi.`, { label: 'plan', phase: 'Plan', schema: { type: 'object', properties: { plan: { type: 'string' }, risques: { type: 'array', items: { type: 'string' } } }, required: ['plan'] } })

phase('Réalisation')
const fait = await agent(`${CONTEXTE}${AJOUT}
PLAN À EXÉCUTER (écrit par un architecte, lis aussi ${SORTIE}/PLAN.md) :
${plan.plan}
Risques notés : ${JSON.stringify(plan.risques || [])}
MOTIFS : ${JSON.stringify(decoupe)}

TA TÂCHE : réaliser le plan en LOCAL : code, migration appliquée sur la base locale (npm run db:migrate dans apps/api via le conteneur memoryline-api, ou la
commande que le dépôt utilise), motifs copiés là où le plan dit (data/assets local, noms NEUFS). Fais passer tsc/astro check. Ouvre le parcours sur
http://localhost:8080 (et ?stand=1) avec un navigateur sans écran (Chrome headless + CDP, ou playwright s'il est installé) : choisir un fond, un motif (les
maisons en couleurs), du texte en haut puis en bas, aller jusqu'au panier SANS payer ; captures dans ${SORTIE}/captures/. Rends aussi un fichier d'impression
local (script tsx qui appelle renderPosterPng sur une config du panier) dans ${SORTIE}/captures/impression-*.png. Regarde les captures (Read) et corrige.
Renvoie : fichiers modifiés/créés, migration (nom), ce qui a été vérifié, captures, problèmes restants.`, { label: 'réalisation', phase: 'Réalisation', schema: {
  type: 'object', properties: { fichiers: { type: 'array', items: { type: 'string' } }, migration: { type: 'string' }, verifie: { type: 'array', items: { type: 'string' } }, captures: { type: 'array', items: { type: 'string' } }, problemes: { type: 'array', items: { type: 'string' } } }, required: ['fichiers', 'verifie', 'problemes'] } })

phase('Vérification')
const VERD = { type: 'object', properties: { ok: { type: 'boolean' }, constats: { type: 'array', items: { type: 'string' } }, corriges: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'constats'] }
const verifs = await parallel([
  () => agent(`${CONTEXTE}${AJOUT}
Un agent vient de réaliser l'affiche du stand de Mulhouse (bilan : ${JSON.stringify(fait)} ; plan : ${SORTIE}/PLAN.md). Lis le diff (git diff et git status dans ${REPO}).
TA TÂCHE : RELECTURE DE CODE adverse : bugs, régression sur les autres affiches personnalisables (rendu identique sans motif ?), fichiers interdits touchés,
logique de commande touchée, migration non idempotente ou dangereuse en prod (rejouer deux fois, base de prod avec d'autres ids), textes manquants dans une des 7
langues, sécurité (le serveur valide-t-il le motif choisi comme il valide les autres pièces ?). CORRIGE toi-même ce qui est sûr de l'être, puis relance tsc/astro check.
Renvoie les constats restants et ce que tu as corrigé.`, { label: 'vérif:code', phase: 'Vérification', schema: VERD }),
  () => agent(`${CONTEXTE}${AJOUT}
Un agent vient de réaliser l'affiche du stand de Mulhouse (bilan : ${JSON.stringify(fait)}). TA TÂCHE : vérifier À L'ÉCRAN, en local, comme une cliente :
sur http://localhost:8080 (ordinateur 1440, téléphone 390) et sur la tablette ?stand=1 (1024x768) avec un navigateur sans écran : trouver la collection,
ouvrir l'affiche, choisir chaque motif (les 16 s'affichent-ils bien en vignette et en grand ? les maisons sont-elles bien colorées une couleur par maison ?),
un autre fond, le texte en haut puis en bas (rien ne chevauche le motif ?), ajouter au panier SANS payer, regarder la vignette du panier. Puis un fichier
d'impression local par script (renderPosterPng) : identique à l'aperçu ? Captures dans ${SORTIE}/captures/verif-*. Regarde-les (Read). Corrige ce qui
cloche (sans toucher les fichiers interdits ni les commandes) et renvoie constats et corrections.`, { label: 'vérif:écran', phase: 'Vérification', schema: VERD }),
])

return { decoupe, plan, fait, verifs }
