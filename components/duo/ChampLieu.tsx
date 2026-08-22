'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { LigneAide } from '@/components/ui/NoteAide'
import { adresseDeCoords, chercherLieu, type LieuTrouve } from '@/lib/geocodage'
import { formatCoords, parseGps, positionActuelle, type Coords } from '@/lib/geoloc'
import { MapPin, LocateFixed, Map as MapIcon, Loader2, Search, X } from 'lucide-react'

// Leaflet touche `window` dès l'import : rendu client uniquement.
const ChoixPointCarte = dynamic(() => import('@/components/duo/ChoixPointCarte'), {
  ssr: false,
  loading: () => <div className="h-[260px] rounded-xl bg-gray-50 border border-gray-200 animate-pulse" />,
})

const champCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500'

export interface ValeursLieu {
  adresse: string
  gps: string
  zone: string
}

/**
 * Le lieu d'une activité : adresse postale ET coordonnées, l'un remplissant
 * l'autre.
 *
 * Trois façons d'entrer, selon ce qu'on a sous la main :
 *  - taper l'adresse et choisir une proposition → le point GPS suit ;
 *  - « Ma position » quand on est sur place ;
 *  - toucher l'endroit sur la carte, ce qui reste le seul moyen pour un lieu
 *    sans adresse (un point de vue, une plage, un départ de sentier).
 *
 * Les deux conversions restent aussi disponibles à la demande, pour une fiche
 * déjà remplie à moitié.
 *
 * 🔑 Le remplissage automatique ne PIÉTINE jamais une saisie existante : il ne
 * complète que les champs vides. Écraser une adresse écrite à la main par le
 * libellé approximatif d'un service de cartographie serait une régression.
 */
export default function ChampLieu({ valeurs, onChange }: {
  valeurs: ValeursLieu
  onChange: (v: Partial<ValeursLieu>) => void
}) {
  const { adresse, gps, zone } = valeurs
  const point = parseGps(gps)

  const [suggestions, setSuggestions] = useState<LieuTrouve[]>([])
  const [ouvert, setOuvert] = useState(false)
  const [cherche, setCherche] = useState(false)
  const [carteOuverte, setCarteOuverte] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'position' | 'adresse' | 'coords' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  // ── Adresse tapée → propositions ────────────────────────────────────────
  // 600 ms d'attente : le service de cartographie tolère une requête par
  // seconde, on ne lance donc rien à chaque frappe.
  const taperAdresse = (v: string) => {
    onChange({ adresse: v })
    setMessage('')
    clearTimeout(timer.current)
    if (v.trim().length < 3) { setSuggestions([]); setOuvert(false); return }
    timer.current = setTimeout(async () => {
      setCherche(true)
      const r = await chercherLieu(v)
      setSuggestions(r)
      setOuvert(r.length > 0)
      setCherche(false)
    }, 600)
  }

  const choisir = (l: LieuTrouve) => {
    onChange({
      adresse: l.adresse || l.label,
      gps: formatCoords({ lat: l.lat, lng: l.lng }),
      ...(zone.trim() ? {} : { zone: l.ville }),
    })
    setSuggestions([])
    setOuvert(false)
    setMessage('')
  }

  // ── Un point posé (carte, GPS, « Ma position ») → adresse ────────────────
  const poserPoint = async (c: Coords, forcerAdresse = false) => {
    const coords = formatCoords(c)
    onChange({ gps: coords })
    if (!forcerAdresse && adresse.trim() && zone.trim()) return

    const l = await adresseDeCoords(c)
    if (!l) { setMessage("Adresse introuvable pour ce point — le GPS suffit."); return }
    onChange({
      gps: coords,
      ...(forcerAdresse || !adresse.trim() ? { adresse: l.adresse || l.label } : {}),
      ...(forcerAdresse || !zone.trim() ? { zone: l.ville } : {}),
    })
  }

  const maPosition = async () => {
    setBusy('position'); setMessage('')
    try {
      const p = await positionActuelle()
      if (!p) { setMessage('Position indisponible — autorisez la localisation, ou touchez la carte.'); return }
      await poserPoint(p)
    } finally { setBusy(null) }
  }

  const retrouverAdresse = async () => {
    if (!point) return
    setBusy('adresse'); setMessage('')
    try { await poserPoint(point, true) }
    finally { setBusy(null) }
  }

  const trouverCoords = async () => {
    if (!adresse.trim()) return
    setBusy('coords'); setMessage('')
    try {
      const r = await chercherLieu(adresse)
      if (!r.length) { setMessage('Aucun lieu trouvé pour cette adresse.'); return }
      if (r.length === 1) { choisir(r[0]); return }
      setSuggestions(r)
      setOuvert(true)
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3">
      {/* Adresse */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
        <div className="relative">
          <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={adresse} onChange={(e) => taperAdresse(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOuvert(true)}
            placeholder="12 rue des Halles, Vannes…" className={`${champCls} pl-9 pr-9`} />
          {cherche && (
            <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500 animate-spin" />
          )}
        </div>

        {ouvert && suggestions.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-50">
              <span className="text-[11px] text-gray-400">Choisir un lieu place aussi le point GPS</span>
              <button type="button" onClick={() => setOuvert(false)} aria-label="Fermer les propositions"
                className="p-1 text-gray-400 hover:text-gray-700 transition">
                <X size={13} />
              </button>
            </div>
            {suggestions.map((l, i) => (
              <button key={`${l.lat},${l.lng},${i}`} type="button" onClick={() => choisir(l)}
                className="w-full text-left px-3 py-2 hover:bg-rose-50 transition border-b border-gray-50 last:border-0">
                <p className="text-sm text-gray-800 break-words">{l.adresse || l.label}</p>
                <p className="text-[11px] text-gray-400 break-words">
                  {[l.codePostal, l.ville, l.pays].filter(Boolean).join(' · ')}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Coordonnées */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-sm font-medium text-gray-700">Coordonnées GPS</label>
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={maPosition} disabled={busy === 'position'}
              className="text-xs font-medium text-rose-600 hover:text-rose-700 flex items-center gap-1 disabled:opacity-60">
              <LocateFixed size={13} />{busy === 'position' ? 'Localisation…' : 'Ma position'}
            </button>
            <button type="button" onClick={() => setCarteOuverte((v) => !v)}
              className="text-xs font-medium text-rose-600 hover:text-rose-700 flex items-center gap-1">
              <MapIcon size={13} />{carteOuverte ? 'Fermer la carte' : 'Sur la carte'}
            </button>
          </div>
        </div>
        <input value={gps} onChange={(e) => onChange({ gps: e.target.value })}
          placeholder="47.629300, -2.779100" className={champCls} />

        <div className="flex flex-wrap gap-2 mt-2">
          {point && (
            <button type="button" onClick={retrouverAdresse} disabled={busy === 'adresse'}
              className="inline-flex items-center gap-1.5 text-xs border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-60 px-2.5 py-1.5 rounded-lg transition">
              <MapPin size={12} />{busy === 'adresse' ? 'Recherche…' : "Retrouver l'adresse"}
            </button>
          )}
          {!!adresse.trim() && (
            <button type="button" onClick={trouverCoords} disabled={busy === 'coords'}
              className="inline-flex items-center gap-1.5 text-xs border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-60 px-2.5 py-1.5 rounded-lg transition">
              <Search size={12} />{busy === 'coords' ? 'Recherche…' : 'Trouver le point GPS'}
            </button>
          )}
          {gps.trim() && !point && (
            <span className="text-xs text-amber-600 py-1.5">
              Format attendu : <strong>latitude, longitude</strong>.
            </span>
          )}
        </div>

        {message && <p className="text-xs text-amber-600 mt-1.5">{message}</p>}
      </div>

      {carteOuverte && (
        <div className="space-y-1.5">
          <ChoixPointCarte point={point} onPoint={(c) => poserPoint(c)} />
          <LigneAide>
            Touchez la carte pour poser le point — c&apos;est le seul moyen pour un endroit qui n&apos;a
            pas d&apos;adresse (un point de vue, une plage, un départ de sentier).
          </LigneAide>
        </div>
      )}

      {/* Zone / ville */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Zone / ville</label>
        <input value={zone} onChange={(e) => onChange({ zone: e.target.value })}
          placeholder="Vannes" className={champCls} />
      </div>
    </div>
  )
}
