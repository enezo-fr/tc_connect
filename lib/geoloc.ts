'use client'

/**
 * Géolocalisation du navigateur, isolée ici pour être utilisable sans tirer
 * tout le catalogue de prix des bars (qui en était le seul appelant à l'origine).
 */

export interface Coords { lat: number; lng: number }

/** Position GPS actuelle (ou null si refusée / indisponible). */
export function positionActuelle(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  })
}

/** « 47.629300, -2.779100 » — format attendu par les liens Google Maps de l'app. */
export const formatCoords = (p: Coords) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`

/**
 * « 47.6293, -2.7791 » → coordonnées, ou `null` si la saisie n'est pas
 * exploitable. Source unique de vérité du format GPS de l'app : le champ est
 * libre, c'est ici qu'on décide ce qui est valable.
 */
export function parseGps(v?: string | null): Coords | null {
  if (!v) return null
  const m = v.replace(/\s/g, '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}
