/**
 * Les gestes de la liste des commandes (components/OrderTable.astro) :
 * « Annuler la vente » et « Supprimer » d'une ligne du stand, son total
 * corrigé dans la ligne (26/11), l'étape suivante d'une ligne, et la barre
 * de la sélection (« masse » : étape suivante, « Marquer terminées » et
 * « Remettre à imprimer » au stand (26/11), « Mettre en test », étiquettes,
 * archivage, suppression).
 *
 * Sortis du composant à la relecture du 20/11, tels quels : Ventes stand les
 * fait désormais AVANT de lire ses chiffres (pages/ventes-salon.astro). Faits
 * par la liste, ils passaient après : la carte du stand, lue en tête de page,
 * et le bloc des chiffres, rendu en même temps que la liste, comptaient
 * encore les ventes qu'on venait de mettre en test, alors que la confirmation
 * dit « Elles sortent des chiffres » et le message « elles ne comptent plus
 * dans vos chiffres ». Il fallait recharger la page pour les voir changer.
 * L'écran Commandes, lui, laisse la liste les faire, comme avant.
 */
import {
  libelleEtape,
  type EtapeTraitement,
  type ParcoursTraitement,
} from "@memoryline/types";
import type { adminApi } from "./api.ts";
import {
  centimesSaisis,
  envoiDuTotal,
  messageDeCorrection,
  messagesDesTotaux,
  resultatDuTotal,
  SAISIE_ILLISIBLE,
  totauxDeLEnvoi,
} from "./montant-vente.ts";
import { compteRenduMiseEnTest } from "./vente-de-test.ts";
import { compteRenduEtapeStand, estGesteEtapeStand } from "./etape-vente-stand.ts";

type Api = ReturnType<typeof adminApi>;

/**
 * Les valeurs de `_action` envoyées par les formulaires de la liste. La page
 * qui la porte les reconnaît ainsi parmi les siennes.
 */
export const ACTIONS_DE_LA_LISTE: readonly string[] = [
  "annuler-vente",
  "supprimer-vente",
  // Corriger le montant d'une vente du stand (26/11) : fait avant que Ventes
  // stand lise ses chiffres, la carte du stand montre déjà le nouveau total.
  "montant-vente",
  // Le même, tapé dans la cellule du total de la ligne (26/11, Margaux :
  // « commande stand pouvoir modifier directement le total dans la ligne »).
  "montant-ligne",
  "etape",
  "masse",
];

/** Ce que la liste affiche après le geste : un message vert, ou rouge. */
export interface ResultatActionListe {
  flash: string | null;
  erreurAction: string | null;
  /**
   * Les totaux corrigés dans les lignes (26/11) : la page revient sur la
   * ligne d'Entrée (#vente-…), et le résultat de chacun s'y lit, sous son
   * champ, sans remonter en tête de la liste. Plusieurs depuis la relecture
   * du 26/11 : les totaux tapés sur d'autres lignes partent avec elle.
   */
  lignes?: { id: number; texte: string; erreur: boolean }[];
}

/**
 * Fait le geste envoyé par un formulaire de la liste, et rend le message à
 * afficher. Un formulaire qui n'est pas de la liste ne fait rien.
 *
 * `auteur` : l'adresse de la propriétaire, pour le journal des commandes.
 */
export async function faireActionDeLaListe(
  f: FormData,
  api: Api,
  auteur: string | undefined,
): Promise<ResultatActionListe> {
  let flash: string | null = null;
  let erreurAction: string | null = null;
  const action = f.get("_action");
  try {
    if (action === "annuler-vente") {
      // Une vente du stand que le client n'a pas payée, ou autre (19/11) :
      // annulée d'ici, sans ouvrir la fiche. Aucun courriel, rien à rendre :
      // son encaissement sur place sort du grand livre (commandes.ts).
      const r = await api.annulerCommande(Number(f.get("id")), {
        motif: String(f.get("motif") ?? "impaye"),
        motifLibre: "",
        rembourser: false,
        author: auteur,
      });
      flash = `Vente ${r.numero} annulée : elle ne compte plus dans vos chiffres.`;
    } else if (action === "supprimer-vente") {
      // Pour les essais (19/11, Alexandra : « faut qu'on puisse supprimer
      // malgré la loi les commandes […] et pas devoir passer par
      // archivées ») : une vente du stand part pour de bon, d'un clic.
      const numero = String(f.get("numero") ?? "");
      await api.supprimerCommande(Number(f.get("id")));
      flash = `Vente ${numero} supprimée définitivement, avec ses lignes et son journal.`;
    } else if (action === "montant-vente") {
      // Le montant d'une vente du stand déjà validée (26/11, Margaux :
      // « des fois ils changent d'avis ils veulent un cadre par exemple […]
      // le but est d'avoir les statistiques bon »). Un refus de l'API
      // (vente facturée, annulée…) se lit tel quel, sans « Error: ».
      try {
        const r = await api.corrigerMontantVente(Number(f.get("id")), {
          totalCents: centimesSaisis(String(f.get("montant") ?? "")),
          motif: String(f.get("motif") ?? ""),
          author: auteur,
        });
        flash = messageDeCorrection(r);
      } catch (refus) {
        return {
          flash: null,
          erreurAction: refus instanceof Error ? refus.message : String(refus),
        };
      }
    } else if (action === "montant-ligne") {
      // Le total tapé dans la ligne de Ventes stand (26/11, Margaux : « si
      // elle applique des réductions par ex, faudrait juste le total
      // indépendamment du reste ») : ni confirmation, ni motif — le journal
      // dit qu'il n'y en a pas. Sans script, la règle du navigateur tient
      // ici : une valeur inchangée ou illisible n'envoie rien à l'API.
      //
      // Avec les totaux tapés sur les AUTRES lignes et pas encore envoyés
      // (relecture du 26/11 : ils étaient perdus sans rien dire), un par un,
      // chacun avec son résultat sous son champ (montant-vente.ts).
      const totaux = totauxDeLEnvoi({
        id: f.get("id"),
        numero: f.get("numero"),
        avant: f.get("avant"),
        montant: f.get("montant"),
        autres: f.get("autres"),
      });
      const resultats: { id: number; numero: string; texte: string; erreur: boolean }[] = [];
      for (const t of totaux) {
        const envoi = envoiDuTotal(t.saisie, t.avantCents);
        if (!envoi.envoyer) {
          if (envoi.raison === "illisible")
            resultats.push({ id: t.id, numero: t.numero, texte: SAISIE_ILLISIBLE, erreur: true });
          // « Inchangé » ne se dit que pour une ligne envoyée seule.
          else if (totaux.length === 1)
            resultats.push({
              id: t.id,
              numero: t.numero,
              texte: resultatDuTotal({ numero: t.numero, avantCents: t.avantCents, apresCents: t.avantCents, inchange: true }),
              erreur: false,
            });
          continue;
        }
        try {
          const r = await api.corrigerMontantVente(t.id, {
            totalCents: envoi.cents,
            motif: "",
            author: auteur,
          });
          resultats.push({ id: t.id, numero: t.numero, texte: resultatDuTotal(r), erreur: false });
        } catch (refus) {
          // La vente facturée, annulée… entre l'affichage et l'envoi : la
          // phrase de l'API, telle quelle, sous le champ.
          const texte = refus instanceof Error ? refus.message : String(refus);
          resultats.push({ id: t.id, numero: t.numero, texte, erreur: true });
        }
      }
      const messages = messagesDesTotaux(resultats);
      return {
        flash: messages.flash,
        erreurAction: messages.erreur,
        lignes: resultats.map(({ id, texte, erreur }) => ({ id, texte, erreur })),
      };
    } else if (action === "etape") {
      // L'étape suivante, d'un clic dans la liste (17/11) : la même règle que
      // la frise de la fiche (courriel compris).
      const r = await api.changerEtape(Number(f.get("id")), {
        etape: String(f.get("etape") ?? ""),
        auteur,
      });
      const nom = libelleEtape(r.etape as EtapeTraitement, r.parcours as ParcoursTraitement);
      flash =
        `${String(f.get("numero") ?? "Commande")} : « ${nom} ».` +
        (r.courrier
          ? r.courrier.parti
            ? ` Courriel envoyé à ${r.courrier.email}.`
            : ` Le courriel n'a PAS pu partir vers ${r.courrier.email}.`
          : "");
    } else if (action === "masse") {
      const ids = String(f.get("ids") ?? "")
        .split(",")
        .map(Number)
        .filter(Boolean);
      const quoi = String(f.get("bulk") ?? "");
      const tags = String(f.get("tags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (quoi === "etape-suivante") {
        const r = await api.bulkOrders(ids, quoi, undefined, auteur);
        const ecartees = r.ecartees ?? [];
        flash =
          `${r.count} commande(s) passée(s) à l'étape suivante` +
          (r.prevenues ? `, ${r.prevenues} client(s) prévenu(s) par courriel` : "") +
          "." +
          (ecartees.length
            ? ` ${ecartees.length} laissée(s) telle(s) quelle(s) : ${ecartees
                .map((e) => e.raison)
                .filter((v, i, t) => t.indexOf(v) === i)
                .join(" ")}`
            : "");
      } else if (quoi === "test") {
        // Les ventes d'essai cochées dans Ventes stand (20/11, Alexandra :
        // « non pour mettre en test à la main c'est avec sélectionner et une
        // option à la sélection ») : annulées sans courriel et étiquetées
        // « test », elles quittent « Toutes » pour l'onglet « Test ». L'API
        // écarte, avec sa raison, ce qui n'est pas une vente du stand.
        const r = await api.bulkOrders(ids, "test", undefined, auteur);
        flash = compteRenduMiseEnTest(r);
      } else if (estGesteEtapeStand(quoi)) {
        // « Marquer terminées » et « Remettre à imprimer » (26/11,
        // Alexandra : « qu'on doive le faire soit dans la commande soit sur
        // la liste avec case à cocher ») : l'API ignore ce qui n'est pas une
        // vente du stand payée, ou déjà à l'étape demandée, et le message
        // compte ces ventes-là, chacune avec sa raison.
        const r = await api.bulkOrders(ids, quoi, undefined, auteur);
        flash = compteRenduEtapeStand(quoi, r);
      } else if (quoi === "tag" || quoi === "untag") {
        // « test » posé à la main sur une vente du stand qui compte encore :
        // l'API refuse toute la sélection (relecture du 20/11,
        // ventes-de-test.ts, `poseTestALaMain`). Sa phrase nomme les ventes
        // et mène à « Mettre en test » : elle se lit telle quelle, sans le
        // « Error: » que String(e) mettrait devant.
        let r: Awaited<ReturnType<Api["bulkOrders"]>>;
        try {
          r = await api.bulkOrders(ids, quoi, tags);
        } catch (refus) {
          return {
            flash: null,
            erreurAction: refus instanceof Error ? refus.message : String(refus),
          };
        }
        flash =
          quoi === "tag"
            ? `Étiquette ajoutée à ${r.count} commande(s).`
            : `Étiquette retirée de ${r.count} commande(s).`;
      } else if (quoi === "archiver" || quoi === "restaurer") {
        const r = await api.bulkOrders(ids, quoi);
        const numeros = Array.isArray(r.numeros) ? r.numeros : [];
        const liste = numeros.length ? ` : ${numeros.join(", ")}.` : ".";
        flash =
          quoi === "archiver"
            ? `${r.count} commande(s) archivée(s)${liste} Rien n'est effacé : elles attendent dans l'onglet « Archivées ».`
            : `${r.count} commande(s) restaurée(s)${liste}`;
      } else if (quoi === "supprimer") {
        // La suppression DÉFINITIVE, par sélection, dans l'onglet
        // « Archivées » (18/11). Une à une, par la route de la fiche : mêmes
        // règles (suppression.ts, motifCommandeAGarder). Ce qui a été payé,
        // facturé, remboursé, expédié ou réglé en carte cadeau reste
        // archivé, et le message dit pourquoi.
        let supprimees = 0;
        const raisons: string[] = [];
        for (const id of ids) {
          try {
            await api.supprimerCommande(id);
            supprimees++;
          } catch (e) {
            raisons.push(String(e).replace(/^Error:\s*/, ""));
          }
        }
        const uniques = raisons.filter((v, i, t) => t.indexOf(v) === i);
        flash =
          `${supprimees} commande(s) supprimée(s) définitivement, avec leurs lignes et leur journal.` +
          (raisons.length ? ` ${raisons.length} gardée(s) : ${uniques.join(" ")}` : "");
      }
    }
  } catch (e) {
    erreurAction = String(e);
  }
  return { flash, erreurAction };
}
