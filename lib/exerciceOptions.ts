/**
 * Vocabulaire partagé des exercices — une seule source de vérité.
 *
 * Ces listes vivaient auparavant en 5 copies (page liste, fiche détail, modale de
 * création depuis une séance) qui avaient fini par diverger : la modale de séance
 * proposait « Cardio » et « Autre » comme MUSCLES, introuvables partout ailleurs.
 */

/** La partie prioritaire = une zone du corps, jamais un muscle (les muscles ont leur propre champ). */
export const PARTIES_CORPS = ['Haut du corps', 'Bas du corps', 'Centre du corps', 'Global'] as const
export type PartieCorps = (typeof PARTIES_CORPS)[number]

export const PARTIE_CORPS_DEFAUT: PartieCorps = 'Global'

export const MUSCLES = [
  'Quadriceps', 'Ischio-jambiers', 'Fessiers', 'Mollets',
  'Pectoraux', 'Dos', 'Épaules', 'Biceps', 'Triceps',
  'Abdominaux', 'Core',
]

export const MATERIEL = [
  'Haltères', 'Barre', 'Élastiques', 'Kettlebell', 'Banc', 'Poulie',
  'TRX', 'Poids du corps', 'Médecine-ball', 'Corde à sauter', 'Tapis', 'Aucun',
]

/**
 * Anciennes valeurs de `partie_prioritaire` (des muscles, avant le passage aux 4 zones)
 * → zone correspondante. Sert au script de migration ET à la lecture : un exercice pas
 * encore converti reste rangé dans la bonne zone au lieu de disparaître des filtres.
 */
export const ANCIENNES_PARTIES: Record<string, PartieCorps> = {
  'quadriceps': 'Bas du corps',
  'ischio-jambiers': 'Bas du corps',
  'ischio jambiers': 'Bas du corps',
  'fessiers': 'Bas du corps',
  'mollets': 'Bas du corps',
  'pectoraux': 'Haut du corps',
  'dos': 'Haut du corps',
  'épaules': 'Haut du corps',
  'epaules': 'Haut du corps',
  'biceps': 'Haut du corps',
  'triceps': 'Haut du corps',
  'abdominaux': 'Centre du corps',
  'core': 'Centre du corps',
  'gainage': 'Centre du corps',
  'lombaires': 'Centre du corps',
  'cardio': 'Global',
  'full body': 'Global',
  'tout le corps': 'Global',
  'mouvements combinés': 'Global',
  'mouvements combines': 'Global',
  'autre': 'Global',
}

/**
 * Les anciennes valeurs qui sont de VRAIS muscles : la migration les recopie dans
 * « Muscles ciblés » pour ne pas perdre l'information en passant à une zone.
 * (« Cardio », « Full body » et « Autre » n'en sont pas → rien à recopier.)
 */
export const ANCIENNE_PARTIE_EST_UN_MUSCLE = (valeur: string) =>
  MUSCLES.some((m) => m.toLowerCase() === valeur.trim().toLowerCase())

/** Ramène n'importe quelle valeur stockée (ancienne ou vide) à l'une des 4 zones. */
export function normalizePartieCorps(valeur?: string | null): PartieCorps {
  const brut = (valeur ?? '').trim()
  if (!brut) return PARTIE_CORPS_DEFAUT
  const exact = PARTIES_CORPS.find((p) => p.toLowerCase() === brut.toLowerCase())
  if (exact) return exact
  return ANCIENNES_PARTIES[brut.toLowerCase()] ?? PARTIE_CORPS_DEFAUT
}

/** Vrai tant que l'exercice porte une ancienne valeur (utile pour repérer ce qui reste à convertir). */
export function estAnciennePartie(valeur?: string | null): boolean {
  const brut = (valeur ?? '').trim()
  if (!brut) return false
  return !PARTIES_CORPS.some((p) => p.toLowerCase() === brut.toLowerCase())
}
