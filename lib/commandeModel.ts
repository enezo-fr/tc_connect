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
