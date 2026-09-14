/**
 * L'empilement d'un personnage : dans quel ordre ses couches se dessinent.
 *
 * L'ordre voulu, du bas vers le haut : le corps, le pantalon, le haut, les
 * cheveux, les accessoires (voir ORDRE_CALQUES).
 *
 * LA DIFFICULTÉ. Le dessin de base d'un personnage n'est pas un corps nu : il
 * arrive déjà habillé et coiffé, chaque pièce dans son groupe
 * (`<g id="Female_Bottoms_1">`, `Female_Clothes_1`, `Female_Hair_1`…). Quand
 * la cliente choisit une autre pièce, le groupe d'origine est masqué et la
 * nouvelle pièce, qui est un fichier à part, se pose par-dessus.
 *
 * Par-dessus TOUTE la base. C'était le défaut : un t-shirt choisi recouvrait
 * les cheveux d'origine — les cheveux longs passaient sous le col —, un jean
 * choisi recouvrait le bas du haut d'origine. L'ordre n'était respecté
 * qu'entre pièces choisies, jamais entre une pièce choisie et une pièce de la
 * base.
 *
 * LA SOLUTION. La base est découpée en tranches, intercalées entre les pièces
 * choisies à la place que leur donne l'ordre. Une tranche est une COPIE du
 * dessin de base où ne restent visibles que certains groupes. Pour une
 * cliente qui change seulement le t-shirt :
 *
 *   1. la base : corps + pantalon d'origine
 *   2. le t-shirt choisi
 *   3. la base : cheveux + accessoires d'origine
 *
 * Tant que rien n'est choisi, la base reste d'un seul tenant, inchangée : on
 * ne découpe que ce qui doit l'être.
 *
 * Même fonction pour l'aperçu et pour l'impression : l'affiche livrée ne peut
 * pas empiler autrement que celle que la cliente a validée.
 */
import { ORDRE_CALQUES } from "./config.js";

/** Une couche d'un personnage : une tranche de sa base, ou une pièce choisie. */
export type EtagePersonnage = { base: string } | { piece: string };

/**
 * Les familles de groupes du dessin de base, dans l'ordre d'empilement.
 *
 * Les noms viennent des fichiers d'origine : `Male_Bottoms_1`,
 * `Teenage_Girl_Hair_1`, `Boy_Accessories_2_2_`, parfois sans préfixe
 * (`Bottoms_1_1_`) ou sans « s » (`Male_Bottom_4`).
 *
 * Le mot doit COMMENCER un segment du nom (début, ou après « _ ») : un simple
 * « contient Hair » attrapait `Wheel_Chair_1` — le fauteuil de la femme en
 * fauteuil roulant disparaissait dès qu'on lui choisissait une coupe.
 *
 * `head` est l'ancien nom des accessoires (commandes de l'ancien site) : il
 * vise les mêmes groupes.
 */
const FAMILLES = [
  { slots: ["pants"], motif: /(?:^|_)Bottoms?(?![a-z])/i },
  { slots: ["clothes"], motif: /(?:^|_)Clothes(?![a-z])/i },
  { slots: ["hair"], motif: /(?:^|_)Hair(?![a-z])/i },
  { slots: ["head", "accessory"], motif: /(?:^|_)Accessor/i },
] as const;
type Famille = (typeof FAMILLES)[number];

/** La famille d'un groupe, d'après son id — aucune pour le corps. */
function familleDe(id: string): Famille | undefined {
  return FAMILLES.find((f) => f.motif.test(id));
}

/**
 * Le rang d'une famille dans l'ordre d'empilement : celui de son DERNIER
 * emplacement (« accessory » pour les accessoires, qui passent après « head »).
 */
function rangDe(f: Famille): number {
  return (ORDRE_CALQUES as readonly string[]).indexOf(f.slots[f.slots.length - 1]!);
}

/** Retire un éventuel attribut `visibility` avant d'en poser un. */
function sansVisibilite(attrs: string): string {
  return attrs.replace(/\svisibility\s*=\s*"[^"]*"/g, "");
}

/**
 * Où apparaissent les groupes de chaque famille dans le fichier (position du
 * premier et du dernier). Le fichier se dessine dans son ordre d'écriture : si
 * les cheveux y sont écrits avant le pantalon, une tranche qui montre les deux
 * poserait le pantalon sur les cheveux.
 */
function positionsDesFamilles(svg: string): Map<Famille, { premier: number; dernier: number }> {
  const positions = new Map<Famille, { premier: number; dernier: number }>();
  for (const m of svg.matchAll(/<g\b[^>]*?\sid\s*=\s*"([^"]*)"/g)) {
    const f = familleDe(m[1]!);
    if (!f) continue;
    const p = positions.get(f);
    if (p) p.dernier = m.index!;
    else positions.set(f, { premier: m.index!, dernier: m.index! });
  }
  return positions;
}

/**
 * Une tranche de la base : ne restent visibles que les familles `montrees`,
 * et le corps si `avecCorps`.
 *
 * On joue sur `visibility` et pas sur `display` : un enfant peut redevenir
 * visible sous un parent caché. La tranche du haut cache donc tout le dessin
 * d'un coup, à la racine, puis rallume ses seuls groupes — sans avoir à
 * savoir où se trouvent les dessins du corps, qui ne sont pas toujours
 * rangés dans un groupe.
 */
function tranche(
  svg: string,
  montrees: readonly Famille[],
  avecCorps: boolean,
  presentes: ReadonlySet<Famille>,
): string {
  const toutes = montrees.length === presentes.size;
  if (avecCorps && toutes) return svg;

  let out = svg.replace(/<g\b([^>]*?)(\/?)>/g, (m, attrs: string, fin: string) => {
    const id = /\sid\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    const f = id ? familleDe(id) : undefined;
    if (!f) return m;
    const visible = montrees.includes(f);
    // Sous une racine visible, un groupe montré n'a rien à déclarer.
    if (visible && avecCorps) return m;
    return `<g${sansVisibilite(attrs)} visibility="${visible ? "visible" : "hidden"}"${fin}>`;
  });
  if (!avecCorps) {
    out = out.replace(
      /<svg\b([^>]*?)(\/?)>/,
      (_m, attrs: string, fin: string) =>
        `<svg${sansVisibilite(attrs)} visibility="hidden"${fin}>`,
    );
  }
  return out;
}

/**
 * Les couches d'un personnage, du bas vers le haut.
 *
 * @param base    le SVG de base du personnage, brut
 * @param pieces  les emplacements qui portent une pièce choisie
 * @param retires les emplacements mis à « aucun » (sans casquette, sans
 *                coupe…) : leur groupe d'origine est masqué, rien ne le
 *                remplace
 */
export function empilerPersonnage(
  base: string,
  pieces: readonly string[],
  retires: readonly string[] = [],
): EtagePersonnage[] {
  const positions = positionsDesFamilles(base);
  const remplacee = (f: Famille) =>
    f.slots.some((s) => pieces.includes(s) || retires.includes(s));
  const presentes = new Set(positions.keys());

  const etages: EtagePersonnage[] = [];
  let lot: Famille[] = [];
  let avecCorps = true;
  let finDuLot = -1;

  const poserLaTranche = () => {
    if (avecCorps || lot.length)
      etages.push({ base: tranche(base, lot, avecCorps, presentes) });
    lot = [];
    avecCorps = false;
    finDuLot = -1;
  };

  for (let rang = 0; rang < ORDRE_CALQUES.length; rang++) {
    const slot = ORDRE_CALQUES[rang]!;
    if (pieces.includes(slot)) {
      poserLaTranche();
      etages.push({ piece: slot });
      continue;
    }
    for (const f of FAMILLES) {
      if (rangDe(f) !== rang || !presentes.has(f) || remplacee(f)) continue;
      const p = positions.get(f)!;
      // Écrite dans le fichier AVANT une famille déjà dans la tranche : elle
      // se dessinerait dessous. Elle ouvre donc une tranche au-dessus.
      if (lot.length && p.premier < finDuLot) poserLaTranche();
      lot.push(f);
      finDuLot = Math.max(finDuLot, p.dernier);
    }
  }
  poserLaTranche();

  // Un emplacement inconnu de l'ordre (pièce d'un ancien format) passe
  // au-dessus de tout, comme il le faisait.
  for (const slot of pieces)
    if (!(ORDRE_CALQUES as readonly string[]).includes(slot))
      etages.push({ piece: slot });

  return etages;
}
