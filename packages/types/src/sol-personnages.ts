/**
 * La hauteur où se posent les pieds des personnages, en fraction de la
 * hauteur de l'affiche (0 = en haut, 1 = en bas).
 *
 * UNE SEULE VALEUR, PARTAGÉE, et c'est tout son intérêt. Le back-office cale
 * chaque personnage — sa taille, le bas réel de son dessin — contre cette
 * ligne ; le site les range ensuite sur cette même ligne. Les deux lisaient
 * chacun leur propre copie du nombre, et le site y ajoutait une pente que le
 * back-office ignorait : un personnage parfaitement calé à l'écran de calage
 * apparaissait décalé sur la boutique, sans que rien ne permette de
 * comprendre pourquoi.
 *
 * 0,816 est le calage visuel fait par la boutique le 7 juillet 2026, ajusté
 * le 11 juillet quand la descente des pieds a été corrigée.
 *
 * Au sens strict, c'est le CENTRE du cadre d'un personnage SEUL (échelle 0,7)
 * — ses pieds tombent une demi-hauteur de cadre plus bas, là où le calage du
 * back-office les a réglés. Quand la composition rapetisse un personnage pour
 * en loger d'autres, elle descend son cadre d'autant, pour que ses pieds ne
 * quittent pas cette ligne (voir composition-personnages.ts).
 */
export const Y_SOL_PERSONNAGES = 0.816;
