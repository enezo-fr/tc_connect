'use client'

import {
  collection, doc, documentId, getDocs, query, where, setDoc, serverTimestamp, arrayUnion, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'

/**
 * Catalogue de prix PAR BAR, partagé entre tous les utilisateurs.
 *
 * Un bar est repéré par sa position GPS. On découpe la carte en cellules d'environ
 * 50 m ; deux commandes passées au même endroit tombent dans la même cellule (ou
 * une voisine) et partagent donc les prix. Pas de géo-requête à index : on lit la
 * cellule + ses 8 voisines et on garde la plus proche à moins de `RAYON_M`.
 *
 * Doc `bar_prix/{cellKey}` : { lat, lng, nom?, prix: {boissonMinuscule: number},
 * histo: [{boisson, prix, at, by}], updatedAt }.
 */

const COLL = 'bar_prix'
/** ~0,0005° de latitude ≈ 55 m. */
const CELL = 0.0005
/** Rayon de rattachement « même bar ». */
const RAYON_M = 70

export interface Position { lat: number; lng: number }
export interface BarProche { key: string; lat: number; lng: number; nom?: string; prix: Record<string, number> }

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

const idx = (v: number) => Math.round(v / CELL)
export const cellKey = (lat: number, lng: number) => `${idx(lat)}_${idx(lng)}`

/** La cellule et ses 8 voisines (pour ne pas rater un bar à cheval sur une limite). */
function voisines(lat: number, lng: number): string[] {
  const i = idx(lat), j = idx(lng)
  const keys: string[] = []
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) keys.push(`${i + di}_${j + dj}`)
  return keys
}

/** Distance en mètres (haversine). */
export function distanceM(a: Position, b: Position): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
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
