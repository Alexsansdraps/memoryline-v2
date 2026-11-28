export const meta = {
  name: 'affiche-stand-reglages',
  description: 'Affiche du stand de Mulhouse : étape « 2. Texte », fenêtre plein écran, personnages de dos sur le muret, 47 motifs ; vérification avant prod',
  phases: [
    { title: 'Réglages', detail: 'les trois demandes d’Alexandra + motifs 3-5' },
    { title: 'Vérification', detail: 'relecture du code et parcours à l’écran' },
  ],
}

const REPO = 'C:/Users/Alexandra/Documents/memory-line/memoryline-v2'
const SORTIE = REPO + '/travaux/affiche-stand-mulhouse'
const CONTEXTE = `
CONTEXTE : Memory Line v2 (dépôt ${REPO}, Windows, Git Bash ; Python avec PIL). Boutique d'affiches EN PRODUCTION (paiements réels). API Hono + Drizzle + PostgreSQL
(apps/api), site Astro SSR + îlots Solid (apps/web), BO Astro (apps/admin), configurateur partagé (packages/configurator), types (packages/types). Pile Docker LOCALE =
copie neutralisée de la prod : site http://localhost:8080 (et le serveur de dev http://localhost:4321), BO http://localhost:4322/bo, API http://localhost:3000,
conteneurs memoryline-api et memoryline-db18. Tablette du stand : ?stand=1.

L'AFFICHE ÉPHÉMÈRE DU STAND DE MULHOUSE vient d'être construite EN LOCAL (rien n'est commité ni en prod) : lis ${SORTIE}/PLAN.md (le plan suivi), ${SORTIE}/BILAN.md
s'il existe, et le diff (git status, git diff) pour connaître l'état exact. Produit « mulhouse-marche-de-noel-affiche-personnalisee », rattaché au stand n° 1
(colonne product.stand_id, il disparaît quand le stand est désactivé/archivé/clôturé), collection éphémère, motifs = personnages d'un jeu « motifs-alsace » rangés en
7 catégories (onglets), nom du motif pré-rempli en ligne 1, fonds unis/dégradés/motifs répétés, texte en haut ou en bas, migration apps/api/drizzle/0121_affiche_stand_mulhouse.sql
(DÉJÀ appliquée en local ; pas encore en prod : en prod, 0121 puis toute nouvelle migration passeront ensemble).

DEMANDES D'ALEXANDRA (28/11 vers 1 h 50, devant http://localhost:4321/affiches/mulhouse-marche-de-noel-affiche-personnalisee), mot pour mot :
1) « Faut faire un 2. texte » : la fenêtre a aujourd'hui 3 étapes « 1. Fond & texte », « 2. Personnages », « 3. Format ». Pour cette affiche : 4 étapes
   « 1. Motif et fond », « 2. Texte », « 3. Personnages », « 4. Format » (le texte, sa place en haut/en bas, ses polices, tailles, couleur passent dans « 2. Texte »).
   Les autres affiches personnalisables NE CHANGENT PAS (rendu et étapes identiques à avant).
2) « et mettre en plein écran la popup » : pour cette affiche, la fenêtre « Composez votre affiche » s'ouvre en PLEIN ÉCRAN (site et tablette, ordinateur et téléphone),
   comme la fenêtre des affiches IA en plein écran sur la tablette (regarde comment AfficheIA.tsx le fait) : aperçu et étapes côte à côte sur grand écran, l'un sous
   l'autre sur téléphone, croix toujours visible, rien qui déborde ni ne défile horizontalement.
3) « et on utilise plus les perso de face c'est perso sur le muret tout le temps » : cette affiche passe en personnages DE DOS ASSIS SUR LE MURET, comme les affiches
   personnalisables de dos (ex. mulhouse-hotel-de-ville-affiche-personnalisee) et l'affiche « à partir de votre photo » (« Assis sur le muret ») : vue de dos, le muret
   du type d'affiche « De dos » (à défaut muret_officiel.svg) en premier plan, aucun personnage de face proposé. Par une migration NEUVE (0122_…, idempotente, rejouable,
   "when" plus grand que tout le journal et entrée en dernier dans drizzle/meta/_journal.json ; relis la fin du journal juste avant : un autre chantier peut en écrire une).
   Le motif, le texte et les personnages sur le muret doivent cohabiter sans se chevaucher : motif au-dessus, personnages assis sur le muret en bas ; texte en haut :
   au-dessus du motif ; texte en bas : entre le motif et les têtes des personnages (jamais sur une tête) — règle les tailles/places en conséquence et vérifie avec 0, 1, 3
   et le maximum de personnages. L'aperçu, le panier et le fichier d'impression doivent être identiques.
4) Les 47 motifs : vérifie que les 19 motifs des planches 3-5 (${SORTIE}/motifs-3/, index.json complet) sont bien dans le choix (onglets Strasbourg et Colmar, Maisons
   d'Alsace, Noël, Gourmandises, Alsace) ; sinon intègre-les par une migration (procédure § 13 de PLAN.md), fichiers motif-alsace-<id>-v1.svg dans data/assets ET dans
   ${SORTIE}/assets-prod/.
5) « faut une meilleure image » (devant la photo de la fiche : les maisons alsaciennes sur fond rouge, deux petits personnages DE FACE qui flottent au milieu, « MAISONS
   ALSACIENNES / Marché de Noël de Mulhouse » en bas) : refais les IMAGES DE LA FICHE (la principale et les suivantes) APRÈS les réglages 1 à 4, composées avec le vrai
   configurateur et rendues par le moteur d'impression (renderPosterPng, haute définition) : personnages DE DOS assis sur le muret, à la bonne taille ; motif grand et
   bien placé ; un beau fond (ex. dégradé « Nuit d'hiver » ou un motif répété de Noël, pas forcément le rouge uni) ; texte soigné (ligne 1 = nom du motif, ligne 2
   « Marché de Noël de Mulhouse » ou une date) ; 3 images différentes (motif, fond, personnages, texte en haut / en bas) qui donnent envie et montrent la variété.
   PUIS, quelques minutes plus tard, Alexandra a montré une composition faite dans le configurateur local et dit « mets plutôt ça en image pour le produit » :
   L'IMAGE PRINCIPALE de la fiche est EXACTEMENT celle-ci : motif « sapin » (le sapin décoré, en grand au milieu), fond = le motif répété ROUGE AUX PETITES ÉTOILES
   DORÉES, texte EN HAUT, ligne 1 « SAPIN DE NOËL » (la police de titre, blanche), ligne 2 « Marché de Noël de Mulhouse » (la manuscrite, blanche), AUCUN personnage,
   sans le filigrane « Memory Line » (le fichier d'impression n'en a pas). Les 2 autres images restent des variantes (par ex. un motif de Mulhouse avec des
   personnages de dos sur le muret, un fond dégradé, texte en bas).
   Regarde-les en grand (outil Read) et recommence tant qu'elles ne sont pas belles.
6) « titre croppé à droite » (capture de « Voir sur un mur » : « BONHOMME EN PAIN D'ÉPICE » coupé au bord droit de l'affiche) : une ligne trop longue doit TOUJOURS
   être réduite pour tenir dans la largeur utile, comme sur les autres affiches (createReductionDesLignes côté aperçu ; pdf.ts réduit déjà ce qui dépasse) : dans
   l'aperçu de la fenêtre, dans « Voir sur un mur », dans le panier et la caisse, et dans le fichier d'impression, texte en haut comme en bas, avec les noms de motifs
   les plus longs (essaie les 47 en ligne 1, en grande taille). Vérifie aussi qu'une affiche classique avec un long titre n'est pas coupée dans « Voir sur un mur »
   (si elle l'est, c'est une régression du chantier : corrige-la).
7) « faut qu'on puisse mettre des couleurs pour les images dans le BO, dans un premier temps mets en 10 par défaut qui pourraient aller à tous, modifiable dans le
   BO » (devant « Couleur du motif », qui ne propose aujourd'hui que sombre et blanc) : le choix « Couleur du motif » propose une PALETTE, par défaut 10 couleurs
   choisies pour aller avec tous les fonds proposés (par ex. anthracite, crème, rouge Noël, vert sapin, bleu nuit, or, bordeaux, ocre, bleu ciel, rose poudré —
   vérifie-les sur les 19 fonds), rangée dans un RÉGLAGE modifiable au BO (même principe que les thèmes du ciel : BO › Ciel étoilé, apps/admin/src/pages/ciel.astro,
   réglage ciel.themes ; ici par exemple un réglage motifs.couleurs et une page ou une section du BO facile à trouver, avec nom + couleur, ajouter, retirer, ordre,
   Activé/Désactivé ; réglage absent = les 10 par défaut). Le serveur n'accepte qu'une couleur de la liste (ou l'ancienne couleur sombre/blanche pour les paniers
   déjà faits). La couleur s'applique à la silhouette du motif ; les détails crème restent lisibles (si la couleur est claire, les détails passent en sombre) ; les
   façades colorées des maisons gardent leurs couleurs. Aperçu, panier et impression identiques. Libellés en 7 langues si la cliente voit le nom des couleurs. Fichiers NEUFS (…-v2.jpg, jamais réutiliser un nom : /assets est servi
   « immutable »), copiés dans data/assets ET ${SORTIE}/assets-prod/, et rattachés à la fiche par la migration neuve (UPDATE/INSERT des images de CE produit seulement).

RÈGLES ABSOLUES :
- Pas de prod, pas de déploiement, pas de commit (l'agent principal le fait). Ne jamais lire ni afficher un .env. Pas de mot de passe, pas de compte BO.
- « Touche pas aux commandes » : aucune modification de la logique de panier, caisse, paiement, factures, stand-caisse ni des données de commandes.
- Ne pas modifier packages/types/src/*, apps/api/src/pdf.ts, apps/api/src/fichiers-impression.ts, apps/api/src/couleurs-image-fichier.ts (empreinte d'impression).
- Les autres affiches (classiques, IA, ciel étoilé) ne doivent PAS changer : captures avant/après de deux affiches classiques (une de dos avec muret, une de face).
- UN AUTRE CHANTIER (nouvelles ombres de familles du ciel étoilé) modifie EN MÊME TEMPS apps/api/src/ciel-ombres-2.ts, apps/web/src/islands/AfficheIA.tsx et les clés
  ciel.* de apps/web/src/i18n/ui.ts : n'y touche pas ; dans ui.ts n'édite qu'avec l'outil Edit par petits remplacements ciblés (jamais de réécriture complète par script).
- Textes du site : ui.ts en 7 langues (fr, en, de, it, es, ja, zh), vouvoiement, pas de tics de gabarit IA (surtitres à filet, capitales espacées).
- Vérifs : npx tsc --noEmit -p . dans apps/api et apps/web (3 erreurs anciennes de StandSalon.tsx tolérées), npx astro check dans apps/admin, tsc dans packages/configurator,
  tests API concernés. Navigateur sans écran (Chrome + CDP, voir ${SORTIE}/navigateur/) ; captures dans ${SORTIE}/captures/reglages-*.`

phase('Réglages')
const fait = await agent(`${CONTEXTE}
TA TÂCHE : réaliser les demandes 1 à 7 en local (la 5, les images de la fiche, EN DERNIER, une fois les réglages faits), puis vérifier à l'écran (1440, 390, tablette ?stand=1 en 1024x768) : ouvrir l'affiche, plein écran, les 4 étapes,
choisir un motif de chaque onglet (dont les maisons en couleurs), un fond uni, un dégradé, un motif répété, du texte en haut puis en bas, 1 puis 3 personnages de dos
sur le muret, aller jusqu'au panier SANS payer (regarder la vignette du panier), puis rendre le fichier d'impression de cette ligne (script tsx qui appelle
renderPosterPng, comme ${SORTIE}/rendu-impression.ts s'il existe) et le comparer à l'aperçu. Regarde chaque capture (outil Read) et corrige. Écris ${SORTIE}/BILAN-REGLAGES.md
(ce qui a changé, fichiers, migration, vérifications, limites) et renvoie l'essentiel.`, { label: 'réglages', phase: 'Réglages', schema: {
  type: 'object', properties: { fichiers: { type: 'array', items: { type: 'string' } }, migrations: { type: 'array', items: { type: 'string' } }, verifie: { type: 'array', items: { type: 'string' } }, problemes: { type: 'array', items: { type: 'string' } } }, required: ['fichiers', 'verifie', 'problemes'] } })

phase('Vérification')
const VERD = { type: 'object', properties: { ok: { type: 'boolean' }, constats: { type: 'array', items: { type: 'string' } }, corriges: { type: 'array', items: { type: 'string' } }, bloquant: { type: 'boolean' } }, required: ['ok', 'constats', 'bloquant'] }
const verifs = await parallel([
  () => agent(`${CONTEXTE}
Bilan des réglages : ${JSON.stringify(fait)}. TA TÂCHE : RELECTURE DE CODE adverse de TOUT le chantier de l'affiche du stand (git diff : tout ce qui n'est pas ciel-ombres-2.ts,
AfficheIA.tsx ni les clés ciel.* de ui.ts), avant une mise en prod cette nuit : régressions sur les autres affiches (configurateur, panier, caisse, aperçus serveur,
impression, courriels), fichiers interdits touchés, logique de commande touchée, migrations 0121 et suivantes : idempotentes, rejouables, sûres sur la base de PROD (autres
ids, données réelles, stands existants : la condition de vente par stand ne doit RIEN retirer d'autre que ce produit), journal drizzle correct (ordre et "when") ;
sécurité (le serveur valide-t-il le motif, le fond, la place du texte comme les autres pièces ? un panier forgé peut-il imposer un motif ou un fond d'une autre affiche ?) ;
textes manquants dans une des 7 langues ; fichiers de data/assets nécessaires en prod listés pour l'agent principal (assets-prod/). CORRIGE ce qui est sûr de l'être, relance
les vérifs. Mets bloquant=true seulement si la mise en prod serait dangereuse en l'état.`, { label: 'vérif:code', phase: 'Vérification', schema: VERD }),
  () => agent(`${CONTEXTE}
Bilan des réglages : ${JSON.stringify(fait)}. TA TÂCHE : vérifier À L'ÉCRAN comme une cliente, en local (navigateur sans écran) : site 1440 et 390, tablette ?stand=1 1024x768 ;
les 3 demandes d'Alexandra sont-elles satisfaites (4 étapes dont « 2. Texte », plein écran, personnages de dos sur le muret, jamais de face) ; les 47 motifs dans leurs
onglets ; le nom du motif en ligne 1 ; texte en haut / en bas sans chevauchement avec 0, 1, 3 personnages ; fonds unis, dégradés, motifs ; panier (vignette) ; fichier
d'impression identique à l'aperçu ; les 3 nouvelles images de la fiche (belles ? personnages de dos sur le muret ? nettes en grand et en vignette de la collection ?) ; la fiche disparaît (404, absente de la collection, de la recherche, de la page du stand) quand on DÉSACTIVE le stand 1 en local
(remets-le ensuite exactement comme avant, en local seulement) ; deux affiches classiques inchangées. Captures ${SORTIE}/captures/verif2-*. Regarde-les (Read).
Corrige ce qui cloche (sans fichiers interdits ni commandes). Mets bloquant=true seulement si une cliente serait gênée en prod.`, { label: 'vérif:écran', phase: 'Vérification', schema: VERD }),
])
return { fait, verifs }
