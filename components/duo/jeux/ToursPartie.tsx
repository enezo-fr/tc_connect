'use client'

import { useMemo, useState } from 'react'
import { Pencil, Layers, ListOrdered } from 'lucide-react'
import { BoutonPoubelle } from '@/components/ui/ConfirmSuppression'
import { classementPartie, totalJoueur } from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

/**
 * La feuille de score : un tour par ligne, un joueur par colonne.
 *
 * C'est la vue que tout le monde connaît sur un carnet, et la seule qui permette
 * de relire une partie sans compter de tête. Le tableau défile horizontalement
 * dans sa propre boîte : à six joueurs sur un téléphone, la page elle-même ne
 * doit pas partir de travers.
 *
 * Deux lectures au choix : les points du tour, ou le cumul après ce tour — c'est
 * le cumul qu'on regarde quand on joue à l'objectif.
 */
export default function ToursPartie({ partie, onModifier, onSupprimer }: {
  partie: DuoPartie
  /** Absent = lecture seule. */
  onModifier?: (index: number) => void
  onSupprimer?: (index: number) => void
}) {
  const [cumul, setCumul] = useState(false)
  const tours = partie.tours ?? []
  const joueurs = partie.joueurs ?? []

  /** Cumul après chaque tour, par joueur — calculé une fois pour tout le tableau. */
  const cumuls = useMemo(() => {
    const courant = new Map<string, number>(joueurs.map((j) => [j, 0]))
    return tours.map((t) => {
      joueurs.forEach((j) => {
        const pts = (t.scores ?? []).find((s) => s.joueur === j)?.points ?? 0
        courant.set(j, (courant.get(j) ?? 0) + pts)
      })
      return new Map(courant)
    })
  }, [tours, joueurs])

  const rangs = useMemo(
    () => new Map(classementPartie(partie).map((l) => [l.joueur, l.rang])),
    [partie],
  )

  if (tours.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-6 text-center">
        <ListOrdered size={24} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">Aucun tour saisi pour l&apos;instant.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {`Feuille de score · ${tours.length} tour${tours.length > 1 ? 's' : ''}`}
        </p>
        <button type="button" onClick={() => setCumul((v) => !v)}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition ${
            cumul ? 'bg-rose-600 text-white border-rose-600' : 'border-gray-200 text-gray-600 hover:border-rose-300'
          }`}>
          <Layers size={13} />Cumul
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-gray-400">
              <th className="text-left font-medium px-4 py-2 sticky left-0 bg-white z-10">Tour</th>
              {joueurs.map((j) => (
                <th key={j} className="font-medium px-3 py-2 text-right whitespace-nowrap max-w-[7rem] truncate">
                  {j}
                </th>
              ))}
              {(onModifier || onSupprimer) && <th className="px-2" />}
            </tr>
          </thead>
          <tbody>
            {tours.map((t, i) => (
              <tr key={i} className="border-t border-gray-50 group">
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap sticky left-0 bg-white z-10">
                  {t.nom || `Tour ${i + 1}`}
                </td>
                {joueurs.map((j) => {
                  const pts = (t.scores ?? []).find((s) => s.joueur === j)?.points ?? 0
                  return (
                    <td key={j} className="px-3 py-2 text-right tabular-nums text-gray-800 whitespace-nowrap">
                      {cumul ? (cumuls[i].get(j) ?? 0) : pts}
                    </td>
                  )
                })}
                {(onModifier || onSupprimer) && (
                  <td className="px-2 py-1 whitespace-nowrap">
                    <div className="flex items-center justify-end">
                      {onModifier && (
                        <button type="button" onClick={() => onModifier(i)} aria-label={`Corriger le tour ${i + 1}`}
                          className="p-2 rounded-lg text-gray-300 hover:text-rose-600 hover:bg-rose-50 transition">
                          <Pencil size={14} />
                        </button>
                      )}
                      {onSupprimer && (
                        <BoutonPoubelle taille={14} label={`Supprimer le tour ${i + 1}`}
                          onClick={() => onSupprimer(i)} />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-100 bg-gray-50/60">
              <td className="px-4 py-2.5 text-xs font-semibold text-gray-500 sticky left-0 bg-gray-50/60 z-10">
                Total
              </td>
              {joueurs.map((j) => (
                <td key={j} className={`px-3 py-2.5 text-right font-bold tabular-nums whitespace-nowrap ${
                  rangs.get(j) === 1 ? 'text-amber-600' : 'text-gray-800'
                }`}>
                  {totalJoueur(partie, j)}
                </td>
              ))}
              {(onModifier || onSupprimer) && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
