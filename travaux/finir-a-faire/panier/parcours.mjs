// Le résumé des lignes du panier (28/11, « Corriger 1 personnage ») : remplit
// un panier À LA TABLETTE (?stand=1) avec l'affiche du stand de Mulhouse
// (0, 1 et 2 personnages) et une affiche classique avec personnages, puis
// capture /panier?stand=1 (tablette) et /commande (site). JAMAIS de paiement,
// jamais « Valider mes affiches » : on s'arrête au panier.
//
// Chrome sans écran lancé à part, sur SON port (d'autres agents utilisent
// 9333, 9361, 9371) :
//   chrome.exe --headless=new --remote-debugging-port=9387 --user-data-dir=<dossier>
// puis, depuis ce dossier :
//   CDP_PORT=9387 node parcours.mjs vider
//   CDP_PORT=9387 node parcours.mjs stand <personnages> [motif]
//   CDP_PORT=9387 node parcours.mjs classique <personnages> [slug]
//   CDP_PORT=9387 node parcours.mjs capturer <préfixe> [langue]
import { brancher, pause } from "../../affiche-stand-mulhouse/navigateur/pilote.mjs";

const SITE = "http://localhost:8080";
const [cmd, a1, a2] = process.argv.slice(2);
const p = await brancher();

async function etape(nom) {
  await p.bouton(nom, 0, ".ml-cfg-etapes");
  await pause(600);
}
/** Clique un bouton du panneau par son title / aria-label exact (motifs, fonds, couleurs). */
async function choisir(titre) {
  const r = await p.eval(`(() => { const b = [...document.querySelectorAll('.ml-cfg-panel button')].find(b => b.title === ${JSON.stringify(titre)} || b.getAttribute('aria-label') === ${JSON.stringify(titre)});
    if (!b) return 'INTROUVABLE'; b.scrollIntoView({ block: 'center' }); b.click(); return 'ok'; })()`);
  if (r !== "ok") throw new Error("introuvable : " + titre);
  await pause(500);
}
async function ajouterPersonnages(n) {
  for (let i = 0; i < n; i++) {
    await p.bouton("Ajouter un personnage");
    await pause(1000);
    await p.bouton("Valider mon personnage");
    await pause(800);
  }
}
/**
 * « Valider l'affiche », puis attend la page du panier (tablette) ou de la
 * caisse. L'API locale redémarre quand d'autres agents modifient son code
 * (tsx watch) : un ajout qui tombe pendant un redémarrage répond 502, on
 * réessaie alors (trois fois au plus).
 */
async function valider() {
  for (let essai = 1; ; essai++) {
    await p.bouton("Valider l'affiche");
    try {
      await p.attendre("/\\/(commande|panier)/.test(location.pathname)", 20000);
      break;
    } catch (e) {
      if (essai >= 3) throw e;
      console.log("pas de passage au panier (essai " + essai + ") :", JSON.stringify(await p.erreurs()));
      await pause(8000);
    }
  }
  await pause(2500);
  console.log("arrivée :", await p.eval("location.pathname + location.search"));
}

try {
  await p.taille(1280, 900);
  if (cmd === "vider") {
    // Un panier neuf : la tablette en crée un au premier ajout.
    await p.aller(`${SITE}/?stand=1&accueil=1`, 1200);
    console.log(await p.eval("(() => { const v = localStorage.getItem('ml_cart_id'); localStorage.removeItem('ml_cart_id'); return 'ancien panier : ' + v; })()"));
  } else if (cmd === "stand") {
    const n = Number(a1 ?? 0);
    const motif = a2 ?? "Sapin de Noël";
    await p.aller(`${SITE}/affiches/mulhouse-marche-de-noel-affiche-personnalisee?stand=1`, 1500);
    await p.bouton("Personnaliser");
    await p.apercuPret();
    // Le motif : on parcourt les onglets jusqu'à le trouver.
    const onglets = await p.eval(
      "[...document.querySelectorAll('.ml-cfg-categories button')].map(b => b.textContent.trim())",
    );
    for (const o of onglets) {
      await p.bouton(o, 0, ".ml-cfg-categories");
      await pause(300);
      const motifs = await p.eval(
        "[...document.querySelectorAll('.ml-cfg-grille-motifs button')].map(b => b.title)",
      );
      if (motifs.includes(motif)) break;
    }
    await choisir(motif);
    await etape("3. Personnages");
    await ajouterPersonnages(n);
    await etape("4. Format");
    await valider();
  } else if (cmd === "classique") {
    const n = Number(a1 ?? 2);
    const slug = a2 ?? "saint-valery-sur-somme-eglise-affiche-personnalisee";
    await p.aller(`${SITE}/affiches/${slug}?stand=1`, 1500);
    await p.bouton("Personnaliser");
    await p.apercuPret();
    const etapes = await p.eval(
      "[...document.querySelectorAll('.ml-cfg-etapes button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())",
    );
    console.log("étapes :", JSON.stringify(etapes));
    await etape(etapes.find((e) => /Personnages/.test(e)));
    await ajouterPersonnages(n);
    await etape(etapes.find((e) => /Format/.test(e)));
    await valider();
  } else if (cmd === "capturer") {
    const prefixe = a1 ?? "essai";
    const langue = a2 && a2 !== "fr" ? `/${a2}` : "";
    // La tablette : /panier?stand=1.
    await p.taille(1280, 1000);
    await p.aller(`${SITE}${langue}/panier?stand=1`, 1500);
    await p.attendre("document.getElementById('ml-attente')?.hasAttribute('data-pret')", 15000);
    await p.attendre("document.querySelectorAll('.ml-cfg-poster').length > 0", 30000);
    await p.apercuPret(".ml-cfg-poster");
    await pause(1500);
    const lignes = await p.eval(
      "[...document.querySelectorAll('#ml-attente li.grid')].map(li => ({ titre: li.querySelector('h2')?.textContent.trim(), details: [...li.querySelectorAll('ul li')].map(x => x.textContent.trim()) }))",
    );
    console.log("TABLETTE", JSON.stringify(lignes, null, 1));
    await p.capture(`${prefixe}-tablette-panier.png`);
    // Le site : la caisse /commande (son récapitulatif).
    await p.aller(`${SITE}${langue}/commande`, 1500);
    await p.attendre("document.getElementById('ml-attente')?.hasAttribute('data-pret')", 15000);
    await p.attendre("document.querySelectorAll('aside .ml-cfg-poster').length > 0", 30000);
    await p.apercuPret("aside .ml-cfg-poster");
    await pause(1500);
    const recap = await p.eval(
      "[...document.querySelectorAll('aside li')].map(li => [...li.querySelectorAll('span.block')].map(s => s.textContent.trim()).join(' | ')).filter(Boolean)",
    );
    console.log("CAISSE", JSON.stringify(recap, null, 1));
    await p.capture(`${prefixe}-site-commande-recapitulatif.png`, "aside");
  } else if (cmd === "tablette") {
    // La page du panier de la tablette à sa vraie taille, en paysage puis en
    // portrait (dans la même session : la taille imposée tombe avec elle).
    const prefixe = a1 ?? "essai";
    for (const [l, h, sens] of [
      [1180, 820, "paysage"],
      [820, 1180, "portrait"],
    ]) {
      await p.taille(l, h, false);
      await p.aller(`${SITE}/panier?stand=1`, 1500);
      await p.attendre("document.querySelectorAll('#ml-attente .ml-cfg-poster').length === 4", 30000);
      await p.apercuPret("#ml-attente .ml-cfg-poster");
      await pause(1200);
      console.log(sens, await p.eval("innerWidth + 'x' + innerHeight"));
      await p.capture(`${prefixe}-tablette-${sens}-${l}x${h}.png`);
    }
  } else {
    console.log("commande inconnue : " + cmd);
    process.exitCode = 1;
  }
  const erreurs = await p.erreurs();
  if (erreurs.length) console.log("erreurs JS :", JSON.stringify(erreurs, null, 1));
} finally {
  p.fermer();
}
