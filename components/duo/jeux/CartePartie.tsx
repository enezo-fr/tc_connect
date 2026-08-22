'use client'

import { useRouter } from 'next/navigation'
import { ChevronRight, Users, Link2, CalendarDays, Trophy } from 'lucide-react'
import { partieJouee, secondesPartie, vainqueurs } from '@/lib/duoJeux'
import type { DuoPartie } from '@/types'

/** « 12 août 2026 » — la date affichée partout sur les cartes de partie. */
export const dateLisible = (p: DuoPartie) => {
  const s = secondesPartie(p)
  if (!s) return ''
  return new Date(s * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Une partie dans une liste. Toujours cliquable : depuis ce chantier, chaque
 * partie a sa PAGE — plus de dépliage dans la liste, qui devenait illisible dès
 * qu'il y avait plus de trois parties.
 */
export default function CartePartie({ partie, partagee = false }: {
  partie: DuoPartie
  /** Partie reçue d'un autre compte. */
  partagee?: boolean
}) {
  const router = useRouter()
  const gagnants = vainqueurs(partie)
  const nbTours = partie.tours?.length ?? 0

  return (
    <button onClick={() => router.push(`/sarah-et-ted/jeux/${partie.id}`)}
      className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md hover:border-rose-200 transition text-left active:scale-[0.995]">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-800 break-words">{partie.jeu}</p>
        <p className="text-xs text-gray-500 mt-0.5 break-words">
          {dateLisible(partie)}
          {' · '}{(partie.joueurs ?? []).join(', ')}
          {!partie.sansPoints && nbTours > 0 && ` · ${nbTours} tour${nbTours > 1 ? 's' : ''}`}
        </p>

        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {partieJouee(partie) && gagnants.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-100 rounded-full px-1.5 py-0.5">
              <Trophy size={11} />{gagnants.join(', ')}
            </span>
          )}
          {!partie.termine && (
            <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-full px-1.5 py-0.5">
              En cours
            </span>
          )}
          {partie.soireeId && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-1.5 py-0.5">
              <CalendarDays size={11} />{partie.soireeName || 'Session'}
            </span>
          )}
          {partagee && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.5">
              <Users size={11} />Partagée avec moi
            </span>
          )}
          {partie.shareToken && !partagee && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-1.5 py-0.5">
              <Link2 size={11} />Lien actif
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={20} className="text-gray-300 shrink-0" />
    </button>
  )
}
