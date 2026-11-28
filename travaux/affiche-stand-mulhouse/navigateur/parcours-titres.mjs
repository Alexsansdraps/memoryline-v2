// « titre croppé à droite » (demande 6 du 28/11) : les 47 noms de motifs en
// ligne 1, en GRANDE taille, texte en haut puis en bas — chacun doit tenir
// dans la largeur utile de l'affiche (marges de 6 %), dans l'aperçu du module
// et dans « Voir sur un mur » (les plus longs).
// node parcours-titres.mjs [préfixe]
import { brancher, pause } from "./pilote.mjs";

const [prefixe = "reglages-titres"] = process.argv.slice(2);
const DOSSIER = "../captures/";
const p = await brancher();

/** Les marges de la ligne 1 dans un aperçu, en fractions de sa largeur. */
const MARGES = (sel) => `(() => {
  const a = document.querySelector(${JSON.stringify(sel)});
  if (!a) return null;
  const b = a.getBoundingClientRect();
  const l = [...a.querySelectorAll('[data-rang-texte="0"]')].find(x => x.offsetParent !== null || x.getClientRects().length);
  if (!l) return null;
  // L'encre de la ligne : la réunion de ses morceaux de texte (les blocs
  // [data-sous-ligne] font toute la largeur du calque, eux).
  let g = Infinity, d = -Infinity;
  for (const s of l.querySelectorAll('span')) { const r = document.createRange(); r.selectNodeContents(s); const x = r.getBoundingClientRect(); if (x.width) { g = Math.min(g, x.left); d = Math.max(d, x.right); } }
  return { texte: l.textContent, gauche: +((g - b.left) / b.width).toFixed(3), droite: +((b.right - d) / b.width).toFixed(3), taille: l.style.fontSize };
})()`;

try {
  await p.taille(1440, 900);
  await p.aller("http://localhost:8080/affiches/mulhouse-marche-de-noel-affiche-personnalisee", 1500);
  await p.bouton("Personnaliser");
  await p.apercuPret();
  // La ligne 1 en « Grand ».
  await p.bouton("2. Texte", 0, ".ml-cfg-etapes");
  await pause(400);
  await p.bouton("Grand", 0);
  await pause(300);
  const resultats = [];
  for (const place of ["En haut", "En bas"]) {
    await p.bouton("2. Texte", 0, ".ml-cfg-etapes");
    await pause(300);
    await p.bouton(place);
    await p.bouton("1. Motif et fond", 0, ".ml-cfg-etapes");
    await pause(400);
    const onglets = await p.eval("[...document.querySelectorAll('.ml-cfg-categories button')].map(b => b.textContent.trim())");
    for (const o of onglets) {
      await p.bouton(o, 0, ".ml-cfg-categories");
      await pause(250);
      const titres = await p.eval("[...document.querySelectorAll('.ml-cfg-grille-motifs button')].map(b => b.title)");
      for (const t of titres) {
        await p.eval(`(() => { const b = [...document.querySelectorAll('.ml-cfg-grille-motifs button')].find(b => b.title === ${JSON.stringify(t)}); b.click(); return 1; })()`);
        await pause(350);
        const m = await p.eval(MARGES(".ml-cfg-root .ml-cfg-poster"));
        resultats.push({ place, ...m });
      }
    }
  }
  const coupes = resultats.filter((r) => r.gauche < 0.05 || r.droite < 0.05);
  console.log("lignes mesurées :", resultats.length, "— hors de la largeur utile :", coupes.length);
  for (const r of coupes) console.log("  COUPÉ", JSON.stringify(r));
  const plusLongs = [...resultats].sort((a, b) => a.gauche - b.gauche).slice(0, 4);
  console.log("les plus larges :", JSON.stringify(plusLongs));

  // « Voir sur un mur » avec le plus long, texte en bas puis en haut.
  for (const place of ["En bas", "En haut"]) {
    await p.bouton("2. Texte", 0, ".ml-cfg-etapes");
    await pause(300);
    await p.bouton(place);
    await p.bouton("1. Motif et fond", 0, ".ml-cfg-etapes");
    await pause(300);
    await p.bouton("Gourmandises", 0, ".ml-cfg-categories");
    await pause(300);
    await p.eval(`(() => { [...document.querySelectorAll('.ml-cfg-grille-motifs button')].find(b => /Bonhomme/.test(b.title)).click(); return 1; })()`);
    await pause(600);
    await p.apercuPret(".ml-cfg-root .ml-cfg-poster");
    await p.capture(`${DOSSIER}${prefixe}-module-${place === "En bas" ? "bas" : "haut"}.png`, ".ml-cfg-root .ml-cfg-poster");
    await p.bouton("Voir sur un mur");
    await p.attendre("document.querySelector('.ml-mur-affiche .ml-cfg-poster')");
    await pause(2500);
    await p.capture(`${DOSSIER}${prefixe}-mur-${place === "En bas" ? "bas" : "haut"}.png`, ".ml-mur-affiche", 4);
    console.log("mur", place, JSON.stringify(await p.eval(MARGES(".ml-mur-affiche .ml-cfg-poster"))));
    await p.eval("[...document.querySelectorAll('[aria-labelledby=\"ml-mur-titre\"] button')].find(b => /ermer/.test(b.getAttribute('aria-label') || ''))?.click(); 1");
    await pause(600);
  }
  console.log(JSON.stringify(await p.erreurs()));
} finally {
  p.fermer();
}
