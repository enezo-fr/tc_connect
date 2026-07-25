'use client'

import {
  collection, doc, documentId, getDocs, query, where, setDoc, serverTimestamp, arrayUnion, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COLL, RAYON_M, cellKey, voisines, distanceM, type Position } from '@/lib/barPrixCore'

/**
 * Catalogue de prix PAR BAR, partagé entre tous les utilisateurs (côté CLIENT).
 * Géo-logique (cellules ~50 m + voisines + distance) dans `barPrixCore` (partagée
 * avec la version serveur `barPrixAdmin`). Doc `bar_prix/{cellKey}` :
 * { lat, lng, nom?, prix: {boissonMinuscule: number}, histo: [{boisson,prix,at,by}], updatedAt }.
 */

export type { Position } from '@/lib/barPrixCore'
export { cellKey } from '@/lib/barPrixCore'
export interface BarProche { key: string; lat: number; lng: number; nom?: string; prix: Record<string, number> }
export interface HistoPrix { boisson: string; prix: number; at?: Timestamp; by?: string }
export interface BarComplet extends BarProche { histo: HistoPrix[] }

/** Position GPS actuelle (ou null si refusée / indisponible). */
export function positionActuelle(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  })
}

/** Bar connu le plus proche (≤ RAYON_M), ou null. */
export async function chargerBarProche(pos: Position): Promise<BarProche | null> {
  const keys = voisines(pos.lat, pos.lng)
  const snap = await getDocs(query(collection(db, COLL), where(documentId(), 'in', keys)))
  let best: BarProche | null = null
  let bestD = Infinity
  for (const d of snap.docs) {
    const data = d.data() as { lat: number; lng: number; nom?: string; prix?: Record<string, number> }
    if (typeof data.lat !== 'number' || typeof data.lng !== 'number') continue
    const dist = distanceM(pos, data)
    if (dist <= RAYON_M && dist < bestD) {
      bestD = dist
      best = { key: d.id, lat: data.lat, lng: data.lng, nom: data.nom, prix: data.prix ?? {} }
    }
  }
  return best
}

/**
 * Résout le bar d'une position : renvoie le plus proche existant, sinon la cellule
 * courante (nouveau bar). `cell` = où écrire les prix ; `prix` = ceux déjà connus.
 */
export async function resoudreBar(pos: Position): Promise<{ cell: string; nom?: string; prix: Record<string, number> }> {
  const proche = await chargerBarProche(pos)
  if (proche) return { cell: proche.key, nom: proche.nom, prix: proche.prix }
  return { cell: cellKey(pos.lat, pos.lng), prix: {} }
}

/** Tous les bars répertoriés (pour la carte + les prix de la page Commandes). */
export async function chargerTousBars(): Promise<BarComplet[]> {
  const snap = await getDocs(collection(db, COLL))
  return snap.docs
    .map((d) => {
      const x = d.data() as { lat?: number; lng?: number; nom?: string; prix?: Record<string, number>; histo?: HistoPrix[] }
      return { key: d.id, lat: x.lat as number, lng: x.lng as number, nom: x.nom, prix: x.prix ?? {}, histo: Array.isArray(x.histo) ? x.histo : [] }
    })
    .filter((b) => typeof b.lat === 'number' && typeof b.lng === 'number')
}

/** Enregistre / met à jour le prix d'une boisson pour ce bar (+ historique). */
export async function enregistrerPrix(args: {
  cell: string; pos: Position; nom?: string; boisson: string; prix: number; uid: string
}): Promise<void> {
  const cle = args.boisson.trim().toLowerCase()
  await setDoc(doc(db, COLL, args.cell), {
    lat: args.pos.lat,
    lng: args.pos.lng,
    ...(args.nom ? { nom: args.nom } : {}),
    prix: { [cle]: args.prix },
    histo: arrayUnion({ boisson: args.boisson.trim(), prix: args.prix, at: Timestamp.now(), by: args.uid }),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}
