/**
 * « Continuer avec Google » (18/11) : le jeton d'identité n'est accepté que
 * pour nous, à temps, avec un e-mail vérifié par Google ; le retour ne mène
 * jamais hors du site ; sans identifiant client, tout dort.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adresseDeGoogle,
  cheminDeRetour,
  configGoogle,
  nouvelEssaiGoogle,
  profilDuJeton,
} from "../src/google-oauth.js";

const ID = "1234-abc.apps.googleusercontent.com";
const MAINTENANT = Date.UTC(2026, 10, 18, 12, 0, 0);

/** Un jeton au format de Google (la signature n'est pas lue : il arrive de Google en direct). */
function jeton(charge: Record<string, unknown>): string {
  const morceau = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${morceau({ alg: "RS256", typ: "JWT" })}.${morceau(charge)}.signature`;
}
const bon = {
  iss: "https://accounts.google.com",
  aud: ID,
  exp: MAINTENANT / 1000 + 600,
  email: "Cliente@Gmail.com",
  email_verified: true,
  given_name: "Léa",
  family_name: "Martin",
  name: "Léa Martin",
  sub: "1098",
};

test("un jeton de Google pour nous : le profil, e-mail en minuscules", () => {
  const p = profilDuJeton(jeton(bon), ID, MAINTENANT);
  assert.equal(p.email, "cliente@gmail.com");
  assert.equal(p.prenom, "Léa");
  assert.equal(p.nom, "Martin");
  assert.equal(p.nomComplet, "Léa Martin");
  assert.equal(profilDuJeton(jeton({ ...bon, iss: "accounts.google.com", email_verified: "true" }), ID, MAINTENANT).email, "cliente@gmail.com");
});

test("refusé : autre site, expiré, e-mail non vérifié, autre émetteur, illisible", () => {
  assert.throws(() => profilDuJeton(jeton({ ...bon, aud: "autre.apps.googleusercontent.com" }), ID, MAINTENANT));
  assert.throws(() => profilDuJeton(jeton({ ...bon, exp: MAINTENANT / 1000 - 1 }), ID, MAINTENANT));
  assert.throws(() => profilDuJeton(jeton({ ...bon, email_verified: false }), ID, MAINTENANT));
  assert.throws(() => profilDuJeton(jeton({ ...bon, email: "" }), ID, MAINTENANT));
  assert.throws(() => profilDuJeton(jeton({ ...bon, iss: "https://evil.example" }), ID, MAINTENANT));
  assert.throws(() => profilDuJeton("pas-un-jeton", ID, MAINTENANT));
});

test("le retour ne mène jamais hors du site", () => {
  assert.equal(cheminDeRetour("/commande"), "/commande");
  assert.equal(cheminDeRetour("/en/compte?x=1"), "/en/compte?x=1");
  for (const faux of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", null, undefined])
    assert.equal(cheminDeRetour(faux as string | null | undefined), "/compte", String(faux));
});

test("sans identifiant client, la connexion avec Google dort", () => {
  assert.equal(configGoogle({}), null);
  assert.equal(configGoogle({ GOOGLE_CLIENT_ID: ID, PUBLIC_ORIGIN: "https://memoryline.fr" }), null);
  const cfg = configGoogle({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: "s", PUBLIC_ORIGIN: "https://memoryline.fr/" });
  assert.equal(cfg?.retour, "https://memoryline.fr/api/compte/google/retour");
});

test("l'adresse de Google porte l'état, le défi PKCE et notre retour", () => {
  const cfg = configGoogle({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: "s", PUBLIC_ORIGIN: "https://memoryline.fr" })!;
  const essai = nouvelEssaiGoogle();
  const u = new URL(adresseDeGoogle(cfg, essai.etat, essai.defi));
  assert.equal(u.searchParams.get("client_id"), ID);
  assert.equal(u.searchParams.get("redirect_uri"), "https://memoryline.fr/api/compte/google/retour");
  assert.equal(u.searchParams.get("state"), essai.etat);
  assert.equal(u.searchParams.get("code_challenge"), essai.defi);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  assert.notEqual(essai.verificateur, essai.defi);
});
