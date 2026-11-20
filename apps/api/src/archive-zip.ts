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
 *
 * Deux façons de l'écrire : `archiveZip`, depuis des octets déjà en mémoire
 * (les PDF d'une commande), et `archiveZipDepuisDisque`, en flux depuis des
 * fichiers rangés (les affiches de démonstration, plus bas).
 */
import { open } from "node:fs/promises";
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

/* -------------------------------------------------------------------------- */
/*  En flux, depuis le disque                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Un fichier déjà rangé sur le disque, à glisser dans une archive SANS le
 * charger en mémoire : sa taille et sa somme de contrôle ont été notées au
 * moment où il a été rangé.
 */
export interface FichierSurDisque {
  /** Son nom dans l'archive. Ramené à l'ASCII (voir plus bas). */
  nom: string;
  /** Où il est sur le disque. */
  chemin: string;
  /** Sa taille en octets, telle que rangée. */
  taille: number;
  /** Son CRC-32, calculé sur ces mêmes octets. */
  crc32: number;
  date?: Date;
  /**
   * Son numéro sur le disque (`stat().ino`) quand la liste a été faite. Un
   * fichier REMPLACÉ depuis — même nom, même taille, autre affiche — est
   * alors refusé, au lieu de partir sous une somme de contrôle qui n'est pas
   * la sienne : l'archive serait déclarée abîmée à l'ouverture.
   */
  ino?: number;
}

/** Une archive prête à partir : sa taille exacte, et ses octets à lire. */
export interface ArchiveEnFlux {
  /** En octets : c'est le Content-Length de la réponse. */
  taille: number;
  flux: ReadableStream<Uint8Array>;
}

/** Au-delà, il faudrait le format ZIP64, qu'on n'écrit pas. */
const LIMITE_OCTETS_ZIP = 0xffffffff;
/** 0xFFFF annonce un ZIP64 dans la fin d'archive : un fichier de moins. */
const LIMITE_FICHIERS_ZIP = 0xffff;

/** Ce qu'on lit d'un coup : assez pour le disque, peu pour la mémoire. */
const BLOC_DE_LECTURE = 1 << 20;

/**
 * Le nom d'une entrée, en ASCII imprimable.
 *
 * L'Explorateur de Windows ouvre les .zip sans lire le drapeau « noms en
 * UTF-8 » : un « é » y devient « Ă© ». Les noms des affiches de démonstration
 * sont déjà écrits sans accent ; ceci n'est qu'un filet, qui remplace aussi
 * les barres (un « / » rangerait le fichier dans un dossier de l'archive).
 */
function nomAscii(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\x20-\x7e]|[/\\]/g, "_")
      .trim() || "fichier"
  );
}

/**
 * L'archive de fichiers RANGÉS, envoyée en flux : chaque fichier est lu au
 * moment de partir, par blocs, et jamais chargé en entier.
 *
 * `archiveZip` veut tous les fichiers en mémoire avant d'écrire le premier
 * octet. C'est juste pour les deux ou trois PDF d'une commande ; pour un lot
 * d'affiches de démonstration, quarante A3 font 600 Mo de plus sur un serveur
 * qui en a quatre Go pour tout faire tourner.
 *
 * Ce qui rend le flux possible : la taille et le CRC-32 de chaque fichier sont
 * CONNUS d'avance (notés quand il a été rangé). L'en-tête de chaque entrée est
 * donc complet dès le départ — pas de « descripteur » après les octets, que
 * certains outils lisent mal —, et la taille totale se calcule avant d'avoir
 * rien lu : Σ(30 + nom + taille) + Σ(46 + nom) + 22. Elle part en
 * Content-Length, et le navigateur affiche une vraie barre d'avancement.
 *
 * Même disposition qu'`archiveZip`, à l'octet près (l'essai le vérifie) :
 * rangé sans compression, version 2.0, pas de ZIP64 (moins de 4 Go et de
 * 65 535 fichiers, sinon une erreur le dit).
 *
 * UN FICHIER QUI A CHANGÉ entre la liste et sa lecture (refait, effacé,
 * raccourci) interrompt le flux : le téléchargement échoue, visiblement,
 * plutôt que de livrer une archive au contenu faux. Les fichiers ne sont
 * ouverts qu'au moment de partir, un à la fois, et toujours refermés — y
 * compris quand le téléchargement est abandonné en route.
 */
export function archiveZipDepuisDisque(fichiers: FichierSurDisque[]): ArchiveEnFlux {
  if (fichiers.length >= LIMITE_FICHIERS_ZIP)
    throw new RangeError(
      `${fichiers.length} fichiers : une archive en compte au plus ${LIMITE_FICHIERS_ZIP - 1}.`,
    );

  interface Entree {
    nom: string;
    chemin: string;
    taille: number;
    ino: number | undefined;
    entete: Buffer;
    octetsNom: Buffer;
  }
  const entrees: Entree[] = [];
  const sommaire: Buffer[] = [];
  const pris = new Set<string>();
  let position = 0;

  for (const f of fichiers) {
    if (!Number.isSafeInteger(f.taille) || f.taille < 0)
      throw new RangeError(`taille impossible pour « ${f.nom} » : ${f.taille}`);
    const base = nomAscii(f.nom);
    let nom = base;
    for (let i = 2; pris.has(nom.toLowerCase()); i++)
      nom = base.replace(/(\.[^.]*)?$/, (ext) => `-${i}${ext ?? ""}`);
    pris.add(nom.toLowerCase());

    const octetsNom = Buffer.from(nom, "ascii");
    const { heure, jour } = dateDos(f.date ?? new Date());
    const somme = f.crc32 >>> 0;

    // En-tête local, complet : taille et somme sont connues d'avance.
    const entete = Buffer.alloc(30);
    entete.writeUInt32LE(0x04034b50, 0);
    entete.writeUInt16LE(20, 4); // version 2.0
    entete.writeUInt16LE(0x0800, 6); // noms en UTF-8 (l'ASCII en est)
    entete.writeUInt16LE(0, 8); // rangé, sans compression
    entete.writeUInt16LE(heure, 10);
    entete.writeUInt16LE(jour, 12);
    entete.writeUInt32LE(somme, 14);
    entete.writeUInt32LE(f.taille, 18);
    entete.writeUInt32LE(f.taille, 22);
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
    fiche.writeUInt32LE(f.taille, 20);
    fiche.writeUInt32LE(f.taille, 24);
    fiche.writeUInt16LE(octetsNom.length, 28);
    // extra, commentaire, disque, attributs : tous à zéro.
    fiche.writeUInt32LE(position, 42);
    sommaire.push(fiche, octetsNom);

    entrees.push({ nom, chemin: f.chemin, taille: f.taille, ino: f.ino, entete, octetsNom });
    position += entete.length + octetsNom.length + f.taille;
    if (position >= LIMITE_OCTETS_ZIP)
      throw new RangeError("l'archive dépasserait 4 Go : faites-en plusieurs.");
  }

  const tailleSommaire = sommaire.reduce((n, b) => n + b.length, 0);
  if (position + tailleSommaire >= LIMITE_OCTETS_ZIP)
    throw new RangeError("l'archive dépasserait 4 Go : faites-en plusieurs.");
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(tailleSommaire, 12);
  fin.writeUInt32LE(position, 16);

  async function* morceaux(): AsyncGenerator<Uint8Array, void, undefined> {
    for (const e of entrees) {
      yield e.entete;
      yield e.octetsNom;
      const fichier = await open(e.chemin, "r");
      try {
        const s = await fichier.stat();
        if (s.size !== e.taille || (e.ino !== undefined && s.ino !== e.ino))
          throw new Error(
            `« ${e.nom} » a changé depuis la liste de l'archive (refait ou remplacé) : relancez le téléchargement.`,
          );
        let lus = 0;
        while (lus < e.taille) {
          // Un tampon NEUF à chaque bloc : celui d'avant part peut-être encore
          // vers le réseau.
          const tampon = Buffer.allocUnsafe(Math.min(BLOC_DE_LECTURE, e.taille - lus));
          const { bytesRead } = await fichier.read(tampon, 0, tampon.length, lus);
          if (bytesRead === 0)
            throw new Error(
              `« ${e.nom} » a raccourci pendant l'envoi de l'archive : relancez le téléchargement.`,
            );
          lus += bytesRead;
          yield bytesRead === tampon.length ? tampon : tampon.subarray(0, bytesRead);
        }
      } finally {
        await fichier.close();
      }
    }
    yield* sommaire;
    yield fin;
  }

  const iterateur = morceaux();
  let abandonnee = false;
  const flux = new ReadableStream<Uint8Array>(
    {
      async pull(controleur) {
        let suivant: IteratorResult<Uint8Array, void>;
        try {
          suivant = await iterateur.next();
        } catch (e) {
          // Le flux s'arrête en erreur, et le téléchargement échoue : la
          // raison n'irait nulle part ailleurs qu'ici.
          console.warn("[zip] archive interrompue :", e instanceof Error ? e.message : e);
          throw e;
        }
        if (abandonnee) return;
        if (suivant.done) controleur.close();
        else controleur.enqueue(suivant.value);
      },
      async cancel() {
        // Téléchargement abandonné : le fichier en cours de lecture se referme
        // (le `finally` ci-dessus).
        abandonnee = true;
        await iterateur.return(undefined);
      },
    },
    // Rien n'est lu avant d'être demandé : une réponse jamais lue n'ouvre
    // aucun fichier.
    { highWaterMark: 0 },
  );

  return { taille: position + tailleSommaire + fin.length, flux };
}
