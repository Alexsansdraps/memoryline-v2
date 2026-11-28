// Repérage, suite : « Valider l'affiche » jusqu'au panier, carte cadeau, et la
// caisse (/commande). Aucune commande : rien n'est validé.
import { demarrer, pause } from "./pilote-pixel.mjs";

const CAPTURES = new URL("./captures/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const p = await demarrer({ captures: CAPTURES });
const boutons = (dans = "") =>
  p.eval(`[...(${JSON.stringify(dans)} ? document.querySelector(${JSON.stringify(dans)}) || document : document).querySelectorAll('button, a[role=button], input[type=submit]')]
    .filter(b => b.offsetParent !== null || b.getClientRects().length)
    .map(b => ((b.textContent || b.value || '').replace(/\\s+/g, ' ').trim() || b.getAttribute('aria-label') || b.title || '?').slice(0, 50) + (b.disabled ? ' [désactivé]' : ''))`);
const champs = () =>
  p.eval(`[...document.querySelectorAll('main input, main select, main textarea')].filter(c => c.offsetParent !== null || c.type === 'radio')
    .map(c => [c.tagName.toLowerCase(), c.type, c.name || '', c.getAttribute('autocomplete') || '', c.placeholder || '', c.value?.slice(0, 30) || '', c.closest('label')?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 50) || ''].join(' | '))`);
try {
  p.scenario("reperage");
  await p.aller("/");
  await p.eval("document.querySelector('#cookie-banner [data-consent=accept]').click(); 1");
  await pause(800);
  await p.aller("/affiches/strasbourg-cathedrale-affiche-personnalisee", 2500);
  await p.bouton("Personnaliser");
  await pause(3500);
  await p.bouton("Continuer");
  await pause(1200);
  console.log("étape 2", JSON.stringify(await boutons(".ml-cfg-panel")));
  await p.bouton("Continuer");
  await pause(1200);
  console.log("étape 3", JSON.stringify(await boutons(".ml-cfg-panel")));
  await p.capture("reperage-etape3");
  const nav = p.attendreChargement();
  await p.bouton("Valider l'affiche");
  console.log("navigation", await nav);
  await pause(3000);
  console.log("page", await p.eval("location.pathname + location.search"));
  console.log("caisse boutons", JSON.stringify(await boutons("main")));
  console.log("caisse champs", JSON.stringify(await champs(), null, 1));
  await p.capture("reperage-commande");
  console.log("appels", JSON.stringify(p.etat.appels.map((a) => [a.via, a.page, a.args])));
  // Carte cadeau.
  await p.aller("/carte-cadeau", 2500);
  console.log("carte boutons", JSON.stringify(await boutons("main")));
  console.log("carte champs", JSON.stringify(await champs()));
  console.log("api", JSON.stringify(p.etat.api.map((a) => a.methode + " " + a.chemin)));
} finally {
  await p.fermer();
}
