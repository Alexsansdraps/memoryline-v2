/**
 * Consigne de style officielle Memory Line, telle que la cliente l'a rédigée.
 *
 * Elle vit dans le code pour ne pas pouvoir se perdre, mais c'est le RÉGLAGE
 * « ia.stylePrompt » du back-office qui fait foi : la cliente doit pouvoir la
 * corriger après avoir vu dix générations, sans attendre une mise en ligne.
 * Ce texte n'est donc qu'un défaut — celui qui s'applique tant que personne
 * n'a rien réglé.
 *
 * Reproduite MOT POUR MOT. C'est sa consigne, elle la relit et la compare ;
 * la corriger en douce reviendrait à lui rendre un texte qu'elle ne
 * reconnaîtrait plus.
 *
 * Pourquoi en anglais : le modèle d'OpenAI suit plus fidèlement une consigne
 * anglaise, et celle-ci repose sur des interdictions très précises — « ne
 * jamais inventer », « ne rien copier des références » — dont la moindre
 * approximation se voit sur l'affiche.
 *
 * La version précédente, en français (ML-FR-002), est dans l'historique du
 * dépôt : elle décrivait le style sans référence visuelle, avant que les
 * quatre images de style existent.
 */

export const STYLE_MEMORY_LINE_VERSION = "ML-EN-003";

export const STYLE_MEMORY_LINE = `IMAGE ROLE RULES

IMAGE 1 is the CUSTOMER SOURCE PHOTO.

IMAGE 1 is the absolute and exclusive visual authority for CONTENT.

IMAGE 2, IMAGE 3 and IMAGE 4 are APPROVED STYLE REFERENCES ONLY.

The reference images may influence ONLY:
- graphic rendering
- flat-color treatment
- level of simplification
- level of detail
- color treatment
- shadow treatment
- edge cleanliness
- texture level
- overall illustration finish

NEVER copy content from the style references.

Never copy from IMAGE 2, IMAGE 3 or IMAGE 4:
- people
- faces
- hairstyles
- clothing
- animals
- buildings
- houses
- architecture
- windows
- doors
- furniture
- objects
- vegetation
- landscape
- mountains
- cliffs
- roads
- paths
- water features
- sky composition
- text
- logos
- composition

ALL SCENE CONTENT MUST COME FROM IMAGE 1.

==================================================
MAIN TASK
==================================================

Transform IMAGE 1 into a clean, premium, semi-realistic illustrated artwork.

The final image must remain unmistakably the SAME photograph.

The goal is NOT to create a new image inspired by the photograph.

The goal is to REDRAW THE ORIGINAL PHOTOGRAPH while changing only its graphic rendering.

PRESERVE THE SCENE.
CHANGE ONLY THE ILLUSTRATION STYLE.

==================================================
A3 VERTICAL — MANDATORY
==================================================

The final artwork is intended for an A3 VERTICAL poster.

Aspect ratio must be:

297:420

The source photograph may originally be:
- landscape
- portrait
- square
- panoramic

Adapt the composition intelligently to the vertical A3 canvas.

Do not simply crop important subjects.

The final composition must look intentionally designed for an A3 vertical artwork.

When adaptation is required:

FIRST preserve every important subject.

SECOND preserve the original visual relationships between subjects.

THIRD preserve the original viewpoint and perspective as closely as possible.

Then adjust the framing conservatively.

You may slightly:
- reframe
- move the crop
- extend simple background areas
- create additional breathing space

ONLY when necessary to make the composition work vertically.

==================================================
EXTENDING THE PHOTO
==================================================

When the source photo does not contain enough information to naturally fill the A3 vertical canvas, extension must be extremely conservative.

You may continue simple existing areas such as:

- sky
- water
- sand
- grass
- plain pavement
- plain floor
- plain wall
- simple distant landscape
- simple vegetation masses

These extensions must look like natural continuations of areas already visible in IMAGE 1.

DO NOT use canvas extension as permission to create new scene content.

Never invent an important object merely to fill empty space.

Empty space is acceptable.

A simple background is preferable to invented content.

==================================================
SOURCE PHOTO FIDELITY
==================================================

IMAGE 1 is the source of truth.

Preserve as accurately as possible:

- subject count
- subject placement
- body positions
- gestures
- interaction between people
- facial structure
- expression
- hairstyle
- hair color
- body proportions
- clothing
- clothing colors
- accessories
- animal appearance
- architecture
- building proportions
- roof geometry
- windows
- doors
- balconies
- walls
- important architectural details
- furniture
- objects
- paths
- roads
- landscape
- horizon
- cliffs
- mountains
- water
- vegetation
- relative distances
- perspective
- original atmosphere

The customer must immediately recognize the original photograph.

==================================================
ZERO INVENTION RULE
==================================================

This is one of the most important instructions.

DO NOT ADD an important object that is absent from IMAGE 1.

Do not invent:

- buildings
- houses
- rooms
- windows
- doors
- balconies
- furniture
- deck chairs
- tables
- chairs
- lamps
- fences
- paths
- roads
- cars
- boats
- people
- children
- animals
- trees
- flowers
- mountains
- decorative objects
- accessories
- signs
- text

If visual information is unclear:

SIMPLIFY THE UNCERTAIN DETAIL.

DO NOT INVENT IT.

An omitted minor detail is preferable to a false detail.

==================================================
GRAPHIC STYLE
==================================================

Use the approved reference images only to understand the visual rendering.

The desired rendering uses:

- clean flat-color areas
- clear shapes
- semi-realistic proportions
- accurate geometry
- carefully simplified details
- subtle tonal variations
- clean controlled shadows
- bright but natural colors
- crisp visual separation
- smooth surfaces
- extremely low texture
- almost zero visible grain
- little to no visible outlines
- professional premium illustration quality

The result must feel graphic without becoming crude or cartoon-like.

==================================================
FLAT COLORS
==================================================

Flat-color illustration is important.

However, do NOT reduce complex objects into one crude color shape.

Use multiple clean tonal areas when necessary to create natural volume.

Example:

A white shirt should contain several clean white and pale-grey areas to show:
- folds
- light
- shadows
- volume

A face should contain several subtle natural skin-tone areas.

Hair should contain several clean tonal masses.

A building facade may contain several adjacent tones to reproduce:
- light
- shadow
- depth
- architectural structure

Trees and vegetation should be represented using clean masses rather than photographic leaf-by-leaf detail.

The result must remain detailed enough to recognize the original scene.

==================================================
PEOPLE
==================================================

When people are visible, preserving them is a HIGH PRIORITY.

Preserve:

- identity
- facial proportions
- facial structure
- expression
- apparent age
- hairstyle
- hair color
- skin tone
- body proportions
- pose
- gesture
- clothing
- clothing color
- relationship between subjects

Do not transform real people into generic characters.

Do not exaggerate:

- eyes
- mouth
- smile
- nose
- jaw
- hair
- muscles
- body proportions

Do not automatically beautify faces.

The people should remain recognizable from IMAGE 1.

==================================================
NOT CARTOON
==================================================

The final image must NOT look like:

- cartoon
- comic book
- caricature
- anime
- manga
- children's illustration
- Pixar-like rendering
- Disney-like rendering
- pop art
- cel shading
- retro advertising
- vintage travel poster

Avoid exaggerated facial shapes and heavy graphic lines.

The target is a refined semi-realistic illustration.

==================================================
OUTLINES
==================================================

Do NOT use thick dark outlines.

Do NOT create black outlines around:

- people
- faces
- hair
- clothes
- buildings
- furniture
- vegetation
- objects

Forms should primarily be separated through:

- color
- tonal difference
- subtle shadow
- geometry

Visible contours should be absent or extremely discreet.

==================================================
ARCHITECTURE
==================================================

When architecture appears in IMAGE 1, preserve it accurately.

Architecture must NOT be redesigned.

Pay particular attention to:

- building shape
- width
- height
- number of visible floors
- roof shape
- roof angle
- towers
- chimneys
- windows
- doors
- balconies
- columns
- arches
- facade divisions
- adjoining structures

Do not duplicate windows.

Do not invent windows.

Do not create additional floors.

Do not change roof geometry.

Do not merge separate buildings.

Do not create generic architecture to replace unclear architecture.

==================================================
LANDSCAPE
==================================================

Preserve:

- horizon position
- cliffs
- mountains
- coastline
- beaches
- fields
- roads
- water
- vegetation masses
- major trees
- visible terrain shape

Do not replace the actual landscape with a prettier generic landscape.

==================================================
COLORS
==================================================

Stay close to the color identity of IMAGE 1.

Colors should be:

- natural
- luminous
- clean
- balanced
- contemporary

The approved references show the desired graphic clarity and saturation level.

However, do NOT blindly copy their exact palette.

The original photograph determines the actual scene colors.

ABSOLUTELY AVOID:

- global yellow cast
- global orange cast
- sepia
- vintage color grading
- excessive saturation
- artificial neon colors

White objects must remain visually white when they are white in the source.

Skin tones must remain natural.

==================================================
TEXTURE
==================================================

Texture must be extremely low.

Do NOT produce:

- painting texture
- watercolor texture
- gouache texture
- oil-paint texture
- canvas texture
- paper texture
- visible digital noise
- film grain
- heavy grain
- brush strokes

The image must appear smooth, clean and sharp.

==================================================
TEXT AND LOGOS
==================================================

ABSOLUTELY NO TEXT.

ABSOLUTELY NO TYPOGRAPHY.

ABSOLUTELY NO TITLE.

ABSOLUTELY NO LOGO.

ABSOLUTELY NO BRAND NAME.

ABSOLUTELY NO SIGNATURE.

ABSOLUTELY NO WATERMARK.

ABSOLUTELY NO RANDOM LETTERS.

Even if one of the STYLE REFERENCES contains text:

IGNORE THE TEXT COMPLETELY.

Never reproduce the words "Memory Line" in the image.

==================================================
BORDERS
==================================================

No border.

No frame.

No decorative margin.

The illustration must fill the complete A3 canvas.

==================================================
OPTIONAL CUSTOMER REQUEST
==================================================

REMOVE_ELEMENTS:
{{REMOVE_ELEMENTS}}

CUSTOMER_REQUEST:
{{CUSTOMER_REQUEST}}

If REMOVE_ELEMENTS = NONE:
do not remove anything intentionally.

If CUSTOMER_REQUEST = NONE:
make no additional modifications.

A customer modification applies ONLY to the specifically requested element.

It does not authorize redesigning the rest of the image.

==================================================
PRIORITY ORDER
==================================================

When instructions conflict, follow this exact priority:

1. Preserve the content and identity of IMAGE 1.
2. Preserve people, animals and recognizable subjects.
3. Preserve architecture and important objects.
4. Create a natural A3 vertical composition.
5. Never invent important content.
6. Reproduce the graphic treatment demonstrated by the approved style references.
7. Improve visual harmony only when it does not reduce fidelity.

STYLE MUST NEVER OVERRIDE SOURCE FIDELITY.

==================================================
FINAL INTERNAL CHECK
==================================================

Before producing the final image, verify:

Is this clearly the same source photograph?

Are the same important people present?

Do the people still resemble the source?

Are their poses and clothing correct?

Are the buildings and important objects correct?

Has any important object been invented?

Has anything important disappeared?

Is the composition genuinely vertical A3?

Does the result use clean flat-color areas?

Is the image detailed enough to remain recognizable?

Is the texture extremely low?

Is the grain almost absent?

Are there no thick outlines?

Is it semi-realistic rather than cartoon?

Are the colors natural?

Is there any unwanted yellow/orange cast?

Is there absolutely no text, logo or watermark?

If an important element was invented:
REMOVE IT.

If an unclear detail was invented:
SIMPLIFY IT.

If the result looks too cartoon-like:
restore natural proportions and add subtle tonal detail.

If the result looks too photographic:
simplify surfaces into cleaner illustrated color areas without changing the scene.

==================================================
FINAL TARGET
==================================================

The final reaction from the customer should be:

"This is clearly my exact photograph, carefully transformed into this beautiful illustrated style."

The reaction must NOT be:

"This is a new AI-generated scene inspired by my photo."

Preserve the photograph.

Adapt it intelligently to A3 vertical.

Transform only the graphic rendering.`;

/**
 * Ce qu'on met dans un marqueur quand le client n'a rien demandé de précis.
 *
 * « NONE » et pas « aucune » : la consigne est en anglais et teste
 * explicitement `REMOVE_ELEMENTS = NONE`. Un mot français y passerait pour une
 * demande, et le modèle chercherait quoi retirer.
 */
const DEFAUTS_VARIABLES: Record<string, string> = {
  REMOVE_ELEMENTS: "NONE",
  CUSTOMER_REQUEST: "NONE",
  OUTPUT_FORMAT: "A3 vertical poster",
  COMPOSITION_REQUEST: "NONE",
  LIGHTING_REQUEST: "NONE",
};

/**
 * Remplace les marqueurs {{...}} d'une consigne.
 *
 * Ceux qui resteraient partiraient au modèle, qui les lirait comme des
 * consignes ; on les remplace donc tous, connus ou non.
 */
export function appliquerVariables(
  gabarit: string,
  valeurs: Partial<Record<string, string>> = {},
): string {
  let out = gabarit;
  for (const [cle, defaut] of Object.entries(DEFAUTS_VARIABLES)) {
    const v = String(valeurs[cle] ?? "").trim() || defaut;
    out = out.split(`{{${cle}}}`).join(v);
  }
  return out.replace(/\{\{[A-Z_]+\}\}/g, "NONE");
}

/**
 * Ajoute la demande du client à la fin de la consigne.
 *
 * En BAS, et clairement annoncée : le modèle retient mieux ce qui vient en
 * dernier, et la consigne officielle rappelle justement que la fidélité passe
 * avant toute demande particulière. Rien n'est ajouté si le client n'a rien
 * écrit — une rubrique vide serait du bruit.
 */
export function ajouterDemandeClient(
  consigne: string,
  demande: string | null | undefined,
): string {
  const texte = String(demande ?? "").trim();
  if (!texte) return consigne;
  return `${consigne}\n\nADDITIONAL CUSTOMER REQUEST (apply only to the specifically requested element; it never authorizes redesigning the rest of the image, and never overrides fidelity to IMAGE 1):\n${texte.slice(0, 600)}`;
}
