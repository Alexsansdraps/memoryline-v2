/**
 * Les horaires d'un stand dictés en quelques mots (17/11) :
 *
 *   « on ne peut pas utiliser ChatGPT pour qu'elle fasse ses horaires en
 *   tapant du texte ? C'est trop galère » — « que ça modifie, tu vois ».
 *
 * Margaux écrit « fermé les lundis, le 24 jusqu'à 16 h, le 25 fermé » ; le
 * modèle reçoit le calendrier ACTUEL et la consigne, et rend le calendrier
 * complet mis à jour. Ce qui revient est relu par les mêmes règles que la
 * saisie à la main (horairesLus) avant d'être enregistré : une réponse
 * fantaisiste est refusée, jamais écrite.
 */
import {
  horairesLus,
  jourValide,
  type Creneau,
  type HorairesStand,
} from "@memoryline/types";

const OPENAI_BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const MODELES = [
  (process.env.OPENAI_MODELE_TRADUCTION ?? "").trim(),
  "gpt-5-mini",
  "gpt-4.1-mini",
  "gpt-4o-mini",
].filter(Boolean);

export class EchecHorairesIa extends Error {}

/** Le calendrier tel qu'on le montre au modèle, et tel qu'il le rend. */
interface CalendrierTexte {
  dateDebut: string | null;
  dateFin: string | null;
  matin: Creneau | null;
  apresMidi: Creneau | null;
  jours: ({ date: string; ferme?: boolean; matin?: Creneau | null; apresMidi?: Creneau | null })[];
}

const CONSIGNE = (aujourdhui: string) => `Tu tiens le calendrier d'un stand de marché de la boutique Memory Line.
Tu reçois le calendrier ACTUEL (JSON) et une consigne écrite par la commerçante, en français courant.
Applique la consigne au calendrier et renvoie le calendrier COMPLET mis à jour, en JSON, exactement sous cette forme :
{"dateDebut":"AAAA-MM-JJ" ou null,"dateFin":"AAAA-MM-JJ" ou null,"matin":{"de":"HH:MM","a":"HH:MM"} ou null,"apresMidi":{"de":"HH:MM","a":"HH:MM"} ou null,"jours":[{"date":"AAAA-MM-JJ","ferme":true} ou {"date":"AAAA-MM-JJ","matin":{"de":"HH:MM","a":"HH:MM"} ou null,"apresMidi":{"de":"HH:MM","a":"HH:MM"} ou null}]}
Règles :
- "matin" et "apresMidi" sont les horaires de base, recopiés sur chaque jour du stand. "jours" ne contient QUE les jours qui s'en écartent : fermés, ou à horaires différents.
- Garde tel quel tout ce que la consigne ne change pas.
- « Fermé les lundis » : chaque lundi entre dateDebut et dateFin est fermé.
- FORMAT D'UNE JOURNÉE NON-STOP (ouverte sans pause : « non-stop », « sans pause », « sans coupure », « en continu », « 10h-21h ») : TOUJOURS un seul créneau, dans "matin", du début du matin à la fin de l'après-midi, et "apresMidi" à null.
  Un jour passé en non-stop : {"date":"2026-11-21","matin":{"de":"10:00","a":"21:00"},"apresMidi":null}
  Des horaires de base non-stop : "matin":{"de":"11:00","a":"20:00"},"apresMidi":null
  Jamais deux créneaux qui se touchent (10:00-13:00 puis 13:00-21:00), et jamais ce créneau unique dans "apresMidi" avec "matin" à null : ce serait « fermé le matin ».
- « Le 24 en non-stop » sans heures : ce jour-là, de l'ouverture de son matin à la fermeture de son après-midi, tels qu'ils sont dans le calendrier actuel.
- « Tout en non-stop » (« non-stop tous les jours », « sans pause ») : les horaires de base deviennent un seul créneau dans "matin", de l'heure d'ouverture du matin ACTUELLE à l'heure de fermeture de l'après-midi ACTUELLE, et "apresMidi" à null. Chaque jour de "jours" qui a deux créneaux devient de même un seul créneau, du début de son matin à la fin de son après-midi. Les jours fermés restent fermés. Aucune autre heure ne change.
- « Fermé le matin » un jour : ce jour-là "matin" à null et l'après-midi garde ses heures. « Fermé l'après-midi » : "apresMidi" à null.
- N'invente jamais une heure ni un jour : ce que la consigne ne dit pas reste exactement comme dans le calendrier actuel.
- « Le 24 jusqu'à 16h » : ce jour-là seulement, le dernier créneau finit à 16:00 ; un créneau qui commencerait après 16:00 devient null.
- Les heures sur 24 h, « HH:MM ». Les dates « AAAA-MM-JJ » ; l'année se déduit d'aujourd'hui (${aujourdhui}) : une date déjà passée cette année est celle de l'année suivante.
- Le matin finit avant le début de l'après-midi.
- Réponds par le JSON seul.`;

const estCreneau = (x: unknown): x is Creneau =>
  !!x && typeof x === "object" && typeof (x as Creneau).de === "string" && typeof (x as Creneau).a === "string";

/**
 * Une journée sans pause, rangée comme le BO la lit (17/11) : un seul créneau
 * dans le matin, l'après-midi à null. L'IA la rend parfois en deux créneaux
 * qui se touchent (10:00–13:00 puis 13:00–21:00), ou tout entière dans
 * l'après-midi : le BO y lisait alors « Avec pause » ou « Matin fermé ».
 */
export function rangerNonStop(
  matin: unknown,
  apresMidi: unknown,
): { matin: unknown; apresMidi: unknown } {
  // Deux créneaux qui se touchent ou se chevauchent : une seule journée.
  if (estCreneau(matin) && estCreneau(apresMidi) && matin.a >= apresMidi.de)
    return { matin: { de: matin.de, a: apresMidi.a > matin.a ? apresMidi.a : matin.a }, apresMidi: null };
  // Un « après-midi » qui commence avant midi est la journée entière.
  if (!matin && estCreneau(apresMidi) && apresMidi.de < "12:00") return { matin: apresMidi, apresMidi: null };
  return { matin, apresMidi };
}

function versTexte(dateDebut: string | null, dateFin: string | null, h: HorairesStand | null): CalendrierTexte {
  return {
    dateDebut,
    dateFin,
    matin: h?.matin ?? null,
    apresMidi: h?.apresMidi ?? null,
    jours: Object.entries(h?.jours ?? {}).map(([date, j]) =>
      j.ferme ? { date, ferme: true } : { date, matin: j.matin ?? null, apresMidi: j.apresMidi ?? null },
    ),
  };
}

/**
 * Le calendrier mis à jour d'après la consigne, VÉRIFIÉ : dates valides et
 * dans l'ordre, horaires lisibles. Lève EchecHorairesIa avec une phrase à
 * montrer telle quelle.
 */
export async function horairesDepuisTexte(
  consigne: string,
  actuel: { dateDebut: string | null; dateFin: string | null; horaires: HorairesStand | null },
  aujourdhui: string,
): Promise<{ dateDebut: string | null; dateFin: string | null; horaires: HorairesStand }> {
  const cle = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!cle)
    throw new EchecHorairesIa("L'IA n'est pas branchée : il manque OPENAI_API_KEY dans les réglages du serveur.");
  const texte = consigne.trim().slice(0, 2000);
  if (!texte) throw new EchecHorairesIa("Écrivez d'abord les horaires, par exemple « fermé les lundis, le 24 jusqu'à 16 h ».");

  let derniere = "";
  for (const modele of MODELES) {
    let res: Response;
    try {
      res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modele,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CONSIGNE(aujourdhui) },
            {
              role: "user",
              content: JSON.stringify({
                aujourdhui,
                calendrierActuel: versTexte(actuel.dateDebut, actuel.dateFin, actuel.horaires),
                consigne: texte,
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new EchecHorairesIa("L'IA ne répond pas. Réessayez dans un instant.");
    }
    const corps = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      derniere = corps?.error?.message ?? `réponse ${res.status}`;
      if (res.status === 404 || corps?.error?.code === "model_not_found") continue;
      throw new EchecHorairesIa(`L'IA a refusé : ${derniere.slice(0, 200)}`);
    }
    let lu: Partial<CalendrierTexte>;
    try {
      lu = JSON.parse(corps?.choices?.[0]?.message?.content ?? "") as Partial<CalendrierTexte>;
    } catch {
      throw new EchecHorairesIa("La réponse de l'IA est illisible. Reformulez, ou réessayez.");
    }
    const dateDebut = lu.dateDebut ? String(lu.dateDebut) : null;
    const dateFin = lu.dateFin ? String(lu.dateFin) : null;
    if ((dateDebut && !jourValide(dateDebut)) || (dateFin && !jourValide(dateFin)) || !dateDebut !== !dateFin)
      throw new EchecHorairesIa("L'IA a rendu des dates incomplètes ou fausses. Précisez le premier et le dernier jour du stand.");
    if (dateDebut && dateFin && dateDebut > dateFin)
      throw new EchecHorairesIa("L'IA a rendu une date de fin avant la date de début. Reformulez les dates.");
    const jours: Record<string, unknown> = {};
    for (const j of Array.isArray(lu.jours) ? lu.jours : []) {
      if (!j || typeof j !== "object" || !jourValide(j.date)) continue;
      jours[j.date] = j.ferme ? { ferme: true } : rangerNonStop(j.matin ?? null, j.apresMidi ?? null);
    }
    const horaires = horairesLus(
      { ...rangerNonStop(lu.matin ?? null, lu.apresMidi ?? null), jours },
      dateDebut,
      dateFin,
    );
    if (typeof horaires === "string")
      throw new EchecHorairesIa(`L'IA a rendu un horaire impossible (${horaires}). Reformulez.`);
    return { dateDebut, dateFin, horaires };
  }
  throw new EchecHorairesIa(`Aucun modèle d'IA disponible sur ce compte OpenAI (${derniere.slice(0, 120)}).`);
}
