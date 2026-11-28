/// <reference lib="dom" />
import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js";

/**
 * De combien réduire chaque ligne de texte d'une affiche pour qu'elle tienne
 * dans la largeur du bloc — la règle du fichier d'impression (apps/api/src/
 * pdf.ts, buildTextSvg), appliquée à l'écran.
 *
 * Une ligne trop longue n'est jamais repliée : elle est réduite, juste assez
 * pour tenir, et la cliente voit ce qui sortira de l'imprimante. L'aperçu la
 * repliait (« SAINT-VALERY-SUR- » / « SOMME ») quand le papier la gardait
 * sur une ligne, un peu plus petite : deux affiches différentes pour une
 * même commande.
 *
 * La mesure est celle du navigateur — l'avance du texte, espacement des
 * lettres compris —, comparée à la largeur du bloc, marges ôtées. Comme
 * tout s'y mesure en `cqw`, la réduction ne dépend pas de la taille de
 * l'aperçu : le même nombre vaut sur un téléphone et sur un grand écran.
 *
 * Chaque ligne se repère à `data-rang-texte` (son rang parmi les lignes
 * remplies) et chacun de ses morceaux coupés à la main à `data-sous-ligne` :
 * c'est le plus long morceau qui décide, comme à l'impression. On mesure
 * les morceaux un à un, et non la ligne entière : ils sont des blocs, larges
 * comme le bloc de texte quel que soit leur contenu.
 *
 * @param couches les calques qui portent des lignes (l'aperçu n'en a qu'un ;
 *   l'affiche tirée d'une photo en a deux, lignes empilées et lignes posées).
 * @param suivre ce dont dépend la largeur des lignes (textes, polices) :
 *   une mesure est refaite à chaque changement.
 * @returns la réduction (0 à 1) d'une ligne, par rang.
 */
export function createReductionDesLignes(
  couches: () => readonly (HTMLElement | undefined)[],
  suivre: () => unknown,
): (rang: number) => number {
  const [reductions, setReductions] = createSignal<Readonly<Record<number, number>>>({});
  /**
   * Suit la taille des calques : un aperçu caché puis montré (téléphone)
   * doit être remesuré. Un calque peut n'apparaître qu'avec la première
   * ligne tapée : chacun est observé dès qu'on le rencontre.
   */
  let observateur: ResizeObserver | null = null;
  const observes = new WeakSet<HTMLElement>();

  function mesurer() {
    const actuelles = untrack(reductions);
    const nouvelles: Record<number, number> = {};
    for (const couche of couches()) {
      if (!couche) continue;
      if (observateur && !observes.has(couche)) {
        observes.add(couche);
        observateur.observe(couche);
      }
      const style = getComputedStyle(couche);
      const place =
        couche.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // Calque caché (aperçu replié sur un téléphone) : rien à mesurer, on
      // garde ce qu'on savait ; l'observateur de taille relancera la mesure.
      if (!(place > 0)) return;
      // L'échelle à laquelle le calque est DESSINÉ (28/11, Alexandra : « titre
      // croppé à droite » dans « Voir sur un mur »). `place` est une largeur
      // de mise en page, alors que la mesure des lignes, plus bas, est celle
      // de l'écran — transformations comprises. L'affiche au mur est
      // dessinée à 480 px puis réduite d'un bloc (ApercuAuMur, `scale`) : ses
      // lignes, mesurées trois fois plus petites qu'elles ne sont, n'étaient
      // jamais réduites et sortaient de l'affiche. On ramène la mesure à
      // l'échelle de la mise en page ; sans transformation, rien ne change
      // (l'écart d'arrondi entre les deux largeurs reste sous 1 %).
      const dessinee = couche.getBoundingClientRect().width;
      if (!(dessinee > 0)) return;
      const brute = dessinee / couche.offsetWidth;
      const echelle = Number.isFinite(brute) && Math.abs(brute - 1) > 0.01 ? brute : 1;
      for (const ligne of Array.from(couche.querySelectorAll("[data-rang-texte]"))) {
        const rang = Number((ligne as HTMLElement).dataset.rangTexte);
        let large = 0;
        for (const morceau of Array.from(ligne.querySelectorAll("[data-sous-ligne]"))) {
          const plage = document.createRange();
          plage.selectNodeContents(morceau);
          large = Math.max(large, plage.getBoundingClientRect().width / echelle);
        }
        if (!(large > 0)) continue;
        // La largeur qu'elle aurait sans réduction : à une taille près, elle
        // est proportionnelle à la taille, et la ligne est déjà réduite de
        // `actuelles[rang]`.
        const naturelle = large / (actuelles[rang] ?? 1);
        nouvelles[rang] = Math.min(1, place / naturelle);
      }
    }
    const rangs = new Set([...Object.keys(actuelles), ...Object.keys(nouvelles)]);
    // Un écart d'un millième ne se voit pas, et réécrire relancerait la mesure.
    const change = [...rangs].some(
      (r) => Math.abs((actuelles[+r] ?? 1) - (nouvelles[+r] ?? 1)) > 0.001,
    );
    if (change) setReductions(nouvelles);
  }

  createEffect(() => {
    suivre();
    mesurer();
  });

  onMount(() => {
    // Une police qui arrive après coup change la largeur des lignes.
    const polices = typeof document !== "undefined" ? document.fonts : undefined;
    void polices?.ready.then(mesurer);
    polices?.addEventListener("loadingdone", mesurer);
    // Mesure remise à l'image suivante : réduire une ligne change la hauteur
    // du calque observé, et le navigateur signale une boucle (« ResizeObserver
    // loop ») si on le fait dans la notification elle-même.
    if (typeof ResizeObserver !== "undefined")
      observateur = new ResizeObserver(() => requestAnimationFrame(mesurer));
    mesurer();
    onCleanup(() => {
      polices?.removeEventListener("loadingdone", mesurer);
      observateur?.disconnect();
      observateur = null;
    });
  });

  return (rang) => reductions()[rang] ?? 1;
}
