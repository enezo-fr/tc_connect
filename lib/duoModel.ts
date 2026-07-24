// App « À deux » — référentiels et calculs.
//
// Listes reprises de l'ancienne app AppSheet (feuille « Listes déroulantes ») :
// Liste 4 (types d'activité), 9 (gamme de prix), 3 (priorité), 11 (film/série),
// 12 (plateformes), 13 (catégories). On garde l'existant pour que l'import
// retombe sur ses pieds sans ressaisie.

import type { DuoPartie } from '@/types'

export const TYPES_FILM = ['Film', 'Série'] as const
export const PLATEFORMES = ['Netflix', 'Canal +', 'Prime Video', 'Disney+', 'Cinéma', 'Autre'] as const
export const CATEGORIES_FILM = [
  'Action', 'Aventure', 'Thriller', 'Comédie', 'Comédie dramatique', 'Braquage',
  'Fantastique', 'Biopic', 'Histoire vraie', 'Série documentaire', 'Film de Noël', 'Football',
] as const

export const TYPES_ACTIVITE = [
  'Restaurant', 'Bar', 'Activité', 'Lieu', 'Parc', 'Vacances', 'Logement', "Aire d'autoroute",
] as const
export const PRIORITES = ['A faire absolument', 'A revoir', 'A ne pas faire'] as const
export const GAMMES_PRIX = ['🟢 Abordable', '🟡 Modéré', '🟠 Cher', '🔴 Exorbitant'] as const

/** Jeux déjà joués — repères de saisie, la liste reste ouverte */
export const JEUX_COURANTS = ['Uno', 'SkyJo', '6 qui prend', 'Molki', 'Belote', 'Triomino'] as const

/** Note en étoiles pleines, pour l'affichage des listes */
export const etoiles = (n?: number): string => (n ? '⭐'.repeat(Math.round(n)) : '')

export interface ClassementJoueur {
  joueur: string
  total: number
  /** Rang, 1 = vainqueur (dépend du sens du jeu) */
  rang: number
}

/**
 * Total par joueur et classement d'une partie.
 *
 * ⚠️ Le sens dépend du jeu : au SkyJo ou au 6 qui prend, le plus PETIT score
 * gagne. D'où `scoreBasGagne` sur la partie — sans lui, on désignerait
 * systématiquement le perdant comme vainqueur.
 */
export function classementPartie(partie: DuoPartie): ClassementJoueur[] {
  const totaux = new Map<string, number>()
  for (const j of partie.joueurs) totaux.set(j, 0)
  for (const tour of partie.tours ?? []) {
    for (const s of tour.scores ?? []) {
      totaux.set(s.joueur, (totaux.get(s.joueur) ?? 0) + (s.points ?? 0))
    }
  }
  const liste = [...totaux.entries()].map(([joueur, total]) => ({ joueur, total }))
  liste.sort((a, b) => (partie.scoreBasGagne ? a.total - b.total : b.total - a.total))

  // Ex æquo : même rang, et le rang suivant saute (1, 1, 3)
  let rang = 0
  let precedent: number | null = null
  return liste.map((l, i) => {
    if (precedent === null || l.total !== precedent) rang = i + 1
    precedent = l.total
    return { ...l, rang }
  })
}

/** Bilan tous jeux confondus : combien de parties chacun a remportées */
export function palmares(parties: DuoPartie[]): { joueur: string; victoires: number; parties: number }[] {
  const stats = new Map<string, { victoires: number; parties: number }>()
  for (const p of parties) {
    if (!p.tours?.length) continue // une partie sans tour n'a pas de vainqueur
    const cl = classementPartie(p)
    for (const c of cl) {
      const s = stats.get(c.joueur) ?? { victoires: 0, parties: 0 }
      s.parties += 1
      if (c.rang === 1) s.victoires += 1
      stats.set(c.joueur, s)
    }
  }
  return [...stats.entries()]
    .map(([joueur, s]) => ({ joueur, ...s }))
    .sort((a, b) => b.victoires - a.victoires || b.parties - a.parties)
}
