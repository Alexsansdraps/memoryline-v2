/**
 * Une archive .zip, sans dépendance : « Tout télécharger » d'une commande.
 *
 * Pourquoi un .zip plutôt qu'un PDF fusionné : chaque affiche garde son
 * fichier et son NOM (« dupont_A3_bois.pdf »), celui qui dit, au moment
 * d'imprimer, quel papier charger et quel cadre sortir ; et un A4 et un A3 ne
 * se retrouvent pas dans le même document, que l'imprimante sortirait sur la
 * même feuille.
 *
 * Les fichiers y sont RANGÉS tels quels, sans compression (méthode « stored »)
 * : un PDF d'affiche est déjà compressé, le recompresser coûterait du calcul
 * pour quelques octets. Le format tient alors en trois enregistrements par
 * fichier — l'en-tête, les octets, la fiche du sommaire — et une fin
 * d'archive. Pas de ZIP64 : une commande pèse quelques dizaines de Mo, loin
 * des 4 Go qui l'exigeraient.
 */
import { crc32 } from "node:zlib";

export interface FichierArchive {
  nom: string;
  contenu: Uint8Array;
  date?: Date;
}

/** Date et heure au format MS-DOS, celui que lit tout outil de décompression. */
function dateDos(d: Date): { heure: number; jour: number } {
  const annee = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    heure: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    jour: ((annee - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * L'archive, en morceaux à envoyer dans l'ordre (rien n'est recopié : les
 * octets de chaque PDF partent tels qu'ils sont en mémoire). Deux fichiers du
 * même nom en reçoivent un second, numéroté, plutôt que de s'écraser l'un
 * l'autre à la décompression.
 */
export function archiveZip(fichiers: FichierArchive[]): Uint8Array[] {
  const morceaux: Uint8Array[] = [];
  const sommaire: Buffer[] = [];
  const pris = new Set<string>();
  let position = 0;

  for (const f of fichiers) {
    let nom = f.nom;
    for (let i = 2; pris.has(nom.toLowerCase()); i++)
      nom = f.nom.replace(/(\.[^.]*)?$/, (ext) => `-${i}${ext ?? ""}`);
    pris.add(nom.toLowerCase());

    const octetsNom = Buffer.from(nom, "utf8");
    const { heure, jour } = dateDos(f.date ?? new Date());
    const somme = crc32(f.contenu) >>> 0;
    const taille = f.contenu.length;

    // En-tête local.
    const entete = Buffer.alloc(30);
    entete.writeUInt32LE(0x04034b50, 0);
    entete.writeUInt16LE(20, 4); // version 2.0
    entete.writeUInt16LE(0x0800, 6); // noms en UTF-8
    entete.writeUInt16LE(0, 8); // rangé, sans compression
    entete.writeUInt16LE(heure, 10);
    entete.writeUInt16LE(jour, 12);
    entete.writeUInt32LE(somme, 14);
    entete.writeUInt32LE(taille, 18);
    entete.writeUInt32LE(taille, 22);
    entete.writeUInt16LE(octetsNom.length, 26);
    entete.writeUInt16LE(0, 28);

    // Sa fiche au sommaire, qui dit où le retrouver.
    const fiche = Buffer.alloc(46);
    fiche.writeUInt32LE(0x02014b50, 0);
    fiche.writeUInt16LE(20, 4);
    fiche.writeUInt16LE(20, 6);
    fiche.writeUInt16LE(0x0800, 8);
    fiche.writeUInt16LE(0, 10);
    fiche.writeUInt16LE(heure, 12);
    fiche.writeUInt16LE(jour, 14);
    fiche.writeUInt32LE(somme, 16);
    fiche.writeUInt32LE(taille, 20);
    fiche.writeUInt32LE(taille, 24);
    fiche.writeUInt16LE(octetsNom.length, 28);
    // extra, commentaire, disque, attributs : tous à zéro.
    fiche.writeUInt32LE(position, 42);
    sommaire.push(fiche, octetsNom);

    morceaux.push(entete, octetsNom, f.contenu);
    position += entete.length + octetsNom.length + taille;
  }

  const tailleSommaire = sommaire.reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(tailleSommaire, 12);
  fin.writeUInt32LE(position, 16);
  return [...morceaux, ...sommaire, fin];
}
