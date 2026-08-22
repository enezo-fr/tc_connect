'use client'

import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { PointActivite } from '@/lib/duoActivites'
import type { DuoActivite } from '@/types'

/**
 * Carte des activités — Leaflet + tuiles OpenStreetMap, aucune clé d'API.
 * Mêmes précautions que la carte des bières : import dynamique `ssr: false`, et
 * des `CircleMarker` plutôt que les icônes par défaut de Leaflet.
 *
 * La couleur dit l'essentiel d'un coup d'œil : ce qui reste à faire ressort, ce
 * qui est fait s'efface.
 */

const couleur = (a: DuoActivite) => {
  if (a.fait) return '#94a3b8'                                  // slate-400 — déjà fait
  if (a.priorite === 'A ne pas faire') return '#f43f5e'          // rose-500
  if (a.priorite === 'A faire absolument') return '#059669'      // emerald-600
  return '#e11d48'                                               // rose-600 — à faire
}

export default function CarteActivites({ points, onOuvrir }: {
  points: PointActivite[]
  /** Ouvre la fiche depuis la bulle. */
  onOuvrir?: (a: DuoActivite) => void
}) {
  // Centre = barycentre des points ; par défaut la Bretagne.
  const centre = useMemo<[number, number]>(() => {
    if (!points.length) return [47.5, -2.5]
    return [
      points.reduce((s, p) => s + p.lat, 0) / points.length,
      points.reduce((s, p) => s + p.lng, 0) / points.length,
    ]
  }, [points])

  if (!points.length) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">Aucune activité géolocalisée.</p>
        <p className="text-xs text-gray-400 mt-1">
          Ajoutez une adresse ou un point GPS à une activité pour la voir apparaître ici.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
      <MapContainer center={centre} zoom={points.length > 1 ? 7 : 13} scrollWheelZoom
        style={{ height: '70vh', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map(({ activite: a, lat, lng }) => (
          <CircleMarker key={a.id} center={[lat, lng]} radius={a.fait ? 7 : 9}
            pathOptions={{
              color: couleur(a), fillColor: couleur(a), fillOpacity: a.fait ? 0.35 : 0.6, weight: 2,
            }}>
            <Popup>
              <div className="text-sm">
                <p className="font-semibold text-gray-900 break-words">{a.nom}</p>
                <p className="text-xs text-gray-500 break-words">
                  {[a.type, a.zone].filter(Boolean).join(' · ')}
                </p>
                {a.adresse && <p className="text-xs text-gray-400 break-words mt-0.5">{a.adresse}</p>}
                <p className="text-xs mt-1">
                  {a.fait ? '✓ déjà fait' : 'à faire'}
                  {a.priorite && ` · ${a.priorite}`}
                  {a.gammePrix && ` · ${a.gammePrix}`}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {onOuvrir && (
                    <button onClick={() => onOuvrir(a)}
                      className="text-xs font-medium text-rose-600 hover:text-rose-700">
                      Ouvrir la fiche
                    </button>
                  )}
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs font-medium text-gray-500 hover:text-gray-800">
                    Y aller
                  </a>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
