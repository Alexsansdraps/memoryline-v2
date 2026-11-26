/**
 * Les affiches déjà vendues dont une ligne de texte a pu s'imprimer avec un
 * TAMPON rond de la version d'essai d'another shabby (police « Manuscrite »).
 * LECTURE SEULE : une transaction « read only », rien n'est écrit.
 *
 * Deux raisons, corrigées le 26/11 :
 *   - « chiffres » : une ligne (ou un morceau coupé par Entrée, ou un bout
 *     entre deux emojis) écrite TOUT ENTIÈRE dans la police de secours
 *     (« 2025 » seul en ligne 3) — en ligne depuis 11 h 45
 *     (lignesEnPoliceDeSecours, apercus.ts) ;
 *   - « symbole » : ¢ £ ¤ ¥ ƒ ₤, seul ou au milieu d'autres lettres
 *     (« Voyage à Londres £ ») — passés en Caveat à 14 h 31
 *     (lignesAvecSymbolesEnSecours, relecture finale du 26/11).
 * Une affiche vendue AVANT la correction de sa raison a pu partir à
 * l'impression avec le tampon : à regarder une par une.
 *
 * La règle est celle du moteur (apercus.ts lit les bouts que pose
 * l'impression), pas une expression régulière qui la recopierait.
 *
 * Usage, sur le serveur, dans le conteneur de l'API (lecture de la base de
 * prod : seulement avec l'accord d'Alexandra) :
 *   docker exec -w /app/apps/api memoryline-api-1 npx tsx scripts/lignes-touchees.ts
 *
 * Sortie : une ligne par ligne d'affiche touchée (raison, commande, statut,
 * canal, date, ligne de commande, titre, quantité, texte en cause), puis les
 * comptes.
 */
import { sql } from "../src/db/client.js";
import { lignesAvecSymbolesEnSecours, lignesEnPoliceDeSecours } from "../src/apercus.js";

type Ligne = {
  numero: string;
  statut: string;
  canal: string;
  le: string;
  ligne: number;
  titre: string | null;
  quantite: number;
  config: unknown;
};

async function principal(): Promise<void> {
  const lignes = await sql.begin("read only", async (tx) =>
    tx<Ligne[]>`
      SELECT o.number AS numero,
             o.status AS statut,
             o.channel AS canal,
             to_char(o.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS le,
             oi.id AS ligne,
             oi.title AS titre,
             oi.quantity AS quantite,
             oi.config AS config
      FROM order_item oi
      JOIN "order" o ON o.id = oi.order_id
      WHERE o.status <> 'draft'
        AND oi.config IS NOT NULL
      ORDER BY o.created_at DESC, oi.id`,
  );

  const comptes = { chiffres: 0, symbole: 0 };
  console.log(
    ["raison", "commande", "statut", "canal", "le (Paris)", "ligne", "titre", "qté", "ligne d'affiche en cause"].join("\t"),
  );
  for (const l of lignes) {
    for (const [raison, trouvees] of [
      ["chiffres", lignesEnPoliceDeSecours(l.config)],
      ["symbole", lignesAvecSymbolesEnSecours(l.config)],
    ] as const) {
      for (const t of trouvees) {
        comptes[raison]++;
        console.log(
          [
            raison,
            l.numero,
            l.statut,
            l.canal,
            l.le,
            l.ligne,
            (l.titre ?? "").replace(/\s+/g, " "),
            l.quantite,
            `ligne ${t.rang + 1} : « ${t.texte.replace(/\n/g, " ⏎ ")} »`,
          ].join("\t"),
        );
      }
    }
  }
  console.log(
    `\nLignes d'affiche touchées : ${comptes.chiffres} (chiffres), ${comptes.symbole} (symbole). ` +
      `Lignes de commande lues (hors paniers) : ${lignes.length}.`,
  );
}

try {
  await principal();
} finally {
  await sql.end({ timeout: 5 });
}
