/*
 * Les trois styles d'affiche IA demandés par la boutique : la cliente dit ce
 * que montre sa photo AVANT de la confier au modèle, pour que l'affiche
 * « sorte toujours bien ».
 *
 *   Personnes / Animaux · Paysage · Maison / Bâtiment
 *
 * Chaque style ajoute sa consigne À LA FIN de la consigne générale de la
 * boutique (réglage ia.stylePrompt) : elle ne la remplace pas, elle dit sur
 * quoi porter l'attention selon le sujet. Elle est écrite en anglais, comme
 * la consigne générale, parce que le modèle suit plus fidèlement une consigne
 * anglaise ; elle se relit et se corrige au back-office (Affiches IA › Styles
 * proposés), comme les titres, qui sont la seule chose que voit la cliente.
 *
 * Chaque insertion se garde d'écraser quoi que ce soit : « WHERE NOT EXISTS »
 * sur le titre. Une boutique qui aurait déjà créé un style « Paysage » garde
 * le sien, et la migration peut être rejouée sans doublon.
 */
INSERT INTO "ia_prompt" (title, prompt, images, position, active, translations)
SELECT 'Personnes / Animaux',
       'SUBJECT OF THIS PHOTO: PEOPLE AND/OR ANIMALS

The customer told us that IMAGE 1 shows people and/or animals. They are the heart of the poster.

- Keep EVERY person and EVERY animal of IMAGE 1: same number, same positions, same poses, same gestures, same interactions. Never add, remove, merge or duplicate anyone.
- Each person must stay recognizable: face shape, apparent age, skin tone, hairstyle and hair colour, beard, glasses, expression. Do not beautify, rejuvenate or age anyone. Never turn real people into generic cartoon characters.
- Clothing keeps its real garments, colours and main patterns, simplified into clean flat areas.
- Animals keep their exact species, breed, size, coat colours and markings, ear and tail shape, collar or harness if visible.
- Never crop heads, hands, paws or tails that are visible in IMAGE 1.
- The background stays the real background of IMAGE 1, simplified a little more than the subjects so that they stand out — never replaced by an invented setting.',
       '[]'::jsonb,
       1, true,
       '{"en":{"title":"People / Pets"},"de":{"title":"Personen / Tiere"},"it":{"title":"Persone / Animali"},"es":{"title":"Personas / Animales"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "ia_prompt" WHERE title = 'Personnes / Animaux');
--> statement-breakpoint
INSERT INTO "ia_prompt" (title, prompt, images, position, active, translations)
SELECT 'Paysage',
       'SUBJECT OF THIS PHOTO: A LANDSCAPE

The customer told us that IMAGE 1 is a landscape. The place itself is the subject of the poster.

- Preserve the real geography of IMAGE 1 at the same places: coastline, beach, cliffs, rocks, sea or lake, river, fields, hills, mountains, forest edges, paths and roads.
- Keep the horizon at the same height and the same overall perspective. Keep the real light, season and time of day.
- Never add landmarks, buildings, boats, people, animals, signs or vegetation that are not in IMAGE 1. Small people or boats that ARE in IMAGE 1 may be kept as small, simple silhouettes.
- Simplify vegetation into clean shapes and flat tones without inventing other species; keep the real clouds, simplified into clean shapes, and a clean sky.
- Keep the composition wide and airy: do not crop the scene to make it more dramatic.',
       '[]'::jsonb,
       2, true,
       '{"en":{"title":"Landscape"},"de":{"title":"Landschaft"},"it":{"title":"Paesaggio"},"es":{"title":"Paisaje"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "ia_prompt" WHERE title = 'Paysage');
--> statement-breakpoint
INSERT INTO "ia_prompt" (title, prompt, images, position, active, translations)
SELECT 'Maison / Bâtiment',
       'SUBJECT OF THIS PHOTO: A HOUSE OR A BUILDING

The customer told us that IMAGE 1 shows a house or a building. Its architecture is the subject of the poster and must be exact.

- Count the floors, windows, doors, dormers and chimneys of IMAGE 1 and reproduce exactly the same numbers, at the same places.
- Keep the exact roof shape, roof material and colour, facade materials (brick, stone, timber framing, render, wood cladding), shutters and their colour, balconies, railings, porch, steps, signs and house number if visible.
- Keep vertical lines straight and the real perspective. Do not make an asymmetrical facade symmetrical, and do not "improve" or modernise the building.
- Keep what surrounds the building in IMAGE 1 (garden, hedge, fence, gate, trees, street, neighbouring buildings), simplified — never add anything that is not there.
- Do not merge separate buildings, and do not invent the parts of the building that are hidden or outside IMAGE 1.',
       '[]'::jsonb,
       3, true,
       '{"en":{"title":"House / Building"},"de":{"title":"Haus / Gebäude"},"it":{"title":"Casa / Edificio"},"es":{"title":"Casa / Edificio"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "ia_prompt" WHERE title = 'Maison / Bâtiment');
