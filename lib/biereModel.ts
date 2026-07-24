// Catalogue de bières — référentiels et calculs.
//
// Les listes viennent des « Listes déroulantes » de l'ancienne app AppSheet
// (feuille du même nom, colonnes Liste 16 à 22) : on reprend l'existant pour que
// les 184 bières importées retombent sur leurs pieds, sans ressaisie.
//
// Tout ce qui se déduit (moyenne, classement, bilan) est CALCULÉ ici, jamais
// stocké : une moyenne figée en base se périme au premier ajout de dégustation.

import type { Biere, Degustation } from '@/types'

/** Comment la bière est servie (Liste 19) */
export const SERVICES = ['Pression', 'Canette', 'Bock'] as const

/** Couleur / famille (Liste 20) */
export const TYPES_BIERE = ['Blonde', 'Ambré', 'Blanche', 'Brune', 'Fruité', 'Rouge', 'Rousse'] as const

/** Style brassicole (Liste 21) — souvent inconnu, d'où le caractère facultatif */
export const TYPOLOGIES = ['IPA', 'Bière de soif', 'Pale Ale'] as const

/** Où l'on boit (Liste 22) */
export const CONTEXTES = ['Terrasse', 'Interieur'] as const

/** Météo (Liste 18) */
export const METEOS = ['☀️', '🌦️', '☁️', '🌧️', '🌩️', '🌨️', '🌙'] as const

/** Ressenti thermique (Liste 17) */
export const RESSENTIS = ['🥶', '😎', '🥵'] as const

/** Notes possibles : 0 à 5 par pas de 0,5 (Liste 16) */
export const NOTES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

/** « 3,5 » — la virgule est la décimale française, et 3.0 s'écrit 3 */
export const formatNote = (n: number): string =>
  (Math.round(n * 10) / 10).toString().replace('.', ',')

/** Moyenne des notes d'une dégustation, toutes personnes confondues */
export function moyenneDegustation(d: Degustation): number | null {
  const vals = Object.values(d.notes ?? {}).filter((v) => typeof v === 'number')
  if (!vals.length) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

/**
 * Note d'une bière = moyenne de TOUTES les notes de TOUTES ses dégustations.
 * Une bière goûtée deux fois pèse donc ses deux avis, ce qui est le but.
 */
export function moyenneBiere(degs: Degustation[]): number | null {
  const vals = degs.flatMap((d) => Object.values(d.notes ?? {})).filter((v) => typeof v === 'number')
  if (!vals.length) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

/** Note moyenne donnée par UNE personne sur l'ensemble de ses dégustations */
export function moyennePersonne(degs: Degustation[], uid: string): number | null {
  const vals = degs.map((d) => d.notes?.[uid]).filter((v): v is number => typeof v === 'number')
  if (!vals.length) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

/** Saison d'une date — reprise de la « Liste 25 » de l'ancienne app */
export function saisonDe(d: Date): string {
  const m = d.getMonth() // 0 = janvier
  if (m <= 1 || m === 11) return '❄️ Hiver'
  if (m <= 4) return '☀️ Printemps'
  if (m <= 7) return '🌡️ Été'
  return '🍁 Automne'
}

export interface BiereCalculee {
  biere: Biere
  degustations: Degustation[]
  moyenne: number | null
  nbDegustations: number
  /** Dégustation la plus récente (celles sans date passent en dernier) */
  derniere?: Degustation
  /** Années où elle a été bue — alimente le filtre et le bilan */
  annees: number[]
  /** Lieux où elle a été bue, sans doublon */
  lieux: string[]
  /** Y a-t-il au moins une photo sur une de ses dégustations ? */
  aPhoto: boolean
}

/**
 * Assemble bières et dégustations, puis classe par note décroissante.
 * Les bières sans note sont rejetées en fin de liste : les afficher à 0
 * laisserait croire qu'elles ont été mal notées, alors qu'elles ne l'ont pas été.
 */
export function classer(
  bieres: Biere[],
  degsParBiere: Map<string, Degustation[]>,
): BiereCalculee[] {
  return bieres
    .map((biere) => {
      const degustations = degsParBiere.get(biere.id) ?? []
      const avecDate = degustations
        .filter((d) => d.date)
        .sort((a, b) => (b.date!.seconds ?? 0) - (a.date!.seconds ?? 0))
      return {
        biere,
        degustations,
        moyenne: moyenneBiere(degustations),
        nbDegustations: degustations.length,
        derniere: avecDate[0] ?? degustations[0],
        annees: [...new Set(avecDate.map((d) => d.date!.toDate().getFullYear()))],
        lieux: [...new Set(degustations.map((d) => d.lieu?.trim()).filter((l): l is string => !!l))],
        aPhoto: degustations.some((d) => (d.photos?.length ?? 0) > 0),
      }
    })
    .sort((a, b) => {
      if (a.moyenne === null && b.moyenne === null) return a.biere.nom.localeCompare(b.biere.nom)
      if (a.moyenne === null) return 1
      if (b.moyenne === null) return -1
      return b.moyenne - a.moyenne
    })
}

/** Top des bières selon UNE personne — « les préférées de Sarah » */
export function topPersonne(liste: BiereCalculee[], uid: string, n = 5): { biere: Biere; note: number }[] {
  return liste
    .map((b) => ({ biere: b.biere, note: moyennePersonne(b.degustations, uid) }))
    .filter((x): x is { biere: Biere; note: number } => x.note !== null)
    .sort((a, b) => b.note - a.note)
    .slice(0, n)
}

/** Là où on boit le plus — les dégustations portent le nom du bar */
export function lieuxFrequents(liste: BiereCalculee[], n = 8): { lieu: string; nb: number }[] {
  const m = new Map<string, number>()
  for (const b of liste) {
    for (const d of b.degustations) {
      const l = d.lieu?.trim()
      if (l) m.set(l, (m.get(l) ?? 0) + 1)
    }
  }
  return [...m.entries()].map(([lieu, nb]) => ({ lieu, nb })).sort((a, b) => b.nb - a.nb).slice(0, n)
}

/** Répartition des dégustations par année, la plus récente d'abord */
export function parAnnee(liste: BiereCalculee[]): { annee: number; nb: number }[] {
  const m = new Map<number, number>()
  for (const b of liste) {
    for (const d of b.degustations) {
      if (d.date) m.set(d.date.toDate().getFullYear(), (m.get(d.date.toDate().getFullYear()) ?? 0) + 1)
    }
  }
  return [...m.entries()].map(([annee, nb]) => ({ annee, nb })).sort((a, b) => b.annee - a.annee)
}

/** Répartition par saison — on ne boit pas les mêmes bières en hiver */
export function parSaison(liste: BiereCalculee[]): { saison: string; nb: number }[] {
  const m = new Map<string, number>()
  for (const b of liste) {
    for (const d of b.degustations) {
      if (d.date) { const s = saisonDe(d.date.toDate()); m.set(s, (m.get(s) ?? 0) + 1) }
    }
  }
  return [...m.entries()].map(([saison, nb]) => ({ saison, nb })).sort((a, b) => b.nb - a.nb)
}

export interface BilanCatalogue {
  total: number
  notees: number
  parType: { label: string; n: number }[]
  parTypologie: { label: string; n: number }[]
  parService: { label: string; n: number }[]
  meilleure?: BiereCalculee
  pire?: BiereCalculee
  moyenneGenerale: number | null
  degresMoyen: number | null
}

export function bilan(liste: BiereCalculee[]): BilanCatalogue {
  const notees = liste.filter((b) => b.moyenne !== null)
  const compte = (cle: (b: BiereCalculee) => string | undefined) => {
    const m = new Map<string, number>()
    for (const b of liste) {
      const v = cle(b)
      if (v) m.set(v, (m.get(v) ?? 0) + 1)
    }
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n)
  }
  const degres = liste.map((b) => b.biere.degres).filter((d): d is number => typeof d === 'number')

  return {
    total: liste.length,
    notees: notees.length,
    parType: compte((b) => b.biere.type),
    parTypologie: compte((b) => b.biere.typologie),
    parService: compte((b) => b.biere.service),
    meilleure: notees[0],
    pire: notees[notees.length - 1],
    moyenneGenerale: notees.length
      ? notees.reduce((s, b) => s + (b.moyenne ?? 0), 0) / notees.length
      : null,
    degresMoyen: degres.length ? degres.reduce((s, d) => s + d, 0) / degres.length : null,
  }
}
