'use client'

import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { euros } from '@/lib/commandeModel'
import type { BarComplet } from '@/lib/barPrix'

/** Carte des bars répertoriés (catalogue de prix partagé). Chargée en client (Leaflet). */
export default function CarteBars({ bars }: { bars: BarComplet[] }) {
  const centre = useMemo<[number, number]>(() => {
    if (!bars.length) return [47.5, -2.5]
    return [
      bars.reduce((s, b) => s + b.lat, 0) / bars.length,
      bars.reduce((s, b) => s + b.lng, 0) / bars.length,
    ]
  }, [bars])

  if (!bars.length) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">Aucun bar répertorié pour l&apos;instant.</p>
        <p className="text-xs text-gray-400 mt-1">Les bars apparaissent ici quand tu enregistres des prix sur place.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
      <MapContainer center={centre} zoom={7} scrollWheelZoom style={{ height: '50vh', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {bars.map((b) => (
          <CircleMarker key={b.key} center={[b.lat, b.lng]} radius={9}
            pathOptions={{ color: '#0284c7', fillColor: '#0284c7', fillOpacity: 0.55, weight: 2 }}>
            <Popup>
              <div className="text-sm">
                <p className="font-semibold text-gray-900">{b.nom || 'Bar'}</p>
                {Object.keys(b.prix).length === 0 ? (
                  <p className="text-xs text-gray-500 mt-1">Aucun prix enregistré.</p>
                ) : (
                  <ul className="text-xs text-gray-700 space-y-0.5 mt-1 max-h-40 overflow-auto">
                    {Object.entries(b.prix).map(([boisson, prix]) => (
                      <li key={boisson} className="flex justify-between gap-3">
                        <span className="capitalize">{boisson}</span><strong>{euros(prix)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
