# Personnages unifiés : le plan

Étude en lecture seule. Aucun fichier du dépôt, aucune ligne de la base n'a été modifié. Les chiffres viennent de la base LOCALE. La prod n'a pas été lue : il faut y refaire les mêmes SELECT avant de lancer le chantier.

## 1. Pourquoi on cale aujourd'hui

1. Chaque personnage est dessiné à sa propre taille et à sa propre place dans son cadre. Un adulte de face va de 4 % à 97 % de la hauteur, un adulte de dos de 13 % à 87 %, un enfant de dos de 22 % à 78 %, un bébé de 32 % à 68 %.
2. Une pièce est le calque découpé dans le dessin d'UN personnage, aux coordonnées de ce corps. Elle ne tombe juste que sur lui ou sur son jumeau exact.
3. Il n'existe aucun repère commun (tête, cou, taille, pieds) ni côté corps ni côté pièce. Le calage compense donc à la main, pour chaque paire personnage × pièce.
4. Les formats sont mélangés : 500×1000, 375×750, 768×1152, 1024×1536 et du PNG. Tout ce qui sort de la famille d'origine se cale : Femme 6 cumule à elle seule 21 des 28 calages.
5. Le catalogue de 170 pièces est en réalité une juxtaposition de petites garde-robes, une par corps. Les hauts et les bas ne servent qu'à un seul personnage (40 hauts sur 42, 36 bas sur 39).

## 2. L'approche recommandée : un gabarit par morphologie

**Principe.** On fixe une dizaine de CORPS DE RÉFÉRENCE (gabarits). Tous partagent le même cadre (500×1000), la même ligne de pieds et la même échelle réelle : un adulte est plus grand qu'un enfant, mais chacun l'est de la même façon partout. Toute pièce est dessinée SUR un gabarit et ne peut être proposée qu'aux personnages de ce gabarit. Une pièce posée sur son gabarit tombe juste par construction, sans aucun calage.

**Les gabarits** (à valider, voir décisions) :
- adulte debout de face ;
- adulte de dos (aujourd'hui assis) ;
- ado de face et de dos ;
- enfant de face et de dos ;
- bébé de face et de dos ;
- fauteuil roulant.

Cela fait 9 ou 10 gabarits, 11 ou 12 si on sépare femme et homme.

**Les personnages** deviennent un gabarit + une tenue de départ :
- le dessin de base est NU (corps, peau) ;
- la tenue de départ est une liste de pièces (`default_assets`) ;
- les traits propres au personnage (barbe, lunettes, fauteuil) deviennent des accessoires.

Le moteur sait déjà poser une base sans calques puis les pièces par-dessus.

**Les accessoires par point d'accroche** (en option, utile seulement pour les partager ENTRE gabarits). Chaque gabarit porte 5 points mesurés une fois : sommet du crâne, yeux, cou, taille, main. Un accessoire déclare son point (un chapeau → crâne, des lunettes → yeux). Le code calcule seul le déplacement et la mise à l'échelle. On dessine ainsi un chapeau une seule fois pour l'adulte, l'ado et l'enfant.

Pas de squelette articulé : les poses sont figées, ce serait du travail sans gain.

**Base de données** :
- une table `gabarit` (vue, morphologie, points d'accroche) ;
- une colonne `gabarit_id` sur `character_type` et sur `asset` ;
- les pièces proposées à un personnage sont celles de son gabarit, ce qui rend `slot_variants` facultatif (il ne sert plus qu'à retirer une pièce) ;
- `slot_adjust`, `bottom_pct` et `facteur_taille` restent à leur valeur neutre pour les nouveaux personnages.

### Alternatives sérieuses

| Option | Pour | Contre |
|---|---|---|
| **A. Recadrer automatiquement l'existant** : un script mesure chaque corps, le ramène à l'échelle et à la ligne de pieds de son gabarit, applique la MÊME transformation à ses pièces et découpe la base habillée en base nue + pièces. Fichiers neufs, aucun dessin. | Pas d'illustrateur. Rapide (environ 4 j de code). Supprime `bottom_pct`, `facteur_taille` et les écarts d'échelle. Les nouveaux personnages et les nouvelles pièces sont recadrés à l'import et ne se calent plus. | Deux corps du même gabarit restent un peu différents (épaules, tête). Une pièce d'un corps ne va donc pas parfaitement sur l'autre : la garde-robe ne devient pas vraiment commune. Inutilisable pour Femme 6 et les chiens, qui sont d'un autre style. |
| **B. Tout redessiner en vectoriel sur les gabarits** | Garde-robe vraiment partagée : tout haut d'adulte va à tous les adultes. Style homogène, fichiers légers, couleurs modifiables partout. Plus jamais de calage. | Beaucoup de dessin. Pour garder le même catalogue : environ 45 corps humains ramenés à une dizaine de gabarits + des tenues, soit de l'ordre de 10 à 20 jours d'illustrateur. Il faut redécider la garde-robe. |
| **C. Mixte (RECOMMANDÉ)** | Pour chaque morphologie, on prend comme gabarit le meilleur corps existant (par exemple male_2 pour l'adulte de dos). On recadre tout automatiquement (A). L'illustrateur ne reprend que ce qui ne tombe pas juste sur le gabarit, puis dessine toutes les NOUVELLES pièces sur gabarit. | Résultat immédiat sans dessin. Le dessin est concentré là où il manque. Le catalogue est unifié progressivement. | Quelques pièces resteront un temps propres à un corps. Il faudra une passe de contrôle visuelle par Margaux. |

## 3. Qui fait quoi (dans le style actuel : vectoriel en aplats, sans visage, ombres en deux tons)

**Le code, seul :**
- la table des gabarits, les colonnes, le rendu « gabarit » (écran, PDF, aperçus, BO) ;
- le recadrage automatique ;
- la découpe des bases habillées en base nue + pièces, pour les 52 dessins vectoriels qui ont leurs calques nommés ;
- les chiens au format 2:3 ramenés au cadre 1:2 et à l'échelle commune ;
- au BO, l'import qui vérifie le format, recadre et range sur un gabarit ;
- une planche de contrôle (toutes les pièces d'un gabarit sur tous ses corps) ;
- la mesure des points d'accroche, à faire valider ;
- les tests de non-régression.

**L'illustrateur :**
- nettoyer les corps de référence choisis (base nue propre, épaules et cou bien dessinés sous les vêtements) ;
- redessiner les pièces qui ne tombent pas juste ;
- dessiner les nouvelles pièces sur gabarit, à partir d'un fichier-modèle 500×1000 que le code fournira (corps en calque verrouillé, zones de couleur nommées `.st1`, `.st2`…).

**Margaux :**
- valider chaque gabarit et ses points d'accroche ;
- relire la planche de contrôle ;
- choisir les tenues de départ et retirer les pièces qui ne conviennent pas ;
- décider quels anciens personnages ne sont plus proposés.

À noter : Femme 6 et ses 6 pièces (style « IA réaliste », en pixels, plus d'1 Mo chacune) ainsi que les 5 chiens peints ne rentrent pas dans le style. Il faut soit les redessiner en vectoriel, soit les garder tels quels hors gabarit (voir décisions).

## 4. Ne rien casser

Une commande ne fige pas le dessin. Elle garde des identifiants, et l'impression relit à chaque fois les lignes `character_type` et `asset`, leurs fichiers, `slot_adjust` et `bottom_pct`. D'où ces règles :

1. **Ne jamais modifier en place** un personnage ou une pièce existants, ni leurs fichiers. On crée de NOUVELLES lignes avec de nouveaux noms de fichiers, et on ARCHIVE les anciennes. Elles restent lisibles par l'impression et la suppression définitive est déjà bloquée. Les commandes passées, les paniers de moins de 14 jours, les affiches de démo et les compositions IA continuent de pointer sur l'ancien et s'impriment à l'identique.
2. **Garder l'ancien chemin de rendu intact.** Le nouveau est un cas particulier : base sans calques, calage vide, gabarit renseigné. Le découpage en tranches, `appliquerCalage`, `bottom_pct`, les fichiers 2:3 et les pixels recolorés restent tels quels.
3. **Filet avant de toucher au code** : rendre et archiver un PNG de chaque ligne payée en PROD, puis les comparer pixel à pixel après chaque lot. C'est indispensable, car toute modification de `packages/types` régénère tous les PDF en cache.
4. **Pas de conversion des anciennes commandes** vers les nouveaux personnages : les zones de couleur et les identifiants ne correspondent pas.
5. **Ne pas réutiliser un numéro de pièce existant** (incident de la migration 0072).
6. **BO** : l'écran de calage reste disponible pour les anciens personnages et les exceptions. Il est masqué pour un personnage sur gabarit.
7. **Bascule** : les nouveaux personnages sont mis en ligne archivés-invisibles, contrôlés, puis on échange la visibilité ancien/nouveau catégorie par catégorie.

## 5. Les lots, dans l'ordre

| Lot | Contenu | Effort (code) |
|---|---|---|
| 0 | Relevé en PROD (personnages, calages, commandes payées) + images de référence de toutes les lignes payées + test pixel à pixel | 1 à 1,5 j |
| 1 | Gabarits : table, colonnes, rendu « gabarit » sur l'écran, le PDF et les aperçus, ancien rendu inchangé, tests | 2 j |
| 2 | Outil de recadrage et de découpe base nue + pièces, nouvelles lignes, planche de contrôle | 2,5 à 3 j |
| 3 | Pilote sur UNE morphologie (adulte de dos, la plus partagée) : génération, relecture par Margaux, bascule | 1 j + relecture |
| 4 | BO : import sur gabarit (vérif du format, recadrage auto), pièces proposées par gabarit, calage masqué, fichier-modèle pour l'illustrateur | 2 à 2,5 j |
| 5 | Les autres morphologies + les animaux (remise à l'échelle) + retrait des personnages d'essai (69 à 74, 47) | 1,5 j + relecture |
| 6 | (option) Accessoires par point d'accroche, partagés entre gabarits | 1,5 à 2 j |
| 7 | Dessin : nettoyage des gabarits, reprise des pièces qui tombent mal, garde-robe commune | illustrateur : 3 à 5 j pour le mixte, 10 à 20 j pour tout redessiner |

**Total code** : environ 10 à 12 jours, plus 1,5 à 2 jours avec l'option 6, plus 1 à 2 jours de relecture par Margaux, répartis.

**Le dessin** est en parallèle et ne bloque pas les lots 0 à 5 : le mixte donne un catalogue sans calage dès le lot 5.

## 6. Décisions pour Alexandra

1. **Quelle approche** : mixte (recommandé), recadrage seul, ou tout redessiner ?
2. **Combien de gabarits** : femme et homme séparés ou un seul adulte ? L'adulte de dos reste-t-il assis ?
3. **Garde-robe** : veut-on qu'un haut aille à TOUS les adultes, ce qui demande le dessin, ou se contente-t-on de « plus de calage » ?
4. **Femme 6 et les 5 chiens peints** : les redessiner dans le style vectoriel, ou les garder à part, hors gabarit ?
5. **Accessoires partagés entre âges** (lot 6) : oui ou plus tard ?
6. **Illustrateur** : qui, et quel budget en jours ?
7. **Bascule** : catégorie par catégorie (recommandé) ou d'un coup ?
8. **Accès en lecture à la prod** pour le lot 0 : le feu vert est nécessaire.
