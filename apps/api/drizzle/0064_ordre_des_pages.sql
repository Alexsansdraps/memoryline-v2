/*
 * L'ordre des pages, réglé à la main dans « Pages du site ».
 *
 * La boutique demandait de pouvoir « trier l'ordre d'apparition » de ses
 * pages comme de ses collections. Les collections avaient déjà leur rang
 * (`collection.position`), jamais réglable ; les pages n'en avaient aucun et
 * se rangeaient par titre partout — au back-office comme sur la tablette du
 * stand.
 *
 * Zéro pour toutes : rien n'est encore rangé, et les listes gardent leur ordre
 * par titre tant que la boutique n'y a pas touché.
 */
ALTER TABLE "page" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;
