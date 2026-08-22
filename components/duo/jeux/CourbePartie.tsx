'use client'

import { useMemo } from 'react'
import { cumulsParTour } from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

/** Une teinte par joueur, reprise à l'identique dans la légende et le tableau. */
export const COULEURS_JOUEURS = [
  '#e11d48', // rose-600 — la couleur de l'app
  '#0ea5e9', // sky-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#8b5cf6', // violet-500
  '#64748b', // slate-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
]

export const couleurJoueur = (i: number) => COULEURS_JOUEURS[i % COULEURS_JOUEURS.length]

const L = 40   // marge gauche (les valeurs)
const R = 10
const H = 200  // hauteur du tracé
const B = 22   // marge basse (les numéros de tour)
const W = 600

/**
 * Évolution des totaux, tour par tour — courbe SVG maison, sans librairie.
 *
 * C'est la stat qu'on ne peut pas lire dans un tableau : qui a décroché, qui est
 * revenu, à quel moment la partie a basculé.
 */
export default function CourbePartie({ partie }: { partie: DuoPartie }) {
  const joueurs = partie.joueurs ?? []
  const cumuls = useMemo(() => cumulsParTour(partie), [partie])

  if (partie.sansPoints || cumuls.length < 2 || joueurs.length === 0) return null

  const valeurs = cumuls.flatMap((c) => joueurs.map((j) => c.get(j) ?? 0))
  const max = Math.max(...valeurs, 0)
  const min = Math.min(...valeurs, 0)
  const amplitude = max - min || 1

  // Le tour 0 (avant la première manche) est inclus : sans lui, toutes les
  // courbes partiraient du premier score au lieu de partir de zéro.
  const points = cumuls.length
  const x = (i: number) => L + ((W - L - R) * i) / points
  const y = (v: number) => H - ((v - min) / amplitude) * (H - 10) + 5

  const ligne = (j: string) =>
    [`${x(0)},${y(0)}`, ...cumuls.map((c, i) => `${x(i + 1)},${y(c.get(j) ?? 0)}`)].join(' ')

  const graduations = [max, Math.round((max + min) / 2), min].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Évolution des scores
        </p>
        <p className="text-[11px] text-gray-400">
          {partie.scoreBasGagne ? 'la courbe la plus basse mène' : 'la courbe la plus haute mène'}
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H + B}`} className="w-full h-auto" role="img"
        aria-label="Évolution des totaux tour par tour">
        {/* Repères horizontaux */}
        {graduations.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#94a3b8">{v}</text>
          </g>
        ))}

        {/* Numéros de tour : le premier, le milieu, le dernier */}
        {[0, Math.floor(points / 2), points].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={x(i)} y={H + 16} textAnchor="middle" fontSize={11} fill="#94a3b8">
            {i === 0 ? 'départ' : i}
          </text>
        ))}

        {/* Une courbe par joueur */}
        {joueurs.map((j, i) => (
          <g key={j}>
            <polyline points={ligne(j)} fill="none" stroke={couleurJoueur(i)}
              strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(points)} cy={y(cumuls[points - 1].get(j) ?? 0)} r={3.5}
              fill={couleurJoueur(i)} />
          </g>
        ))}
      </svg>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {joueurs.map((j, i) => (
          <span key={j} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: couleurJoueur(i) }} />
            {j}
          </span>
        ))}
      </div>
    </div>
  )
}
