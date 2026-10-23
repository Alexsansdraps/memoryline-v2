/*
 * Le compte Instagram de la boutique : une DONNÉE, sans rien changer au
 * schéma (migration « custom » : son instantané est celui de 0070).
 *
 * Donné par Alexandra le 23/10/2026 pour le référencement (AUDIT-SEO.md,
 * ORG-1) : le site le publie en lien dans son pied de page et en « sameAs »
 * dans les données structurées de l'accueil. Il se modifie ensuite dans
 * BO › Contenu du site › Pied de page. Une valeur déjà saisie n'est jamais
 * écrasée.
 */
INSERT INTO "setting" ("key", "value", "label", "group", "updated_at")
VALUES ('footer.instagram', '"https://www.instagram.com/memoryline.fr/"'::jsonb, 'Compte Instagram (pied de page)', 'footer', now())
ON CONFLICT ("key") DO NOTHING;
