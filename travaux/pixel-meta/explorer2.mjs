// Repérage du parcours : fiche d'une affiche personnalisable, configurateur,
// panier (/commande), carte cadeau. Aucune commande.
import { demarrer, pause } from "./pilote-pixel.mjs";

const CAPTURES = new URL("./captures/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const p = await demarrer({ captures: CAPTURES });
const boutons = (dans = "") =>
  p.eval(`[...(${JSON.stringify(dans)} ? document.querySelector(${JSON.stringify(dans)}) || document : document).querySelectorAll('button, a[role=button], input[type=submit]')]
    .filter(b => b.offsetParent !== null || b.getClientRects().length)
    .map(b => ((b.textContent || b.value || '').replace(/\\s+/g, ' ').trim() || b.getAttribute('aria-label') || b.title || '?').slice(0, 50) + (b.disabled ? ' [désactivé]' : ''))`);
try {
  p.scenario("reperage");
  await p.aller("/");
  await p.eval("document.querySelector('#cookie-banner [data-consent=accept]').click(); 1");
  await pause(800);
  await p.aller("/affiches/strasbourg-cathedrale-affiche-personnalisee", 2500);
  console.log("fiche", JSON.stringify(await boutons("main")));
  await p.bouton("Personnaliser");
  await pause(4000);
  console.log("configurateur", JSON.stringify(await boutons()));
  await p.capture("reperage-configurateur");
  const etapes = await p.eval("[...document.querySelectorAll('.ml-cfg-etapes button, [class*=etape] button')].map(b => b.textContent.trim()).slice(0, 12)");
  console.log("étapes", JSON.stringify(etapes));
  console.log("appels jusqu'ici", JSON.stringify(p.etat.appels.map((a) => [a.via, a.page, a.args])));
} finally {
  await p.fermer();
}
