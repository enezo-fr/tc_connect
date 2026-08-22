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

export interface GroupeActivites {
  lat: number
  lng: number
  activites: DuoActivite[]
}

/**
 * Regroupe les activités qui tombent au même endroit.
 *
 * 🔑 Sans ça, deux fiches à la même adresse (un bar et le restaurant d'à côté,
 * deux visites du même lieu) se recouvrent exactement : le second point est
 * invisible et inatteignable. Un seul rond, dont la bulle liste tout, et le
 * compteur redevient honnête.
 *
 * Arrondi au 4ᵉ décimal, soit ~11 m — même règle que la carte des bières.
 */
export function groupesActivites(points: PointActivite[]): GroupeActivites[] {
  const par = new Map<string, GroupeActivites>()
  for (const p of points) {
    const cle = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
    const groupe = par.get(cle) ?? { lat: p.lat, lng: p.lng, activites: [] }
    groupe.activites.push(p.activite)
    par.set(cle, groupe)
  }
  return [...par.values()]
}
