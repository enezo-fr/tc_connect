import type {
  BeloteGame, BeloteRegles, BeloteRound, RoundInput, Score, TeamSlot,
} from './types'

/** Règles retenues par défaut (choix de la maison) quand la partie n'en porte pas. */
export const REGLES_DEFAUT: BeloteRegles = { egalite: 'litige', beloteDansContrat: false }

/** Total des points d'un tour de belote (dont 10 pour le dernier pli) */
export const BELOTE_TOTAL = 162

/** Valeur d'un capot (tous les plis) */
export const BELOTE_CAPOT = 252

/** Seuil de contrat : l'équipe preneuse doit faire au moins la moitié */
export const BELOTE_CONTRAT = 82

/** Bonus belote & rebelote */
export const BELOTE_BONUS = 20

/** Arrondi à la dizaine la plus proche (5 arrondi au-dessus) */
export function roundToNearestTen(n: number): number {
  return Math.round(n / 10) * 10
}

/**
 * Vérifie que la somme des points bruts vaut 162.
 * (Utilisé hors capot où la saisie brute n'a pas lieu d'être.)
 */
export function validateRoundPoints(nous: number, eux: number): boolean {
  return nous + eux === BELOTE_TOTAL
}

export const reglesDe = (game?: Pick<BeloteGame, 'regles'> | null): BeloteRegles =>
  game?.regles ?? REGLES_DEFAUT

const autre = (t: TeamSlot): TeamSlot => (t === 'team1' ? 'team2' : 'team1')

/** Bonus belote revenant à une équipe sur ce tour. */
function bonusBelote(input: Pick<RoundInput, 'beloteRebelote' | 'beloteRebeloteTeam'>, t: TeamSlot): number {
  return input.beloteRebelote && input.beloteRebeloteTeam === t ? BELOTE_BONUS : 0
}

/**
 * Points aux cartes que le preneur doit atteindre pour tenir son contrat.
 *
 * Sans belote au contrat, c'est toujours 82 (la moitié de 162, plus un). Quand la
 * belote compte, elle déplace le seuil : 72 si le preneur la détient, 92 si ce
 * sont ses adversaires — d'où les « litiges » de table. Et si la règle donne
 * l'égalité au preneur, un point de moins suffit.
 */
export function seuilContrat(
  input: Pick<RoundInput, 'teamTaker' | 'beloteRebelote' | 'beloteRebeloteTeam'>,
  regles: BeloteRegles = REGLES_DEFAUT,
): number {
  let seuil = BELOTE_CONTRAT
  if (regles.beloteDansContrat) {
    const preneur = bonusBelote(input, input.teamTaker)
    const adverse = bonusBelote(input, autre(input.teamTaker))
    // cartesPreneur > 81 + (bonusAdverse - bonusPreneur) / 2
    seuil = Math.floor(81 + (adverse - preneur) / 2) + 1
  }
  return regles.egalite === 'preneur' ? seuil - 1 : seuil
}

export type IssueTour = 'contrat' | 'dedans' | 'litige' | 'capot'

export interface ResultatTour {
  finalScore: Score
  dedans: boolean
  litige: boolean
  /** Points de litige encaissés sur ce tour (déjà compris dans `finalScore`). */
  potRecu: number
  /** Points partis en attente sur ce tour. */
  potAjoute: number
  issue: IssueTour
  /** Ce qu'il fallait faire aux cartes (indication affichée à la saisie). */
  seuil: number
  /** Le verdict vient d'une correction manuelle. */
  force: boolean
}

/**
 * Résultat d'UN tour, hors report de litige (celui-ci se règle sur la séquence
 * complète, cf. `calculerPartie`). Fonction pure.
 */
export function calculerTour(input: RoundInput, regles: BeloteRegles = REGLES_DEFAUT): ResultatTour {
  const rounding = input.rounding ?? false
  const preneur = input.teamTaker
  const adverse = autre(preneur)
  const seuil = seuilContrat(input, regles)

  const score: Score = { team1: 0, team2: 0 }
  const poser = (t: TeamSlot, v: number) => { score[t] = v }

  // ── Capot : tous les plis, le contrat ne se discute pas ────────────────────
  if (input.capot && input.capotTeam) {
    poser(input.capotTeam, BELOTE_CAPOT)
    poser(autre(input.capotTeam), 0)
    score.team1 += bonusBelote(input, 'team1')
    score.team2 += bonusBelote(input, 'team2')
    // Un capot encaissé par le preneur est une chute, comme un dedans.
    const dedans = input.dedansForce ?? (input.capotTeam !== preneur)
    return {
      finalScore: arrondir(score, rounding),
      dedans, litige: false, potRecu: 0, potAjoute: 0,
      issue: 'capot', seuil, force: input.dedansForce !== undefined,
    }
  }

  // ── Cas normal : on compare les deux totaux « de contrat » ─────────────────
  const cartes: Score = { team1: input.rawScoreNous || 0, team2: input.rawScoreEux || 0 }
  const compte = (t: TeamSlot) => cartes[t] + (regles.beloteDansContrat ? bonusBelote(input, t) : 0)

  const totalPreneur = compte(preneur)
  const totalAdverse = compte(adverse)

  let issue: IssueTour
  if (input.dedansForce !== undefined) issue = input.dedansForce ? 'dedans' : 'contrat'
  else if (totalPreneur > totalAdverse) issue = 'contrat'
  else if (totalPreneur < totalAdverse) issue = 'dedans'
  else issue = regles.egalite === 'preneur' ? 'contrat'
    : regles.egalite === 'dedans' ? 'dedans'
    : 'litige'

  let potAjoute = 0
  if (issue === 'contrat') {
    // Chacun ses points, plus sa belote.
    poser(preneur, cartes[preneur] + bonusBelote(input, preneur))
    poser(adverse, cartes[adverse] + bonusBelote(input, adverse))
  } else if (issue === 'dedans') {
    // Le preneur chute : l'adversaire empoche toute la donne. La belote reste
    // acquise à qui la détient, même dans la chute.
    poser(preneur, bonusBelote(input, preneur))
    poser(adverse, BELOTE_TOTAL + bonusBelote(input, adverse))
  } else {
    // Litige : le preneur ne marque rien, ses points aux cartes attendent la
    // donne suivante. La belote, elle, est acquise tout de suite.
    poser(preneur, bonusBelote(input, preneur))
    poser(adverse, cartes[adverse] + bonusBelote(input, adverse))
    potAjoute = cartes[preneur]
  }

  return {
    finalScore: arrondir(score, rounding),
    dedans: issue === 'dedans',
    litige: issue === 'litige',
    potRecu: 0,
    potAjoute,
    issue,
    seuil,
    force: input.dedansForce !== undefined,
  }
}

function arrondir(s: Score, rounding: boolean): Score {
  return rounding
    ? { team1: roundToNearestTen(s.team1), team2: roundToNearestTen(s.team2) }
    : s
}

export interface ResultatPartie {
  tours: ResultatTour[]
  /** Points encore en attente d'attribution à la fin de la séquence. */
  pot: number
  totaux: Score
}

/**
 * Calcule TOUTE la partie, dans l'ordre des tours.
 *
 * Le report de litige impose cette lecture séquentielle : les points mis de côté
 * reviennent à l'équipe qui remporte la donne SUIVANTE. Tant qu'aucune donne
 * n'est remportée (litiges enchaînés, ou donne à égalité parfaite), la cagnotte
 * s'empile.
 */
export function calculerPartie(inputs: RoundInput[], regles: BeloteRegles = REGLES_DEFAUT): ResultatPartie {
  let pot = 0
  const tours = inputs.map((input) => {
    const r = calculerTour(input, regles)
    if (r.litige) { pot += r.potAjoute; return r }

    if (pot > 0) {
      const gagnant: TeamSlot | null =
        r.finalScore.team1 > r.finalScore.team2 ? 'team1'
        : r.finalScore.team2 > r.finalScore.team1 ? 'team2'
        : null
      if (gagnant) {
        r.finalScore[gagnant] += pot
        r.potRecu = pot
        pot = 0
      }
    }
    return r
  })

  return { tours, pot, totaux: sumRounds(tours.map((t) => ({ finalScore: t.finalScore }))) }
}

/** Cumule les scores finaux d'une liste de tours */
export function sumRounds(rounds: Pick<BeloteRound, 'finalScore'>[]): Score {
  return rounds.reduce<Score>(
    (acc, r) => ({
      team1: acc.team1 + (r.finalScore?.team1 ?? 0),
      team2: acc.team2 + (r.finalScore?.team2 ?? 0),
    }),
    { team1: 0, team2: 0 },
  )
}

/** Remet un tour enregistré sous la forme attendue par le moteur. */
export function inputDeTour(r: Pick<BeloteRound,
  'teamTaker' | 'rawScoreNous' | 'rawScoreEux' | 'capot' | 'capotTeam' |
  'beloteRebelote' | 'beloteRebeloteTeam' | 'dedansForce'>): RoundInput {
  return {
    teamTaker: r.teamTaker,
    rawScoreNous: r.rawScoreNous,
    rawScoreEux: r.rawScoreEux,
    capot: r.capot,
    capotTeam: r.capotTeam,
    beloteRebelote: r.beloteRebelote,
    beloteRebeloteTeam: r.beloteRebeloteTeam,
    // `typeof` et pas `!== undefined` : Firestore rend `null` pour un champ vidé,
    // et un `null` serait pris pour un verdict imposé « contrat tenu ».
    ...(typeof r.dedansForce === 'boolean' ? { dedansForce: r.dedansForce } : {}),
  }
}

/**
 * Score final d'un tour isolé — conservé pour les appels qui n'ont pas besoin du
 * report de litige (aperçu à la saisie).
 */
export function calculateRoundScore(round: RoundInput, regles: BeloteRegles = REGLES_DEFAUT): Score {
  return calculerTour(round, regles).finalScore
}

/**
 * Détermine si la partie est terminée et qui gagne.
 * - 'rounds' : terminée après endValue tours
 * - 'score'  : terminée dès qu'une équipe atteint endValue
 */
export function checkGameEnd(
  game: Pick<BeloteGame, 'endCondition' | 'endValue' | 'team1Id' | 'team2Id'>,
  rounds: Pick<BeloteRound, 'finalScore'>[],
): { finished: boolean; winnerId: string | null } {
  const totals = sumRounds(rounds)

  const winner = (): string | null => {
    if (totals.team1 === totals.team2) return null
    return totals.team1 > totals.team2 ? game.team1Id : game.team2Id
  }

  if (game.endCondition === 'rounds') {
    if (rounds.length >= game.endValue) return { finished: true, winnerId: winner() }
    return { finished: false, winnerId: null }
  }

  // endCondition === 'score'
  if (totals.team1 >= game.endValue || totals.team2 >= game.endValue) {
    return { finished: true, winnerId: winner() }
  }
  return { finished: false, winnerId: null }
}
