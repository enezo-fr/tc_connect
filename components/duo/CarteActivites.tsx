'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { groupesActivites, type GroupeActivites, type PointActivite } from '@/lib/duoActivites'
import type { DuoActivite } from '@/types'

/**
 * Carte des activités — Leaflet + tuiles OpenStreetMap, aucune clé d'API.
 * Mêmes précautions que la carte des bières : import dynamique `ssr: false`, et
 * des `CircleMarker` plutôt que les icônes par défaut de Leaflet.
 *
 * 🔑 Trois choses rendent cette carte lisible, et il ne faut pas les défaire :
 *  1. le cadrage s'AJUSTE aux points (`Ajuster`) — un zoom fixe montrait toute
 *     la façade atlantique pour sept lieux tous situés autour de Vannes ;
 *  2. les activités au même endroit sont REGROUPÉES en un seul rond, sinon les
 *     unes recouvrent les autres et le compteur ment ;
 *  3. la légende est construite depuis la même table `ETATS` que les marqueurs,
 *     donc elles ne peuvent pas se désynchroniser.
 *
 * Ce qui reste à faire ressort (rond plein, cerné de blanc) ; ce qui est fait
 * s'efface (plus petit, translucide, contour pointillé — lisible même sans
 * distinguer les couleurs).
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

/** Ce qui reste à faire l'emporte sur le reste : un groupe attire l'œil si UNE seule y reste. */
const ORDRE: EtatCarte[] = ['absolument', 'a_faire', 'eviter', 'revoir', 'fait']

const etatDuGroupe = (g: GroupeActivites): EtatCarte => {
  const etats = g.activites.map(etatDe)
  return ORDRE.find((e) => etats.includes(e)) ?? 'fait'
}

/**
 * Cadre la vue sur les points affichés, à chaque changement de filtre.
 * `maxZoom` évite de coller au ras des toits quand il n'y a qu'un seul lieu.
 */
function Ajuster({ groupes }: { groupes: GroupeActivites[] }) {
  const map = useMap()
  const cle = groupes.map((g) => `${g.lat.toFixed(4)},${g.lng.toFixed(4)}`).join('|')

  useEffect(() => {
    if (!groupes.length) return
    if (groupes.length === 1) {
      map.setView([groupes[0].lat, groupes[0].lng], 14)
      return
    }
    map.fitBounds(groupes.map((g) => [g.lat, g.lng] as [number, number]), {
      padding: [36, 36],
      maxZoom: 15,
    })
  }, [cle, map]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

/** Légende compacte — seulement les états réellement présents sur la carte. */
function LegendeCarte({ groupes }: { groupes: GroupeActivites[] }) {
  const presents = useMemo(() => {
    const vus = new Set(groupes.flatMap((g) => g.activites.map(etatDe)))
    return ETATS.filter((e) => vus.has(e.cle))
  }, [groupes])

  if (!presents.length) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
      {presents.map((e) => (
        <span key={e.cle} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
          <span className={`rounded-full shrink-0 ${e.fait ? 'w-2 h-2 opacity-50' : 'w-3 h-3'}`}
            style={{ background: e.couleur }} />
          {e.libelle}
        </span>
      ))}
    </div>
  )
}

export default function CarteActivites({ points, onOuvrir }: {
  points: PointActivite[]
  /** Ouvre la fiche depuis la bulle. */
  onOuvrir?: (a: DuoActivite) => void
}) {
  const groupes = useMemo(() => groupesActivites(points), [points])

  // Centre de départ ; `Ajuster` recadre dès le premier rendu.
  const centre = useMemo<[number, number]>(() => {
    if (!groupes.length) return [47.5, -2.5]
    return [
      groupes.reduce((s, g) => s + g.lat, 0) / groupes.length,
      groupes.reduce((s, g) => s + g.lng, 0) / groupes.length,
    ]
  }, [groupes])

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
      <LegendeCarte groupes={groupes} />

      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
        <MapContainer center={centre} zoom={9} scrollWheelZoom
          style={{ height: '65vh', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Ajuster groupes={groupes} />

          {groupes.map((g) => {
            const etat = infosEtat(etatDuGroupe(g))
            const nb = g.activites.length
            return (
              <CircleMarker key={`${g.lat},${g.lng}`} center={[g.lat, g.lng]}
                // Le rayon grossit avec le nombre d'activités du lieu, sans jamais
                // manger la carte.
                radius={Math.min(15, (etat.fait ? 5 : 7) + (nb - 1) * 2)}
                pathOptions={{
                  color: '#ffffff',           // liseré blanc : deux ronds voisins restent distincts
                  fillColor: etat.couleur,
                  fillOpacity: etat.fait ? 0.55 : 0.95,
                  weight: 2,
                  dashArray: etat.fait ? '3 3' : undefined,
                }}>
                <Popup>
                  <div className="text-sm space-y-2">
                    {nb > 1 && (
                      <p className="text-xs font-semibold text-gray-500">
                        {`${nb} activités à cet endroit`}
                      </p>
                    )}
                    {g.activites.map((a) => {
                      const e = infosEtat(etatDe(a))
                      return (
                        <div key={a.id} className={nb > 1 ? 'border-t border-gray-100 pt-1.5 first:border-0 first:pt-0' : ''}>
                          <p className="font-semibold text-gray-900 break-words">{a.nom}</p>
                          <p className="text-xs text-gray-500 break-words">
                            {[a.type, a.zone].filter(Boolean).join(' · ')}
                          </p>
                          {a.adresse && nb === 1 && (
                            <p className="text-xs text-gray-400 break-words mt-0.5">{a.adresse}</p>
                          )}
                          <p className="text-xs mt-0.5" style={{ color: e.couleur }}>
                            <strong>{e.libelle}</strong>
                            {a.gammePrix && <span className="text-gray-500">{` · ${a.gammePrix}`}</span>}
                          </p>
                          {onOuvrir && (
                            <button onClick={() => onOuvrir(a)}
                              className="text-xs font-medium text-rose-600 hover:text-rose-700 mt-0.5">
                              Ouvrir la fiche
                            </button>
                          )}
                        </div>
                      )
                    })}
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lng}`}
                      target="_blank" rel="noopener noreferrer"
                      className="block text-xs font-medium text-gray-500 hover:text-gray-800 pt-1">
                      Y aller
                    </a>
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
