// Premier tour du pilote : injection, bandeau, faux fbevents.js, et ce que voit
// un script posé par Page.addScriptToEvaluateOnNewDocument.
import { demarrer, pause } from "./pilote-pixel.mjs";

const p = await demarrer({ captures: new URL("./captures/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1") });
try {
  // Ce que voit un script « au tout début de la page » : <html> existe-t-il ?
  await p.envoyer("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__sonde = { html: !!document.documentElement, attrs: document.documentElement ? document.documentElement.getAttributeNames() : null };",
  });
  p.scenario("exploration");
  await p.aller("/");
  console.log("sonde", JSON.stringify(await p.eval("window.__sonde")));
  console.log("pixel", JSON.stringify(await p.etatPixel()));
  await p.eval("document.querySelector('#cookie-banner [data-consent=accept]').click(); 1");
  await pause(1500);
  console.log("après accepter", JSON.stringify(await p.etatPixel()));
  console.log("appels", JSON.stringify(p.etat.appels));
  console.log("meta", JSON.stringify(p.etat.meta));
  console.log("pages", JSON.stringify(p.etat.pages));
  console.log("externes", JSON.stringify(p.etat.externes));
  console.log("erreurs", JSON.stringify(p.etat.erreurs, null, 1));
} finally {
  await p.fermer();
}
