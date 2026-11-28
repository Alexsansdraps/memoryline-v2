/**
 * La mise en page de l'affiche à motifs du stand de Mulhouse (28/11,
 * packages/configurator/src/mise-en-page-motif.ts) — sans base. Alexandra :
 * « c'est perso sur le muret tout le temps » : les personnages restent assis
 * sur le muret, le motif au-dessus d'eux ; le texte en haut au-dessus du
 * motif, en bas entre le motif et les têtes (jamais sur une tête).
 *
 * Sur le poste (le module du configurateur ne se résout pas depuis le
 * conteneur de l'API) :
 *   cd apps/api && npx tsx --test tests/mise-en-page-motif.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  basDuTexteEnBas,
  ECART_BLOCS,
  hauteurTexteEnBas,
  hauteurTexteEnHaut,
  placementDuMotif,
  placesTexteEnBas,
} from "../../../packages/configurator/src/mise-en-page-motif.ts";
import { HAUT_DU_TEXTE, LARGEUR_CADRE_PERSONNAGE } from "../../../packages/types/src/index.ts";

const lignes = [
  { value: "HÔTEL DE VILLE", font: "dm-serif-display" },
  { value: "Marché de Noël de Mulhouse", font: "another-shabby" },
];
/** Le haut du dessin d'une femme assise seule, de dos (0,78 de la hauteur). */
const TETE_SEULE = 0.78;

test("texte en haut, sans personnage : le motif sous le texte, jusqu'à la marge du bas", () => {
  const p = placementDuMotif({ lignes, enBas: false, hautsPersonnages: [], proportion: 1.06 });
  const haut = HAUT_DU_TEXTE + hauteurTexteEnHaut(lignes) + ECART_BLOCS;
  const place = 1 - HAUT_DU_TEXTE - haut;
  assert.ok(Math.abs(p.y - (haut + place / 2)) < 1e-3);
  // Assez de place : la largeur maximale (0,8 de l'affiche).
  assert.ok(Math.abs(p.scale * LARGEUR_CADRE_PERSONNAGE - 0.8) < 1e-3);
});

test("texte en haut, avec personnages : le dessin du motif s'arrête au-dessus des têtes", () => {
  const proportion = 1.06;
  const p = placementDuMotif({ lignes, enBas: false, hautsPersonnages: [TETE_SEULE], proportion });
  const largeur = p.scale * LARGEUR_CADRE_PERSONNAGE; // fraction de la largeur
  const hauteur = (largeur * proportion) / Math.SQRT2; // fraction de la hauteur
  assert.ok(p.y + hauteur / 2 <= TETE_SEULE - ECART_BLOCS + 1e-3, "le motif touche une tête");
  assert.ok(p.y - hauteur / 2 >= HAUT_DU_TEXTE + hauteurTexteEnHaut(lignes) + ECART_BLOCS - 1e-3, "le motif touche le texte");
});

test("texte en bas : au-dessus des têtes, le motif au-dessus du texte ; sans personne, en bas", () => {
  // Sans personnage : le bas du bloc à la marge du bas.
  assert.equal(basDuTexteEnBas([]), 1 - HAUT_DU_TEXTE);
  const seul = placesTexteEnBas(lignes);
  assert.equal(seul.length, 2);
  assert.ok(seul.every((l) => l.x === 0.5));
  // Avec des têtes : le bloc juste au-dessus de la plus haute.
  const bas = basDuTexteEnBas([TETE_SEULE, 0.8]);
  assert.ok(Math.abs(bas - (TETE_SEULE - ECART_BLOCS)) < 1e-9);
  const places = placesTexteEnBas(lignes, bas);
  const hauteur = hauteurTexteEnBas(lignes);
  // La dernière ligne finit au-dessus des têtes, la première commence plus haut.
  assert.ok(places[1]!.y < bas && places[0]!.y > bas - hauteur);
  const proportion = 0.7;
  const p = placementDuMotif({ lignes, enBas: true, hautsPersonnages: [TETE_SEULE, 0.8], proportion });
  const largeur = p.scale * LARGEUR_CADRE_PERSONNAGE;
  const hMotif = (largeur * proportion) / Math.SQRT2;
  assert.ok(p.y + hMotif / 2 <= bas - hauteur - ECART_BLOCS + 1e-3, "le motif touche le texte");
  assert.ok(p.y - hMotif / 2 >= HAUT_DU_TEXTE - 1e-3, "le motif sort par le haut");
});

test("un motif très haut rapetisse au lieu de déborder ; le facteur du BO ne fait que réduire", () => {
  const p = placementDuMotif({ lignes, enBas: false, hautsPersonnages: [0.7], proportion: 1.9 });
  const hMotif = (p.scale * LARGEUR_CADRE_PERSONNAGE * 1.9) / Math.SQRT2;
  const haut = HAUT_DU_TEXTE + hauteurTexteEnHaut(lignes) + ECART_BLOCS;
  assert.ok(hMotif <= 0.7 - ECART_BLOCS - haut + 1e-3);
  const reduit = placementDuMotif({ lignes, enBas: false, hautsPersonnages: [], proportion: 1, facteur: 0.5 });
  const plein = placementDuMotif({ lignes, enBas: false, hautsPersonnages: [], proportion: 1, facteur: 3 });
  assert.ok(reduit.scale < plein.scale);
  assert.ok(Math.abs(plein.scale * LARGEUR_CADRE_PERSONNAGE - 0.8) < 1e-3);
});
