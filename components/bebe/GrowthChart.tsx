'use client'

import { useState } from 'react'

/**
 * Courbe de croissance (poids, taille ou périmètre crânien) — SVG à la main.
 *
 * Le projet n'embarque aucune librairie de graphiques et une courbe à 5-20 points
 * n'en justifie pas une (recharts ≈ 100 ko gzip pour ça). Le viewBox est fixe et
 * le SVG s'étire en largeur : les proportions sont conservées, le texte reste net.
 *
 * Un point se TOUCHE pour lire sa valeur : la zone tactile est un cercle
 * transparent bien plus large que le point dessiné (un point de 3 px est
 * intouchable au doigt). « Détail » déplie le tableau complet, où chaque ligne
 * sélectionne le point correspondant.
 */

export interface GrowthPoint {
  /** Date de la mesure */
  date: Date
  /** Valeur dans l'unité affichée (kg ou cm) */
  value: number
  /** Repère « Naissance » : point d'origine repris des infos de naissance */
  origine?: boolean
}

interface Props {
  points: GrowthPoint[]
  /** Unité affichée sur l'axe (ex. « kg », « cm ») */
  unite: string
  /** Couleur de la courbe (valeur CSS) */
  couleur: string
  /** Décimales des valeurs affichées */
  decimales?: number
}

const W = 320, H = 150
const PAD = { top: 12, right: 10, bottom: 22, left: 34 }

const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
const fmtDateLongue = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export function GrowthChart({ points, unite, couleur, decimales = 1 }: Props) {
  const [selection, setSelection] = useState<number | null>(null)
  const [detail, setDetail] = useState(false)
  const fmt = (v: number) => v.toFixed(decimales).replace('.', ',')

  if (points.length === 0) {
    return <p className="text-sm text-gray-400 italic py-6 text-center">Aucune mesure pour l&apos;instant.</p>
  }

  const tris = [...points].sort((a, b) => a.date.getTime() - b.date.getTime())
  const t0 = tris[0].date.getTime()
  const t1 = tris[tris.length - 1].date.getTime()
  const vMin = Math.min(...tris.map(p => p.value))
  const vMax = Math.max(...tris.map(p => p.value))

  // Marge verticale de 10 % pour que la courbe ne colle ni au haut ni au bas.
  // Cas d'une seule valeur (ou valeurs identiques) : on ouvre une plage arbitraire
  // autour, sinon la division par zéro écrase tout sur une ligne.
  const span = vMax - vMin
  const marge = span > 0 ? span * 0.1 : Math.max(vMax * 0.05, 0.5)
  const yMin = vMin - marge
  const yMax = vMax + marge

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (d: Date) => PAD.left + (t1 === t0 ? innerW / 2 : ((d.getTime() - t0) / (t1 - t0)) * innerW)
  const y = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH

  const ligne = tris.map(p => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const graduations = [yMax, (yMax + yMin) / 2, yMin]

  /** Écart avec la mesure précédente (null pour la première) */
  const ecart = (i: number) => (i === 0 ? null : tris[i].value - tris[i - 1].value)
  const fmtEcart = (e: number) => `${e >= 0 ? '+' : '−'}${fmt(Math.abs(e))} ${unite}`

  // Par défaut, la lecture porte sur la dernière mesure — celle qu'on vient noter
  const i = selection ?? tris.length - 1
  const lu = tris[i]
  const ecartLu = ecart(i)

  return (
    <div>
      {/* Lecture du point choisi : c'est ce que « voir à combien il est » demande */}
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-base font-semibold" style={{ color: couleur }}>
          {`${fmt(lu.value)} ${unite}`}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {[
            lu.origine ? 'naissance' : fmtDateLongue(lu.date),
            ecartLu !== null ? fmtEcart(ecartLu) : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
        {/* Grille + valeurs de l'axe vertical */}
        {graduations.map((v, k) => (
          <g key={k}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{fmt(v)}</text>
          </g>
        ))}

        {/* Repère vertical sur le point lu */}
        <line x1={x(lu.date)} x2={x(lu.date)} y1={PAD.top} y2={H - PAD.bottom}
          stroke={couleur} strokeWidth={1} strokeDasharray="3 3" opacity={0.35} />

        {/* Courbe */}
        {tris.length > 1 && (
          <polyline points={ligne} fill="none" stroke={couleur} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Points : la naissance est creuse pour la distinguer des mesures saisies */}
        {tris.map((p, k) => (
          <circle key={k} cx={x(p.date)} cy={y(p.value)} r={k === i ? 4.5 : 3}
            fill={p.origine ? '#fff' : couleur} stroke={couleur} strokeWidth={k === i ? 2.5 : 1.5} />
        ))}

        {/* Zones tactiles : invisibles et larges, sinon un point de 3 px est inatteignable au doigt */}
        {tris.map((p, k) => (
          <circle key={`t${k}`} cx={x(p.date)} cy={y(p.value)} r={11} fill="transparent"
            style={{ cursor: 'pointer' }} onClick={() => setSelection(k)}>
            <title>{`${fmt(p.value)} ${unite} — ${p.origine ? 'naissance' : fmtDateLongue(p.date)}`}</title>
          </circle>
        ))}

        {/* Axe horizontal : première et dernière date (au-delà, ça se chevauche) */}
        <text x={PAD.left} y={H - 6} fontSize={8} fill="#94a3b8">{fmtDate(tris[0].date)}</text>
        {tris.length > 1 && (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={8} fill="#94a3b8">
            {fmtDate(tris[tris.length - 1].date)}
          </text>
        )}
      </svg>

      {/* Tableau complet, replié par défaut */}
      <button type="button" onClick={() => setDetail(d => !d)}
        className="text-xs font-medium text-gray-400 hover:text-gray-600 transition mt-1">
        {detail ? 'Masquer le détail' : `Détail (${tris.length})`}
      </button>
      {detail && (
        <div className="mt-2 -mx-1 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left font-medium py-1 px-1">Date</th>
                <th className="text-right font-medium py-1 px-1">Valeur</th>
                <th className="text-right font-medium py-1 px-1">Évolution</th>
              </tr>
            </thead>
            <tbody>
              {[...tris].reverse().map((p, k) => {
                const idx = tris.length - 1 - k
                const e = ecart(idx)
                return (
                  <tr key={idx} onClick={() => setSelection(idx)}
                    className={`border-t border-gray-50 cursor-pointer ${idx === i ? 'bg-gray-50' : ''}`}>
                    <td className="py-1 px-1 text-gray-500 whitespace-nowrap">
                      {p.origine ? 'Naissance' : fmtDate(p.date)}
                    </td>
                    <td className="py-1 px-1 text-right font-medium text-gray-800 whitespace-nowrap">
                      {`${fmt(p.value)} ${unite}`}
                    </td>
                    <td className={`py-1 px-1 text-right whitespace-nowrap ${e === null ? 'text-gray-300' : e >= 0 ? 'text-green-600' : 'text-orange-500'}`}>
                      {e === null ? '—' : fmtEcart(e)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
