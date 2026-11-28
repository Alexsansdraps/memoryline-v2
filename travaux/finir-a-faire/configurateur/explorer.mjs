// Exploration rapide (chantier configurateur, 28/11) : ouvre une fiche et
// donne quelques mesures. node explorer.mjs <url> <largeur> <hauteur> [mobile]
import { brancher, pause } from "../../affiche-stand-mulhouse/navigateur/pilote.mjs";
const [url, l = "1440", h = "900", mobile = ""] = process.argv.slice(2);
const p = await brancher();
try {
  await p.taille(Number(l), Number(h), mobile === "mobile");
  await p.aller(url, 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  console.log(await p.eval(`document.querySelector('.ml-cfg-root') ? 'module ouvert' : 'pas de module'`));
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
