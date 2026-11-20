/**
 * Les gestes de la liste des commandes (components/OrderTable.astro) :
 * « Annuler la vente » et « Supprimer » d'une ligne du stand, l'étape
 * suivante d'une ligne, et la barre de la sélection (« masse » : étape
 * suivante, « Mettre en test », étiquettes, archivage, suppression).
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
import { compteRenduMiseEnTest } from "./vente-de-test.ts";

type Api = ReturnType<typeof adminApi>;

/**
 * Les valeurs de `_action` envoyées par les formulaires de la liste. La page
 * qui la porte les reconnaît ainsi parmi les siennes.
 */
export const ACTIONS_DE_LA_LISTE: readonly string[] = [
  "annuler-vente",
  "supprimer-vente",
  "etape",
  "masse",
];

/** Ce que la liste affiche après le geste : un message vert, ou rouge. */
export interface ResultatActionListe {
  flash: string | null;
  erreurAction: string | null;
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
