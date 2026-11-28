// L'en-tête entre 768 et 1440 px, avec et sans le bouton « Back-office »
// (A-FAIRE 0.6 et 1, « en-tête compact sous 1280 px » ; demande d'Alexandra
// du 28/11 : « finis le à faire sauf la partie personnages »).
//
// Le bouton n'existe que pour une session de back-office valide, et ce
// chantier n'a ni mot de passe ni compte BO : il est SIMULÉ, recopié tel quel
// de Base.astro (son bloc `{admin && (…)}`, classes comprises) puis posé à sa
// place, entre la loupe et le compte. Les classes Tailwind existent dans la
// feuille de style : Tailwind lit le source, pas la page rendue.
//
//   node mesures-entete.mjs [étiquette] [langues…]
//
// Écrit mesures-<étiquette>.json et des captures de l'en-tête dans ce dossier.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brancher, pause } from "./pilote.mjs";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, "../../..");
const SITE = process.env.SITE || "http://localhost:8080";
const [etiquette = "essai", ...languesDemandees] = process.argv.slice(2);
const LANGUES = languesDemandees.length ? languesDemandees : ["fr", "en", "de", "it", "es", "ja", "zh"];
const LARGEURS = process.env.LARGEURS
  ? process.env.LARGEURS.split(",").map(Number)
  : [768, 900, 1024, 1100, 1180, 1279, 1280, 1440];
/** Une feuille de style d'essai, posée sur chaque page avant la mesure (réglages à tâtons). */
const CSS_ESSAI = process.env.CSS_ESSAI ? readFileSync(process.env.CSS_ESSAI, "utf8") : "";

/** Le bouton du back-office, recopié du source (le bloc `{admin && (…)}`). */
function boutonBackOffice() {
  const src = readFileSync(resolve(racine, "apps/web/src/layouts/Base.astro"), "utf8");
  const debut = src.indexOf("{admin && (");
  if (debut < 0) throw new Error("bloc {admin && ( introuvable dans Base.astro");
  const ouverture = src.indexOf("<a", debut);
  const fin = src.indexOf("</a>", ouverture) + "</a>".length;
  let bloc = src.slice(ouverture, fin);
  bloc = bloc
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/href=\{lienBackOffice\}/, 'href="/bo"')
    .replace(/title=\{`[\s\S]*?`\}/, 'title="Back-office (essai)"');
  if (/[{}]/.test(bloc.replace(/viewBox="[^"]*"/, "")))
    throw new Error("le bloc du bouton porte encore une expression : " + bloc);
  return bloc;
}
const BOUTON_BO = boutonBackOffice();

/** Ce qu'on mesure dans la page (en-tête seulement). */
const MESURE = `(() => {
  const html = document.documentElement;
  const rangee = document.querySelector("header > div:last-of-type");
  const r = rangee.getBoundingClientRect();
  const st = getComputedStyle(rangee);
  const droiteUtile = r.right - parseFloat(st.paddingRight);
  const gaucheUtile = r.left + parseFloat(st.paddingLeft);
  const [gauche, recherche, icones] = rangee.children;
  const boite = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { g: Math.round(b.left), d: Math.round(b.right), l: Math.round(b.width), h: Math.round(b.height) }; };
  const visible = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  // Tout ce qui se voit dans la rangée (hors listes déroulantes fermées).
  const dehors = [];
  for (const el of rangee.querySelectorAll("a, summary, button, input, img, svg, form")) {
    if (!visible(el)) continue;
    if (el.closest(".ml-menu-mobile nav, .ml-langues-liste, #ml-q-panneau, details:not([open]) > div")) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.right > droiteUtile + 0.5 || b.left < gaucheUtile - 0.5 || b.right > html.clientWidth)
      dehors.push((el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30) + " [" + Math.round(b.left) + "→" + Math.round(b.right) + "]");
  }
  // Les entrées du menu de bureau : une seule ligne chacune ?
  const nav = gauche.querySelector("nav.hidden, nav[class*='md:flex']");
  // Une entrée sur deux lignes ou plus : sa hauteur dépasse une ligne et demie
  // de sa police (et non celle de la plus basse des entrées : à 768 px,
  // toutes se coupent).
  const entrees = nav && visible(nav) ? [...nav.children].map((e) => { const s = e.matches("details") ? e.querySelector("summary") : e; const lh = parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.5; return { t: s.textContent.trim(), h: s.getBoundingClientRect().height, lh }; }) : [];
  const coupees = entrees.filter((e) => e.h > e.lh * 1.5).map((e) => e.t);
  const champ = visible(recherche) ? boite(recherche) : null;
  // Ce qu'il faut au champ pour que son indication (« Rechercher une
  // affiche ») se lise en entier : le texte en gras 13 px mesuré, ses marges,
  // la loupe, le cadre, et 20 px pour la petite croix que Safari réserve
  // (c'est ce qui donnait les 230 px du commentaire de Base.astro en français).
  let besoinRecherche = 0;
  if (champ) {
    const i = recherche.querySelector("input"); const cs = getComputedStyle(i);
    const cv = document.createElement("canvas").getContext("2d");
    cv.font = "700 " + cs.fontSize + " " + cs.fontFamily;
    const form = i.closest("form");
    besoinRecherche = Math.ceil(cv.measureText(i.placeholder).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      + form.querySelector("button").getBoundingClientRect().width + parseFloat(getComputedStyle(form).borderLeftWidth) * 2 + 20);
  }
  // L'empreinte de la rangée : la boîte de chaque élément visible, pour
  // comparer avant et après au-dessus de 1280 px (rien ne doit y bouger).
  const empreinte = [...rangee.querySelectorAll("*")].filter((el) => visible(el) && !el.closest(".ml-langues-liste, #ml-q-panneau, .ml-menu-mobile nav")).map((el) => { const b = el.getBoundingClientRect(); return el.tagName + ":" + [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10).join(","); });
  const bo = rangee.querySelector('a[href="/bo"], a[rel="nofollow"][title^="Back-office"]');
  return {
    largeur: innerWidth,
    utile: Math.round(droiteUtile - gaucheUtile),
    defilementPage: html.scrollWidth > html.clientWidth,
    rangeeDeborde: rangee.scrollWidth > rangee.clientWidth + 0.5,
    dehors,
    gauche: boite(gauche),
    recherche: champ,
    besoinRecherche,
    rechercheTropEtroite: !!champ && champ.l < besoinRecherche,
    empreinte,
    icones: boite(icones),
    chevauchement: (champ && (boite(gauche).d > champ.g + 0.5 || champ.d > boite(icones).g + 0.5)) || (!champ && boite(gauche).d > boite(icones).g + 0.5),
    bo: bo && visible(bo) ? { ...boite(bo), texte: getComputedStyle(bo.querySelector("span") || bo).position !== "absolute" && /Back-office/.test(bo.innerText) } : null,
    coupees,
    hauteurEnTete: Math.round(document.querySelector("header").getBoundingClientRect().height),
  };
})()`;

const c = await brancher();
const resultats = [];
const dossierCaptures = resolve(ici, "captures");
mkdirSync(dossierCaptures, { recursive: true });
try {
  for (const langue of LANGUES) {
    const chemin = langue === "fr" ? "/" : `/${langue}`;
    for (const stand of [false, true]) {
      for (const largeur of LARGEURS) {
        await c.taille(largeur, 900);
        await c.aller(`${SITE}${chemin}${stand ? "?stand=1&accueil=1" : ""}`, 300);
        await c.attendre("!document.documentElement.classList.contains('ml-avec-accueil')", 4000);
        if (CSS_ESSAI)
          await c.eval(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(CSS_ESSAI)}; document.head.appendChild(s); return true; })()`);
        // Sans bouton (visiteuse), puis avec (administratrice) — jamais au
        // stand : le middleware y efface la session du back-office.
        for (const avecBo of stand ? [false] : [false, true]) {
          if (avecBo)
            await c.eval(`(() => {
              const loupe = document.getElementById("ml-q-loupe");
              loupe.insertAdjacentHTML("afterend", ${JSON.stringify(BOUTON_BO)});
              return true;
            })()`);
          await pause(80);
          const m = await c.eval(MESURE);
          const ko =
            m.defilementPage || m.rangeeDeborde || m.dehors.length > 0 || m.chevauchement || m.rechercheTropEtroite;
          resultats.push({ langue, stand, avecBo, ...m, ko });
          const nom = `${etiquette}-${langue}${stand ? "-stand" : ""}-${largeur}${avecBo ? "-bo" : ""}.png`;
          if (langue === "fr" || ko)
            await c.capture(resolve(dossierCaptures, nom), { x: 0, y: 0, width: largeur, height: m.hauteurEnTete + 40 });
          console.log(
            `${langue}${stand ? " stand" : "      "} ${String(largeur).padStart(4)} ${avecBo ? "BO " : "   "}` +
              ` ${ko ? "DÉBORDE" : "ok     "} gauche ${m.gauche.l} | recherche ${m.recherche ? m.recherche.l + "/" + m.besoinRecherche : "-"} | icônes ${m.icones.l}` +
              (m.bo ? ` (BO ${m.bo.l}${m.bo.texte ? " texte" : " icône"})` : "") +
              (m.coupees.length ? ` | coupées : ${m.coupees.join(" / ")}` : "") +
              (m.dehors.length ? ` | dehors : ${m.dehors.join(" ; ")}` : ""),
          );
        }
      }
    }
  }
} finally {
  writeFileSync(resolve(ici, `mesures-${etiquette}.json`), JSON.stringify(resultats, null, 1));
  await c.fermer();
}
const echecs = resultats.filter((r) => r.ko && r.largeur >= 768 && r.largeur <= 1280);
console.log(`\n${resultats.length} mesures, ${echecs.length} débordements entre 768 et 1280 px.`);
