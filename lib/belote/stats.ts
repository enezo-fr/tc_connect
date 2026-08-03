import type { BeloteGame, BeloteRound, TeamSlot } from './types'

/**
 * Statistiques de belote par joueur et par équipe.
 *
 * Fonctions pures (aucune dépendance Firebase) : resservies dans l'app, sur la
 * page de série et sur la page publique du lien de partage.
 *
 * L'équipe d'un preneur se lit sur le TOUR lui-même (`teamTaker`), pas sur la
 * composition des équipes : les parties créées avant le partage n'ont pas leurs
 * joueurs recopiés, et leurs statistiques doivent quand même se calculer.
 */

export interface StatJoueur {
  nom: string
  equipe: TeamSlot | null
  equipeNom: string
  /** Nombre de fois où il a pris l'atout. */
  prises: number
  /** Prises où son équipe a chuté (« dedans »). */
  dedans: number
  reussies: number
  /** Pourcentage de prises réussies, `null` s'il n'a jamais pris. */
  taux: number | null
  /** Capots réalisés par son équipe sur ses prises. */
  capots: number
  /** Capots encaissés par son équipe sur ses prises. */
  capotsSubis: number
  /** Points marqués par son équipe sur ses prises. */
  points: number
  /** Points moyens par prise, `null` s'il n'a jamais pris. */
  moyenne: number | null
  /** Nombre de fois où il a distribué. */
  distributions: number
}

export interface StatEquipe {
  slot: TeamSlot
  nom: string
  prises: number
  dedans: number
  taux: number | null
  belotes: number
  capots: number
  points: number
}

/** Une partie et ses tours — l'unité de calcul (une seule, ou toute une série). */
export interface PartieAvecTours {
  game: Pick<BeloteGame, 'team1Name' | 'team2Name' | 'team1Players' | 'team2Players'>
  rounds: Pick<BeloteRound,
    'trumpTaker' | 'dealer' | 'teamTaker' | 'dedans' | 'capot' | 'capotTeam' |
    'beloteRebelote' | 'beloteRebeloteTeam' | 'finalScore'>[]
}

const nomComplet = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`.trim()

const pourcent = (n: number, sur: number) => (sur > 0 ? Math.round((n / sur) * 100) : null)

/**
 * Statistiques par joueur, du plus preneur au moins preneur.
 *
 * Les joueurs des équipes sont listés même sans aucune prise : « celui qui ne
 * prend jamais » est une information en soi.
 */
export function statsJoueurs(parties: PartieAvecTours[]): StatJoueur[] {
  const map = new Map<string, StatJoueur>()

  const entree = (nom: string, equipe: TeamSlot | null, equipeNom: string): StatJoueur => {
    const cur = map.get(nom) ?? {
      nom, equipe, equipeNom,
      prises: 0, dedans: 0, reussies: 0, taux: null,
      capots: 0, capotsSubis: 0, points: 0, moyenne: null, distributions: 0,
    }
    // L'équipe déduite d'un tour est plus sûre qu'une composition absente.
    if (equipe && !cur.equipe) { cur.equipe = equipe; cur.equipeNom = equipeNom }
    map.set(nom, cur)
    return cur
  }

  parties.forEach(({ game, rounds }) => {
    const nomEquipe = (t: TeamSlot) => (t === 'team1' ? game.team1Name : game.team2Name)

    // Amorçage : tous les joueurs connus des deux équipes.
    ;(game.team1Players ?? []).forEach((p) => entree(nomComplet(p), 'team1', game.team1Name))
    ;(game.team2Players ?? []).forEach((p) => entree(nomComplet(p), 'team2', game.team2Name))

    rounds.forEach((r) => {
      if (r.dealer) entree(r.dealer, null, '').distributions += 1
      if (!r.trumpTaker) return

      const equipe = r.teamTaker
      const s = entree(r.trumpTaker, equipe, nomEquipe(equipe))
      s.prises += 1
      s.points += r.finalScore?.[equipe] ?? 0
      if (r.dedans) s.dedans += 1
      if (r.capot) {
        if (r.capotTeam === equipe) s.capots += 1
        else s.capotsSubis += 1
      }
    })
  })

  return [...map.values()]
    .map((s) => ({
      ...s,
      reussies: s.prises - s.dedans,
      taux: pourcent(s.prises - s.dedans, s.prises),
      moyenne: s.prises > 0 ? Math.round(s.points / s.prises) : null,
    }))
    .sort((a, b) => b.prises - a.prises || a.nom.localeCompare(b.nom))
}

/** Statistiques par équipe (une seule partie, ou cumulées sur une série). */
export function statsEquipes(parties: PartieAvecTours[]): StatEquipe[] {
  const base = (slot: TeamSlot, nom: string): StatEquipe =>
    ({ slot, nom, prises: 0, dedans: 0, taux: null, belotes: 0, capots: 0, points: 0 })

  const acc: Record<TeamSlot, StatEquipe> = {
    team1: base('team1', parties[0]?.game.team1Name ?? 'Équipe 1'),
    team2: base('team2', parties[0]?.game.team2Name ?? 'Équipe 2'),
  }

  parties.forEach(({ rounds }) => {
    rounds.forEach((r) => {
      const t = r.teamTaker
      if (r.trumpTaker) {
        acc[t].prises += 1
        if (r.dedans) acc[t].dedans += 1
      }
      if (r.capot && r.capotTeam) acc[r.capotTeam].capots += 1
      if (r.beloteRebelote && r.beloteRebeloteTeam) acc[r.beloteRebeloteTeam].belotes += 1
      acc.team1.points += r.finalScore?.team1 ?? 0
      acc.team2.points += r.finalScore?.team2 ?? 0
    })
  })

  return (['team1', 'team2'] as const).map((t) => ({
    ...acc[t],
    taux: pourcent(acc[t].prises - acc[t].dedans, acc[t].prises),
  }))
}
