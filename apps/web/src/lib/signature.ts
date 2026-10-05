/**
 * La signature de la boutique, telle que l'aperçu doit la montrer.
 *
 * Le fichier d'impression la pose en bas à droite de chaque création
 * (apps/api/src/pdf.ts, signaturePosee) : l'aperçu que le client valide doit
 * la montrer au même endroit, à la même taille. Mêmes réglages, mêmes bornes
 * et mêmes valeurs par défaut que l'API (fichiers-impression.ts,
 * signatureDesCreations) — sinon l'écran et le papier se contrediraient.
 *
 * À lire côté serveur, dans les pages : les îlots la reçoivent en propriété.
 */
import { assetUrl, setting } from "./api.ts";

export interface SignatureApercu {
  /** Adresse de l'image, prête pour le navigateur. */
  url: string;
  /** Largeur, en fraction du petit côté de l'affiche. */
  largeur: number;
  /** Marge depuis les bords droit et bas, même unité. */
  marge: number;
  /** Opacité, de 0 à 1. */
  opacite: number;
}

/** Le logo de la boutique, servi par le site : la signature par défaut. */
const LOGO_PAR_DEFAUT = "/logo-memory-line.png";

export async function signatureDesCreations(): Promise<SignatureApercu | null> {
  const [visible, image, largeur, marge, opacite] = await Promise.all([
    setting("signature.visible", "on"),
    setting("signature.image", ""),
    setting("signature.largeur", ""),
    setting("signature.marge", ""),
    setting("signature.opacite", ""),
  ]);
  if (["off", "non", "no", "false", "0"].includes(visible.trim().toLowerCase())) return null;
  const nombre = (brut: string, defaut: number, min: number, max: number) => {
    const n = Number(brut.trim().replace(",", "."));
    return brut.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
  };
  return {
    url: (image.trim() && assetUrl(image.trim())) || LOGO_PAR_DEFAUT,
    largeur: nombre(largeur, 12, 4, 25) / 100,
    marge: nombre(marge, 3, 0, 10) / 100,
    opacite: nombre(opacite, 100, 20, 100) / 100,
  };
}
