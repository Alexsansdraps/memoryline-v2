// Essai (chantier configurateur, 6) : ♥ ☀ ❄ ❤ suivis de VS16, dans les polices
// de l'affiche, avec ou sans police emoji explicite. Capture du résultat.
import { brancher, pause } from "./pilote-cfg.mjs";
const p = await brancher();
try {
  await p.taille(1000, 700);
  await p.aller("http://localhost:8080/affiches/mers-les-bains-baigneurs-affiche-personnalisee", 1500);
  await p.attendre("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Personnaliser')", 30000);
  await p.bouton("Personnaliser");
  await p.attendre("document.querySelector('.ml-cfg-poster')", 30000);
  await pause(3000);
  const r = await p.eval(`(async () => {
    const familles = ["'DM Serif Display', Georgia, 'Times New Roman', serif", "'Another Shabby', 'DM Serif Display', Georgia, 'Times New Roman', serif", "'Abril Fatface', 'DM Serif Display', Georgia, serif"];
    const boite = document.createElement('div');
    boite.id = 'essai-vs16';
    boite.style.cssText = 'position:fixed;left:0;top:0;width:1000px;background:#bcd;padding:10px;z-index:99999;font-size:40px;color:#fff';
    const lignes = [];
    for (const f of familles) {
      for (const [nom, texte, emojiFont] of [
        ['nu', '♥ ☀ ❄ ❤ 🎄 ⭐', false],
        ['vs16', '♥\\uFE0F ☀\\uFE0F ❄\\uFE0F ❤\\uFE0F 🎄 ⭐', false],
        ['police', '♥\\uFE0F ☀\\uFE0F ❄\\uFE0F ❤\\uFE0F 🎄 ⭐', true],
      ]) {
        const d = document.createElement('div');
        d.style.fontFamily = f;
        d.style.whiteSpace = 'nowrap';
        d.style.letterSpacing = '0.05em';
        d.style.lineHeight = '1.2';
        const etiquette = document.createElement('span');
        etiquette.textContent = nom + ' ';
        etiquette.style.fontSize = '14px';
        d.append(etiquette);
        const s = document.createElement('span');
        s.textContent = JSON.parse('"' + texte + '"');
        if (emojiFont) s.style.fontFamily = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
        d.append(s);
        boite.append(d);
        lignes.push([nom, f.slice(0, 20), Math.round(s.getBoundingClientRect().width), Math.round(d.getBoundingClientRect().height)]);
      }
    }
    document.body.append(boite);
    await new Promise(r => setTimeout(r, 500));
    return lignes.map((l, i) => { const d = boite.children[i]; return [...l, Math.round(d.getBoundingClientRect().height), Math.round(d.lastChild.getBoundingClientRect().width)]; });
  })()`);
  console.log(JSON.stringify(r));
  await p.capture("./avant/essai-vs16.png", "#essai-vs16");
} finally {
  p.fermer();
}
