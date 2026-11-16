/**
 * Le fuseau de la boutique, et les calculs de jour qui en dépendent.
 *
 * Une commande est un INSTANT (enregistré en temps universel) ; « le jour de
 * la vente », « ce mois-ci », « l'année de la facture » sont des questions
 * posées à Paris. Entre les deux il y a une ou deux heures selon la saison :
 * une vente à 23 h 30 un soir de marché reste le même jour en temps universel,
 * mais une vente à 0 h 30 y tombe LA VEILLE — et celle du 1er janvier à
 * 0 h 30, l'année d'avant.
 *
 * Ces fonctions ne lisent JAMAIS le fuseau du processus (TZ) : elles disent
 * Paris, que le serveur soit réglé sur Paris (docker-compose), sur UTC (un
 * lancement à la main, un conteneur de test) ou ailleurs. Le navigateur non
 * plus n'y est pour rien. Toutes passent par Intl, qui connaît les
 * changements d'heure (dernier dimanche de mars et d'octobre).
 *
 * Un jour s'écrit « 2026-11-20 » partout : c'est la forme d'un champ
 * `<input type="date">`, celle qui se trie comme du texte, et celle que
 * Postgres lit sans hésiter.
 */

/** Le fuseau qui fait foi pour la boutique : jours, mois, années, heures. */
export const FUSEAU_BOUTIQUE = "Europe/Paris";

/**
 * Les pièces d'une date à Paris. `hourCycle: "h23"` : sans lui, certains
 * moteurs écrivent minuit « 24 », et le jour lu serait celui d'avant.
 */
const PIECES_DE_PARIS = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSEAU_BOUTIQUE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface Pieces {
  annee: number;
  mois: number;
  jour: number;
  heure: number;
  minute: number;
  seconde: number;
}

function piecesAParis(d: Date): Pieces {
  const v: Record<string, number> = {};
  for (const p of PIECES_DE_PARIS.formatToParts(d))
    if (p.type !== "literal") v[p.type] = Number(p.value);
  return {
    annee: v.year ?? NaN,
    mois: v.month ?? NaN,
    jour: v.day ?? NaN,
    heure: (v.hour ?? NaN) % 24,
    minute: v.minute ?? NaN,
    seconde: v.second ?? NaN,
  };
}

const deux = (n: number) => String(n).padStart(2, "0");

/** Le jour à Paris d'un instant : « 2026-11-20 ». */
export function jourAParis(d: Date): string {
  const p = piecesAParis(d);
  return `${p.annee}-${deux(p.mois)}-${deux(p.jour)}`;
}

/**
 * L'année à Paris d'un instant. C'est elle qui numérote les factures
 * (F2026-0001) : une facture éditée le 1er janvier à 0 h 30 est de la
 * nouvelle année, même s'il n'est encore que 23 h 30 en temps universel.
 */
export function anneeAParis(d: Date): number {
  return piecesAParis(d).annee;
}

/**
 * Un instant écrit pour un champ `<input type="datetime-local">`, à l'heure de
 * Paris : « 2026-12-01T09:00 ». Le champ n'a pas de fuseau ; c'est celui de la
 * boutique qu'on y met, pas celui de la machine qui fabrique la page.
 */
export function champAParis(d: Date): string {
  const p = piecesAParis(d);
  return `${jourAParis(d)}T${deux(p.heure)}:${deux(p.minute)}`;
}

/**
 * L'avance de Paris sur le temps universel à cet instant, en millisecondes :
 * une heure l'hiver, deux l'été.
 */
function avanceDeParis(instant: number): number {
  const p = piecesAParis(new Date(instant));
  const aLaSeconde = instant - (((instant % 1000) + 1000) % 1000);
  return Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde) - aLaSeconde;
}

const FORME_HEURE_DE_PARIS =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

/**
 * Une heure de Paris écrite sans fuseau, convertie en instant.
 *
 * Accepte un jour seul (« 2026-11-20 », qui vaut minuit) ou une heure
 * (« 2026-11-20T09:30 », « 2026-11-20T23:59:59.999 ») — exactement ce que
 * renvoient `<input type="date">` et `<input type="datetime-local">`.
 *
 * `new Date("2026-11-20")` lit un jour seul en temps UNIVERSEL, et
 * `new Date("2026-11-20T09:30")` dans le fuseau de la machine : aucun des deux
 * ne dit Paris à coup sûr. Une promotion « jusqu'au 24 décembre » finissait
 * alors une ou deux heures trop tôt ou trop tard selon la machine.
 *
 * Null si le texte n'a pas la forme, ou si la date n'existe pas au calendrier
 * (« 2026-02-31 » n'est pas remplacé en silence par le 3 mars). Une heure qui
 * n'existe pas à Paris (2 h 30 la nuit du passage à l'heure d'été) donne
 * l'instant voisin ; une heure qui existe deux fois (2 h 30 la nuit du retour
 * à l'heure d'hiver), l'une des deux : aucune boutique n'y fixe rien.
 */
export function instantDeParis(texte: string): Date | null {
  const m = FORME_HEURE_DE_PARIS.exec(texte.trim());
  if (!m) return null;
  const [annee, mois, jour, heure, minute, seconde] = [1, 2, 3, 4, 5, 6].map((i) =>
    Number(m[i] ?? 0),
  ) as [number, number, number, number, number, number];
  const ms = Number((m[7] ?? "0").padEnd(3, "0"));
  if (heure > 23 || minute > 59 || seconde > 59) return null;
  const naif = Date.UTC(annee, mois - 1, jour, heure, minute, seconde, ms);
  const controle = new Date(naif);
  if (
    controle.getUTCFullYear() !== annee ||
    controle.getUTCMonth() !== mois - 1 ||
    controle.getUTCDate() !== jour
  )
    return null;
  // Deux passes : l'avance lue à l'heure « naïve » peut être celle de l'autre
  // côté d'un changement d'heure ; relue à l'instant trouvé, elle est la bonne.
  const essai = naif - avanceDeParis(naif);
  return new Date(naif - avanceDeParis(essai));
}

/** Un jour « 2026-11-20 » décalé de quelques jours de calendrier. */
export function decalerJour(jour: string, nbJours: number): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + nbJours);
  return d.toISOString().slice(0, 10);
}

/**
 * Les `nb` derniers jours de calendrier à Paris, le plus ancien d'abord, le
 * jour de `fin` en dernier.
 *
 * À compter « maintenant moins 24 h » plusieurs fois, la nuit du passage à
 * l'heure d'été sautait un jour et celle du retour en comptait un deux fois.
 */
export function derniersJoursAParis(fin: Date, nb: number): string[] {
  const dernier = jourAParis(fin);
  const jours: string[] = [];
  for (let i = nb - 1; i >= 0; i--) jours.push(decalerJour(dernier, -i));
  return jours;
}

/**
 * Le 1er du mois en cours à Paris, à minuit de Paris. Le 1er à 0 h 30, c'est
 * déjà le nouveau mois — en temps universel, ce serait encore l'ancien.
 */
export function debutDuMoisAParis(d: Date): Date {
  return instantDeParis(`${jourAParis(d).slice(0, 8)}01`)!;
}
