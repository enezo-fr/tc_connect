import type { BeloteGame, BeloteRound, TeamSlot } from './types'

/**
 * Statistiques de belote par joueur et par équipe.
 *
 * Fonctions pures (aucune dépendance Firebase) : resservies dans l'app, sur la
 * page de série et sur la page publique du lien de partage.
 *
 * L'équipe d'un joueur se déduit de la composition de la partie quand elle est
 * connue, sinon des tours où il a pris (`teamTaker`) : les parties créées avant
 * le partage n'ont pas leurs joueurs recopiés, et leurs statistiques doivent
 * quand même se calculer.
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
  /** Capots réalisés par son équipe (toutes prises confondues). */
  capots: number
  /** Capots encaissés par son équipe. */
  capotsSubis: number
  /** Belote-rebelote annoncées NOMINATIVEMENT par lui. */
  belotes: number
  /** Belote-rebelote de son équipe, la sienne comprise. */
  belotesEquipe: number
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

type TourStat = Pick<BeloteRound,
  'trumpTaker' | 'dealer' | 'teamTaker' | 'dedans' | 'capot' | 'capotTeam' |
  'beloteRebelote' | 'beloteRebeloteTeam' | 'finalScore'> & { beloteRebelotePlayer?: string }

/** Une partie et ses tours — l'unité de calcul (une seule, ou toute une série). */
export interface PartieAvecTours {
  game: Pick<BeloteGame, 'team1Name' | 'team2Name' | 'team1Players' | 'team2Players'>
  rounds: TourStat[]
}

const nomComplet = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`.trim()

const pourcent = (n: number, sur: number) => (sur > 0 ? Math.round((n / sur) * 100) : null)

const autre = (t: TeamSlot): TeamSlot => (t === 'team1' ? 'team2' : 'team1')

const vide = (nom: string, equipe: TeamSlot | null, equipeNom: string): StatJoueur => ({
  nom, equipe, equipeNom,
  prises: 0, dedans: 0, reussies: 0, taux: null,
  capots: 0, capotsSubis: 0, belotes: 0, belotesEquipe: 0,
  points: 0, moyenne: null, distributions: 0,
})

/**
 * Statistiques par joueur, du plus preneur au moins preneur.
 *
 * Les joueurs des équipes sont listés même sans aucune prise : « celui qui ne
 * prend jamais » est une information en soi.
 */
export function statsJoueurs(parties: PartieAvecTours[]): StatJoueur[] {
  const map = new Map<string, StatJoueur>()

  const entree = (nom: string, equipe: TeamSlot | null, equipeNom: string): StatJoueur => {
    const cur = map.get(nom) ?? vide(nom, equipe, equipeNom)
    // L'équipe déduite d'un tour est plus sûre qu'une composition absente.
    if (equipe && !cur.equipe) { cur.equipe = equipe; cur.equipeNom = equipeNom }
    map.set(nom, cur)
    return cur
  }

  parties.forEach(({ game, rounds }) => {
    const nomEquipe = (t: TeamSlot) => (t === 'team1' ? game.team1Name : game.team2Name)

    // ── Qui joue CETTE partie, et dans quelle équipe ? ───────────────────────
    // Indispensable pour n'attribuer les capots et belotes d'équipe qu'aux
    // joueurs présents : sur une série, tout le monde n'a pas joué toutes les
    // parties.
    const equipeDansCettePartie = new Map<string, TeamSlot>()
    ;(game.team1Players ?? []).forEach((p) => equipeDansCettePartie.set(nomComplet(p), 'team1'))
    ;(game.team2Players ?? []).forEach((p) => equipeDansCettePartie.set(nomComplet(p), 'team2'))
    rounds.forEach((r) => {
      if (r.trumpTaker && !equipeDansCettePartie.has(r.trumpTaker)) {
        equipeDansCettePartie.set(r.trumpTaker, r.teamTaker)
      }
    })

    equipeDansCettePartie.forEach((t, nom) => entree(nom, t, nomEquipe(t)))

    // ── Ce qui se rattache à une PRISE ───────────────────────────────────────
    rounds.forEach((r) => {
      if (r.dealer) entree(r.dealer, null, '').distributions += 1
      if (!r.trumpTaker) return
      const s = entree(r.trumpTaker, r.teamTaker, nomEquipe(r.teamTaker))
      s.prises += 1
      s.points += r.finalScore?.[r.teamTaker] ?? 0
      if (r.dedans) s.dedans += 1
    })

    // ── Ce qui se rattache à l'ÉQUIPE (ou nominativement à un joueur) ────────
    rounds.forEach((r) => {
      if (r.beloteRebelote && r.beloteRebelotePlayer) {
        entree(r.beloteRebelotePlayer, null, '').belotes += 1
      }
      equipeDansCettePartie.forEach((equipe, nom) => {
        const s = entree(nom, equipe, nomEquipe(equipe))
        if (r.capot && r.capotTeam === equipe) s.capots += 1
        if (r.capot && r.capotTeam === autre(equipe)) s.capotsSubis += 1
        if (r.beloteRebelote && r.beloteRebeloteTeam === equipe) s.belotesEquipe += 1
      })
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
