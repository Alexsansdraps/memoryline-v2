/**
 * Jeu d'essai du tunnel de commande — RÉSERVÉ AUX ENVIRONNEMENTS DE TEST.
 *
 * Remplir douze champs à la main pour vérifier une modification de trois
 * lignes fait perdre plus de temps que la modification elle-même. Ce module
 * tire donc un client au sort et pré-remplit le formulaire.
 *
 * Le garde-fou est volontairement strict : la fonction ne renvoie quelque
 * chose QUE si `PUBLIC_JEU_ESSAI` vaut « 1 ». La variable n'est définie que
 * dans le docker-compose de développement et de test — en production, elle
 * est absente, `estActif()` répond faux, et il n'existe aucun autre chemin
 * pour activer ce code. Un vrai client ne verra jamais « Camille Dubois »
 * apparaître dans son panier.
 */

/** Vrai seulement si l'environnement l'autorise explicitement. */
export function estActif(): boolean {
  return String(import.meta.env.PUBLIC_JEU_ESSAI ?? "") === "1";
}

const PRENOMS = [
  "Camille",
  "Léa",
  "Noah",
  "Manon",
  "Hugo",
  "Jade",
  "Louis",
  "Chloé",
  "Adam",
  "Alice",
];
const NOMS = [
  "Dubois",
  "Moreau",
  "Lefèvre",
  "Garnier",
  "Roussel",
  "Perrin",
  "Fontaine",
  "Marchand",
  "Girard",
  "Leclerc",
];
const VOIES = [
  "rue des Lilas",
  "avenue de la Gare",
  "impasse du Moulin",
  "boulevard Victor Hugo",
  "chemin des Vignes",
  "place du Marché",
];
/** Villes réelles avec leur code postal : les points relais existent. */
const VILLES = [
  { ville: "Mulhouse", cp: "68100" },
  { ville: "Lille", cp: "59000" },
  { ville: "Nantes", cp: "44000" },
  { ville: "Bordeaux", cp: "33000" },
  { ville: "Lyon", cp: "69003" },
  { ville: "Rennes", cp: "35000" },
];

function au_hasard<T>(liste: readonly T[]): T {
  return liste[Math.floor(Math.random() * liste.length)]!;
}

export interface JeuEssai {
  nom: string;
  email: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  phone: string;
}

/**
 * Un client fictif complet, ou `null` hors environnement de test.
 *
 * L'adresse e-mail part sur le domaine réservé `example.com` (RFC 2606) : même
 * si un courrier de confirmation était envoyé par erreur, il ne pourrait
 * atteindre personne.
 */
export function clientFictif(): JeuEssai | null {
  if (!estActif()) return null;
  const prenom = au_hasard(PRENOMS);
  const nom = au_hasard(NOMS);
  const { ville, cp } = au_hasard(VILLES);
  const n = 1 + Math.floor(Math.random() * 98);
  return {
    nom: `${prenom} ${nom}`,
    email: `${prenom}.${nom}${Math.floor(Math.random() * 1000)}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase() + "@example.com",
    line1: `${n} ${au_hasard(VOIES)}`,
    line2: Math.random() < 0.3 ? `Bâtiment ${au_hasard(["A", "B", "C"])}` : "",
    postalCode: cp,
    city: ville,
    phone: `06${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`,
  };
}
