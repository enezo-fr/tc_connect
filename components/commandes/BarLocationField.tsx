'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { positionActuelle } from '@/lib/barPrix'
import { MapPin, LocateFixed } from 'lucide-react'

// Leaflet touche `window` dès l'import → chargement client uniquement.
const CarteBarPicker = dynamic(() => import('@/components/commandes/CarteBarPicker'), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
      Chargement de la carte…
    </div>
  ),
})

/** Choix de la position du bar : carte (toucher pour placer) + bouton « ma position ». */
export function BarLocationField({ lat, lng, onChange }: {
  lat: number | null
  lng: number | null
  onChange: (lat: number, lng: number) => void
}) {
  const [signal, setSignal] = useState(0)
  const [loc, setLoc] = useState(false)

  const maPosition = async () => {
    setLoc(true)
    try {
      const p = await positionActuelle()
      if (p) { onChange(p.lat, p.lng); setSignal((s) => s + 1) }
    } finally { setLoc(false) }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <MapPin size={14} />Position du bar <span className="text-gray-400 font-normal">(facultatif)</span>
        </label>
        <button type="button" onClick={maPosition} disabled={loc}
          className="text-xs font-medium text-sky-600 hover:text-sky-700 flex items-center gap-1 disabled:opacity-60">
          <LocateFixed size={13} />{loc ? 'Localisation…' : 'Ma position'}
        </button>
      </div>
      <CarteBarPicker lat={lat} lng={lng} signal={signal} onPick={onChange} />
      <p className="text-xs text-gray-400">
        {lat != null
          ? 'Touchez la carte pour ajuster le point exact du bar. Sert au catalogue de prix partagé.'
          : 'Touchez la carte à l’emplacement du bar (ou « Ma position » si vous y êtes). Sert au catalogue de prix partagé.'}
      </p>
    </div>
  )
}
