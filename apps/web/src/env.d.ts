/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /**
     * La personne du back-office qui regarde la page, si elle est connectée.
     *
     * Résolue UNE FOIS par le middleware, et lue partout ailleurs. Chaque
     * écran qui la redemanderait paierait un aller-retour de plus à l'API,
     * pour la même réponse.
     *
     * `null` pour un vrai visiteur — et alors aucun appel n'est fait : c'est
     * la présence du cookie d'administration qui déclenche la vérification.
     */
    admin: { email: string; role: string } | null;
    /**
     * Le site est-il consulté DEPUIS UN STAND ?
     *
     * Même boutique, mêmes pages, mêmes affiches : seuls les montants
     * disparaissent et la dernière étape change. Un stand n'est pas un autre
     * site, c'est le même vu autrement — deux interfaces séparées finissent
     * toujours par diverger, et c'est celle qu'on regarde le moins qui casse.
     *
     * Lu dans l'adresse seule (`?stand=1`), sans cookie depuis le 17/11 : la
     * même adresse sans lui est le site normal. Les liens de la tablette le
     * gardent (Base.astro).
     */
    stand: boolean;
    /**
     * La valeur de `?stand=` en mode stand (null sinon) : le NUMÉRO du stand
     * de la tablette (18/11). Les liens de la tablette la recopient telle
     * quelle (Base.astro, `avecStand`), pour rester sur le même stand.
     */
    standValeur: string | null;
    /**
     * La page que la tablette de ce stand affiche, et elle seule (18/11,
     * BO › Ventes stand) : son adresse, son titre dans la langue de la page,
     * et les adresses de ses affiches. Le middleware y ramène toute autre
     * adresse ; la mise en page n'offre plus qu'elle dans le menu. Null hors
     * stand, ou pour un stand sans page : tout le catalogue, comme avant.
     */
    pageDuStand: { slug: string; titre: string; affiches: string[] } | null;
    /**
     * Le code que la page d'erreur (404.astro) doit répondre quand une page
     * s'y réécrit elle-même, faute de pouvoir se servir : 410 pour une
     * affiche archivée (partie pour de bon : Google la retire plus vite),
     * 503 quand l'API ne répond pas (« reviens plus tard » : Google retente
     * sans rien désindexer). Absent : 404.
     */
    statutErreur?: 410 | 503;
  }
}
