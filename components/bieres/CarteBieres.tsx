'use client'

import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { formatNote, type BiereCalculee } from '@/lib/biereModel'

/**
 * Carte des dégustations — Leaflet + tuiles OpenStreetMap (aucune clé d'API).
 *
 * ⚠️ Ce composant DOIT être chargé dynamiquement avec `ssr: false` : Leaflet
 * touche `window` dès l'import, un rendu serveur casserait la page.
 *
 * On n'utilise pas les marqueurs par défaut mais des `CircleMarker` : l'icône
 * par défaut de Leaflet référence des images via des chemins relatifs que
 * bundler et service worker cassent régulièrement. Un cercle est dessiné par
 * Leaflet lui-même, donc rien à charger — et la couleur peut porter la note.
 */

export interface PointCarte {
  /** « lat, lng » tel que saisi */
  gps: string
  lat: number
  lng: number
  lieu: string
  /** Bières bues à cet endroit, avec la note de la dégustation concernée */
  bieres: { nom: string; note: number | null; date?: Date }[]
}

/** « 47.6293, -2.7791 » → coordonnées, ou null si la saisie n'est pas exploitable */
export function parseGps(v?: string): { lat: number; lng: number } | null {
  if (!v) return null
  const m = v.replace(/\s/g, '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1]); const lng = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

/** Regroupe les dégustations par coordonnées : un même bar = un seul point */
export function pointsDeCarte(liste: BiereCalculee[]): PointCarte[] {
  const par = new Map<string, PointCarte>()
  for (const b of liste) {
    for (const d of b.degustations) {
      const c = parseGps(d.gps)
      if (!c) continue
      // Arrondi au 4ᵉ décimal (~11 m) : deux relevés du même bar se rejoignent
      const cle = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
      const existant = par.get(cle) ?? {
        gps: d.gps!, lat: c.lat, lng: c.lng, lieu: d.lieu?.trim() || 'Lieu inconnu', bieres: [],
      }
      if (!existant.lieu || existant.lieu === 'Lieu inconnu') existant.lieu = d.lieu?.trim() || existant.lieu
      const notes = Object.values(d.notes ?? {})
      existant.bieres.push({
        nom: b.biere.nom,
        note: notes.length ? notes.reduce((s, v) => s + v, 0) / notes.length : null,
        date: d.date?.toDate(),
      })
      par.set(cle, existant)
    }
  }
  return [...par.values()]
}

const couleurNote = (n: number | null) =>
  n === null ? '#94a3b8' : n >= 4 ? '#059669' : n >= 3 ? '#65a30d' : n >= 2 ? '#d97706' : '#e11d48'

export default function CarteBieres({ points }: { points: PointCarte[] }) {
  // Centre = barycentre des points ; par défaut la Bretagne, d'où vient l'essentiel
  const centre = useMemo<[number, number]>(() => {
    if (!points.length) return [47.5, -2.5]
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length
    return [lat, lng]
  }, [points])

  if (!points.length) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">Aucune dégustation géolocalisée.</p>
        <p className="text-xs text-gray-400 mt-1">
          Ajoute des coordonnées GPS à une dégustation pour la voir apparaître ici.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
      <MapContainer center={centre} zoom={6} scrollWheelZoom style={{ height: '70vh', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((p) => {
          const notes = p.bieres.map((b) => b.note).filter((n): n is number => n !== null)
          const moyenne = notes.length ? notes.reduce((s, v) => s + v, 0) / notes.length : null
          return (
            <CircleMarker
              key={`${p.lat},${p.lng}`}
              center={[p.lat, p.lng]}
              // Le rayon dit combien de bières ont été bues là, sans écraser la carte
              radius={Math.min(18, 6 + p.bieres.length * 1.6)}
              pathOptions={{
                color: couleurNote(moyenne),
                fillColor: couleurNote(moyenne),
                fillOpacity: 0.55,
                weight: 2,
              }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900">{p.lieu}</p>
                  <p className="text-xs text-gray-500 mb-1.5">
                    {p.bieres.length} bière{p.bieres.length > 1 ? 's' : ''}
                    {moyenne !== null && ` · moyenne ${formatNote(moyenne)}/5`}
                  </p>
                  <ul className="space-y-0.5 max-h-40 overflow-auto">
                    {p.bieres.map((b, i) => (
                      <li key={i} className="text-xs text-gray-700">
                        {b.nom}
                        {b.note !== null && <strong> · {formatNote(b.note)}</strong>}
                        {b.date && (
                          <span className="text-gray-400"> — {b.date.toLocaleDateString('fr-FR')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}
