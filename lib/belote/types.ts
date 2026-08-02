import { Timestamp } from 'firebase/firestore'

// ─── Types génériques (réutilisables pour d'autres jeux à terme) ────────────────

export type TeamSlot = 'team1' | 'team2'
export type BeloteEndCondition = 'rounds' | 'score'
export type BeloteGameStatus = 'in_progress' | 'finished'

export interface Score {
  team1: number
  team2: number
}

// ─── Belote ─────────────────────────────────────────────────────────────────────

export interface BelotePlayer {
  firstName: string
  lastName: string
}

/** Collection : belote_teams */
export interface BeloteTeam {
  id: string
  name: string                 // auto-généré depuis les prénoms : "Marie & Pierre"
  players: BelotePlayer[]      // 2 joueurs
  createdBy?: string           // UID du créateur (données privées à chaque utilisateur)
  createdAt: Timestamp
}

/** Collection : belote_games */
export interface BeloteGame {
  id: string
  team1Id: string
  team2Id: string
  team1Name: string            // dénormalisé pour affichage rapide
  team2Name: string
  /**
   * Joueurs dénormalisés depuis `belote_teams`. Indispensable au PARTAGE : les
   * équipes restent privées à leur créateur (`createdBy`), une personne invitée
   * ne peut donc pas les lire — sans cette copie, elle ne pourrait pas choisir
   * le preneur d'atout. Recopiés à la création, et rattrapés à l'ouverture d'une
   * partie ancienne par son propriétaire.
   */
  team1Players?: BelotePlayer[]
  team2Players?: BelotePlayer[]
  endCondition: BeloteEndCondition
  endValue: number             // nombre de tours OU score cible
  status: BeloteGameStatus
  winnerId: string | null
  totalScore: Score
  createdBy?: string           // UID du créateur (pour nettoyage des données à l'archivage)

  /** UID ayant accès à la partie (le créateur en fait toujours partie). */
  members?: string[]
  /** Jeton du lien public / QR : donne accès SANS COMPTE (lecture + modification). */
  shareToken?: string
  /** Adresses à qui le lien a été envoyé — mémo d'envoi, aucun droit en soi. */
  sharedEmails?: string[]

  /** Parties liées (revanche…) : même `serieId` = même série. */
  serieId?: string | null
  serieName?: string | null

  createdAt: Timestamp
  finishedAt: Timestamp | null
}

/** Collection : belote_rounds */
export interface BeloteRound {
  id: string
  gameId: string
  roundNumber: number
  dealer: string               // distributeur (nom complet)
  trumpTaker: string           // preneur d'atout (nom complet)
  teamTaker: TeamSlot          // équipe qui a pris l'atout

  // Saisie brute (Nous = team1, Eux = team2)
  rawScoreNous: number
  rawScoreEux: number

  // Événements spéciaux
  capot: boolean
  capotTeam: TeamSlot | null
  dedans: boolean
  beloteRebelote: boolean
  beloteRebeloteTeam: TeamSlot | null

  // Scores calculés après application des règles
  finalScore: Score
  createdAt: Timestamp
}

/**
 * Données pures nécessaires au calcul d'un tour (sans champs Firestore).
 * Convention : Nous = team1, Eux = team2.
 */
export interface RoundInput {
  teamTaker: TeamSlot
  rawScoreNous: number
  rawScoreEux: number
  capot: boolean
  capotTeam: TeamSlot | null
  dedans: boolean
  beloteRebelote: boolean
  beloteRebeloteTeam: TeamSlot | null
  rounding?: boolean           // arrondi à la dizaine (défaut : true)
}
