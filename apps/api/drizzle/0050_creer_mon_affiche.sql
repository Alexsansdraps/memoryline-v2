-- « Créer mon affiche », dans le menu du site, menait à « /affiches » : toutes
-- les affiches, prêtes à imprimer comprises, rangées par nouveautés. On n'y
-- crée pourtant qu'une affiche personnalisable, et c'est sur leur page que
-- s'applique l'ordre réglé au back-office (Produits › Ordre d'affichage) : une
-- cliente qui cliquait là ne voyait jamais les affiches mises devant.
--
-- L'entrée est reconnue à son libellé ET à son adresse d'origine. Une entrée
-- renommée ou déjà redirigée depuis l'écran « Menu du site » est un choix de la
-- propriétaire : on n'y touche pas. Rejouée, la migration ne trouve plus rien.
UPDATE "menu_item"
SET "href" = '/affiches?genre=personnalisable'
WHERE "label" = 'Créer mon affiche'
  AND "href" = '/affiches';
