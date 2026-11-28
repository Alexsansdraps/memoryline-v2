// Sonde : ouvre une adresse et évalue une expression (mise au point des parcours).
// node sonde.mjs <url> <largeur> <hauteur> [mobile] [expression]
import { brancher, pause } from "./pilote-cfg.mjs";
const [url, l = "1440", h = "900", mobile = "", expr = "document.title"] = process.argv.slice(2);
const p = await brancher();
try {
  await p.taille(Number(l), Number(h), mobile === "mobile");
  await p.aller(url, 2500);
  console.log(JSON.stringify(await p.eval(expr), null, 1));
  console.log("erreurs : " + JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
