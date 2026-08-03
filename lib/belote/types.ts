import { Timestamp } from 'firebase/firestore'

// ─── Types génériques (réutilisables pour d'autres jeux à terme) ────────────────

export type TeamSlot = 'team1' | 'team2'
export type BeloteEndCondition = 'rounds' | 'score'
export type BeloteGameStatus = 'in_progress' | 'finished'

export interface Score {
  team1: number
  team2: number
}

// ─── Règles de table ────────────────────────────────────────────────────────────

/**
 * Que faire quand le preneur finit à égalité (81-81, ou 91-91 si la belote
 * compte) ? Trois écoles, choisies PAR PARTIE.
 */
export type RegleEgalite =
  | 'dedans'   // il fallait faire mieux : le preneur chute
  | 'litige'   // personne ne marque, les points du preneur attendent la donne suivante
  | 'preneur'  // la moitié suffit : chacun garde ses points

export interface BeloteRegles {
  egalite: RegleEgalite
  /**
   * La belote-rebelote (20) entre-t-elle dans le calcul du contrat ?
   * Si oui, une belote adverse peut mettre le preneur dedans (seuil à 92) ;
   * si non, elle s'ajoute au tableau une fois le contrat jugé (seuil à 82).
   */
  beloteDansContrat: boolean
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

  /** Règles de table choisies pour cette partie (absentes = `REGLES_DEFAUT`). */
  regles?: BeloteRegles

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
  /** Le preneur a chuté — CALCULÉ à partir des points et des règles de la partie. */
  dedans: boolean
  /** L'utilisateur a contredit le verdict de l'app (cas particulier de table). */
  dedansForce?: boolean
  beloteRebelote: boolean
  beloteRebeloteTeam: TeamSlot | null

  /** Ce tour est parti en litige : ses points attendent la donne suivante. */
  litige?: boolean
  /** Points de litige encaissés sur ce tour (déjà compris dans `finalScore`). */
  potRecu?: number

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
  /**
   * Verdict imposé à la main. `undefined` = l'app tranche d'après les règles ;
   * `true`/`false` = la table a corrigé (points mal saisis, exception maison).
   */
  dedansForce?: boolean
  beloteRebelote: boolean
  beloteRebeloteTeam: TeamSlot | null
  rounding?: boolean           // arrondi à la dizaine (défaut : false)
}
