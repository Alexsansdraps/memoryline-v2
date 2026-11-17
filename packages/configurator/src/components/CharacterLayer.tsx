/// <reference lib="dom" />
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
} from "solid-js";
import {
  appliquerCalage,
  calagePour,
  couleursDeLaBase,
  couleursDeLaPiece,
  empilerPersonnage,
  scopeSvgStyles,
} from "@memoryline/types";
import {
  NONE_ASSET,
  SLOT_ZORDER,
  dessinPourLEcran,
  findVariant,
  recolorForCharacter,
  type CharacterDTO,
  type SlotVariants,
  type SvgCache,
  type WorkingCharacter,
} from "../store";

/**
 * Fait remplir le conteneur (width/height 100%, display block) à la balise
 * <svg> racine. Toutes les couches d'un humain partagent le cadre 500×1000 :
 * empilées alignées, elles composent le personnage (cf. RENDU-SPEC.md).
 *
 * L'ALIGNEMENT EST CELUI DU FICHIER, et c'est une correction. Cette fonction
 * forçait `xMidYMax` — le dessin collé au BAS de son cadre. Pour un dessin au
 * format du cadre (1:2), l'ancrage ne change rien : il remplit tout. Mais cinq
 * personnages ne le sont pas — les chiens, dessinés en 2:3 — et eux se
 * posaient 12,5 % plus bas que partout ailleurs :
 *
 *   - l'écran de calage du back-office les centre dans leur cadre ;
 *   - le fichier d'impression aussi, parce que le SVG le demande lui-même
 *     (`xMidYMid meet`) et que sharp le respecte ;
 *   - seule la boutique les collait en bas.
 *
 * Résultat : un chien calé au pixel près au back-office descendait sur la
 * boutique, et la cliente le voyait plus bas que là où il serait IMPRIMÉ —
 * près de deux centimètres sur une affiche A3. En respectant l'alignement du
 * fichier, les trois rendus disent enfin la même chose.
 *
 * Les chiens n'ont aucune couche de vêtement à aligner (variantes vides) : ce
 * que l'ancrage forcé protégeait n'existe pas pour eux.
 */
function fillSvg(rawSvg: string): string {
  if (!rawSvg) return rawSvg;
  let out = rawSvg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    let a = attrs;
    // width/height/style = 100% (le viewBox d'origine est conservé)
    a = a
      .replace(/\swidth\s*=\s*"[^"]*"/g, "")
      .replace(/\sheight\s*=\s*"[^"]*"/g, "")
      .replace(/\sstyle\s*=\s*"[^"]*"/g, "");
    a = `${a} width="100%" height="100%" style="display:block;position:absolute;inset:0"`;
    return `<svg${a}>`;
  });
  return out;
}

/**
 * Les images d'un SVG de couche : celles qu'un dessin en pixels va chercher
 * au serveur, recoloriées (cf. dessinPourLEcran). Une couche vectorielle n'en
 * a pas et s'affiche aussitôt.
 */
function imagesDuSvg(svg: string): string[] {
  const urls: string[] = [];
  for (const m of svg.matchAll(/<image\b[^>]*?\s(?:xlink:)?href="([^"]+)"/g)) {
    const url = m[1]!.replace(/&amp;/g, "&");
    if (!url.startsWith("data:")) urls.push(url);
  }
  return urls;
}

/** Met des images dans le cache du navigateur ; résolu même si l'une échoue. */
function precharger(urls: string[]): Promise<void> {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((fini) => {
          const image = new Image();
          image.onload = () => fini();
          image.onerror = () => fini();
          image.src = url;
        }),
    ),
  ).then(() => undefined);
}

/**
 * Une couche du personnage qui ne se vide jamais (17/11 : « quand on change la
 * couleur des pantalons ça charge un peu, et on voit la meuf en string »).
 *
 * Une pièce dessinée en pixels est recoloriée par le serveur : sa nouvelle
 * image met un moment à venir. L'ancienne reste affichée pendant ce temps, et
 * la nouvelle ne prend sa place qu'une fois chargée (elle sort alors du
 * cache). Une couche vectorielle change aussitôt.
 */
function Couche(props: { svg: string; onAttente: (enAttente: boolean) => void }) {
  const [affiche, setAffiche] = createSignal("");
  // Chaque changement a son numéro : une image lente qui arrive après une
  // couleur plus récente ne la remplace pas.
  let generation = 0;
  createEffect(
    on(
      () => props.svg,
      (svg) => {
        const g = ++generation;
        const urls = imagesDuSvg(svg);
        if (!urls.length) {
          setAffiche(svg);
          props.onAttente(false);
          return;
        }
        props.onAttente(true);
        const poser = () => {
          if (g !== generation) return;
          generation++;
          setAffiche(svg);
          props.onAttente(false);
        };
        void precharger(urls).then(poser);
        // Une image qui ne vient pas ne bloque pas la couche indéfiniment.
        setTimeout(poser, 12_000);
      },
    ),
  );
  onCleanup(() => {
    generation++;
    props.onAttente(false);
  });
  return (
    <div
      class="ml-cfg-charlayer"
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={affiche()}
      style={{
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        "pointer-events": "none",
        "user-select": "none",
      }}
    />
  );
}

/**
 * Rend un personnage composé : sa base et les pièces choisies, toutes au même
 * cadre 500×1000, recoloriées avec les couleurs du perso, dans l'ordre corps →
 * pantalon → haut → cheveux → accessoires. La base est découpée en tranches
 * intercalées entre les pièces (cf. empilerPersonnage) : un t-shirt choisi
 * passe SOUS les cheveux d'origine. Positionné en % par le parent.
 */
export function CharacterStack(props: {
  character: WorkingCharacter;
  base: CharacterDTO | undefined;
  slots: SlotVariants | undefined;
  cache: SvgCache;
  /**
   * Racine de l'API, pour aller chercher l'image recolorée d'un personnage
   * dessiné en pixels (cf. dessinPourLEcran). Absente, ces personnages
   * s'affichent dans les couleurs de leur fichier — jamais faux, juste pas
   * recoloré.
   */
  assetBaseUrl?: string;
  /**
   * Montre un petit indicateur tant qu'une couche attend sa nouvelle image
   * (17/11). Pour le grand aperçu de l'éditeur, pas pour les vignettes.
   */
  indicateur?: boolean;
}) {
  // Scope CSS unique par instance : les <style> des SVG inlinés sont globaux
  // au document, sans scoping la dernière couche écrase les couleurs des
  // autres (cf. scopeSvgStyles).
  const uid = createUniqueId();

  /** SVG inline (string) de chaque couche, recolorié + ancré bas. */
  const layers = createMemo(() => {
    const out: { key: string; svg: string }[] = [];
    // Couleurs namespacées par couche (base:stN / clothes:stN…) : chaque
    // couche ne reçoit QUE les siennes, sinon les zones stN partagées entre
    // base et slots se recolorent mutuellement (cf. colorsForScope).
    const colors = props.character.colors;

    const slots = props.slots;
    const choisie = (slot: (typeof SLOT_ZORDER)[number]) =>
      findVariant(slots?.[slot] ?? [], props.character.assets[slot]);
    // Les emplacements qui portent une pièce choisie, et ceux mis à « aucun »
    // (sans casquette, sans coupe) : leur groupe d'origine disparaît de la
    // base, et seules les premières prennent sa place.
    const pieces = SLOT_ZORDER.filter((slot) => choisie(slot) !== undefined);
    const retires = SLOT_ZORDER.filter(
      (slot) => props.character.assets[slot] === NONE_ASSET,
    );

    const base = props.base;
    // Couleurs de la base : les défauts du back-office, puis celles du
    // client — la même fonction que le fichier d'impression.
    const couleursBase = couleursDeLaBase(colors, base);

    const fichier = base ? props.cache.raw[base.baseSvgUrl] : undefined;
    // Personnage dessiné en PIXELS : son image devient celle que le serveur a
    // recolorée. Remplacée AVANT le découpage en tranches, pour que la suite
    // ne voie qu'un dessin ordinaire — c'est aussi l'ordre que suit le
    // fichier d'impression.
    const brute =
      fichier && base
        ? dessinPourLEcran(
            fichier,
            couleursBase,
            base.baseCouleursImage,
            `/characters/${base.id}`,
            props.assetBaseUrl,
          )
        : fichier;
    // Base pas encore chargée (ou illisible) : les pièces seules, dans l'ordre.
    const etages = brute
      ? empilerPersonnage(brute, pieces, retires)
      : pieces.map((piece) => ({ piece }));

    etages.forEach((etage, i) => {
      if ("base" in etage) {
        out.push({
          key: `base:${i}`,
          svg: fillSvg(
            scopeSvgStyles(
              recolorForCharacter(etage.base, couleursBase),
              // Une portée par tranche : chacune porte son propre <style>.
              `${uid}-base-${i}`,
            ),
          ),
        });
        return;
      }
      const slot = etage.piece as (typeof SLOT_ZORDER)[number];
      const variant = choisie(slot);
      if (!variant) return;
      const fichierPiece = props.cache.raw[variant.svgUrl];
      if (fichierPiece === undefined || fichierPiece === "") return;
      const couleursPiece = couleursDeLaPiece(colors, slot, variant);
      // Une pièce dessinée en pixels se recolore comme un personnage.
      const raw = dessinPourLEcran(
        fichierPiece,
        couleursPiece,
        variant.couleursImage,
        `/pieces/${variant.id}`,
        props.assetBaseUrl,
      );
      out.push({
        // La clé est l'EMPLACEMENT, pas la pièce : changer de pantalon garde
        // la même couche, qui montre l'ancien jusqu'à ce que le nouveau soit
        // chargé (cf. Couche).
        key: slot,
        svg: fillSvg(
          scopeSvgStyles(
            // Calage de la pièce sur ce personnage : même fonction que
            // pour l'impression, l'aperçu ne peut donc pas mentir. Idem pour
            // les couleurs : les zones non proposées gardent leur défaut.
            appliquerCalage(
              recolorForCharacter(raw, couleursPiece),
              calagePour(props.base?.slotAdjust, slot, variant.position),
            ),
            `${uid}-${slot}-${variant.id}`,
          ),
        ),
      });
    });
    return out;
  });

  // Les couches par leur clé : une clé qui reste (même emplacement, autre
  // couleur ou autre pièce) garde son composant, qui gère le changement.
  const cles = createMemo(() => layers().map((l) => l.key));
  const svgDe = (cle: string) => layers().find((l) => l.key === cle)?.svg ?? "";
  // Les couches qui attendent leur nouvelle image, pour l'indicateur.
  const [enAttente, setEnAttente] = createSignal<ReadonlySet<string>>(new Set());
  const noter = (cle: string, oui: boolean) =>
    setEnAttente((avant) => {
      if (avant.has(cle) === oui) return avant;
      const apres = new Set(avant);
      if (oui) apres.add(cle);
      else apres.delete(cle);
      return apres;
    });

  return (
    <div class="ml-cfg-charstack">
      <For each={cles()}>
        {(cle) => <Couche svg={svgDe(cle)} onAttente={(oui) => noter(cle, oui)} />}
      </For>
      <Show when={props.indicateur && enAttente().size > 0}>
        <div
          class="ml-cfg-charstack-attente"
          role="status"
          aria-label="Chargement des couleurs…"
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            width: "26px",
            height: "26px",
            "border-radius": "50%",
            border: "3px solid rgba(17, 24, 39, 0.15)",
            "border-top-color": "rgba(17, 24, 39, 0.65)",
            animation: "ml-cfg-tourne 0.8s linear infinite",
            "pointer-events": "none",
          }}
        />
        <style>{"@keyframes ml-cfg-tourne{to{transform:rotate(360deg)}}"}</style>
      </Show>
    </div>
  );
}
