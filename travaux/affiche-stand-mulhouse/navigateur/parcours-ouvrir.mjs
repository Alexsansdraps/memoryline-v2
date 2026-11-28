// Ouvre la fenêtre de l'affiche du stand et capture la page entière, à une
// taille donnée. node parcours-ouvrir.mjs <largeur> <hauteur> <préfixe> [mobile] [url]
import { brancher, pause } from "./pilote.mjs";

const [l = "1440", h = "900", prefixe = "reglages-ouverture", mobile = "", url] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();
try {
  await p.taille(Number(l), Number(h), mobile === "mobile");
  await p.aller(url || "http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee", 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  await pause(500);
  await p.capture(DOSSIER + prefixe + ".png");
  const info = await p.eval(`(() => {
    const pan = document.querySelector('.ml-modal-panel').getBoundingClientRect();
    const croix = document.querySelector('.ml-modal-close').getBoundingClientRect();
    const corps = document.querySelector('.ml-modal-body');
    const etapes = [...document.querySelectorAll('.ml-cfg-etape')].map(b => ({ t: b.textContent.trim(), coupe: b.firstElementChild.scrollWidth > b.firstElementChild.clientWidth + 1 }));
    return {
      panneau: [Math.round(pan.width), Math.round(pan.height)],
      croix: [Math.round(croix.left), Math.round(croix.top), Math.round(croix.right)],
      defileX: corps.scrollWidth > corps.clientWidth + 1,
      pageX: document.documentElement.scrollWidth > innerWidth + 1,
      etapes,
      affiche: Math.round(document.querySelector('.ml-cfg-poster').getBoundingClientRect().width),
    };
  })()`);
  console.log(JSON.stringify(info));
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
