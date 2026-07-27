// « Qui suis-je » sur une commande.
//
// Une même commande est ouverte depuis PLUSIEURS téléphones : celui qui l'a créée
// (dans l'app) et ceux qui rejoignent par QR/lien. Savoir qui tient l'appareil ne
// regarde donc que cet appareil — ce n'est pas une donnée de la commande et ça ne
// part jamais en base (sinon le dernier arrivé écraserait l'identité des autres).
// On la retient par commande, dans le stockage local, pour pré-sélectionner le
// destinataire de chaque boisson : chacun ajoute ce qu'il boit en deux gestes.

export const LA_TABLE = 'La table'

const cle = (commandeId: string) => `cmd-moi:${commandeId}`

export interface Moi {
  /** L'appareil a déjà répondu — même « je ne commande pas ». Sert à ne pas redemander. */
  repondu: boolean
  /** Prénom choisi, ou `null` = personne (les boissons vont sur « La table »). */
  nom: string | null
}

export function lireMoi(commandeId: string | null | undefined): Moi {
  if (!commandeId || typeof window === 'undefined') return { repondu: false, nom: null }
  try {
    const v = localStorage.getItem(cle(commandeId))
    // Absent = jamais demandé ; chaîne vide = a répondu « personne ».
    if (v === null) return { repondu: false, nom: null }
    return { repondu: true, nom: v.trim() || null }
  } catch { return { repondu: false, nom: null } }
}

export function ecrireMoi(commandeId: string | null | undefined, nom: string | null): void {
  if (!commandeId || typeof window === 'undefined') return
  try { localStorage.setItem(cle(commandeId), nom?.trim() || '') } catch { /* stockage indispo */ }
}

/**
 * Suit les modifications de la liste des personnes : un renommage suit l'identité,
 * une suppression la remet à « personne ». Renvoie le nouveau prénom (ou null).
 */
export function suivreMoi(
  commandeId: string,
  renames: Record<string, string>,
  removed: string[],
): string | null {
  const { repondu, nom } = lireMoi(commandeId)
  if (!repondu || !nom) return null
  if (removed.some((r) => r.trim() === nom)) { ecrireMoi(commandeId, null); return null }
  const suivant = renames[nom]
  if (suivant) { ecrireMoi(commandeId, suivant); return suivant }
  return nom
}
