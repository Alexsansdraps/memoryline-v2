/*
 * Deux corrections de DONNÉES, sans rien changer au schéma (migration
 * « custom » : son instantané est celui de 0068).
 *
 * 1. L'offre « 3 achetées = 1 A4 offerte » (règle n° 1), réglée comme Margaux
 *    l'a demandé : « 3 affiches achetées, peu importe la taille → 1 A4
 *    offerte, SANS CADRE, juste l'affiche » (carte Trello D9). Le moteur et
 *    l'écran Promotions savent le faire depuis le 19/10, mais la règle elle-
 *    même était restée sur son ancien réglage : seules les A4 comptaient, et
 *    l'A4 offerte l'était cadre compris. En local, elle a été passée au
 *    nouveau réglage par l'écran ; en prod, non. La condition sur `version`
 *    laisse intact un réglage déjà fait par l'écran (forme v2) : seule
 *    l'ancienne forme est réécrite, et seulement pour la règle n° 1 de type
 *    « x achetées, y offertes ».
 *
 *    Les commandes déjà passées ne bougent pas : chacune a figé les règles en
 *    jeu au moment où elle a été passée (order.promotions, 0067). Seuls les
 *    paniers en cours suivent le nouveau réglage, comme pour toute promotion
 *    modifiée à l'écran.
 *
 * 2. Le nom de la promotion « Livraison offerte dès 60 € » (désactivée, créée
 *    le 11/09, avant le lot) avait perdu ses accents à l'enregistrement : il
 *    s'affichait « Livraison offerte d�s 60 � » dans BO › Promotions. Seul ce
 *    nom exact, avec ses deux caractères de remplacement (U+FFFD), est
 *    corrigé : un nom déjà retouché à l'écran ne l'est pas.
 *
 * Rien n'est supprimé.
 */
UPDATE "promo_rule"
SET "config" = '{"version":2,"achat":{"quantite":3,"formats":[]},"offert":{"quantite":1,"formats":["A4"],"pourcentage":100,"cadreCompris":false,"maxLots":null},"conditions":{"minCents":null,"minQuantite":null},"cumulable":true}'::jsonb,
    "updated_at" = now()
WHERE "id" = 1
  AND "type" = 'buy_x_get_y'
  AND ("config"->>'version') IS DISTINCT FROM '2';--> statement-breakpoint
UPDATE "promo_rule"
SET "name" = 'Livraison offerte dès 60 €',
    "updated_at" = now()
WHERE "name" = 'Livraison offerte d' || chr(65533) || 's 60 ' || chr(65533);
