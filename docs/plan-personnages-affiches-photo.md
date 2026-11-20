PLAN DE MISE EN ŒUVRE : ajouter des personnages et un muret à l'affiche « à partir de votre photo » (site et tablette du stand)

Racine du dépôt : C:\Users\Alexandra\Documents\memory-line\memoryline-v2. Les chemins sont relatifs à cette racine ; la liste en chemins absolus est à la fin. Les numéros de ligne ont été relevés sur le disque le 20/11 au soir. D'autres sessions modifient ia.ts, configurator-routes.ts et salon.ts : chercher par nom de fonction. Je n'ai rien modifié.

## 0. Ce que j'ai revérifié dans le code, et qui fonde le plan

**L'impression sait déjà le faire.**
- configAImprimer (apps/api/src/fichiers-impression.ts 287-299) remplace seulement le fond par la pleine définition.
- renderPosterPng (pdf.ts 1027-1074) pose ensuite :
  - le muret, seulement s'il y a au moins un personnage ;
  - les personnages, aux places enregistrées ;
  - les textes, x/y compris.
- Il ne faut toucher ni pdf.ts, ni fichiers-impression.ts, ni packages/types/src/*. Ces fichiers forment l'empreinte LANCEMENT (fichiers-impression.ts 110-129) : en changer un rend caducs les PDF déjà fabriqués, et jusqu'à 300 PDF sont refaits au redémarrage.

**Le module de personnalisation ne sait pas encore :**
- démarrer ailleurs qu'à l'étape « fond » : STEPS est figé (store.ts 43) et stateFromConfig remet `step: "background"` ;
- se passer de son filigrane : index.tsx 762-782 ne transmet pas `filigrane` ;
- se passer de texte : PosterPreview montre « Memory Line » quand aucune ligne n'est remplie (151-159), et ignore les x/y des lignes ;
- restituer aiPublicId, foregroundUrl ou les x/y des textes : configFromState (store.ts 553-596) ne les rend pas.

**Défaut existant qui va se produire plus souvent.** Dans rattacherGenerationsAuPanier (ia.ts ~703-713), deux lignes peuvent porter le même aiPublicId (la création seule, puis la même avec personnages). La seconde se voit alors rattacher une AUTRE génération du même produit dans le panier : elle est marquée payée et sa photo d'origine est effacée.

**Défaut existant, visible à côté de personnages nets.** Le menu BO « Taille de l'image » (apps/admin/src/pages/ia.astro 45-50) ne propose pas 1584x2240. Le moindre enregistrement des réglages IA écrit 1024x1536, soit environ 88 ppp en A3.

**Choix d'architecture : AfficheIA reste le seul maître de la ligne de panier.** Il garde les textes (x/y compris), le format, la quantité, les créations multiples et l'ajout au panier. Le module n'est ouvert que sur l'étape « Personnages », avec l'aperçu filigrané pour seul fond, et il rend {vue, personnages}.
- J'écarte la voie « monter ConfiguratorIsland ». Elle perdrait les x/y des textes déplacés et redemanderait le format. Elle écrirait aussi elle-même au panier, pour une seule création, et appellerait /backgrounds et /frames, qui propose les cadres au stand.

## 1. Ce que voit le client

Les écrans sont les mêmes sur le site et sur la tablette ; au stand, aucun prix ne s'affiche.

1. **Jusqu'à la création, rien ne change** : style, photo (ou téléphone), sens, précision, puis « Créer mon affiche ».
2. **Création prête, en PORTRAIT.** Sous les formats apparaît un bloc « Personnages (facultatif) » avec deux gros boutons :
   - « Assis sur le muret » : vue "back", personnages de dos, muret ;
   - « Debout, de face » : vue "front", sans muret.
   En PAYSAGE, une phrase remplace les boutons : « Les personnages s'ajoutent aux affiches en portrait ».
3. **Écran de composition**, dans la même fenêtre ; l'écran IA est masqué.
   - À gauche : l'image IA (un seul filigrane, celui déjà cuit dans l'image), le muret dès le premier personnage, les personnages placés automatiquement (rangée le long du muret, ou groupe), sans texte.
   - À droite, comme sur les affiches personnalisables : « + Ajouter un personnage », tenues, couleurs, ordre, dupliquer.
   - Barre du bas : « Retour » (annule) et « Valider les personnages ».
   - Échap et la croix valent « Retour ». Un clic hors de la fenêtre ne fait rien. Le relais photo est fermé.
4. **Retour à l'écran IA.**
   - Le grand aperçu montre l'image, le muret, les personnages et les textes, toujours déplaçables.
   - Le bloc devient « 3 personnages, assis sur le muret · Modifier · Retirer ».
   - Format, quantité et « Ajouter au panier » fonctionnent comme aujourd'hui.
   - Plusieurs créations cochées : chacune part avec SES personnages, ou sans.
   - « Générer une autre version » reprend les personnages sur la nouvelle version si elle est en portrait (voir Q8).
5. **Panier** (/commande sur le site, /panier?stand=… sur la tablette).
   - Vignette : image, muret et personnages, sans texte comme aujourd'hui.
   - Détail : « Affiche générée à partir de votre photo · 3 personnages ».
   - Toujours pas de « Modifier » : le client revient à la fiche, où ses créations et leurs personnages sont gardés (sessionStorage).
6. **Après le paiement ou la vente au stand.**
   - PDF : pleine définition, muret, personnages, textes x/y et signature.
   - Courriels, compte client et BO : vignette serveur avec les personnages.

## 2. Changements fichier par fichier

### A. packages/configurator

Les nouvelles props sont facultatives ; leur absence garde le comportement actuel.

**src/index.tsx**
- ConfiguratorProps (65-138) : ajouter `etapes?: readonly Step[]`, `filigrane?: boolean` et `sansTexte?: boolean`.
- Après initialState (160-175) : si `etapes` ne contient pas l'étape de départ, partir de `etapes[0]`.
- Lire `etapes()` (= props.etapes ?? STEPS) au lieu de STEPS dans :
  - stepIndex (277) ;
  - next et prev (289-303) ; prev au rang 0 appelle déjà onBack ;
  - isLast (727) ;
  - le fil d'étapes (807-865), masqué s'il n'y a qu'une étape.
- Appel de PosterPreview (762-782) : transmettre `filigrane={props.filigrane}` et `sansTexte={props.sansTexte}`.
- Exporter `type Step`.
- Corriger le commentaire 107-108 : le muret est DERRIÈRE les personnages.

**src/components/PosterPreview.tsx**
- Ajouter la prop `sansTexte?: boolean`.
- Placer la couche texte (649-711) et la roue des polices (713-732) sous `<Show when={!props.sansTexte}>`.

### B. apps/web

**src/lib/messages-configurateur.ts (nouveau)**
- `messagesDuConfigurateur(tr, locale)` : le dictionnaire aujourd'hui écrit en ligne dans ConfiguratorIsland.tsx 255-339, déplacé tel quel. ConfiguratorIsland l'appelle à son tour.

**src/lib/api.ts**
- Ajouter `browserApi.views()` : GET /views, route publique (index.ts 1367-1380).

**src/islands/PersonnagesIA.tsx (nouveau)**, chargé à la demande comme dans ProductConfigurator.tsx 28-29.
- `chargerBibliotheque(langue)` : promesse gardée en mémoire, qui appelle browserApi.characters(langue) et views(). Le muret est le foregroundUrl du type "back", sinon "/assets/muret_officiel.svg".
- Export par défaut `ComposerPersonnages` :
  - `<Configurator etapes={["characters"]} backgrounds={[{id:0, url: apercuChemin, name:null, position:0}]}`
  - `initialConfig={{schemaVersion:1, productId, backgroundUrl: apercuChemin, format, view: vue, texts:{lines:[]}, characters: personnages}}`
  - `foregroundUrl={vue === "back" ? muret : null} cadres={[]} sansPrix filigrane={false} sansTexte`
  - `messages={{...messagesDuConfigurateur(...), validerAffiche: tr("ia.perso.valider")}}`
  - `onSubmit={cfg => onValider({vue: cfg.view, personnages: cfg.characters, decor})} onBack={onRetour}`
  - Le fond est toujours `/ia/apercu/<id>`, jamais `/admin/ia/full`.
- `ApercuPersonnages` :
  - PosterPreview(stateFromConfig({...})) avec `sansTexte`, `filigrane={false}` et un foregroundUrl absolu ;
  - createSvgCache, et le préchargement des SVG copié de CartIsland.tsx 188-203.

**src/islands/AfficheIA.tsx**
- Type `Creation` (530-539) : ajouter `compo?: { vue: "back" | "front"; personnages: Character[]; decor: string | null }`. Il est écrit par memoriserCreations (554-561), donc il survit à revoir() et à un rechargement.
- Nouveau signal `composer` ({vue} ou null).
  - Dans .ml-modal-body (924) : `<Show when={composer()}>` monte ComposerPersonnages (lazy + Suspense).
  - La grille (927) reste montée, en `display:none` pendant la composition : les références des calques de texte et le relais sont gardés.
- RelaisPhoto (1276-1284) : passer `occupe={occupe() || !!composer()}` et `interrompre={etape() === "generation" || !!composer()}`. Une photo reçue appellerait sinon choisirPhoto, qui efface l'aperçu (697-699).
- Pendant la composition :
  - surTouche (884-887) et la croix (920) reviennent à l'écran IA ;
  - le clic sur le fond (913-915) ne fait rien.
- Grand aperçu (965-969) : si la création montrée a des personnages, `<ApercuPersonnages>` (absolute inset-0) remplace l'`<img>`. Les deux calques de texte (975-1078, z 200 et 201) restent au-dessus, sans changement.
- Bloc « Personnages (facultatif) » en tête de `<Show when={apercu()}>` (1495) :
  - visible seulement si `orientationApercu() === "portrait"` ;
  - avec une composition : résumé, « Modifier » (même vue) et « Retirer » ;
  - pour changer de vue : retirer, puis rechoisir. On ne mélange jamais personnages de face et de dos.
- lancerGeneration (742-751) : une nouvelle création en portrait recopie la composition de la création montrée (selon Q8).
- ajouterUneAffiche (821-847) :
  ```ts
  const compo = a.sens === "portrait" ? compoDe(a.publicId) : undefined;
  const n = compo?.personnages.length ?? 0;
  view: n ? compo.vue : "front",
  characters: n ? compo.personnages : [],
  ...(n && compo.vue === "back" && compo.decor ? { foregroundUrl: compo.decor } : {}),
  ```
  Le reste ne change pas. ajouterAuPanier et affichesAAjouter (779-813) non plus : la composition se lit par publicId.
- Précharger PersonnagesIA.tsx au repos dès l'étape "pret" (tablette en 4G).
- Recommandé pour la tablette : une entrée d'historique pendant la composition (pushState/popstate, comme ProductConfigurator.tsx 187-221). Sinon, le geste « retour » d'Android quitte la page.

**src/islands/CartIsland.tsx**
- Branche IA (590-623) : si la ligne a des personnages et que `biblio()` est chargée, afficher :
  - `PosterPreview(stateFromConfig({...config, backgroundUrl: config.aiApercuUrl || "/ia/apercu/<id>"}))` ;
  - avec `filigrane={false}`, `sansTexte`, et le même calcul de foregroundUrl qu'aux lignes 561-574.
  Sinon, garder l'`<img>` actuelle, qui gère aussi le paysage.
- details() (246-251) : ajouter « n personnage(s) » avec les clés existantes panier.personnage et panier.personnages.

**src/islands/CheckoutIsland.tsx**
- Même changement dans la branche IA (2905-2930).

**src/i18n/ui.ts**
- Nouvelles clés dans les 7 langues : `ia.perso.titre`, `.aide`, `.muret`, `.face`, `.valider`, `.modifier`, `.retirer`, `.resume`, `.paysage`. Le type est fermé : une clé oubliée bloque la compilation.

**[slug].astro** : rien à changer.

### C. apps/api

**src/ia-composition.ts (nouveau)**
- À ne PAS mettre dans packages/types, qui fait partie de LANCEMENT.
- Fonction pure `ligneIAControlee(config, ctx)`. Le contexte contient : cartId, productId, la génération, le statut du panier d'origine, la liste des décors autorisés et celle des vues. Règles, dans l'ordre :
  1. Génération absente, pas "prete", ou fullPath nul (purgée) : refus `ia_indisponible`.
  2. gen.productId différent de productId : refus `ia_autre_affiche`.
  3. gen.cartId différent du panier : refus `ia_autre_panier`.
     - Exception : si le panier d'origine est clos et que la génération n'a jamais été vendue, on accepte, et le wrapper reporte cart_id sur le nouveau panier.
     - C'est le cas du nouvel essai « panier_clos » d'ajouterAuPanier (api-navigateur.ts).
  4. Nettoyage :
     - config.productId = productId ;
     - on retire backgroundUrl, backgroundId et frameId ;
     - aiApercuUrl = `/ia/apercu/<id>`.
  5. Sans personnage : view "front" et pas de foregroundUrl.
  6. Avec personnages :
     - refus `ia_personnages_paysage` si l'orientation est "paysage" ou si gen.size vaut "2240x1584" ;
     - view gardée si elle existe en base, sinon "front" ;
     - foregroundUrl gardé seulement s'il est dans les décors autorisés ;
     - limite de nombre éventuelle (Q5).
  7. Les textes ne sont pas touchés (x/y compris).
- `controlerLigneIA(cartId, productId, config)` lit en base :
  - la ligne ai_generation ;
  - les foreground_url non nuls de poster_view, celui du produit, plus "/assets/muret_officiel.svg" ;
  - les slugs de poster_view ;
  - le statut du panier d'origine.

**src/configurator-routes.ts**
- POST /cart/:cartId/items (2902-2983) :
  - juste après le safeParse (2908-2910), si `aiPublicId` est présent, appeler controlerLigneIA ;
  - en cas de refus, répondre 400 `{error: code}` ;
  - calculer productId (aujourd'hui l. 2940) avant cet appel.
- PUT (2986-3055), dans la transaction après loadCartItem (3011) :
  - une ligne déjà IA garde la config enregistrée en base ; seule la quantité change. Le panier et la caisse renvoient de toute façon la config telle quelle (CartIsland 383, CheckoutIsland 415) ;
  - une config IA envoyée sur une ligne qui ne l'était pas : 400.
- resolvePrixLigne (854-903) : inchangé (Q1).

**src/apercus.ts**
- Remplacer iaAvecTexte (56-61) par `iaComposee` = aiPublicId ET (texte OU personnages).
  - Ligne 149 : garder le MÊME sel "ia-avec-texte". Les vignettes « texte seul » gardent ainsi leur adresse.
  - Ligne 338 : utiliser iaComposee.
- Garde : si l'aperçu a été purgé et que la ligne a des personnages, renvoyer l'image du produit. Sinon on obtient des personnages sur une page blanche.

**src/ia.ts**, rattacherGenerationsAuPanier (~703-713)
- N'utiliser le dernier repli (« la génération la plus récente du même produit ») que si la ligne n'annonce PAS d'aiPublicId.
- Extraire `candidatDeLaLigne(...)` pour pouvoir le tester.
- À faire après les commits en cours sur ia.ts.

### D. Ce qu'on ne touche pas
- pdf.ts, fichiers-impression.ts, couleurs-image-fichier.ts et packages/types/src/*.
- salon.ts : la ligne est déjà contrôlée à l'ajout, et le PDF de la vente se fabrique en arrière-plan.
- ia-reutiliser.ts et AtelierAffiche.tsx.
- Ne JAMAIS donner au client :
  - /admin/ia/full ;
  - configDeLAtelier, qui retire aiPublicId ;
  - /admin/ia/:id/decor, qui publierait la pleine définition sans filigrane.

### E. La ligne de panier produite

Aucun changement de schéma : posterConfigSchema accepte déjà cette forme.
```
config: {
  schemaVersion: 1, productId, format: "A4" | "A3",
  view: "back" | "front",                // "front" sans personnage
  foregroundUrl: <muret du type back>,   // seulement vue back et au moins 1 personnage
  texts: { lines: [{ value, font, color, x?, y? }] },              // ceux d'AfficheIA
  characters: [{ typeId, position, x, y, scale, assets, colors }], // sortis de configFromState
  aiPublicId, aiApercuUrl: "/ia/apercu/<id>"
}
```
Jamais d'orientation "paysage" avec des personnages ; ni backgroundUrl, ni backgroundId, ni frameId.

## 3. Tests à ajouter

**apps/api/tests/ia-composition.test.ts** (fonction pure, sans base). Cas à couvrir :
- génération purgée, en cours, ou d'une autre affiche : refus ;
- autre panier encore ouvert : refus ; panier d'origine clos et génération jamais vendue : accepté ;
- backgroundUrl, backgroundId et frameId retirés ; aiApercuUrl imposé ;
- foregroundUrl en "http://…", "ia/x-pleine.png" ou "../" : retiré ; le muret officiel : gardé ;
- muret sans personnage : retiré ;
- personnages en paysage : refus ;
- x/y des textes intacts.

**apps/api/tests/apercus-ia.test.ts** (dans le conteneur, sans requête) :
- une ligne IA « texte seul » garde sa version (même sha1 qu'avant, sel compris) ;
- une ligne IA avec personnages et sans texte reçoit le sel ;
- une ligne IA nue reste sans sel.

**apps/api/tests/rattachement-ia.test.ts** :
- deux lignes avec le même aiPublicId : la seconde n'emprunte aucune autre génération ;
- une ligne sans aiPublicId garde le repli par produit.

**Base locale seulement**, avec la même garde `@db:5432` que cartes-cadeaux-caisse.test.ts :
- POST avec un foregroundUrl forgé : la ligne est enregistrée sans lui ;
- aiPublicId d'un autre panier ouvert : 400 ;
- PUT de quantité sur une ligne IA : config intacte.

**Vérifications de types** : `tsc --noEmit` dans packages/configurator, apps/web (les 3 erreurs anciennes de StandSalon sont tolérées) et apps/api, puis `astro check`.

**Recette à la main, en local puis sur la tablette :**
1. Portrait : 2 personnages sur le muret ; textes déplacés ; A3 ; panier (vignette et « 2 personnages ») ; paiement en mode test ; PDF au BO (muret, personnages, textes à leur place, signature, pas de filigrane) ; courriel.
2. Paysage : la phrase remplace les boutons.
3. Deux créations cochées, une avec et une sans personnages.
4. « Générer une autre version » puis « Retirer ».
5. Au stand : aucun prix, relais fermé pendant la composition, vente, PDF préparé.
6. Échap, croix, et geste retour d'Android.

## 4. Risques et pièges

**Impression**
- Portrait seulement. La géométrie paysage est fausse à quatre endroits : PosterPreview (aspectFor 67-70, ×√2 l. 553), store.ts (483-485) et pdf.ts (439, 1054-1057).
- Il n'y a pas de muret sans personnage, et la vue "back" sans foregroundUrl reçoit d'office muret_officiel (pdf.ts 1027-1030).
- AfficheIA affiche l'image en `object-contain` (968), alors que le module et le PDF la recadrent en `cover`. Une image en 1024x1536 perd environ 5,7 % de sa hauteur sur l'aperçu composé, comme sur le papier.

**Prix**
- Aucun changement si Q1 = non.
- Si la boutique veut un supplément :
  - resolvePrixLigne a 3 appelants (989, 2950, 3016) ;
  - il faut l'afficher dans AfficheIA (1480-1484) ;
  - les promotions le remiseraient avec l'affiche.

**Stand**
- La première ouverture du module charge la bibliothèque et les SVG en 4G : d'où le préchargement.
- « Terminé » repart d'un panier neuf : les créations et compositions du client précédent disparaissent. C'est voulu.
- Un A3 avec personnages est plus long à fabriquer, mais le PDF se fait en arrière-plan : preparerFichierDImpression n'est pas attendu.

**Protection des générations**
- aiPublicId doit rester sur la ligne : il commande l'impression, le rattachement au paiement et la protection contre la purge.
- Corriger le rattachement (§2 C, ia.ts).
- Une ligne non payée perd son fond après 30 jours (comportement existant). Le contrôle au POST refuse une génération purgée.
- Ajouter des personnages ne rappelle pas le modèle : ni coût, ni plafond.

**Filigrane**
- Un seul, celui cuit dans /ia/apercu : `filigrane={false}` dans le module, dans AfficheIA, au panier et à la caisse.
- La vignette serveur garde preview_path.
- La pleine définition (fullPath) n'est jamais exposée côté client.

**Composition sur une photo**
- Le muret couvre environ 24 % du bas de l'image.
- Les pieds des personnages sont posés à 81,6 % de la hauteur (Y_SOL_PERSONNAGES) : ils peuvent cacher les personnes de la photo.
- Pas de glisser-déposer : c'est le choix de la boutique (index.tsx 904-905).
- Parade sans code : un style « Avec personnages » au BO (Q10).

**Sécurité, hors de ce périmètre**
- Sur les lignes CLASSIQUES, foregroundUrl et backgroundUrl restent des chaînes libres.
- readSource lit tout data/assets, y compris `ia/<autre>-pleine.png`, et va chercher les adresses http(s).
- Le contrôle prévu ici ne couvre que les lignes IA : à étendre ensuite.

**BO**
- « Image sans filigrane » de BO › Affiches IA (ia.astro ~554) montre l'image nue : imprimer depuis la commande, jamais depuis là.
- Vérifier la taille d'image IA (§0) avant de vendre des A3.

**Mise en ligne**
- Après la mise en ligne de ce soir (1ad2c31 n'est pas encore en production).
- Se recaler sur les commits en cours dans ia.ts, configurator-routes.ts et salon.ts.
- Mettre en ligne hors des heures du stand.
- Aucun fichier de LANCEMENT n'est touché, donc pas de réimpression de masse.

## 5. Questions pour la boutique, avant de coder

1. **Supplément de prix pour des personnages ou le muret ?** Recommandation : non. Sur les affiches personnalisables, les personnages sont compris dans le prix ; ainsi, rien ne change côté prix.
2. **Quels murets proposer ?** Recommandation : un seul, celui du type « De dos » (BO › Types d'affiche, aujourd'hui muret_officiel.svg). Un banc ou une barrière demandent un nouveau type d'affiche avec ses propres personnages : après Noël.
3. **Proposer « Assis sur le muret » (de dos) et « Debout, de face » (sans muret), ou seulement le muret ?** Recommandation : les deux, le muret en premier. De face, les personnages peuvent sembler flotter sur la photo : juger sur 3 essais avant de l'ouvrir aux clients.
4. **Un muret seul, sans personnage ?** Recommandation : non. C'est la règle actuelle à l'écran comme au PDF ; la changer touche pdf.ts et refait toutes les impressions en cours.
5. **Une limite au nombre de personnages ?** Recommandation : aucune nouvelle limite, puisque le module resserre la rangée tout seul. Si elle en veut une : 6, contrôlée au serveur.
6. **Le paysage ?** Recommandation : personnages en portrait seulement ; la phrase invite à créer une version en portrait.
7. **Placement automatique ou glisser-déposer ?** Recommandation : automatique, comme sur ses affiches personnalisables. À revoir si des visages se retrouvent cachés.
8. **« Générer une autre version » garde-t-il les personnages ?** Recommandation : oui. C'est gratuit, et ils se retirent d'un geste.
9. **Vignette du panier : image, muret et personnages, sans les textes ?** Recommandation : oui, comme aujourd'hui pour les affiches IA. Le PDF, les courriels et le BO montrent tout.
10. **Créer au BO un style « Avec personnages », dont la consigne garde le bas de l'image calme ?** Recommandation : oui. C'est un réglage, sans code.
11. **Le muret aussi dans « Créer une affiche » du BO ?** Recommandation : plus tard.

**Ordre de travail proposé :**
1. Réponses à Q1, Q2 et Q3.
2. Le module (A).
3. AfficheIA, PersonnagesIA et les traductions.
4. Panier, caisse et apercus.ts.
5. Contrôles serveur et correctif du rattachement, après les commits des autres sessions.
6. Tests et recette sur la tablette.

**Indispensables** pour livrer en sécurité :
- côté navigateur : A et B ;
- apercus.ts ;
- dans le contrôle serveur : les règles 1, 2, 4, 5 et 6.
**Peuvent suivre** : la règle 3 (même panier), l'historique Android et la reprise des personnages d'une version à l'autre.

## Fichiers (chemins absolus)
- Modifiés :
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\packages\configurator\src\index.tsx
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\packages\configurator\src\components\PosterPreview.tsx
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\islands\AfficheIA.tsx
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\islands\ConfiguratorIsland.tsx
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\islands\CartIsland.tsx
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\islands\CheckoutIsland.tsx
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\lib\api.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\i18n\ui.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\src\configurator-routes.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\src\apercus.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\src\ia.ts
- Nouveaux :
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\islands\PersonnagesIA.tsx
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\web\src\lib\messages-configurateur.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\src\ia-composition.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\tests\ia-composition.test.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\tests\apercus-ia.test.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\tests\rattachement-ia.test.ts
- À ne pas toucher :
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\src\pdf.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\apps\api\src\fichiers-impression.ts
  - C:\Users\Alexandra\Documents\memory-line\memoryline-v2\packages\types\src\ (tout le dossier)
