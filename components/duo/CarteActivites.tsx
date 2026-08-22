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
 * 🔑 Une pastille de couleur ne veut rien dire toute seule : la légende est
 * juste au-dessus, et elle est construite à partir de la MÊME table `ETATS`.
 * Impossible qu'elles se désynchronisent.
 *
 * Ce qui reste à faire ressort : rond plein et large. Ce qui est fait s'efface :
 * rond plus petit, translucide, contour pointillé.
 */

export type EtatCarte = 'absolument' | 'a_faire' | 'revoir' | 'eviter' | 'fait'

export const ETATS: { cle: EtatCarte; libelle: string; couleur: string; fait: boolean }[] = [
  { cle: 'absolument', libelle: 'À faire absolument', couleur: '#059669', fait: false },
  { cle: 'a_faire', libelle: 'À faire', couleur: '#e11d48', fait: false },
  { cle: 'eviter', libelle: 'À ne pas faire', couleur: '#a1a1aa', fait: false },
  { cle: 'revoir', libelle: 'Fait — à revoir', couleur: '#f59e0b', fait: true },
  { cle: 'fait', libelle: 'Déjà fait', couleur: '#64748b', fait: true },
]

/** L'état d'une activité sur la carte. La priorité prime sur le reste. */
export function etatDe(a: DuoActivite): EtatCarte {
  if (a.priorite === 'A revoir') return 'revoir'
  if (a.fait) return 'fait'
  if (a.priorite === 'A ne pas faire') return 'eviter'
  if (a.priorite === 'A faire absolument') return 'absolument'
  return 'a_faire'
}

const infosEtat = (cle: EtatCarte) => ETATS.find((e) => e.cle === cle) ?? ETATS[1]

/**
 * Légende — affichée seulement pour les états réellement présents sur la carte.
 * Rendue DANS ce composant (et pas depuis la page) pour que Leaflet reste
 * derrière l'import dynamique.
 */
function LegendeCarte({ points }: { points: PointActivite[] }) {
  const presents = useMemo(() => {
    const vus = new Set(points.map((p) => etatDe(p.activite)))
    return ETATS.filter((e) => vus.has(e.cle))
  }, [points])

  if (!presents.length) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Légende</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {presents.map((e) => (
          <span key={e.cle} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span className={`rounded-full shrink-0 ${e.fait ? 'w-2.5 h-2.5 opacity-50' : 'w-3.5 h-3.5'}`}
              style={{ background: e.couleur, border: `2px solid ${e.couleur}` }} />
            {e.libelle}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        Les gros ronds pleins sont ce qu&apos;il vous reste à faire ; les petits ronds pâles, ce qui est déjà fait.
      </p>
    </div>
  )
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
        <p className="text-sm text-gray-400">Aucune activité géolocalisée ici.</p>
        <p className="text-xs text-gray-400 mt-1">
          Ajoutez une adresse ou un point GPS à une activité — ou élargissez les filtres.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <LegendeCarte points={points} />
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
      <MapContainer center={centre} zoom={points.length > 1 ? 7 : 13} scrollWheelZoom
        style={{ height: '70vh', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map(({ activite: a, lat, lng }) => {
          const etat = infosEtat(etatDe(a))
          return (
            <CircleMarker key={a.id} center={[lat, lng]} radius={etat.fait ? 6 : 10}
              pathOptions={{
                color: etat.couleur,
                fillColor: etat.couleur,
                fillOpacity: etat.fait ? 0.2 : 0.7,
                weight: etat.fait ? 1.5 : 2.5,
                // Le pointillé distingue le « déjà fait » même pour un daltonien.
                dashArray: etat.fait ? '3 3' : undefined,
              }}>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900 break-words">{a.nom}</p>
                  <p className="text-xs text-gray-500 break-words">
                    {[a.type, a.zone].filter(Boolean).join(' · ')}
                  </p>
                  {a.adresse && <p className="text-xs text-gray-400 break-words mt-0.5">{a.adresse}</p>}
                  <p className="text-xs mt-1" style={{ color: etat.couleur }}>
                    <strong>{etat.libelle}</strong>
                    {a.gammePrix && <span className="text-gray-500">{` · ${a.gammePrix}`}</span>}
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
          )
        })}
      </MapContainer>
      </div>
    </div>
  )
}
