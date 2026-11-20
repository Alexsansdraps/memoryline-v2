/**
 * L'archive .zip envoyée en flux depuis le disque (archiveZipDepuisDisque),
 * sans base de données :
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/archive-zip.test.ts
 *
 * Elle sert le « Tout télécharger » des affiches de démonstration. Ces essais
 * vérifient qu'elle écrit, octet pour octet, la même archive qu'`archiveZip`
 * (celle des commandes, depuis la mémoire) ; que la taille annoncée d'avance
 * — le Content-Length — est exacte ; et qu'un fichier refait ou raccourci
 * entre la liste et l'envoi interrompt le flux au lieu de livrer une archive
 * fausse. Tous les fichiers sont factices, dans un dossier temporaire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import {
  archiveZip,
  archiveZipDepuisDisque,
  type FichierSurDisque,
} from "../src/archive-zip.js";

const date = new Date(2026, 10, 20, 18, 42, 10);

/** Des octets reconnaissables, pas tous pareils. */
function contenu(taille: number, graine: number): Buffer {
  const b = Buffer.alloc(taille);
  for (let i = 0; i < taille; i++) b[i] = (i * 31 + graine * 7) & 0xff;
  return b;
}

async function lireTout(flux: ReadableStream<Uint8Array>): Promise<Buffer> {
  const morceaux: Uint8Array[] = [];
  const lecteur = flux.getReader();
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
  }
  return Buffer.concat(morceaux);
}

async function dossierDEssai(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zip-essai-"));
}

async function surDisque(
  dossier: string,
  nom: string,
  octets: Buffer,
): Promise<FichierSurDisque> {
  const chemin = join(dossier, nom.replace(/[^a-z0-9.]/gi, "_"));
  await writeFile(chemin, octets);
  return {
    nom,
    chemin,
    taille: octets.length,
    crc32: crc32(octets) >>> 0,
    date,
    ino: (await stat(chemin)).ino,
  };
}

test("même archive qu'archiveZip, à l'octet près, et taille annoncée exacte", async () => {
  const dossier = await dossierDEssai();
  try {
    // Un fichier vide, un petit, et un de plus d'un bloc de lecture (1 Mo).
    const octets = [contenu(0, 1), contenu(1234, 2), contenu((1 << 20) * 2 + 17, 3)];
    const noms = ["vide.pdf", "petit_A4_famille_1.pdf", "grand_A3_couple_2.pdf"];
    const fichiers = await Promise.all(noms.map((n, i) => surDisque(dossier, n, octets[i]!)));

    const { taille, flux } = archiveZipDepuisDisque(fichiers);
    const lue = await lireTout(flux);
    const attendue = Buffer.concat(
      archiveZip(noms.map((nom, i) => ({ nom, contenu: octets[i]!, date }))),
    );
    assert.equal(lue.length, taille, "Content-Length exact");
    assert.equal(lue.length, attendue.length);
    assert.ok(lue.equals(attendue), "mêmes octets qu'archiveZip");
    // Σ(30 + nom + taille) + Σ(46 + nom) + 22
    const calcul =
      noms.reduce((s, n, i) => s + 30 + n.length + octets[i]!.length + 46 + n.length, 0) + 22;
    assert.equal(taille, calcul);
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

test("noms ramenés à l'ASCII, et un nom en double reçoit un numéro", async () => {
  const dossier = await dossierDEssai();
  try {
    const a = await surDisque(dossier, "Réunion_é.pdf", contenu(10, 4));
    const b = await surDisque(dossier, "Reunion_e.pdf", contenu(11, 5));
    const c = await surDisque(dossier, "sous/dossier.pdf", contenu(12, 6));
    const lue = await lireTout(archiveZipDepuisDisque([a, b, { ...c, chemin: c.chemin }]).flux);
    const texte = lue.toString("latin1");
    assert.ok(texte.includes("Reunion_e.pdf"));
    assert.ok(texte.includes("Reunion_e-2.pdf"), "le second du même nom est numéroté");
    assert.ok(texte.includes("sous_dossier.pdf"), "pas de dossier glissé dans l'archive");
    assert.ok(!/[^\x00-\x7f]/.test(lue.subarray(30, 30 + 13).toString("latin1")));
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

test("un fichier refait après la liste (autre fichier, même taille) interrompt le flux", async () => {
  const dossier = await dossierDEssai();
  try {
    const f = await surDisque(dossier, "affiche.pdf", contenu(5000, 7));
    // Refait : écrit à côté puis renommé, comme le fait l'ouvrier.
    await writeFile(`${f.chemin}.tmp`, contenu(5000, 8));
    await rename(`${f.chemin}.tmp`, f.chemin);
    await assert.rejects(lireTout(archiveZipDepuisDisque([f]).flux), /a changé/);
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

test("un fichier raccourci ou effacé après la liste interrompt le flux", async () => {
  const dossier = await dossierDEssai();
  try {
    const f = await surDisque(dossier, "affiche.pdf", contenu(5000, 9));
    await writeFile(f.chemin, contenu(4000, 9));
    await assert.rejects(lireTout(archiveZipDepuisDisque([{ ...f, ino: undefined }]).flux), /a changé/);
    await rm(f.chemin);
    await assert.rejects(lireTout(archiveZipDepuisDisque([f]).flux), /ENOENT/);
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

test("un téléchargement abandonné en route s'arrête sans erreur", async () => {
  const dossier = await dossierDEssai();
  try {
    const f = await surDisque(dossier, "grand.pdf", contenu((1 << 20) * 3, 10));
    const { flux } = archiveZipDepuisDisque([f]);
    const lecteur = flux.getReader();
    // L'en-tête, le nom, puis un premier bloc du fichier : il est ouvert.
    for (let i = 0; i < 3; i++) assert.equal((await lecteur.read()).done, false);
    await lecteur.cancel();
    // Le fichier a été refermé : on peut l'effacer et le dossier avec.
    await rm(f.chemin);
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

test("rien n'est ouvert tant que rien n'est lu", async () => {
  // Un fichier qui n'existe pas : la création de l'archive ne le lit pas.
  const { taille } = archiveZipDepuisDisque([
    { nom: "absent.pdf", chemin: "/nulle/part/absent.pdf", taille: 3, crc32: 0 },
  ]);
  assert.equal(taille, 30 + 10 + 3 + 46 + 10 + 22);
});

test("au-delà de 4 Go, une erreur le dit plutôt qu'une archive fausse", () => {
  assert.throws(
    () =>
      archiveZipDepuisDisque([
        { nom: "a.pdf", chemin: "/x/a.pdf", taille: 0xffff_ff00, crc32: 0 },
        { nom: "b.pdf", chemin: "/x/b.pdf", taille: 0x1000, crc32: 0 },
      ]),
    /4 Go/,
  );
});
