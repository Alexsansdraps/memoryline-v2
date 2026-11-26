/**
 * Ce qui part au modèle d'images : le HTML de l'éditeur du BO en TEXTE
 * (26/11, relecture de « qualité affiches IA pas top »). Sans base.
 *
 *   MSYS_NO_PATHCONV=1 docker exec -w /app/apps/api memoryline-api npx tsx --test tests/consigne-texte.test.ts
 *
 * La règle d'or : aucun mot perdu, aucun mot COLLÉ à son voisin. Chaque cas
 * piégeux compare aussi la suite des mots à celle du HTML lu comme un
 * navigateur (`motsDuHtml`, un témoin volontairement naïf et indépendant).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { consigneEnTexte } from "../src/consigne-texte.ts";

/** Les mots d'un HTML tel qu'un navigateur l'affiche : blocs = séparation, balises en ligne = rien. */
function motsDuHtml(html: string): string[] {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|blockquote|hr)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\s+/)
    .filter(Boolean);
}
/** Les mots du texte converti, sans les puces « - » qu'il ajoute en tête des éléments de liste. */
const mots = (texte: string) =>
  texte
    .split("\n")
    .flatMap((ligne) => ligne.replace(/^\s*- /, "").split(/\s+/))
    .filter(Boolean);

function memesMots(html: string): string {
  const texte = consigneEnTexte(html);
  assert.deepEqual(mots(texte), motsDuHtml(html), `mots différents pour ${JSON.stringify(html)}`);
  return texte;
}

test("deux paragraphes font deux lignes : « inventé.</p><p>RÉSULTAT » ne se colle pas", () => {
  assert.equal(
    memesMots("<p>Ne rien ajouter d'inventé.</p><p>RÉSULTAT FINAL ATTENDU</p>"),
    "Ne rien ajouter d'inventé.\nRÉSULTAT FINAL ATTENDU",
  );
});

test("les balises en ligne s'effacent sans rien ajouter ni coller", () => {
  assert.equal(
    memesMots("<p>Tu es spécialisé dans le style <strong>Memory Line (ML)</strong>.</p>"),
    "Tu es spécialisé dans le style Memory Line (ML).",
  );
  assert.equal(memesMots("<p>un<em> mot</em> puis <u>un</u> <a href=\"x\">lien</a></p>"), "un mot puis un lien");
  // Une balise en ligne au milieu d'un mot ne le coupe pas.
  assert.equal(memesMots("<p>aplat<strong>s</strong> nets</p>"), "aplats nets");
});

test("les listes de l'éditeur (<ul><li><p>…</p></li></ul>) : une ligne « - » par élément", () => {
  assert.equal(
    memesMots(
      "<p>La photographie peut représenter :</p><ul><li><p>Une personne seule.</p></li><li><p>Un couple.</p></li></ul><p>Ensuite.</p>",
    ),
    "La photographie peut représenter :\n- Une personne seule.\n- Un couple.\nEnsuite.",
  );
});

test("une liste numérotée garde ses numéros, et son départ", () => {
  assert.equal(consigneEnTexte("<ol><li>Fidélité</li><li>Couleurs</li></ol>"), "1. Fidélité\n2. Couleurs");
  assert.equal(consigneEnTexte('<ol start="4"><li>Animaux</li><li>Décor</li></ol>'), "4. Animaux\n5. Décor");
});

test("une liste dans une liste est mise en retrait", () => {
  assert.equal(
    memesMots("<ul><li>Personnes<ul><li>visages</li><li>tenues</li></ul></li><li>Décor</li></ul>"),
    "- Personnes\n  - visages\n  - tenues\n- Décor",
  );
});

test("<br> fait un retour à la ligne ; un paragraphe vide (<p><br></p>) une ligne vide, une seule", () => {
  assert.equal(memesMots("<p>ligne un<br>ligne deux</p>"), "ligne un\nligne deux");
  assert.equal(memesMots("<p>a</p><p><br></p><p>b</p>"), "a\n\nb");
  assert.equal(memesMots("<p>a</p><p><br></p><p><br></p><p><br></p><p>b</p>"), "a\n\nb");
  // Un <br> en fin de paragraphe n'ajoute rien (le navigateur non plus).
  assert.equal(memesMots("<p>a<br></p><p>b</p>"), "a\nb");
  // Un paragraphe vide sans <br> ne se voit pas : pas de ligne vide.
  assert.equal(memesMots("<p>a</p><p></p><p>b</p>"), "a\nb");
});

test("les entités redeviennent des caractères, sans redevenir des balises", () => {
  assert.equal(
    memesMots("<p>Lumière&nbsp;: douce &amp; chaude, l&#39;été, &quot;mer&quot;, &lt;p&gt; reste du texte</p>"),
    "Lumière : douce & chaude, l'été, \"mer\", <p> reste du texte",
  );
  assert.equal(consigneEnTexte("<p>&#x2014; &#8212; &laquo;&nbsp;oui&nbsp;&raquo; &hellip;</p>"), "— — « oui » …");
  // Une entité inconnue reste telle quelle : rien n'est perdu.
  assert.equal(consigneEnTexte("<p>&inconnue; x</p>"), "&inconnue; x");
});

test("les blancs suivent la règle du HTML : un retour à la ligne DANS le texte vaut une espace", () => {
  assert.equal(memesMots("<p>une phrase\n   coupée   en deux</p>\n\n<p>suite</p>"), "une phrase coupée en deux\nsuite");
  assert.equal(memesMots("<ul>\n  <li>\n    <p>indentée</p>\n  </li>\n</ul>"), "- indentée");
});

test("commentaires, <script> et <style> collés depuis une page web ne passent pas", () => {
  assert.equal(
    consigneEnTexte("<p>garder</p><!-- note --><style>p{color:red}</style><script>alert(1)</script><p>ceci</p>"),
    "garder\nceci",
  );
});

test("les titres et les <div> (collage) font aussi changer de ligne", () => {
  assert.equal(memesMots("<h2>1. IDENTITÉ</h2><p>Texte</p><div>bloc</div><div><br></div><div>fin</div>"), "1. IDENTITÉ\nTexte\nbloc\n\nfin");
});

test("un texte SANS balise (consigne générale, zone de texte) garde ses lignes", () => {
  const brut = "# TITRE\r\n\r\n## RÔLE\r\n\r\nTu es **illustrateur**.   \r\n- un\r\n- deux\r\n\r\n\r\n\r\nFin & suite < 3";
  assert.equal(consigneEnTexte(brut), "# TITRE\n\n## RÔLE\n\nTu es **illustrateur**.\n- un\n- deux\n\nFin & suite < 3");
  // Rien d'autre ne bouge : mêmes mots, mêmes signes.
  assert.deepEqual(mots(consigneEnTexte(brut)), mots(brut));
});

test("vide, nul, ou un éditeur vidé (« <p><br></p> ») : chaîne vide", () => {
  assert.equal(consigneEnTexte(null), "");
  assert.equal(consigneEnTexte(undefined), "");
  assert.equal(consigneEnTexte(""), "");
  assert.equal(consigneEnTexte("<p><br></p>"), "");
  assert.equal(consigneEnTexte("<p></p>"), "");
  assert.equal(consigneEnTexte("  \n "), "");
});

test("les marqueurs {{…}} de la consigne générale traversent intacts", () => {
  assert.equal(consigneEnTexte("<p>Format : {{OUTPUT_FORMAT}}</p><p>{{CUSTOMER_REQUEST}}</p>"), "Format : {{OUTPUT_FORMAT}}\n{{CUSTOMER_REQUEST}}");
});
