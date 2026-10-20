/**
 * Le mode essai, tel que le back-office le lit (SERVEUR seulement).
 *
 * L'aide explique comment passer une commande test et où arrivent les
 * courriers d'essai ; l'écran Courriers dit comment sortir de la boîte
 * d'essai. Sur la vraie boutique, ces textes sont faux et dangereux : une
 * « commande test » y est une vraie commande. Ils ne s'affichent donc que si
 * l'API dit que la boutique est en essai (GET /admin/mode-essai, voir
 * apps/api/src/mode-essai.ts), et la recherche ne les propose pas non plus.
 *
 * Gardé une minute, pour que l'aide ne l'interroge pas à chaque ouverture.
 * L'état ne change plus seulement au redémarrage de l'API : l'interrupteur de
 * BO › Réglages › Paiements le bascule à tout moment. Cet écran appelle donc
 * `oublierModeEssai()` après chaque modification réussie (même processus) :
 * l'accueil et l'aide suivent aussitôt. Une API muette répond « pas en
 * essai » : mieux vaut cacher une aide de test sur un site d'essai que la
 * montrer sur la vraie boutique. Les échecs ne sont pas gardés, pour que la
 * réponse revienne dès que l'API répond.
 */
import type { ReponseRecherche } from "@memoryline/types/recherche";
import { apiInterne } from "./api-interne.ts";

export interface EtatEssai {
  /** Un moyen de paiement branché encaisse pour de faux. */
  paiement: boolean;
  /** Les courriers partent dans la boîte d'essai, pas chez les clients. */
  courriers: boolean;
  /** SendCloud fabrique des étiquettes d'essai, gratuites. */
  colis: boolean;
  /** Paiements ou courriers pour de faux : c'est un site de test. */
  essai: boolean;
  /**
   * L'état des paiements en une phrase (« Mode essai : Stripe test, PayPal
   * sandbox, étiquettes non payées. »), ou null quand l'API ne l'a pas dit.
   */
  resume?: string | null;
}

/** La réponse quand on ne sait pas : rien d'essai ne s'affiche. */
export const HORS_ESSAI: EtatEssai = {
  paiement: false,
  courriers: false,
  colis: false,
  essai: false,
  resume: null,
};

const DUREE_MS = 60_000;
let garde: { etat: EtatEssai; jusqua: number } | null = null;

/** À appeler après une modification de l'écran Paiements : on relit l'API. */
export function oublierModeEssai(): void {
  garde = null;
}

/** L'état du mode essai, pour la session de cette requête. */
export async function modeEssai(request: Request): Promise<EtatEssai> {
  if (garde && garde.jusqua > Date.now()) return garde.etat;
  try {
    const res = await fetch(`${apiInterne()}/admin/mode-essai`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return HORS_ESSAI;
    const brut = (await res.json()) as Partial<EtatEssai>;
    const etat: EtatEssai = {
      paiement: brut.paiement === true,
      courriers: brut.courriers === true,
      colis: brut.colis === true,
      essai: brut.essai === true,
      resume: typeof brut.resume === "string" ? brut.resume : null,
    };
    garde = { etat, jusqua: Date.now() + DUREE_MS };
    return etat;
  } catch {
    return HORS_ESSAI;
  }
}

/** Le titre de la section de l'écran Courriers qui parle de sortir de l'essai. */
export const SECTION_SORTIR_DE_L_ESSAI = "Le jour où les courriers devront vraiment partir";

/**
 * Les résultats de recherche qui n'ont de sens qu'en essai, retirés quand la
 * boutique ne l'est pas : les deux rubriques d'aide des tests, et la section
 * de l'écran Courriers qui explique comment sortir de la boîte d'essai.
 *
 * Fonction pure, essayée par tests/recherche.test.mjs. Le total d'un groupe
 * perd les lignes retirées ; un groupe vidé disparaît, comme un groupe qui
 * n'a rien trouvé.
 */
export function retirerCeQuiNeVautQuEnEssai(
  reponse: ReponseRecherche,
  etat: EtatEssai,
): ReponseRecherche {
  const aRetirer = (r: { id: string; ou: string | null }): boolean =>
    (!etat.essai && r.id === "aide:commande-test") ||
    (!etat.courriers && r.id === "aide:courriers-essai") ||
    (!etat.courriers &&
      r.id.startsWith("ecran:/courriers§") &&
      (r.ou ?? "").startsWith(SECTION_SORTIR_DE_L_ESSAI));
  const groupes = reponse.groupes
    .map((g) => {
      const resultats = g.resultats.filter((r) => !aRetirer(r));
      const retires = g.resultats.length - resultats.length;
      return retires ? { ...g, resultats, total: Math.max(resultats.length, g.total - retires) } : g;
    })
    .filter((g) => g.resultats.length > 0);
  return { ...reponse, groupes };
}
