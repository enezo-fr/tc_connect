'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMapEvents, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * Choix précis de la position d'un bar : on TOUCHE la carte pour poser le point.
 * Chargé dynamiquement (ssr:false) — Leaflet touche `window` dès l'import.
 * On dessine un `CircleMarker` (pas de marqueur à icône, dont les images cassent
 * avec le bundler / service worker — cf. CarteBieres).
 */

function Clic({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

/** Recentre la carte quand `signal` change (bouton « ma position »). */
function Recentre({ lat, lng, signal }: { lat: number | null; lng: number | null; signal: number }) {
  const map = useMap()
  useEffect(() => {
    if (lat != null && lng != null) map.setView([lat, lng], 17)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal])
  return null
}

export default function CarteBarPicker({ lat, lng, signal = 0, onPick }: {
  lat: number | null
  lng: number | null
  /** Incrémenter pour recentrer sur (lat,lng) — ex. après « ma position ». */
  signal?: number
  onPick: (lat: number, lng: number) => void
}) {
  const centre: [number, number] = [lat ?? 47.5, lng ?? -2.5]
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200">
      <MapContainer center={centre} zoom={lat != null ? 17 : 6} scrollWheelZoom style={{ height: 220, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Clic onPick={onPick} />
        <Recentre lat={lat} lng={lng} signal={signal} />
        {lat != null && lng != null && (
          <CircleMarker center={[lat, lng]} radius={10}
            pathOptions={{ color: '#0284c7', fillColor: '#0284c7', fillOpacity: 0.6, weight: 2 }} />
        )}
      </MapContainer>
    </div>
  )
}
