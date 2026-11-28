// « Voir sur un mur » sur une affiche CLASSIQUE à long titre (demande 6 du
// 28/11) : le titre est-il coupé ? Les personnages sont-ils à leur place ?
// node parcours-mur-classique.mjs <slug> <préfixe des captures> [personnage]
import { brancher, pause } from "./pilote.mjs";

const [slug = "saint-valery-sur-somme-2-affiche-personnalisee", prefixe = "reglages-mur-classique", perso] =
  process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();
try {
  await p.taille(1440, 900);
  await p.aller(`http://localhost:8080/affiches/${slug}`, 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  if (perso) {
    await p.bouton("2. Personnages");
    await pause(600);
    await p.bouton("Ajouter un personnage");
    await pause(1500);
    await p.bouton("Valider mon personnage");
    await p.attendre("document.querySelector('.ml-cfg-poster .ml-cfg-charstack svg')");
    await pause(800);
  }
  await p.capture(DOSSIER + prefixe + "-apercu.png", ".ml-cfg-poster");
  await p.bouton("Voir sur un mur");
  await p.attendre("document.querySelector('.ml-mur-affiche .ml-cfg-poster')");
  await pause(2500);
  await p.capture(DOSSIER + prefixe + "-mur.png", ".ml-mur-affiche");
  const mesure = await p.eval(`(() => {
    const a = document.querySelector('.ml-mur-affiche .ml-cfg-poster');
    const b = a.getBoundingClientRect();
    return [...a.querySelectorAll('[data-rang-texte]')].map((l) => {
      const r = document.createRange(); r.selectNodeContents(l); const x = r.getBoundingClientRect();
      return { rang: l.dataset.rangTexte, gauche: Math.round(x.left - b.left), droite: Math.round(b.right - x.right), taille: l.style.fontSize };
    });
  })()`);
  console.log(JSON.stringify(mesure));
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
