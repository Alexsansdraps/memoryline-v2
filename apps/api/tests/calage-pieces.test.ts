/**
 * Le calage d'une pièce, sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/calage-pieces.test.ts
 *
 * Le calage se règle au back-office dans le cadre 500×1000 du personnage : la
 * pièce y est posée comme une <image> 500×1000 (centrée sans déborder), puis
 * décalée en % du cadre et agrandie depuis son bas-centre. La boutique et
 * l'impression, elles, écrivent la transformation DANS le fichier de la pièce
 * (appliquerCalage). Le 27 octobre, les pièces dessinées en 1024×1536 (Femme 6,
 * les nouvelles coupes) tombaient ailleurs qu'au back-office : un t-shirt
 * plus bas et plus à droite, des coupes très loin de la tête. Ces essais
 * vérifient, point par point, que les deux calculs se rejoignent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BORNES_CALAGE,
  appliquerCalage,
  calagePropre,
  repereDuFichier,
  transformCalage,
  type CalagePiece,
} from "@memoryline/types";

/** Où le back-office pose un point du cadre une fois le calage appliqué. */
function auBackOffice(c: CalagePiece, x: number, y: number) {
  return {
    x: 250 + (x - 250) * c.scale + (c.dx / 100) * 500,
    y: 1000 + (y - 1000) * c.scale + (c.dy / 100) * 1000,
  };
}

/** Lit les trois premières opérations de transformCalage. */
function lire(transformation: string) {
  const n = [...transformation.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(
    (m) => Number(m[0]),
  );
  return { fx: n[0], fy: n[1], ax: n[2], ay: n[3], k: n[4] };
}

/**
 * Où la boutique pose un point du cadre : le point passe dans le repère du
 * fichier, y subit la transformation écrite, puis revient dans le cadre.
 */
function aLaBoutique(ouverture: string, c: CalagePiece, x: number, y: number) {
  const r = repereDuFichier(ouverture);
  const t = lire(transformCalage(c, r));
  const vx = r.minX + (x - r.margeX) / r.echelleX;
  const vy = r.minY + (y - r.margeY) / r.echelleY;
  const wx = t.ax + (vx - t.ax) * t.k + t.fx;
  const wy = t.ay + (vy - t.ay) * t.k + t.fy;
  return {
    x: (wx - r.minX) * r.echelleX + r.margeX,
    y: (wy - r.minY) * r.echelleY + r.margeY,
  };
}

const POINTS = [
  [250, 1000],
  [0, 0],
  [500, 125],
  [119, 412],
  [384, 681],
] as const;

function memesPlaces(ouverture: string, c: CalagePiece) {
  for (const [x, y] of POINTS) {
    const attendu = auBackOffice(c, x, y);
    const obtenu = aLaBoutique(ouverture, c, x, y);
    assert.ok(
      Math.abs(obtenu.x - attendu.x) < 1e-6 && Math.abs(obtenu.y - attendu.y) < 1e-6,
      `(${x}, ${y}) : boutique (${obtenu.x}, ${obtenu.y}), back-office (${attendu.x}, ${attendu.y})`,
    );
  }
}

// Calages réels de la prod au 27 octobre.
const TSHIRT_FEMME_6: CalagePiece = { dx: 0.14, dy: 1.94, scale: 1.066 };
const COUPE_28_FEMME_4: CalagePiece = { dx: -0.48, dy: -20.23, scale: 0.743 };

test("une pièce en 500×1000 garde exactement la transformation d'avant", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 1000"><path d="M0 0"/></svg>';
  const c = { dx: 2, dy: -10, scale: 0.8 };
  assert.equal(
    appliquerCalage(svg, c),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 1000">' +
      '<g transform="translate(10 -100) translate(250 1000) scale(0.8) translate(-250 -1000)">' +
      '<path d="M0 0"/></g></svg>',
  );
});

test("une pièce sans viewBox est prise pour un 500×1000", () => {
  assert.equal(
    transformCalage(COUPE_28_FEMME_4, repereDuFichier("<svg>")),
    transformCalage(COUPE_28_FEMME_4),
  );
});

test("une pièce en 1024×1536 tombe au même endroit qu'au back-office", () => {
  const ouverture =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">';
  memesPlaces(ouverture, TSHIRT_FEMME_6);
  memesPlaces(ouverture, COUPE_28_FEMME_4);
  // Le bas-centre du cadre est SOUS le dessin : le fichier, réduit à la
  // largeur du cadre, y est centré avec 125 de marge en haut et en bas.
  const t = lire(transformCalage(TSHIRT_FEMME_6, repereDuFichier(ouverture)));
  assert.ok(Math.abs(t.ax - 512) < 1e-9);
  assert.ok(Math.abs(t.ay - 1792) < 1e-9);
});

test("les animaux en 375×750 et 768×1152 suivent la même règle", () => {
  memesPlaces('<svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 375 749.999995">', COUPE_28_FEMME_4);
  memesPlaces('<svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 768 1151.999944">', TSHIRT_FEMME_6);
});

test("un fichier qui demande un autre ancrage est suivi", () => {
  const c = { dx: 3, dy: -4, scale: 1.2 };
  memesPlaces('<svg viewBox="0 0 1024 1536" preserveAspectRatio="xMidYMax meet">', c);
  memesPlaces('<svg viewBox="10 20 1024 1536" preserveAspectRatio="xMinYMin slice">', c);
  memesPlaces('<svg viewBox="0 0 1024 1536" preserveAspectRatio="none">', c);
  // Collé en bas : le bas-centre du cadre est le bas du dessin.
  const r = repereDuFichier('<svg viewBox="0 0 1024 1536" preserveAspectRatio="xMidYMax meet">');
  assert.equal(r.margeY, 250);
});

test("une coupe peut monter au-delà de la moitié du cadre", () => {
  // Le 27/10, « Hair bouclés courts » restait bloquée à −50 % sur une femme
  // de dos : réduite à 0,41, elle n'atteignait pas le haut de la tête.
  assert.deepEqual(calagePropre({ dx: -14.9, dy: -62, scale: 0.41 }), {
    dx: -14.9,
    dy: -62,
    scale: 0.41,
  });
  // Les bornes tiennent toujours : ni hors du cadre, ni taille absurde.
  assert.deepEqual(calagePropre({ dx: 250, dy: -250, scale: 9 }), {
    dx: BORNES_CALAGE.decalage,
    dy: -BORNES_CALAGE.decalage,
    scale: BORNES_CALAGE.tailleMax,
  });
});
