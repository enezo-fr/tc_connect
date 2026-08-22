'use client'

import { Flag, RotateCcw, Undo2 } from 'lucide-react'
import type { DuoPartie } from '@/types'

/** Médaille du podium, comme dans le classement. */
const couleurRang = (rang: number) =>
  rang === 1 ? 'bg-amber-100 text-amber-700'
    : rang === 2 ? 'bg-gray-200 text-gray-600'
      : rang === 3 ? 'bg-orange-100 text-orange-700'
        : 'bg-gray-50 text-gray-500'

/**
 * Ordre d'arrivée d'une partie SANS POINTS : on touche les joueurs dans l'ordre
 * où ils finissent, le premier d'abord.
 *
 * Beaucoup de jeux de session n'ont pas de score (jeux d'ambiance, sport, jeux de
 * plateau à élimination) : sans ce mode ils resteraient hors du classement de la
 * session, alors qu'ils comptent autant que les autres.
 *
 * Le bouton « annuler » d'une ligne renvoie simplement le joueur dans la liste
 * des restants — c'est l'inverse exact du geste qui l'a placé, refaisable d'une
 * touche. Ce n'est pas une suppression : ni croix, ni poubelle, ni confirmation.
 */
export default function OrdreArrivee({ partie, onChange, lectureSeule = false }: {
  partie: DuoPartie
  onChange: (ordre: string[]) => void | Promise<void>
  lectureSeule?: boolean
}) {
  const joueurs = partie.joueurs ?? []
  const ordre = (partie.ordre ?? []).filter((j) => joueurs.includes(j))
  const restants = joueurs.filter((j) => !ordre.includes(j))

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Flag size={13} />Ordre d&apos;arrivée
        </p>
        {!lectureSeule && ordre.length > 0 && (
          <button type="button" onClick={() => onChange([])}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition">
            <RotateCcw size={12} />Recommencer
          </button>
        )}
      </div>

      {ordre.length === 0 ? (
        <p className="text-sm text-gray-400">
          Touchez les joueurs dans l&apos;ordre où ils terminent — le vainqueur en premier.
        </p>
      ) : (
        <div className="space-y-1.5">
          {ordre.map((j, i) => (
            <div key={j} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${couleurRang(i + 1)}`}>
                {i + 1}
              </span>
              <span className="flex-1 min-w-0 text-sm text-gray-800 break-words">{j}</span>
              {!lectureSeule && (
                <button type="button" title={`Remettre ${j} dans la liste`}
                  aria-label={`Remettre ${j} dans la liste`}
                  onClick={() => onChange(ordre.filter((x) => x !== j))}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-gray-700 hover:bg-gray-100 transition shrink-0">
                  <Undo2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!lectureSeule && restants.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] text-gray-400 mb-1.5">
            {ordre.length === 0 ? 'Qui a gagné ?' : 'Puis…'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {restants.map((j) => (
              <button key={j} type="button" onClick={() => onChange([...ordre, j])}
                className="px-3 py-1.5 rounded-xl text-sm border border-gray-200 text-gray-700 hover:border-rose-300 hover:text-rose-700 transition">
                {j}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
