/**
 * PayPal répond-il, et de quel côté ?
 *
 * Un moyen de paiement mal branché ne dit rien : le bouton est simplement
 * absent de la boutique, et on cherche pendant une heure si c'est la clé, le
 * fichier de réglages, ou le serveur qui n'a pas redémarré. Ce script pose la
 * question à PayPal lui-même et rend une réponse en français.
 *
 * Il interroge les DEUX environnements, parce que la confusion la plus
 * fréquente n'est pas d'avoir une mauvaise clé : c'est d'avoir la bonne, mais
 * celle de l'autre côté. Le bac à sable et le compte réel ont des identifiants
 * entièrement séparés, et chacun refuse ceux de l'autre.
 *
 * Il ne crée aucun paiement, ne déplace pas un centime, et n'affiche jamais
 * vos identifiants.
 *
 * IL NE LIT QUE LE .env. Les identifiants saisis dans BO › Réglages ›
 * Paiements passent devant ceux du .env : pour ceux-là, c'est le bouton
 * « Vérifier » de l'écran qui pose la même question à PayPal.
 *
 * Usage :
 *   pnpm --filter @memoryline/api run verifier:paypal
 */
const ID = (process.env.PAYPAL_CLIENT_ID ?? "").trim();
const SECRET = (process.env.PAYPAL_SECRET ?? "").trim();
const ENV_CHOISI = (process.env.PAYPAL_ENV ?? "").trim().toLowerCase();

const SERVEURS = [
  { nom: "bac à sable", cle: "sandbox", base: "https://api-m.sandbox.paypal.com" },
  { nom: "compte réel", cle: "live", base: "https://api-m.paypal.com" },
] as const;

function manque(quoi: string): never {
  console.error(`✖ ${quoi}`);
  console.error(
    "\n  Le fichier de réglages est « .env », à la racine du projet. Il lui faut :\n" +
      "    PAYPAL_CLIENT_ID=votre_identifiant\n" +
      "    PAYPAL_SECRET=votre_secret\n" +
      "    PAYPAL_ENV=sandbox        (ou « live » pour encaisser vraiment)\n\n" +
      "  Les valeurs se prennent sur developer.paypal.com, dans « Apps & Credentials ».\n" +
      "  Attention à l'onglet : Sandbox et Live ont chacun leurs propres identifiants.",
  );
  process.exit(1);
}

async function reconnu(base: string): Promise<boolean> {
  const auth = Buffer.from(`${ID}:${SECRET}`).toString("base64");
  try {
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log(
    "Ce script ne lit que le .env. Les identifiants saisis dans BO › Réglages › Paiements\n" +
      "passent devant : pour eux, utilisez le bouton « Vérifier » de l'écran.\n",
  );
  if (!ID && !SECRET) manque("Aucun identifiant PayPal n'est renseigné.");
  if (!ID) manque("Le secret est renseigné, mais pas l'identifiant (PAYPAL_CLIENT_ID).");
  if (!SECRET) manque("L'identifiant est renseigné, mais pas le secret (PAYPAL_SECRET).");

  console.log(
    `Identifiant de ${ID.length} caractères, secret de ${SECRET.length}. On demande à PayPal…\n`,
  );

  const verdicts = [];
  for (const s of SERVEURS) {
    const ok = await reconnu(s.base);
    verdicts.push({ ...s, ok });
    console.log(`  ${s.nom.padEnd(12)} ${ok ? "✓ reconnus" : "✗ refusés"}`);
  }

  const bon = verdicts.find((v) => v.ok);
  console.log("");

  if (!bon) {
    console.error(
      "✖ PayPal ne reconnaît ces identifiants ni d'un côté ni de l'autre.\n\n" +
        "  Les causes habituelles : une valeur tronquée à la copie, un espace resté\n" +
        "  au bout, ou un secret qui a été régénéré depuis (l'ancien cesse alors de\n" +
        "  fonctionner immédiatement). Reprenez-les sur developer.paypal.com.",
    );
    process.exit(1);
  }

  console.log(`✓ Ces identifiants sont ceux du ${bon.nom}.`);

  if (!ENV_CHOISI) {
    console.log(
      `\n⚠ PAYPAL_ENV n'est pas renseigné : la boutique parlera au bac à sable.` +
        (bon.cle === "live"
          ? "\n  Or vos identifiants sont ceux du compte réel : ils seront refusés.\n  Écrivez PAYPAL_ENV=live."
          : "\n  C'est cohérent avec vos identifiants, mais écrivez-le quand même :\n  PAYPAL_ENV=sandbox."),
    );
    process.exit(1);
  }

  const viseLive = ENV_CHOISI === "live";
  if ((viseLive ? "live" : "sandbox") !== bon.cle) {
    console.error(
      `\n✖ Le réglage et les identifiants ne parlent pas du même PayPal.\n` +
        `  PAYPAL_ENV vaut « ${ENV_CHOISI} », donc la boutique s'adresse au ` +
        `${viseLive ? "compte réel" : "bac à sable"},\n` +
        `  alors que ces identifiants sont ceux du ${bon.nom}. Ils seront refusés.\n\n` +
        `  Soit vous écrivez PAYPAL_ENV=${bon.cle}, soit vous prenez les identifiants\n` +
        `  de l'onglet ${viseLive ? "Live" : "Sandbox"} sur developer.paypal.com.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ Le réglage concorde : la boutique s'adresse bien au ${bon.nom}.\n\n` +
      "  Redémarrez l'API pour qu'elle les relise :\n" +
      "    docker restart memoryline-api\n\n" +
      "  Le bouton PayPal apparaîtra alors au paiement, et l'avertissement de\n" +
      "  l'accueil du back-office disparaîtra." +
      (viseLive
        ? "\n\n  ⚠ Vous êtes en compte réel : les paiements d'essai débiteront vraiment."
        : "") +
      "\n\n  Rappel : des identifiants saisis dans BO › Réglages › Paiements passent\n" +
      "  devant ceux-ci (ce script ne les voit pas).",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("✖ La vérification a échoué :", e);
  process.exit(1);
});
