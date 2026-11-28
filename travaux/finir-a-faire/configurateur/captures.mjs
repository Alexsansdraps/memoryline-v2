// Captures et mesures du chantier « configurateur » (28/11), avant et après :
//   node captures.mjs <avant|apres> [scénario…]
// Scénarios : classiques, barre, bulle, poignee, champ, emojis, motifs.
// Rien n'est écrit en base : le panier est bloqué par le pilote, et les
// cadres du site ne sont forcés que dans ce navigateur (forcerCadres).
import { writeFileSync, mkdirSync } from "node:fs";
import { brancher, pause } from "./pilote-cfg.mjs";

const [quand = "avant", ...voulus] = process.argv.slice(2);
const DOSSIER = `./${quand}/`;
mkdirSync(DOSSIER, { recursive: true });
const SITE = process.env.SITE || "http://localhost:8080";
const DOS = "mers-les-bains-baigneurs-affiche-personnalisee";
const FACE = "montagne-neige-affiche-personnalisee";
const STAND = "mulhouse-marche-de-noel-affiche-personnalisee";
const mesures = {};
const veut = (s) => voulus.length === 0 || voulus.includes(s);

const p = await brancher();

async function ouvrir(slug, { l = 1440, h = 900, mobile = false, stand = false, cadres = false } = {}) {
  p.forcerCadres(cadres);
  await p.taille(l, h, mobile);
  await p.aller(`${SITE}/affiches/${slug}${stand ? "?stand=1" : ""}`, 1500);
  // Le bouton naît avec l'îlot : on l'attend (premier passage du serveur de dev).
  await p.attendre("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Personnaliser' && b.getClientRects().length)", 30000);
  await p.bouton("Personnaliser");
  await p.apercuPret();
}

/** Ajoute `n` personnages (le premier proposé, validé tel quel). */
async function ajouterPersos(n) {
  for (let i = 0; i < n; i++) {
    await p.bouton("Ajouter un personnage");
    await p.attendre("document.querySelector('.ml-cfg-editor')");
    await pause(1200);
    await p.bouton("Valider mon personnage");
    await p.attendre("!document.querySelector('.ml-cfg-editor')");
    await pause(500);
  }
  await p.apercuPret();
}

/** Débords horizontaux de la barre du bas, de la fenêtre et de la page. */
const DEBORDS = `(() => {
  const barre = [...document.querySelectorAll('.ml-cfg-pied')].find(b => b.getClientRects().length);
  const panneau = document.querySelector('.ml-cfg-panel').getBoundingClientRect();
  const corps = document.querySelector('.ml-modal-body');
  const enfants = barre ? [...barre.children].filter(e => e.getClientRects().length).map(e => {
    const r = e.getBoundingClientRect();
    return { texte: e.textContent.trim().slice(0, 40), gauche: Math.round(r.left), droite: Math.round(r.right), haut: Math.round(r.height) };
  }) : [];
  return {
    largeurEcran: innerWidth,
    panneau: [Math.round(panneau.left), Math.round(panneau.right)],
    barre: barre ? { scroll: barre.scrollWidth, client: barre.clientWidth, droite: Math.round(barre.getBoundingClientRect().right), hauteur: Math.round(barre.getBoundingClientRect().height) } : null,
    enfants,
    fenetreDefileX: corps ? corps.scrollWidth > corps.clientWidth + 1 : null,
    pageDefileX: document.documentElement.scrollWidth > innerWidth + 1,
    sortDuPanneau: enfants.some(e => e.droite > panneau.right + 0.5 || e.gauche < panneau.left - 0.5),
  };
})()`;

try {
  /* ---- 0. Affiches classiques (de dos, de face) : doivent rester identiques ---- */
  if (veut("classiques")) {
    for (const [nom, slug] of [["dos", DOS], ["face", FACE]]) {
      await ouvrir(slug);
      await p.saisir(2, "Été 2025");
      await pause(400);
      await p.apercuPret();
      await p.capture(`${DOSSIER}classique-${nom}-etape1-apercu.png`, ".ml-cfg-poster");
      await p.capture(`${DOSSIER}classique-${nom}-etape1-panneau.png`, ".ml-cfg-panel");
      await p.bouton("2. Personnages");
      await pause(600);
      await ajouterPersos(2);
      await p.capture(`${DOSSIER}classique-${nom}-persos-apercu.png`, ".ml-cfg-poster");
      await p.capture(`${DOSSIER}classique-${nom}-persos-panneau.png`, ".ml-cfg-panel");
      await p.bouton("3. Format");
      await pause(600);
      await p.capture(`${DOSSIER}classique-${nom}-format-panneau.png`, ".ml-cfg-panel");
    }
    // Les mêmes, sur un téléphone.
    for (const [nom, slug] of [["dos", DOS], ["face", FACE]]) {
      await ouvrir(slug, { l: 390, h: 844, mobile: true });
      await p.saisir(2, "Été 2025");
      await pause(400);
      await p.apercuPret();
      await p.capture(`${DOSSIER}classique-${nom}-tel-apercu.png`, ".ml-cfg-poster");
      await p.capture(`${DOSSIER}classique-${nom}-tel-panneau.png`, ".ml-cfg-panel");
    }
  }

  /* ---- 1. La barre du bas à 360 px, cadre choisi ---- */
  if (veut("barre")) {
    const cas = [
      ["stand-motifs", STAND, { stand: true }, "4. Format"],
      ["stand-classique", DOS, { stand: true }, "3. Format"],
      ["site-cadres", DOS, { cadres: true }, "3. Format"],
    ];
    mesures.barre = {};
    for (const [nom, slug, opts, etape] of cas) {
      for (const l of [360, 320]) {
        await ouvrir(slug, { l, h: 740, mobile: true, ...opts });
        await p.bouton(etape);
        await pause(700);
        await p.bouton("A3", 0, ".ml-cfg-panel");
        await p.bouton("Cadre bois façon chêne", 0, ".ml-cfg-panel");
        await pause(700);
        mesures.barre[`${nom}-${l}`] = await p.eval(DEBORDS);
        await p.capture(`${DOSSIER}barre-${nom}-${l}.png`);
      }
    }
  }

  /* ---- 2. La bulle « Plus bas » sur un petit téléphone ---- */
  if (veut("bulle")) {
    mesures.bulle = {};
    for (const [l, h] of [[360, 640], [320, 568], [375, 667], [390, 844]]) {
      await ouvrir(DOS, { l, h, mobile: true });
      await p.bouton("2. Personnages");
      await pause(600);
      await p.bouton("Ajouter un personnage");
      await p.attendre("document.querySelector('.ml-cfg-editor')");
      // Le défilement de bouton() a pu descendre la fenêtre : on remonte, comme à l'arrivée.
      await p.eval("document.querySelector('.ml-modal-body').scrollTop = 0; 1");
      await pause(2500);
      mesures.bulle[`${l}x${h}`] = await p.eval(`(() => {
        const b = document.querySelector('.ml-cfg-invite-bouton');
        const visible = b && getComputedStyle(b.closest('.ml-cfg-invite')).visibility === 'visible' && getComputedStyle(b.closest('.ml-cfg-invite')).opacity !== '0';
        const rb = b ? b.getBoundingClientRect() : null;
        const grille = document.querySelector('.ml-cfg-grille-persos');
        const rg = grille.getBoundingClientRect();
        const couvertes = [...grille.querySelectorAll('[data-item]')].filter(v => {
          const r = v.getBoundingClientRect();
          const haut = Math.max(r.top, rg.top), bas = Math.min(r.bottom, rg.bottom);
          if (bas - haut < 2) return false;
          return rb && visible && r.left < rb.right && r.right > rb.left && haut < rb.bottom && bas > rb.top;
        }).length;
        return { visible, texte: b ? b.textContent.trim() : null, bulle: rb && [Math.round(rb.left), Math.round(rb.top), Math.round(rb.right), Math.round(rb.bottom)], couvertes };
      })()`);
      await p.capture(`${DOSSIER}bulle-${l}x${h}.png`);
    }
  }

  /* ---- 3. La poignée ⠿ ---- */
  if (veut("poignee")) {
    mesures.poignee = {};
    for (const [nom, l, h, mobile] of [["bureau", 1440, 900, false], ["tel", 390, 844, true]]) {
      await ouvrir(DOS, { l, h, mobile });
      await p.bouton("2. Personnages");
      await pause(600);
      await ajouterPersos(2);
      mesures.poignee[nom] = await p.eval(`(() => {
        const ligne = document.querySelector('[data-rang="0"]');
        const poignee = ligne.querySelector('[role=button]');
        const r = poignee.getBoundingClientRect();
        // La cible réelle : les points où un toucher atteint la poignée.
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        const touche = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === poignee || poignee.contains(e)); };
        let g = 0, d = 0, hh = 0, b = 0;
        while (touche(cx - g - 1, cy) && g < 60) g++;
        while (touche(cx + d + 1, cy) && d < 60) d++;
        while (touche(cx, cy - hh - 1) && hh < 60) hh++;
        while (touche(cx, cy + b + 1) && b < 60) b++;
        const rl = ligne.getBoundingClientRect();
        return { boite: [Math.round(r.width), Math.round(r.height)], cible: [g + d + 1, hh + b + 1], ligne: [Math.round(rl.width), Math.round(rl.height)], glyphe: [Math.round(r.left - rl.left), Math.round(r.top - rl.top)] };
      })()`);
      await p.capture(`${DOSSIER}poignee-${nom}-liste.png`, "[data-rang='0']");
      await p.capture(`${DOSSIER}poignee-${nom}-panneau.png`, ".ml-cfg-panel");
    }
  }

  /* ---- 4. Le champ d'une ligne longue ---- */
  if (veut("champ")) {
    mesures.champ = {};
    for (const [nom, l, h, mobile] of [["bureau", 1440, 900, false], ["tel", 360, 740, true]]) {
      await ouvrir(DOS, { l, h, mobile });
      await p.saisir(1, "Les vacances inoubliables de toute la famille Dupont-Martin");
      await pause(500);
      mesures.champ[nom] = await p.eval(`(() => { const c = document.querySelectorAll('.ml-cfg-panel textarea')[1];
        return { hauteur: Math.round(c.getBoundingClientRect().height), contenu: c.scrollHeight, client: c.clientHeight, rows: c.rows }; })()`);
      await p.capture(`${DOSSIER}champ-${nom}.png`, ".ml-cfg-field:nth-of-type(2)");
      await p.capture(`${DOSSIER}champ-${nom}-panneau.png`, ".ml-cfg-panel");
    }
  }

  /* ---- 5 et 6. Les emojis ---- */
  if (veut("emojis")) {
    await ouvrir(DOS);
    await p.saisir(1, "Joyeux Noël 🎄 🫩 🐦‍🔥");
    await p.saisir(2, "♥ ☀ ❄ ❤ 🎄 ⭐");
    await pause(800);
    await p.apercuPret();
    await p.capture(`${DOSSIER}emojis-apercu.png`, ".ml-cfg-poster");
    await p.capture(`${DOSSIER}emojis-panneau.png`, ".ml-cfg-panel");
    mesures.emojis = await p.eval(`(() => [...document.querySelectorAll('.ml-cfg-poster [data-rang-texte]')].map(l => ({ rang: l.dataset.rangTexte, html: l.innerHTML.length, texte: l.textContent, taille: l.style.fontSize })))()`);
  }

  /* ---- 7. L'affiche à motifs : couleur du texte suivant le fond ---- */
  if (veut("motifs")) {
    mesures.motifs = {};
    await ouvrir(STAND);
    for (const fond of ["Rouge Noël (uni)", "Crème (uni)", "Bleu ciel (uni)", "Neige (dégradé)", "Vichy rouge", "Cœurs alsaciens", "Aube rosée (dégradé)", "Crépuscule (dégradé)", "Bleu nuit (uni)"]) {
      try {
        await p.bouton(fond);
      } catch (e) {
        mesures.motifs[fond] = String(e.message);
        continue;
      }
      await pause(600);
      await p.apercuPret();
      mesures.motifs[fond] = await p.eval(`(() => { const l = document.querySelector('.ml-cfg-poster [data-rang-texte]'); return l ? getComputedStyle(l).color : null; })()`);
      await p.capture(`${DOSSIER}motifs-${fond.replace(/[^a-zA-Zéèê]+/g, "-")}.png`, ".ml-cfg-poster");
    }
  }

  writeFileSync(`${DOSSIER}mesures-${voulus.join("-") || "toutes"}.json`, JSON.stringify(mesures, null, 1));
  console.log(JSON.stringify(mesures, null, 1));
  console.log("erreurs : " + JSON.stringify(await p.erreurs()));
  console.log("panier retenu : " + JSON.stringify(p.panierRetenu));
} finally {
  p.fermer();
}
