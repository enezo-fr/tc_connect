import { parseGps } from '@/lib/geoloc'
import type { DuoActivite } from '@/types'

/**
 * Préparation des activités pour la carte — SANS Leaflet.
 *
 * ⚠️ Volontairement séparé de `components/duo/CarteActivites` : ce dernier
 * importe Leaflet, qui touche `window` dès son import et ne doit donc être
 * chargé que dynamiquement (`ssr: false`). Une page qui a juste besoin de
 * compter les lieux ne doit pas tirer la librairie de carte avec elle.
 */

export interface PointActivite {
  activite: DuoActivite
  lat: number
  lng: number
}

/** Activités géolocalisables d'une liste (les autres restent invisibles sur la carte). */
export function pointsActivites(activites: DuoActivite[]): PointActivite[] {
  return activites.flatMap((a) => {
    const c = parseGps(a.gps)
    return c ? [{ activite: a, lat: c.lat, lng: c.lng }] : []
  })
}
