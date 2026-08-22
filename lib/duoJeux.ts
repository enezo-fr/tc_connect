// App « Sarah & Ted » — module Jeux : référentiels et calculs.
//
// Fonctions PURES (aucune dépendance Firebase) : elles servent dans l'app, sur
// la page publique du lien de partage, et dans les statistiques. Les écritures
// vivent dans `lib/duoJeuxDb.ts`, le partage côté serveur dans `lib/jeuxShare.ts`.

import type { DuoPartie } from '@/types'

/**
 * Jeux connus — repères de saisie, la liste reste ouverte (le champ est libre).
 *
 * `scoreBasGagne` pré-règle le sens du classement à la création : au SkyJo, au
 * 6 qui prend ou au Rami, les points sont des pénalités et le plus PETIT total
 * gagne. Sans ça, le classement désigne le perdant.
 * `sansPoints` = jeu où l'on ne note pas de score, seulement l'ordre d'arrivée.
 */
export interface JeuConnu {
  nom: string
  scoreBasGagne?: boolean
  sansPoints?: boolean
}

export const JEUX_CONNUS: JeuConnu[] = [
  { nom: 'Uno' },
  { nom: 'SkyJo', scoreBasGagne: true },
  { nom: '6 qui prend', scoreBasGagne: true },
  { nom: 'Molki' },
  { nom: 'Belote' },
  { nom: 'Triomino' },
  { nom: 'Yams' },
  { nom: 'Rami', scoreBasGagne: true },
  { nom: 'Mille Bornes' },
]

/** Réglages par défaut d'un jeu (repli neutre : points, le plus grand gagne). */
export function reglagesDuJeu(nom: string): { scoreBasGagne: boolean; sansPoints: boolean } {
  const j = JEUX_CONNUS.find((x) => x.nom.toLowerCase() === nom.trim().toLowerCase())
  return { scoreBasGagne: !!j?.scoreBasGagne, sansPoints: !!j?.sansPoints }
}

// ─── Classement d'UNE partie ────────────────────────────────────────────────────

export interface LigneClassement {
  joueur: string
  /** Somme des points marqués (0 sur une partie sans points). */
  total: number
  /** 1 = vainqueur. Les ex æquo partagent le rang, et le suivant saute (1, 1, 3). */
  rang: number
  /** `false` = joueur non départagé (partie sans points dont l'ordre est incomplet). */
  classe: boolean
}

/** Une partie a-t-elle de quoi désigner un vainqueur ? */
export function partieJouee(p: DuoPartie): boolean {
  return p.sansPoints ? (p.ordre?.length ?? 0) > 0 : (p.tours?.length ?? 0) > 0
}

/** Total des points d'un joueur sur une partie. */
export function totalJoueur(p: DuoPartie, joueur: string): number {
  return (p.tours ?? []).reduce(
    (s, t) => s + ((t.scores ?? []).find((x) => x.joueur === joueur)?.points ?? 0),
    0,
  )
}

/**
 * Total par joueur et classement d'une partie.
 *
 * Deux façons de départager, selon la partie :
 *  - AVEC points : on somme les tours, dans le sens du jeu (`scoreBasGagne`) ;
 *  - SANS points : on suit l'ordre d'arrivée saisi (`ordre`). Ceux qui n'y sont
 *    pas restent non classés, à égalité derrière — c'est le cas d'une partie en
 *    cours où l'on n'a désigné que le vainqueur.
 */
export function classementPartie(partie: DuoPartie): LigneClassement[] {
  const joueurs = partie.joueurs ?? []

  if (partie.sansPoints) {
    const ordre = (partie.ordre ?? []).filter((j) => joueurs.includes(j))
    const restants = joueurs.filter((j) => !ordre.includes(j))
    return [
      ...ordre.map((joueur, i) => ({ joueur, total: 0, rang: i + 1, classe: true })),
      ...restants.map((joueur) => ({ joueur, total: 0, rang: ordre.length + 1, classe: false })),
    ]
  }

  const liste = joueurs.map((joueur) => ({ joueur, total: totalJoueur(partie, joueur) }))
  liste.sort((a, b) => (partie.scoreBasGagne ? a.total - b.total : b.total - a.total))

  const jouee = partieJouee(partie)
  let rang = 0
  let precedent: number | null = null
  return liste.map((l, i) => {
    if (precedent === null || l.total !== precedent) rang = i + 1
    precedent = l.total
    return { ...l, rang, classe: jouee }
  })
}

/** Vainqueur(s) d'une partie — vide tant qu'elle n'a rien d'enregistré. */
export function vainqueurs(partie: DuoPartie): string[] {
  if (!partieJouee(partie)) return []
  return classementPartie(partie).filter((l) => l.classe && l.rang === 1).map((l) => l.joueur)
}

/**
 * L'objectif de score est-il atteint ?
 *
 * Dans les deux sens, c'est le fait d'ATTEINDRE la cible qui arrête la partie :
 * à l'Uno on court après les 500 points, au SkyJo on est éliminé en les
 * dépassant — dans un cas comme dans l'autre, la partie est finie.
 */
export function objectifAtteint(partie: DuoPartie): boolean {
  const cible = partie.objectif ?? 0
  if (!cible || partie.sansPoints) return false
  return (partie.joueurs ?? []).some((j) => totalJoueur(partie, j) >= cible)
}

// ─── Soirées (parties liées) ────────────────────────────────────────────────────

/**
 * Une soirée n'a pas de collection dédiée : c'est un `soireeId` recopié sur
 * chaque partie liée — même patron que les séries de belote. Elle peut mélanger
 * plusieurs jeux : c'est tout l'intérêt d'une soirée jeux.
 */
export type BaremeSoiree = 'victoires' | 'places' | 'points'

export const BAREMES: { cle: BaremeSoiree; nom: string; aide: string }[] = [
  {
    cle: 'victoires', nom: 'Victoires',
    aide: 'Une partie gagnée = 1 point. Le plus simple, et le seul qui ne dépend pas du nombre de joueurs.',
  },
  {
    cle: 'places', nom: 'Places',
    aide: "Chaque partie rapporte des points selon la place : le 1er d'une partie à 4 marque 4 points, le dernier 1. Comparable d'un jeu à l'autre.",
  },
  {
    cle: 'points', nom: 'Points cumulés',
    aide: 'La somme des scores de toutes les parties. Réservé aux soirées où toutes les parties sont le même jeu — additionner un Uno et un SkyJo ne veut rien dire.',
  },
]

export function nouvelleSoireeId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Date d'une partie en secondes (repli sur la création). */
export const secondesPartie = (p: DuoPartie): number =>
  p.date?.seconds ?? p.createdAt?.seconds ?? 0

/** Parties d'une soirée, de la plus ancienne à la plus récente (ordre de jeu). */
export function partiesDeSoiree(parties: DuoPartie[], soireeId: string): DuoPartie[] {
  return parties
    .filter((p) => p.soireeId === soireeId)
    .sort((a, b) => secondesPartie(a) - secondesPartie(b))
}

export interface Soiree {
  soireeId: string
  nom: string
  parties: DuoPartie[]
  /** Jeux distincts joués pendant la soirée. */
  jeux: string[]
  bareme: BaremeSoiree
  /** Date de la dernière partie (tri des soirées). */
  dernier: number
}

/** Soirées visibles, de la plus récente à la plus ancienne. */
export function soireesDe(parties: DuoPartie[]): Soiree[] {
  const map = new Map<string, DuoPartie[]>()
  parties.forEach((p) => {
    if (!p.soireeId) return
    map.set(p.soireeId, [...(map.get(p.soireeId) ?? []), p])
  })
  return [...map.entries()]
    .map(([soireeId, liste]) => {
      const ordonnees = [...liste].sort((a, b) => secondesPartie(a) - secondesPartie(b))
      return {
        soireeId,
        nom: ordonnees.find((p) => p.soireeName)?.soireeName ?? 'Soirée jeux',
        parties: ordonnees,
        jeux: [...new Set(ordonnees.map((p) => p.jeu).filter(Boolean))],
        bareme: baremeDeSoiree(ordonnees),
        dernier: Math.max(...ordonnees.map(secondesPartie)),
      }
    })
    .sort((a, b) => b.dernier - a.dernier)
}

/**
 * Peut-on additionner les scores bruts ? Seulement si toutes les parties sont
 * le même jeu, dans le même sens, et avec des points. Sinon le total mélange
 * des unités qui n'ont rien à voir.
 */
export function cumulPointsPossible(parties: DuoPartie[]): boolean {
  if (parties.length === 0) return false
  if (parties.some((p) => p.sansPoints)) return false
  const jeu = parties[0].jeu
  const sens = !!parties[0].scoreBasGagne
  return parties.every((p) => p.jeu === jeu && !!p.scoreBasGagne === sens)
}

/** Barème enregistré sur la soirée, ramené à ce qui a du sens pour ces parties. */
export function baremeDeSoiree(parties: DuoPartie[]): BaremeSoiree {
  const choisi = parties.find((p) => p.soireeBareme)?.soireeBareme
  if (choisi === 'points') return cumulPointsPossible(parties) ? 'points' : 'places'
  if (choisi === 'victoires' || choisi === 'places') return choisi
  return cumulPointsPossible(parties) ? 'points' : 'places'
}

export interface LigneSoiree {
  joueur: string
  /** Points selon le barème retenu. */
  points: number
  rang: number
  parties: number
  victoires: number
  /** Places sur le podium (rang ≤ 3). */
  podiums: number
  /** Somme des scores bruts — indicatif quand le barème ne s'en sert pas. */
  totalBrut: number
}

/**
 * Classement d'une soirée, tous jeux confondus.
 *
 * ⚠️ Les scores bruts ne sont additionnés QUE dans le barème « points », et
 * seulement s'il est autorisé : 500 points à l'Uno et 32 au SkyJo ne se
 * comparent pas. Les deux autres barèmes ramènent chaque partie à un résultat
 * (une victoire, une place), ce qui se cumule entre n'importe quels jeux.
 */
export function classementSoiree(parties: DuoPartie[], bareme: BaremeSoiree): LigneSoiree[] {
  const mode: BaremeSoiree = bareme === 'points' && !cumulPointsPossible(parties) ? 'places' : bareme
  const map = new Map<string, LigneSoiree>()

  const ligne = (joueur: string): LigneSoiree => {
    const cur = map.get(joueur)
      ?? { joueur, points: 0, rang: 0, parties: 0, victoires: 0, podiums: 0, totalBrut: 0 }
    map.set(joueur, cur)
    return cur
  }

  parties.forEach((p) => {
    // Une partie sans résultat ne rapporte rien, mais les joueurs restent visibles.
    const jouee = partieJouee(p)
    const classement = classementPartie(p)
    const classes = classement.filter((l) => l.classe).length

    classement.forEach((l) => {
      const s = ligne(l.joueur)
      // Une partie encore vide n'est pas comptée : elle ferait chuter le ratio
      // « victoires / parties » de tout le monde le temps qu'on la remplisse.
      if (!jouee) return
      s.parties += 1
      s.totalBrut += l.total
      if (l.classe && l.rang === 1) s.victoires += 1
      if (l.classe && l.rang <= 3) s.podiums += 1
      if (mode === 'victoires') s.points += l.classe && l.rang === 1 ? 1 : 0
      else if (mode === 'places') s.points += l.classe ? Math.max(1, classes - l.rang + 1) : 0
      else s.points += l.total
    })
  })

  // En barème « points » sur un jeu où le plus petit gagne, le meilleur est le
  // plus bas — trier comme d'habitude désignerait le dernier.
  const sensBas = mode === 'points' && parties.every((p) => p.scoreBasGagne)
  const lignes = [...map.values()].sort((a, b) =>
    (sensBas ? a.points - b.points : b.points - a.points)
    || b.victoires - a.victoires
    || b.podiums - a.podiums
    || a.joueur.localeCompare(b.joueur))

  let rang = 0
  let precedent: number | null = null
  return lignes.map((l, i) => {
    if (precedent === null || l.points !== precedent) rang = i + 1
    precedent = l.points
    return { ...l, rang }
  })
}

/** Écart entre les deux premiers d'un classement de soirée. */
export function ecartSoiree(lignes: LigneSoiree[]): { ecart: number; enTete: LigneSoiree; second: LigneSoiree } | null {
  if (lignes.length < 2) return null
  const [enTete, second] = lignes
  return { ecart: Math.abs(enTete.points - second.points), enTete, second }
}

/** Nom par défaut d'une soirée, d'après sa date. */
export function nomSoireePour(d: Date): string {
  return `Soirée du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
}

/** Nom par défaut d'une soirée créée depuis une partie. */
export function nomSoireeParDefaut(p: DuoPartie): string {
  return nomSoireePour(p.date?.toDate() ?? p.createdAt?.toDate() ?? new Date())
}

// ─── Statistiques ───────────────────────────────────────────────────────────────

export interface StatJoueur {
  joueur: string
  parties: number
  victoires: number
  /** Part de victoires, `null` si aucune partie terminée. */
  taux: number | null
  podiums: number
  /** Points cumulés toutes parties confondues — indicatif, tous jeux mélangés. */
  pointsMarques: number
  /** Meilleur score personnel et le jeu où il a été fait. */
  record: { points: number; jeu: string } | null
  /** Victoires d'affilée en cours (parties les plus récentes). */
  serieEnCours: number
  meilleureSerie: number
  /** Jeu où il gagne le plus souvent (au moins 2 parties). */
  jeuFavori: { jeu: string; victoires: number; parties: number } | null
}

const pourcent = (n: number, sur: number) => (sur > 0 ? Math.round((n / sur) * 100) : null)

/**
 * Bilan par joueur, du plus victorieux au moins victorieux.
 * Ne comptent que les parties qui ont un résultat.
 */
export function statsJoueurs(parties: DuoPartie[]): StatJoueur[] {
  const jouees = parties.filter(partieJouee).sort((a, b) => secondesPartie(a) - secondesPartie(b))
  const map = new Map<string, StatJoueur>()
  const parJeu = new Map<string, Map<string, { victoires: number; parties: number }>>()
  const suites = new Map<string, { courante: number; meilleure: number }>()

  const stat = (joueur: string): StatJoueur => {
    const cur = map.get(joueur) ?? {
      joueur, parties: 0, victoires: 0, taux: null, podiums: 0, pointsMarques: 0,
      record: null, serieEnCours: 0, meilleureSerie: 0, jeuFavori: null,
    }
    map.set(joueur, cur)
    return cur
  }

  jouees.forEach((p) => {
    classementPartie(p).forEach((l) => {
      const s = stat(l.joueur)
      s.parties += 1
      s.pointsMarques += l.total
      const gagne = l.classe && l.rang === 1
      if (gagne) s.victoires += 1
      if (l.classe && l.rang <= 3) s.podiums += 1
      if (!p.sansPoints && (!s.record || l.total > s.record.points)) {
        s.record = { points: l.total, jeu: p.jeu }
      }

      const jeux = parJeu.get(l.joueur) ?? new Map<string, { victoires: number; parties: number }>()
      const e = jeux.get(p.jeu) ?? { victoires: 0, parties: 0 }
      e.parties += 1
      if (gagne) e.victoires += 1
      jeux.set(p.jeu, e)
      parJeu.set(l.joueur, jeux)

      // Les parties sont parcourues de la plus ancienne à la plus récente : la
      // suite « courante » à la fin est donc bien la série en cours.
      const suite = suites.get(l.joueur) ?? { courante: 0, meilleure: 0 }
      suite.courante = gagne ? suite.courante + 1 : 0
      suite.meilleure = Math.max(suite.meilleure, suite.courante)
      suites.set(l.joueur, suite)
    })
  })

  return [...map.values()]
    .map((s) => {
      const jeux = [...(parJeu.get(s.joueur) ?? new Map<string, { victoires: number; parties: number }>()).entries()]
        .filter(([, e]) => e.parties >= 2 && e.victoires > 0)
        .sort((a, b) => (b[1].victoires / b[1].parties) - (a[1].victoires / a[1].parties)
          || b[1].parties - a[1].parties)
      const suite = suites.get(s.joueur) ?? { courante: 0, meilleure: 0 }
      return {
        ...s,
        taux: pourcent(s.victoires, s.parties),
        serieEnCours: suite.courante,
        meilleureSerie: suite.meilleure,
        jeuFavori: jeux.length ? { jeu: jeux[0][0], ...jeux[0][1] } : null,
      }
    })
    .sort((a, b) => b.victoires - a.victoires || b.parties - a.parties || a.joueur.localeCompare(b.joueur))
}

export interface StatJeu {
  jeu: string
  parties: number
  joueurs: number
  scoreBasGagne: boolean
  sansPoints: boolean
  /** Vainqueur de la dernière partie jouée — le tenant du titre. */
  tenant: string | null
  /** Meilleur score jamais réalisé (le plus bas si le jeu se joue à l'envers). */
  record: { joueur: string; points: number } | null
  /** Joueur qui gagne le plus souvent à ce jeu. */
  meilleur: { joueur: string; victoires: number; parties: number } | null
}

/** Bilan par jeu — c'est là qu'on voit le cumul des parties d'un même jeu. */
export function statsParJeu(parties: DuoPartie[]): StatJeu[] {
  const jouees = parties.filter(partieJouee).sort((a, b) => secondesPartie(a) - secondesPartie(b))
  const map = new Map<string, DuoPartie[]>()
  jouees.forEach((p) => map.set(p.jeu, [...(map.get(p.jeu) ?? []), p]))

  return [...map.entries()].map(([jeu, liste]) => {
    const sansPoints = liste.every((p) => p.sansPoints)
    const scoreBasGagne = !!liste[0].scoreBasGagne
    const joueurs = new Set<string>()
    const victoires = new Map<string, { victoires: number; parties: number }>()
    let record: { joueur: string; points: number } | null = null

    liste.forEach((p) => {
      classementPartie(p).forEach((l) => {
        joueurs.add(l.joueur)
        const e = victoires.get(l.joueur) ?? { victoires: 0, parties: 0 }
        e.parties += 1
        if (l.classe && l.rang === 1) e.victoires += 1
        victoires.set(l.joueur, e)
        if (p.sansPoints) return
        const actuel = record
        const mieux = actuel === null
          || (scoreBasGagne ? l.total < actuel.points : l.total > actuel.points)
        if (mieux) record = { joueur: l.joueur, points: l.total }
      })
    })

    const meilleurs = [...victoires.entries()]
      .filter(([, e]) => e.victoires > 0)
      .sort((a, b) => b[1].victoires - a[1].victoires || a[1].parties - b[1].parties)

    const derniere = liste[liste.length - 1]
    return {
      jeu,
      parties: liste.length,
      joueurs: joueurs.size,
      scoreBasGagne,
      sansPoints,
      tenant: vainqueurs(derniere)[0] ?? null,
      record: sansPoints ? null : record,
      meilleur: meilleurs.length ? { joueur: meilleurs[0][0], ...meilleurs[0][1] } : null,
    }
  }).sort((a, b) => b.parties - a.parties || a.jeu.localeCompare(b.jeu))
}

export interface FaceAFace {
  a: string
  b: string
  parties: number
  victoiresA: number
  victoiresB: number
  /** Parties où aucun des deux n'a gagné (un tiers l'a emporté, ou égalité). */
  autres: number
}

/** Duel entre deux joueurs, sur les seules parties où ils étaient tous les deux. */
export function faceAFace(parties: DuoPartie[], a: string, b: string): FaceAFace {
  const res: FaceAFace = { a, b, parties: 0, victoiresA: 0, victoiresB: 0, autres: 0 }
  parties.filter(partieJouee).forEach((p) => {
    if (!p.joueurs?.includes(a) || !p.joueurs?.includes(b)) return
    res.parties += 1
    const gagnants = vainqueurs(p)
    const ga = gagnants.includes(a)
    const gb = gagnants.includes(b)
    if (ga && !gb) res.victoiresA += 1
    else if (gb && !ga) res.victoiresB += 1
    else res.autres += 1
  })
  return res
}

/** Les deux joueurs les plus présents — de quoi proposer LE duel de la maison. */
export function duoVedette(parties: DuoPartie[]): [string, string] | null {
  const presence = new Map<string, number>()
  parties.forEach((p) => (p.joueurs ?? []).forEach((j) => presence.set(j, (presence.get(j) ?? 0) + 1)))
  const tri = [...presence.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return tri.length >= 2 ? [tri[0][0], tri[1][0]] : null
}

/** Joueurs déjà vus, du plus fréquent au moins fréquent (pastilles de saisie). */
export function joueursConnus(parties: DuoPartie[]): string[] {
  const m = new Map<string, number>()
  parties.forEach((p) => (p.joueurs ?? []).forEach((j) => m.set(j, (m.get(j) ?? 0) + 1)))
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([j]) => j)
}

/** Jeux déjà joués, du plus fréquent au moins fréquent. */
export function jeuxJoues(parties: DuoPartie[]): string[] {
  const m = new Map<string, number>()
  parties.forEach((p) => { if (p.jeu) m.set(p.jeu, (m.get(p.jeu) ?? 0) + 1) })
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([j]) => j)
}
