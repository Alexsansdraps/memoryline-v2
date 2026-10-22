/**
 * Les essais du filet de l'API (erreur-interne.ts), sans base de données.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/erreur-interne.test.ts
 *
 * Ils vérifient ce que le filet promet : une exception non rattrapée devient
 * un JSON neutre en 500 et laisse au journal la route et la pile ; une
 * HTTPException garde sa réponse ; une route qui répond elle-même n'est pas
 * touchée ; une sous-application montée par app.route() est couverte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  CODE_ERREUR_INTERNE,
  MESSAGE_ERREUR_INTERNE,
  repondreErreurInterne,
} from "../src/erreur-interne.js";

/** Ce que le filet écrit au journal, gardé au lieu d'être affiché. */
function journal(): { lignes: unknown[][]; rendre: () => void } {
  const lignes: unknown[][] = [];
  const avant = console.error;
  console.error = (...args: unknown[]) => {
    lignes.push(args);
  };
  return { lignes, rendre: () => (console.error = avant) };
}

function application(): Hono {
  const app = new Hono();
  app.onError(repondreErreurInterne);
  app.post("/orders", () => {
    throw new Error("relation « orders » : colonne inconnue");
  });
  app.get("/refus", (c) => c.json({ error: "panier vide", code: "panier_vide" }, 400));
  app.get("/panne-voulue", (c) => c.json({ error: "Stripe n'a pas répondu" }, 502));
  app.get("/trop-lourd", () => {
    throw new HTTPException(413, { message: "Photo trop lourde" });
  });
  // Une sous-application SANS gestionnaire à elle : elle retombe sur celui-ci.
  const sous = new Hono();
  sous.get("/leve", () => {
    throw new TypeError("x is undefined");
  });
  app.route("/sous", sous);
  return app;
}

test("exception non rattrapée : 500 en JSON neutre, la route et la pile au journal", async () => {
  const j = journal();
  try {
    const res = await application().request("/orders?email=cliente@example.com", { method: "POST" });
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await res.json(), {
      error: MESSAGE_ERREUR_INTERNE,
      code: CODE_ERREUR_INTERNE,
    });
    assert.equal(j.lignes.length, 1);
    const [entete, erreur] = j.lignes[0]!;
    assert.match(String(entete), /POST \/orders/);
    // Le chemin seul : la requête peut porter une adresse e-mail.
    assert.doesNotMatch(String(entete), /cliente@example\.com/);
    // L'erreur entière, pas seulement son message : c'est elle qui porte la pile.
    assert.ok(erreur instanceof Error);
    assert.match((erreur as Error).stack ?? "", /colonne inconnue/);
  } finally {
    j.rendre();
  }
});

test("le visiteur ne lit rien de la cause", async () => {
  const j = journal();
  try {
    const res = await application().request("/orders", { method: "POST" });
    assert.doesNotMatch(await res.text(), /colonne|relation|orders/);
  } finally {
    j.rendre();
  }
});

test("une HTTPException garde sa propre réponse", async () => {
  const j = journal();
  try {
    const res = await application().request("/trop-lourd");
    assert.equal(res.status, 413);
    assert.equal(await res.text(), "Photo trop lourde");
    // Un refus voulu n'est pas une panne : rien au journal.
    assert.equal(j.lignes.length, 0);
  } finally {
    j.rendre();
  }
});

test("une route qui répond elle-même n'est pas touchée", async () => {
  const j = journal();
  try {
    const refus = await application().request("/refus");
    assert.equal(refus.status, 400);
    assert.deepEqual(await refus.json(), { error: "panier vide", code: "panier_vide" });
    const panne = await application().request("/panne-voulue");
    assert.equal(panne.status, 502);
    assert.deepEqual(await panne.json(), { error: "Stripe n'a pas répondu" });
    assert.equal(j.lignes.length, 0);
  } finally {
    j.rendre();
  }
});

test("une sous-application montée par app.route() est couverte", async () => {
  const j = journal();
  try {
    const res = await application().request("/sous/leve");
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { code: string }).code, CODE_ERREUR_INTERNE);
    assert.match(String(j.lignes[0]?.[0]), /GET \/sous\/leve/);
  } finally {
    j.rendre();
  }
});
