/**
 * Ce que l'API répond quand une route lève une exception qu'elle n'a pas
 * rattrapée.
 *
 * Sans ce filet, Hono répondait « Internal Server Error » en texte brut. La
 * caisse affichait alors « Error: API POST /orders -> 500 » à la cliente, et
 * le journal n'avait que la pile, sans dire quelle route l'avait levée — sur
 * un serveur où l'on ne lit que ce journal, autant chercher à l'aveugle.
 *
 * Désormais :
 *   - le journal reçoit la méthode, le chemin et l'erreur ENTIÈRE, pile et
 *     cause comprises. Le chemin sans la requête (`?…`) : ce qui suit le
 *     point d'interrogation n'aide pas à trouver la route, et peut porter une
 *     adresse e-mail ;
 *   - la réponse est un JSON au format des autres refus de l'API
 *     ({ error, code }), que le site sait lire, avec un message NEUTRE : le
 *     détail d'une exception — une requête SQL, un chemin de fichier — n'a
 *     rien à faire chez le visiteur. Le code « erreur_interne » dit au site
 *     qu'il s'agit d'une panne et non d'un refus : à lui de choisir sa phrase,
 *     dans la langue de la page.
 *
 * Une HTTPException garde sa propre réponse, exactement comme le faisait le
 * gestionnaire de Hono : c'est un refus voulu (une limite de taille, un
 * validateur), pas une panne. Une route qui répond elle-même — un 400, un 502
 * « Stripe n'a pas répondu » — ne passe jamais par ici.
 *
 * Toutes les routes de l'API sont déclarées sur la même application : les
 * `mount…(app)` d'index.ts n'en créent aucune autre. Le jour où une
 * sous-application serait montée par `app.route()`, elle retomberait sur ce
 * gestionnaire tant qu'elle n'a pas le sien (Hono enveloppe ses routes de son
 * propre `onError` seulement s'il en a un) — l'essai le vérifie.
 */
import type { ErrorHandler } from "hono";

/** Le code qui distingue une panne d'un refus, côté site. */
export const CODE_ERREUR_INTERNE = "erreur_interne";

/** Ce que lit le visiteur : rien de la cause, seulement quoi faire. */
export const MESSAGE_ERREUR_INTERNE =
  "Un problème technique nous a empêchés de traiter votre demande. Réessayez dans un instant.";

export const repondreErreurInterne: ErrorHandler = (err, c) => {
  if ("getResponse" in err) {
    // Recopiée par le contexte, comme le fait Hono : elle garde les en-têtes
    // déjà posés (ceux du CORS, entre autres).
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(`[api] ${c.req.method} ${c.req.path} : exception non rattrapée`, err);
  return c.json({ error: MESSAGE_ERREUR_INTERNE, code: CODE_ERREUR_INTERNE }, 500);
};
