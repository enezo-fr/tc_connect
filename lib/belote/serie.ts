import type { BeloteGame } from './types'

/**
 * Séries de parties (revanche, belle…).
 *
 * Une série n'a pas de collection dédiée : c'est un simple `serieId` recopié sur
 * chaque partie liée. Le cumul se calcule PAR ÉQUIPE (`team1Id`/`team2Id`) et non
 * par côté : d'une partie à l'autre, une même équipe peut passer de « Nous » à
 * « Eux », et son total doit la suivre.
 *
 * Fonctions pures (aucune dépendance Firebase) — resservies côté page publique.
 */

export interface SerieLigne {
  teamId: string
  name: string
  points: number
  parties: number
  victoires: number
}

export function nouvelleSerieId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Parties d'une série, de la plus ancienne à la plus récente (ordre de jeu). */
export function partiesDeSerie(games: BeloteGame[], serieId: string): BeloteGame[] {
  return games
    .filter((g) => g.serieId === serieId)
    .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
}

/** Cumul des points de chaque équipe sur une série, meilleure en tête. */
export function cumulSerie(games: BeloteGame[]): SerieLigne[] {
  const map = new Map<string, SerieLigne>()
  const add = (teamId: string, name: string, points: number, gagne: boolean) => {
    if (!teamId) return
    const cur = map.get(teamId) ?? { teamId, name, points: 0, parties: 0, victoires: 0 }
    cur.name = name || cur.name
    cur.points += points
    cur.parties += 1
    if (gagne) cur.victoires += 1
    map.set(teamId, cur)
  }
  games.forEach((g) => {
    add(g.team1Id, g.team1Name, g.totalScore?.team1 ?? 0, g.winnerId === g.team1Id)
    add(g.team2Id, g.team2Name, g.totalScore?.team2 ?? 0, g.winnerId === g.team2Id)
  })
  return [...map.values()].sort((a, b) => b.points - a.points)
}

/**
 * Écart de points entre les deux premières équipes de la série.
 * `null` s'il n'y a pas au moins deux équipes (rien à comparer).
 */
export function ecartSerie(lignes: SerieLigne[]): { ecart: number; enTete: SerieLigne; second: SerieLigne } | null {
  if (lignes.length < 2) return null
  const [enTete, second] = lignes
  return { ecart: enTete.points - second.points, enTete, second }
}

/** Écart de points d'UNE partie (positif : team1 devant). */
export function ecartPartie(g: BeloteGame): number {
  return (g.totalScore?.team1 ?? 0) - (g.totalScore?.team2 ?? 0)
}

/** Nom par défaut d'une série créée depuis une partie. */
export function nomSerieParDefaut(g: BeloteGame): string {
  return `${g.team1Name} vs ${g.team2Name}`
}
