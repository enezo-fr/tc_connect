/**
 * Géo-logique PURE du catalogue de prix par bar — sans Firestore, réutilisable
 * côté client (lib/barPrix.ts) ET côté serveur Admin SDK (lib/barPrixAdmin.ts).
 */

export interface Position { lat: number; lng: number }

export const COLL = 'bar_prix'
/** ~0,0005° de latitude ≈ 55 m. */
export const CELL = 0.0005
/** Rayon de rattachement « même bar ». */
export const RAYON_M = 70

const idx = (v: number) => Math.round(v / CELL)
export const cellKey = (lat: number, lng: number) => `${idx(lat)}_${idx(lng)}`

/** La cellule et ses 8 voisines (pour ne pas rater un bar à cheval sur une limite). */
export function voisines(lat: number, lng: number): string[] {
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
