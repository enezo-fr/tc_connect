// Commandes au bar — agrégations.
//
// Trois lectures d'une même commande, et c'est tout l'intérêt de l'app :
//  1. la SAISIE, par personne, parce qu'on fait le tour de la table ;
//  2. le RÉCAP BAR, regroupé par boisson, parce que c'est ce qu'on dit au comptoir ;
//  3. l'ADDITION, par personne, parce qu'il faut se répartir la note.
//
// Les lignes restent stockées à l'unité (une par personne) : c'est la seule
// forme qui permet de produire les trois. Un total agrégé ne se redécoupe pas.

import type { Commande, LigneCommande } from '@/types'

/** Boissons proposées d'emblée — complétées par l'historique réel */
export const BOISSONS_COURANTES = [
  'Pinte blonde', 'Demi blonde', 'Pinte IPA', 'Demi IPA', 'Pinte blanche',
  'Bière bouteille', 'Coca', 'Eau pétillante', 'Café', 'Vin rouge', 'Vin blanc',
  'Cocktail', 'Diabolo', 'Perrier',
]

/** Contenances proposées avant le nom (« Pinte » + « blonde » → « Pinte blonde »).
 *  Le format se colle simplement devant le nom : le champ `boisson` reste unique,
 *  donc les regroupements bar/addition ne changent pas. */
export const FORMATS_BOISSON = ['Pinte', 'Demi', 'Verre', 'Bouteille', 'Shooter']

/** Compose « format + nom » en évitant de répéter le format déjà tapé dans le nom. */
export function composerBoisson(format: string, nom: string): string {
  const n = nom.trim()
  const f = format.trim()
  if (!f) return n
  if (!n) return f
  if (n.toLowerCase().startsWith(f.toLowerCase())) return n
  return `${f} ${n}`
}

/** Reporte un prix sur TOUTES les lignes d'une même boisson (dans un bar, la pinte
 *  a le même prix partout — sauf happy hour, où l'on ressaisit et ça se propage). */
export function propagerPrix(lignes: LigneCommande[], boisson: string, prix: number): LigneCommande[] {
  const cle = boisson.trim().toLowerCase()
  return (lignes ?? []).map((l) => (l.boisson.trim().toLowerCase() === cle ? { ...l, prix } : l))
}

/** Remappe le champ `pour` des lignes après renommage / suppression de personnes.
 *  Personne supprimée → sa boisson repasse sur « La table » (clé `pour` retirée). */
export function remapLignesParticipants(
  lignes: LigneCommande[],
  renames: Record<string, string>,
  removed: string[],
): LigneCommande[] {
  const rm = new Set(removed.map((s) => s.trim()))
  return (lignes ?? []).map((l) => {
    const pour = l.pour?.trim()
    if (!pour) return l
    if (rm.has(pour)) { const { pour: _drop, ...rest } = l; return rest }
    if (renames[pour]) return { ...l, pour: renames[pour] }
    return l
  })
}

export interface RecapBoisson {
  boisson: string
  quantite: number
  /** Somme des prix quand ils sont connus */
  total: number | null
  /** Qui l'a demandée, pour retrouver à qui donner le verre */
  pour: string[]
}

/** Regroupé par boisson : ce qu'on annonce au bar */
export function recapBar(c: Commande): RecapBoisson[] {
  const m = new Map<string, RecapBoisson>()
  for (const l of c.lignes ?? []) {
    const cle = l.boisson.trim().toLowerCase()
    const e = m.get(cle) ?? { boisson: l.boisson.trim(), quantite: 0, total: 0, pour: [] }
    e.quantite += l.quantite
    // Un seul prix manquant rend le total non fiable : on préfère « — » à un faux chiffre
    if (e.total !== null) e.total = l.prix != null ? e.total + l.prix * l.quantite : null
    if (l.pour?.trim() && !e.pour.includes(l.pour.trim())) e.pour.push(l.pour.trim())
    m.set(cle, e)
  }
  return [...m.values()].sort((a, b) => b.quantite - a.quantite || a.boisson.localeCompare(b.boisson))
}

/** Numéro de tournée d'une ligne (1 par défaut). */
export const numeroTournee = (l: LigneCommande): number => l.tournee ?? 1

/** Plus grand numéro de tournée présent (au moins 1). */
export function derniereTournee(c: Commande): number {
  return (c.lignes ?? []).reduce((mx, l) => Math.max(mx, numeroTournee(l)), 1)
}

/** Tournée où sont rattachées les nouvelles boissons. */
export function tourneeCouranteDe(c: Commande): number {
  return c.tourneeCourante ?? derniereTournee(c)
}

/** Nombre de tournées de la soirée. */
export function nbTournees(c: Commande): number {
  return Math.max(derniereTournee(c), tourneeCouranteDe(c))
}

/** Récap bar découpé PAR tournée (pour lire au comptoir, une tournée à la fois). */
export function recapParTournee(c: Commande): { tournee: number; recap: RecapBoisson[]; quantite: number }[] {
  const total = nbTournees(c)
  const out: { tournee: number; recap: RecapBoisson[]; quantite: number }[] = []
  for (let n = 1; n <= total; n++) {
    const lignes = (c.lignes ?? []).filter((l) => numeroTournee(l) === n)
    const recap = recapBar({ ...c, lignes } as Commande)
    out.push({ tournee: n, recap, quantite: lignes.reduce((s, l) => s + l.quantite, 0) })
  }
  return out
}

export interface PartPersonne {
  personne: string
  lignes: LigneCommande[]
  quantite: number
  /** null si un prix manque sur au moins une de ses lignes */
  total: number | null
}

/** Par personne : l'addition de chacun */
export function additionParPersonne(c: Commande): PartPersonne[] {
  const m = new Map<string, PartPersonne>()
  for (const l of c.lignes ?? []) {
    const p = l.pour?.trim() || 'La table'
    const e = m.get(p) ?? { personne: p, lignes: [], quantite: 0, total: 0 }
    e.lignes.push(l)
    e.quantite += l.quantite
    if (e.total !== null) e.total = l.prix != null ? e.total + l.prix * l.quantite : null
    m.set(p, e)
  }
  return [...m.values()].sort((a, b) => (b.total ?? 0) - (a.total ?? 0) || b.quantite - a.quantite)
}

/** Total de la commande — null dès qu'un prix manque, pour ne pas annoncer un faux montant */
export function totalCommande(c: Commande): number | null {
  let t = 0
  for (const l of c.lignes ?? []) {
    if (l.prix == null) return null
    t += l.prix * l.quantite
  }
  return t
}

/** Total connu, en ignorant les lignes sans prix — pour un ordre de grandeur */
export function totalPartiel(c: Commande): number {
  return (c.lignes ?? []).reduce((s, l) => s + (l.prix != null ? l.prix * l.quantite : 0), 0)
}

export const nbVerres = (c: Commande): number =>
  (c.lignes ?? []).reduce((s, l) => s + l.quantite, 0)

/** « 4,50 € » */
export const euros = (v: number): string =>
  v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

/**
 * Prix déjà pratiqués pour une boisson, du plus récent au plus ancien.
 * Sert à pré-remplir : dans le même bar, la pinte vaut le même prix qu'hier.
 */
export function prixConnus(commandes: Commande[], boisson: string): number | null {
  const cle = boisson.trim().toLowerCase()
  const triees = [...commandes].sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0))
  for (const c of triees) {
    for (const l of c.lignes ?? []) {
      if (l.boisson.trim().toLowerCase() === cle && l.prix != null) return l.prix
    }
  }
  return null
}

/** Boissons déjà commandées, les plus fréquentes d'abord */
export function boissonsFrequentes(commandes: Commande[], max = 12): string[] {
  const m = new Map<string, number>()
  for (const c of commandes) {
    for (const l of c.lignes ?? []) {
      const n = l.boisson.trim()
      if (n) m.set(n, (m.get(n) ?? 0) + l.quantite)
    }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n)
}

/** Personnes déjà vues dans les commandes — pour composer une tablée en un clic */
export function participantsFrequents(commandes: Commande[], max = 12): string[] {
  const m = new Map<string, number>()
  for (const c of commandes) {
    for (const p of c.participants ?? []) m.set(p, (m.get(p) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n)
}
