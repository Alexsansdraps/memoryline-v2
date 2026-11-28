/**
 * G2 — la règle du stand (affiches-de-stand.ts), vérifiée SANS RIEN ÉCRIRE.
 *
 * docker exec -w /app/apps/api memoryline-api npx tsx /app/travaux/affiche-stand-mulhouse/verifier-stand.ts <id produit de stand> <id affiche classique>
 *
 * N'importe que des fichiers de ../../apps/api/src (les paquets nus ne se
 * trouveraient pas depuis travaux/). Les états « désactivé », « archivé » et
 * « terminé » sont joués sur des COPIES en mémoire des stands réels.
 */
import { db, schema } from "../../apps/api/src/db/client.js";
import { etatDuStand, standDuProduitEnService } from "../../apps/api/src/affiches-de-stand.js";

const [produit, classique] = process.argv.slice(2).map(Number);
if (!Number.isInteger(produit) || !Number.isInteger(classique)) {
  console.error("usage : verifier-stand.ts <id produit de stand> <id affiche classique>");
  process.exit(1);
}

const dates: [string, Date][] = [
  ["maintenant", new Date()],
  ["27/12 23 h 00 (dernier jour)", new Date("2026-12-27T23:00:00+01:00")],
  ["28/12 0 h 30 (lendemain)", new Date("2026-12-28T00:30:00+01:00")],
];
let erreurs = 0;
const attendu = (nom: string, obtenu: boolean, voulu: boolean) => {
  const ok = obtenu === voulu;
  if (!ok) erreurs++;
  console.log(`${ok ? "ok  " : "FAUX"} ${nom} : ${obtenu} (attendu ${voulu})`);
};
for (const [nom, quand] of dates) {
  attendu(`affiche de stand ${produit}, ${nom}`, await standDuProduitEnService(produit, quand), !nom.startsWith("28/12"));
  attendu(`affiche classique ${classique}, ${nom}`, await standDuProduitEnService(classique, quand), true);
}

const stands = await db.select().from(schema.stands);
for (const s of stands) {
  const base = { actif: s.actif, archivedAt: s.archivedAt, dateFin: s.dateFin };
  console.log(`stand ${s.id} « ${s.nom} » (dernier jour ${s.dateFin}) :`);
  console.log(`  réel, aujourd'hui      : ${etatDuStand(base)}`);
  console.log(`  copie désactivée       : ${etatDuStand({ ...base, actif: false })}`);
  console.log(`  copie archivée         : ${etatDuStand({ ...base, archivedAt: new Date() })}`);
  console.log(`  réel, le 28/12 à 0 h 30 : ${etatDuStand(base, new Date("2026-12-28T00:30:00+01:00"))}`);
  console.log(`  réel, le 27/12 à 23 h   : ${etatDuStand(base, new Date("2026-12-27T23:00:00+01:00"))}`);
}
console.log(erreurs ? `${erreurs} écart(s)` : "tout est conforme");
process.exit(erreurs ? 1 : 0);
