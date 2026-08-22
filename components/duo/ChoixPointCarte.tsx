'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Coords } from '@/lib/geoloc'

/**
 * Petite carte de POINTAGE : on touche l'endroit, ça pose le point.
 *
 * ⚠️ À charger dynamiquement avec `ssr: false` — Leaflet touche `window` dès
 * l'import (même piège que la carte des bières). Et comme les icônes par défaut
 * de Leaflet référencent des images par chemin relatif, que le bundler et le
 * service worker cassent régulièrement, le repère est un `CircleMarker`, dessiné
 * par Leaflet lui-même.
 *
 * `scrollWheelZoom` est désactivé : la carte vit dans une modale qui défile, elle
 * ne doit pas confisquer la molette ni le doigt.
 */

function Clic({ onPoint }: { onPoint: (c: Coords) => void }) {
  useMapEvents({
    click(e) { onPoint({ lat: e.latlng.lat, lng: e.latlng.lng }) },
  })
  return null
}

/** Recentre quand le point change depuis l'extérieur (« Ma position », adresse choisie). */
function Suivi({ point }: { point: Coords | null }) {
  const map = useMap()
  useEffect(() => {
    if (point) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 14))
  }, [point?.lat, point?.lng, map]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function ChoixPointCarte({ point, onPoint, hauteur = 260 }: {
  point: Coords | null
  onPoint: (c: Coords) => void
  hauteur?: number
}) {
  // Par défaut la Bretagne, d'où vient l'essentiel des sorties.
  const centre: [number, number] = point ? [point.lat, point.lng] : [47.5, -2.5]

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200">
      <MapContainer center={centre} zoom={point ? 14 : 6} scrollWheelZoom={false}
        style={{ height: hauteur, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Clic onPoint={onPoint} />
        <Suivi point={point} />
        {point && (
          <CircleMarker center={[point.lat, point.lng]} radius={9}
            pathOptions={{ color: '#e11d48', fillColor: '#e11d48', fillOpacity: 0.6, weight: 2 }} />
        )}
      </MapContainer>
    </div>
  )
}
