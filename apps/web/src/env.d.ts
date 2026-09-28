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
     * Posé par `?stand=1` dans l'adresse, retenu ensuite dans un cookie pour
     * que la tablette n'ait pas à traîner le paramètre de lien en lien.
     * `?stand=0` le retire.
     */
    stand: boolean;
  }
}
