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
 * 🔑 Quatre choses rendent cette carte lisible, et il ne faut pas les défaire :
 *  1. DEUX couleurs seulement — fait / à faire (cf. `ETATS`) ;
 *  2. le cadrage s'AJUSTE aux points (`Ajuster`) — un zoom fixe montrait toute
 *     la façade atlantique pour sept lieux tous situés autour de Vannes ;
 *  3. les activités au même endroit sont REGROUPÉES en un seul rond, sinon les
 *     unes recouvrent les autres et le compteur ment ;
 *  4. la légende est construite depuis la même table `ETATS` que les marqueurs,
 *     donc elles ne peuvent pas se désynchroniser.
 *
 * Ce qui reste à faire ressort (rond plein, cerné de blanc) ; ce qui est fait
 * s'efface (plus petit, translucide, contour pointillé — lisible même sans
 * distinguer les couleurs).
 */

/**
 * DEUX couleurs, pas plus : fait ou à faire.
 *
 * Une palette par priorité avait été essayée — cinq teintes, illisible d'un
 * coup d'œil. La carte répond à une seule question (« qu'est-ce qu'il nous
 * reste ? ») ; la priorité et le prix restent dans la bulle et dans la liste,
 * où on a le temps de lire.
 */
export type EtatCarte = 'a_faire' | 'fait'

/**
 * Rouge = à faire, vert = fait. Deux couleurs, deux libellés, rien d'autre —
 * demandé explicitement par Teddy après deux essais plus nuancés.
 */
export const ETATS: { cle: EtatCarte; libelle: string; couleur: string; fait: boolean }[] = [
  { cle: 'a_faire', libelle: 'À faire', couleur: '#dc2626', fait: false },
  { cle: 'fait', libelle: 'Fait', couleur: '#16a34a', fait: true },
]

export const etatDe = (a: DuoActivite): EtatCarte => (a.fait ? 'fait' : 'a_faire')

const infosEtat = (cle: EtatCarte) => ETATS.find((e) => e.cle === cle) ?? ETATS[0]

/** Un endroit reste « à faire » tant qu'UNE seule de ses activités l'est. */
const etatDuGroupe = (g: GroupeActivites): EtatCarte =>
  g.activites.some((a) => !a.fait) ? 'a_faire' : 'fait'

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
        <span key={e.cle} className="inline-flex items-center gap-1.5 text-xs text-gray-700">
          <span className={`rounded-full shrink-0 ${e.fait ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5'}`}
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
                radius={Math.min(15, (etat.fait ? 6 : 8) + (nb - 1) * 2)}
                pathOptions={{
                  color: '#ffffff',           // liseré blanc : deux ronds voisins restent distincts
                  fillColor: etat.couleur,
                  fillOpacity: 0.9,
                  weight: 2,
                  // Rouge et vert sont mal distingués par un daltonien : le
                  // « fait » est aussi plus petit et cerné de pointillés.
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
                          {/* La priorité et le prix ne colorent plus le rond :
                              ils se lisent ici, au calme. */}
                          <p className="text-xs mt-0.5" style={{ color: e.couleur }}>
                            <strong>{e.libelle}</strong>
                            {[a.priorite, a.gammePrix].filter(Boolean).map((t) => (
                              <span key={t} className="text-gray-500">{` · ${t}`}</span>
                            ))}
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
