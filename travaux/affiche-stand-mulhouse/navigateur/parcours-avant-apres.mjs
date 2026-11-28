// Contrôle « aucune régression » (G9) : le même parcours qu'avant-apres.sh —
// l'aperçu d'une affiche classique avec ses textes par défaut, puis avec un
// personnage — dans UNE seule session, à une taille fixe (l'aperçu y fait
// 410 px de large, comme les captures « avant » du 28/11 à 1 h 20).
// node parcours-avant-apres.mjs <slug> <préfixe> [largeur] [hauteur]
import { brancher, pause } from "./pilote.mjs";

const [slug, prefixe, l = "1440", h = "906"] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();
try {
  await p.taille(Number(l), Number(h));
  await p.aller(`http://localhost:8080/affiches/${slug}`, 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  await pause(2000);
  await p.capture(DOSSIER + prefixe + "-textes.png", ".ml-cfg-poster");
  await p.bouton("2. Personnages", 0, ".ml-cfg-etapes");
  await pause(800);
  await p.bouton("Ajouter un personnage");
  await pause(1800);
  await p.bouton("Valider mon personnage");
  await p.attendre("document.querySelector('.ml-cfg-poster .ml-cfg-charstack svg')");
  await pause(2500);
  await p.capture(DOSSIER + prefixe + "-1perso.png", ".ml-cfg-poster");
  const panneau = await p.eval("document.querySelector('.ml-cfg-panel')?.textContent || ''");
  console.log(
    JSON.stringify({
      motif: /Motif/.test(panneau),
      place: /Place du texte/.test(panneau),
      etapes: await p.eval("[...document.querySelectorAll('.ml-cfg-etape')].map(b => b.textContent.trim())"),
      pleinEcran: await p.eval("!!document.querySelector('.ml-modal-plein-ecran')"),
    }),
  );
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
