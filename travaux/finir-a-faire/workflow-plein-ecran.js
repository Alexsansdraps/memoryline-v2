export const meta = {
  name: 'plein-ecran-partout',
  description: 'Fenêtre « Composez votre affiche » en plein écran et étape « 2. Texte » sur toutes les affiches personnalisables ; vérification',
  phases: [
    { title: 'Réalisation', detail: 'configurateur classique et fenêtre IA' },
    { title: 'Vérification', detail: 'relecture et essais au navigateur' },
  ],
}
const REPO = 'C:/Users/Alexandra/Documents/memory-line/memoryline-v2'
const CONTEXTE = `
CONTEXTE : Memory Line v2 (dépôt ${REPO}, Windows, Git Bash ; lis ${REPO}/A-FAIRE.md, sections 0.1 ter, 0.2, 0.3). Boutique d'affiches EN PRODUCTION. Pile Docker
LOCALE = copie neutralisée de la prod (site http://localhost:8080, dev http://localhost:4321, BO http://localhost:4322/bo, API http://localhost:3000). Tablette : ?stand=1.
L'affiche éphémère du stand de Mulhouse (mulhouse-marche-de-noel-affiche-personnalisee, mode « motifs », vueMotifs) a déjà : fenêtre « Composez votre affiche » en PLEIN
ÉCRAN (classe ml-modal-plein-ecran dans apps/web/src/islands/ProductConfigurator.tsx, règles dans apps/web/src/styles/global.css, étapes compactes .ml-cfg-etapes-quatre)
et 4 étapes « 1. Motif et fond », « 2. Texte », « 3. Personnages », « 4. Format » (packages/configurator : ETAPES_AFFICHE_A_MOTIF dans store.ts, index.tsx,
StepBackgroundText.tsx avec sa prop « partie » fond/texte/tout). Les affiches personnalisables CLASSIQUES ont encore une fenêtre non plein écran et 3 étapes
« 1. Fond & texte », « 2. Personnages », « 3. Format ».
DÉCISION D'ALEXANDRA (28/11, 13 h 25, question « on la met sur toutes les affiches personnalisables ? ») : « Sur toutes ».
RÈGLES : pas de prod, pas de commit (l'agent principal le fait), jamais de .env ; « touche pas aux commandes » (panier, caisse, paiement, factures : logique et données) ;
ne pas modifier packages/types/src/*, apps/api/src/pdf.ts, fichiers-impression.ts, couleurs-image-fichier.ts ; ne pas toucher aux personnages (travaux/personnages-unifies)
ni au pixel Meta ; dans apps/web/src/i18n/ui.ts, seulement avec l'outil Edit, par petits remplacements, 7 langues ; vouvoiement, pas de tics de gabarit IA.
Vérifs : tsc --noEmit (apps/web : 3 erreurs anciennes de StandSalon.tsx tolérées ; packages/configurator : 0), astro check (apps/admin si touché), navigateur sans écran
(pilote : travaux/affiche-stand-mulhouse/navigateur/cdp.mjs) ; captures dans ${REPO}/travaux/finir-a-faire/plein-ecran/.`

phase('Réalisation')
const fait = await agent(`${CONTEXTE}
TA TÂCHE :
1) TOUTES les affiches personnalisables classiques (de dos avec muret, de face, avec ou sans cadres, au site et à la tablette, ordinateur et téléphone) : la fenêtre
   « Composez votre affiche » s'ouvre en PLEIN ÉCRAN comme celle de l'affiche du stand, et passe à 4 étapes : « 1. Fond », « 2. Texte », « 3. Personnages », « 4. Format »
   (« 2. Texte » : les lignes, leurs polices, tailles, couleur — et la place du texte seulement là où elle existe aujourd'hui). Réutilise ce qui existe pour l'affiche à
   motifs plutôt que de dupliquer. Les libellés des étapes en 7 langues (clés existantes cfg.etape.* à réutiliser ; ajoute « Fond » s'il manque).
2) Les fenêtres des affiches IA (photo et ciel étoilé, apps/web/src/islands/AfficheIA.tsx) ont déjà 4 étapes ; elles sont en plein écran à la tablette : mets-les en plein écran
   aussi au site, même rendu que la fenêtre classique (croix visible, rien ne déborde ni ne défile de côté, aperçu et étapes côte à côte au-dessus de 768 px, l'un sous
   l'autre en dessous).
3) Rien d'autre ne change : même contenu dans chaque étape (seulement réparti), même ordre des champs, même panier, même config enregistrée, même impression ; « Voir sur un
   mur », réouverture depuis le panier (?edit=…) et retour à l'étape voulue fonctionnent comme avant ; le « Continuer » / « Retour » passe par les 4 étapes.
Essaie : une affiche classique de dos (mulhouse-hotel-de-ville-affiche-personnalisee), une de face, l'affiche du stand, l'affiche photo IA et le ciel étoilé, à 1440, 1024
(tablette ?stand=1 compris), 820 (portrait), 390 et 360 px : plein écran, 4 étapes, aucun débordement, jusqu'au panier SANS payer ; « Modifier » depuis le panier rouvre à
l'identique. Avant/après de la config enregistrée d'une affiche classique : identique. Écris ${REPO}/travaux/finir-a-faire/plein-ecran/BILAN.md et renvoie l'essentiel.`, {
  label: 'réalisation', phase: 'Réalisation',
  schema: { type: 'object', properties: { fichiers: { type: 'array', items: { type: 'string' } }, fait: { type: 'array', items: { type: 'string' } }, verifie: { type: 'array', items: { type: 'string' } }, pas_fait: { type: 'array', items: { type: 'string' } } }, required: ['fichiers', 'fait', 'verifie', 'pas_fait'] },
})

phase('Vérification')
const VERD = { type: 'object', properties: { ok: { type: 'boolean' }, bloquant: { type: 'boolean' }, constats: { type: 'array', items: { type: 'string' } }, corriges: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'bloquant', 'constats'] }
const verifs = await parallel([
  () => agent(`${CONTEXTE}\nLe chantier vient d'être fait (bilan : ${JSON.stringify(fait)}). TA TÂCHE : RELECTURE DE CODE adverse de ses fichiers (git diff) : régressions (config enregistrée,
panier, réouverture, « Voir sur un mur », stand, IA, ciel), fichiers interdits, logique de commande, clés ui.ts dans les 7 langues. Relance tsc. Corrige ce qui est sûr.
bloquant=true seulement si la mise en prod serait dangereuse.`, { label: 'vérif:code', phase: 'Vérification', schema: VERD }),
  () => agent(`${CONTEXTE}\nLe chantier vient d'être fait (bilan : ${JSON.stringify(fait)}). TA TÂCHE : ESSAIS AU NAVIGATEUR en adversaire, comme une cliente sur téléphone et une vendeuse
sur la tablette : chaque type d'affiche (classique de dos, de face, stand, photo IA, ciel) en plein écran, 4 étapes, tailles 1440 / 1024 / 820 / 390 / 360, clavier (Tab, Échap ferme ?),
jusqu'au panier sans payer, « Modifier » depuis le panier. Captures ${REPO}/travaux/finir-a-faire/plein-ecran/verif-*. Corrige ce qui cloche. bloquant=true seulement si une
cliente serait gênée en prod.`, { label: 'vérif:navigateur', phase: 'Vérification', schema: VERD }),
])
return { fait, verifs }
