/**
 * Reprendre l'historique de l'ancienne boutique Shopify : les clientes et
 * leurs commandes, dans la base EN SERVICE.
 *
 * La boutique encaisse déjà sur le nouveau site. Cette reprise n'efface donc
 * rien et ne modifie aucune commande du site : elle AJOUTE les commandes
 * Shopify qui manquent, et complète les fiches clientes là où elles sont
 * vides. Elle se rejoue sans doublon.
 *
 * Les commandes reprises :
 *   - portent un numéro « SHOP-1001 », hors des séries WEB- et SAL- ;
 *   - comptent dans les statistiques à leur date d'origine, sauf les
 *     annulées, les remboursées et les impayées, rangées aux archives ;
 *   - ne sont jamais « à traiter » : déjà vues, déjà traitées ;
 *   - n'envoient aucun courriel, ne prennent aucun numéro de facture,
 *     n'achètent aucune étiquette et ne bougent aucun stock.
 * Le détail des règles : scripts/import/historique-shopify.ts.
 *
 * Sans argument, c'est un APERÇU : rien n'est écrit. `--pour-de-bon` écrit,
 * en une seule transaction.
 *
 * Le dossier des CSV : IMPORT_DIR, sinon data/exports/shopify. Dans le
 * conteneur de l'API, depuis /app/apps/api :
 *
 *   IMPORT_DIR=/app/data/assets/import-shopify npx tsx scripts/import-historique.ts
 *   IMPORT_DIR=/app/data/assets/import-shopify npx tsx scripts/import-historique.ts --pour-de-bon
 *
 * Sur le serveur, le conteneur ne voit du disque que ./data/assets (monté sur
 * /app/data/assets) : les CSV se déposent dans un SOUS-dossier,
 * ~/memoryline/data/assets/import-shopify. Jamais à la racine de
 * data/assets, que l'API sert au public (/api/assets/<fichier>). Et on
 * efface ce sous-dossier une fois la reprise faite : il contient les
 * adresses des clientes.
 */
import { sql } from "../src/db/client.js";
import { dossierImport } from "./import/lib.js";
import { reprendreHistorique } from "./import/orders.js";
import {
  ImportImpossible,
  dateFr,
  euros,
  type Bilan,
  type Ecart,
} from "./import/historique-shopify.js";

const POUR_DE_BON = process.argv.includes("--pour-de-bon");
const DOSSIER = dossierImport("./data/exports/shopify");

/** La base visée, sans jamais montrer son mot de passe. */
function baseVisee(): string {
  const brut = process.env.DATABASE_URL ?? "";
  try {
    const u = new URL(brut);
    const hote = u.port ? `${u.hostname}:${u.port}` : u.hostname;
    return `${hote}/${decodeURIComponent(u.pathname.replace(/^\//, ""))}`;
  } catch {
    return "(adresse illisible)";
  }
}

const n = (v: number) => v.toLocaleString("fr-FR");
const s = (v: number) => (v > 1 ? "s" : "");

/** Quelques exemples, puis « et N autres ». */
function exemples(liste: readonly string[], max = 8): string {
  if (liste.length <= max) return liste.join(", ");
  return `${liste.slice(0, max).join(", ")} et ${n(liste.length - max)} autre${s(liste.length - max)}`;
}

function afficherEcarts(ecarts: readonly Ecart[], max = 15) {
  for (const e of ecarts.slice(0, max))
    console.log(`      – ${e.fichier}${e.ligne ? ` ligne ${e.ligne}` : ""} : ${e.raison}`);
  if (ecarts.length > max) console.log(`      – … et ${n(ecarts.length - max)} autre${s(ecarts.length - max)}`);
}

function afficherBilan(b: Bilan) {
  const c = b.clientes;
  console.log("\nClientes");
  console.log(`  • ${n(c.lignes)} ligne${s(c.lignes)} dans l'export des clientes`);
  console.log(
    `  • ${n(c.creees)} fiche${s(c.creees)} à créer, dont ${n(c.abonneesCreees)} abonnée${s(c.abonneesCreees)} aux e-mails (accord donné dans Shopify)`,
  );
  if (c.depuisCommandes)
    console.log(
      `      dont ${n(c.depuisCommandes)} vue${s(c.depuisCommandes)} seulement dans les commandes`,
    );
  console.log(
    `  • ${n(c.completees)} fiche${s(c.completees)} existante${s(c.completees)} à compléter (cases vides seulement ; identifiant Shopify posé sur ${n(c.identifiantsPoses)})`,
  );
  console.log(`  • ${n(c.inchangees)} fiche${s(c.inchangees)} existante${s(c.inchangees)} inchangée${s(c.inchangees)}`);
  console.log(`  • ${n(c.adresses)} adresse${s(c.adresses)} ajoutée${s(c.adresses)} au carnet`);
  if (c.abonnementNonRepris)
    console.log(
      `  • ${n(c.abonnementNonRepris)} abonnement${s(c.abonnementNonRepris)} non repris : fiche déjà là, ou adresse désabonnée de la lettre — leur choix reste le leur`,
    );
  if (c.ecartees.length) {
    console.log(`  • ${n(c.ecartees.length)} ligne${s(c.ecartees.length)} écartée${s(c.ecartees.length)} :`);
    afficherEcarts(c.ecartees);
  }

  const o = b.commandes;
  console.log("\nCommandes");
  console.log(`  • ${n(o.lues)} commande${s(o.lues)} dans l'export (${n(o.lignes)} ligne${s(o.lignes)})`);
  const periode =
    o.premiere && o.derniere ? `, du ${dateFr(o.premiere)} au ${dateFr(o.derniere)}` : "";
  console.log(`  • ${n(o.aCreer)} à créer${periode}`);
  console.log(
    `      – ${n(o.ventes)} vente${s(o.ventes)} : ${euros(o.chiffreAffairesCents)}, comptées à leur date d'origine`,
  );
  console.log(
    `      – ${n(o.horsVentes)} hors ventes (annulées, remboursées, jamais payées) : rangées aux archives`,
  );
  console.log(`      – ${n(o.web)} du site, ${n(o.salon)} de stand (caisse Shopify ou commande saisie à la main)`);
  console.log(`  • ${n(o.dejaPresentes)} déjà en base : sautée${s(o.dejaPresentes)}`);
  if (o.remboursements)
    console.log(`  • ${n(o.remboursements)} remboursement${s(o.remboursements)} noté${s(o.remboursements)} sur leur commande`);
  if (o.correspondances.length) {
    console.log("  • Statut Shopify (paiement · expédition) → ce qu'elles deviennent :");
    for (const l of o.correspondances)
      console.log(`      ${l.shopify} → ${l.repris} : ${n(l.nombre)}`);
  }
  if (o.traiteesALaReprise.length)
    console.log(
      `  • ${n(o.traiteesALaReprise.length)} vente${s(o.traiteesALaReprise.length)} payée${s(o.traiteesALaReprise.length)} mais non expédiée${s(o.traiteesALaReprise.length)} dans Shopify, marquée${s(o.traiteesALaReprise.length)} traitée${s(o.traiteesALaReprise.length)} quand même : ${exemples(o.traiteesALaReprise)}`,
    );
  if (o.sansCliente)
    console.log(`  • ${n(o.sansCliente)} sans adresse e-mail : reprise${s(o.sansCliente)} sans fiche cliente`);
  if (o.autresDevises.length)
    console.log(`  • ⚠ Pas en euros : ${exemples(o.autresDevises)}. Leurs montants sont repris tels quels.`);
  if (o.doublons.length)
    console.log(
      `  • ${n(o.doublons.length)} commande${s(o.doublons.length)} présente${s(o.doublons.length)} entière${s(o.doublons.length)} dans deux fichiers, lue${s(o.doublons.length)} une seule fois : ${exemples(o.doublons)}`,
    );
  if (o.ecartees.length) {
    console.log(`  • ${n(o.ecartees.length)} écartée${s(o.ecartees.length)} :`);
    afficherEcarts(o.ecartees);
  }

  const a = b.articles;
  console.log("\nArticles");
  console.log(
    `  • ${n(a.lignes)} ligne${s(a.lignes)} : ${n(a.parSku)} rattachée${s(a.parSku)} par la référence (sku), ${n(a.parTitre)} par le titre, ${n(a.parShopify)} par l'identifiant Shopify`,
  );
  console.log(
    a.nonRattaches > 1
      ? `  • ${n(a.nonRattaches)} non rattachées : elles gardent seulement leur titre`
      : `  • ${n(a.nonRattaches)} non rattachée : elle garde seulement son titre`,
  );
  if (a.personnalises)
    console.log(`  • ${n(a.personnalises)} avec leur personnalisation (export Matrixify)`);
  if (a.quantiteNulle)
    console.log(`  • ${n(a.quantiteNulle)} ligne${s(a.quantiteNulle)} à quantité nulle, laissée${s(a.quantiteNulle)} de côté`);
  if (a.titresNonRattaches.length) {
    console.log("  • Titres non rattachés les plus fréquents :");
    for (const t of a.titresNonRattaches.slice(0, 12))
      console.log(`      ${n(t.nombre)} × ${t.titre}`);
  }
}

/** Ce que la base contient, pour comparer avant et après. */
async function comptes() {
  const [r] = await sql`
    select
      (select count(*)::int from "order"
        where legacy_id is null and legacy_name is null) as "commandesDuSite",
      (select count(*)::int from "order" where number like 'SHOP-%') as "reprises",
      (select count(*)::int from customer) as "clientes",
      (select count(*)::int from payment) as "paiements",
      (select coalesce(sum(dernier_numero), 0)::int from facture_compteur) as "factures"`;
  return {
    commandesDuSite: Number(r?.commandesDuSite ?? 0),
    reprises: Number(r?.reprises ?? 0),
    clientes: Number(r?.clientes ?? 0),
    paiements: Number(r?.paiements ?? 0),
    factures: Number(r?.factures ?? 0),
  };
}

async function main(): Promise<number> {
  console.log("▶ Reprise de l'historique Shopify");
  console.log(`  Dossier : ${DOSSIER}`);
  console.log(`  Base    : ${baseVisee()}`);
  console.log(
    POUR_DE_BON
      ? "  Mode    : ÉCRITURE (--pour-de-bon), en une seule transaction"
      : "  Mode    : aperçu — rien ne sera écrit",
  );

  const avant = POUR_DE_BON ? await comptes() : null;
  const { lu, plan, ecriture } = await reprendreHistorique({
    dossier: DOSSIER,
    pourDeBon: POUR_DE_BON,
  });

  console.log(`\nFichiers lus (export ${lu.fichiers.format === "matrixify" ? "Matrixify" : "Shopify natif"}) :`);
  for (const t of [...lu.clientes, ...lu.commandes])
    console.log(`  • ${t.fichier} — ${n(t.lignes.length)} ligne${s(t.lignes.length)}`);
  afficherBilan(plan.bilan);

  if (!ecriture || !avant) {
    console.log("\nRien n'a été écrit. Relancez avec --pour-de-bon pour écrire.");
    return 0;
  }

  const apres = await comptes();
  console.log("\n✓ Écrit, en une seule transaction :");
  console.log(
    `  • ${n(ecriture.clientesCreees)} fiche${s(ecriture.clientesCreees)} créée${s(ecriture.clientesCreees)}, ${n(ecriture.clientesCompletees)} complétée${s(ecriture.clientesCompletees)}, ${n(ecriture.adresses)} adresse${s(ecriture.adresses)}`,
  );
  console.log(
    `  • ${n(ecriture.commandes)} commande${s(ecriture.commandes)}, ${n(ecriture.articles)} article${s(ecriture.articles)}, ${n(ecriture.expeditions)} expédition${s(ecriture.expeditions)}, ${n(ecriture.remboursements)} remboursement${s(ecriture.remboursements)}`,
  );
  console.log("\nContrôles :");
  const ligne = (ok: boolean, texte: string) => console.log(`  ${ok ? "✓" : "⚠"} ${texte}`);
  ligne(
    apres.commandesDuSite >= avant.commandesDuSite,
    `commandes du site : ${n(avant.commandesDuSite)} avant, ${n(apres.commandesDuSite)} après (une vente passée pendant la reprise peut s'y ajouter)`,
  );
  ligne(
    apres.paiements >= avant.paiements,
    `paiements : ${n(avant.paiements)} avant, ${n(apres.paiements)} après — la reprise n'en écrit aucun`,
  );
  ligne(
    apres.factures === avant.factures,
    `compteur des factures : ${n(avant.factures)} avant, ${n(apres.factures)} après — la reprise n'en numérote aucune`,
  );
  ligne(
    apres.reprises === avant.reprises + ecriture.commandes,
    `commandes reprises : ${n(avant.reprises)} avant, ${n(apres.reprises)} après`,
  );
  console.log(
    "\nAucun courriel n'est parti, aucune facture ni étiquette n'a été faite, aucun stock n'a bougé.",
  );
  console.log("Pensez à effacer le dossier des CSV : il contient les adresses des clientes.");
  return 0;
}

main()
  .then(
    (code) => code,
    (e: unknown) => {
      if (e instanceof ImportImpossible) {
        console.error(`\n✖ ${e.message}`);
        return 1;
      }
      console.error(
        POUR_DE_BON
          ? "\n✖ La reprise a échoué. Rien n'a été écrit : la transaction a tout annulé."
          : "\n✖ L'aperçu a échoué. Rien n'a été écrit.",
      );
      console.error(e);
      return 1;
    },
  )
  .then(async (code) => {
    await sql.end({ timeout: 5 });
    process.exit(code);
  });
