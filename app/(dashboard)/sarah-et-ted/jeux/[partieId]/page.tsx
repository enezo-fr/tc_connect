'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { StoreGate } from '@/components/ui/StoreGate'
import ConfirmSuppression, { type CibleSuppression } from '@/components/ui/ConfirmSuppression'
import { useDuoJeux } from '@/hooks/useDuoJeux'
import ClassementPartie from '@/components/duo/jeux/ClassementPartie'
import ToursPartie from '@/components/duo/jeux/ToursPartie'
import StatsPartie from '@/components/duo/jeux/StatsPartie'
import TourModal from '@/components/duo/jeux/TourModal'
import OrdreArrivee from '@/components/duo/jeux/OrdreArrivee'
import PartageJeuModal from '@/components/duo/jeux/PartageJeuModal'
import LierSoireeModal from '@/components/duo/jeux/LierSoireeModal'
import ModifierPartieModal from '@/components/duo/jeux/ModifierPartieModal'
import { dateLisible } from '@/components/duo/jeux/CartePartie'
import { lierPartieASoiree } from '@/lib/duoJeuxDb'
import {
  baremeDeSoiree, classementSoiree, ecartSoiree, nomSoireeParDefaut, nouvelleSoireeId,
  objectifAtteint, partieJouee, partiesDeSoiree, vainqueurs,
} from '@/lib/duoJeux'
import { Timestamp } from 'firebase/firestore'
import {
  ArrowLeft, Plus, Pencil, Trash2, Share2, Link2, RotateCcw, CheckCircle2, CalendarDays,
  ChevronRight, StickyNote,
} from 'lucide-react'
import type { DuoPartie, DuoTour } from '@/types'

/**
 * LA page d'une partie.
 *
 * C'est le changement de fond de ce chantier : une partie n'est plus une ligne
 * qu'on déplie dans une liste, elle a son écran — score, feuille de tours,
 * partage, session. Tout ce qui supprime passe par une poubelle et une
 * confirmation, jamais par une croix.
 */
export default function PartieJeuPage() {
  const { partieId } = useParams<{ partieId: string }>()
  const router = useRouter()
  const { items, loading, modifier, supprimer, ajouter, base, bypass, estAuteur } = useDuoJeux()

  const partie = useMemo(() => items.find((p) => p.id === partieId) ?? null, [items, partieId])

  const [tourOuvert, setTourOuvert] = useState<{ index: number | null } | null>(null)
  const [partageOuvert, setPartageOuvert] = useState(false)
  const [soireeOuverte, setSoireeOuverte] = useState(false)
  const [editOuvert, setEditOuvert] = useState(false)
  const [aSupprimer, setASupprimer] = useState<CibleSuppression | null>(null)
  const [busy, setBusy] = useState(false)

  // ── Session : cumul avec les parties liées ────────────────────────────────
  const soiree = useMemo(
    () => (partie?.soireeId ? partiesDeSoiree(items, partie.soireeId) : []),
    [items, partie],
  )
  const ecart = useMemo(
    () => (soiree.length < 2 ? null : ecartSoiree(classementSoiree(soiree, baremeDeSoiree(soiree)))),
    [soiree],
  )

  const enregistrerTour = async (tour: DuoTour) => {
    if (!partie) return
    const tours = [...(partie.tours ?? [])]
    if (tourOuvert?.index == null) tours.push(tour)
    else tours[tourOuvert.index] = tour
    await modifier(partie.id, { tours })
  }

  const supprimerTour = (index: number) => {
    if (!partie) return
    setASupprimer({
      quoi: `le tour ${index + 1}`,
      detail: 'Les scores de ce tour seront retirés du total.',
      go: () => modifier(partie.id, { tours: (partie.tours ?? []).filter((_, i) => i !== index) }),
    })
  }

  const basculerTermine = () => partie && modifier(partie.id, { termine: !partie.termine })

  /**
   * Revanche : même jeu, mêmes joueurs, mêmes réglages, rattachée à la même
   * session (créée au besoin) pour que les points se cumulent. Les accès sont
   * repris, sinon les invités perdraient la revanche.
   */
  const revanche = async () => {
    if (!partie || !base) return
    setBusy(true)
    try {
      const soireeId = partie.soireeId ?? nouvelleSoireeId()
      const soireeName = partie.soireeName ?? nomSoireeParDefaut(partie)
      if (!partie.soireeId) await lierPartieASoiree(partie.id, soireeId, soireeName)

      const id = await ajouter({
        ...base,
        members: Array.from(new Set([...(partie.members ?? []), ...base.members])),
        jeu: partie.jeu,
        date: Timestamp.now(),
        joueurs: partie.joueurs ?? [],
        tours: [],
        ordre: [],
        sansPoints: !!partie.sansPoints,
        scoreBasGagne: !!partie.scoreBasGagne,
        objectif: partie.objectif ?? null,
        infos: '',
        termine: false,
        soireeId,
        soireeName,
      })
      router.push(`/sarah-et-ted/jeux/${id}`)
    } finally { setBusy(false) }
  }

  const gagnants = partie ? vainqueurs(partie) : []
  const proposerFin = !!partie && !partie.termine && objectifAtteint(partie)

  return (
    <StoreGate appRoute="/sarah-et-ted" bypass={bypass} showPin={false}>
      <div className="space-y-5">
        {/* En-tête : titre à gauche, actions à droite */}
        <div className="flex items-start gap-3">
          <button onClick={() => router.push('/sarah-et-ted/jeux')} aria-label="Retour aux jeux"
            className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 break-words">{partie?.jeu ?? 'Partie'}</h1>
            {partie && (
              <p className="text-sm text-gray-500 mt-1 break-words">
                {dateLisible(partie)}
                {' · '}{(partie.joueurs ?? []).join(', ')}
              </p>
            )}
          </div>
          {partie && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setPartageOuvert(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 transition">
                <Share2 size={16} /><span className="hidden sm:inline">Partager</span>
              </button>
              <button onClick={() => setSoireeOuverte(true)} aria-label="Rattacher à une session"
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                <Link2 size={16} />
              </button>
              <button onClick={() => setEditOuvert(true)} aria-label="Modifier la partie"
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                <Pencil size={16} />
              </button>
              {estAuteur(partie) && (
                <button aria-label="Supprimer la partie"
                  onClick={() => setASupprimer({
                    quoi: `la partie de ${partie.jeu}`,
                    detail: 'Tous ses tours et son classement seront perdus. Cette action est irréversible.',
                    go: async () => { await supprimer(partie.id); router.push('/sarah-et-ted/jeux') },
                  })}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )}
        </div>

        {loading && !partie ? (
          <div className="space-y-3">
            <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
            <div className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
          </div>
        ) : !partie ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <p className="text-sm text-gray-400">Partie introuvable — elle a peut-être été supprimée.</p>
          </div>
        ) : (
          <>
            {/* Session */}
            {partie.soireeId && soiree.length > 1 && (
              <button onClick={() => router.push(`/sarah-et-ted/jeux/soiree/${partie.soireeId}`)}
                className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md transition text-left">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <CalendarDays size={12} />{`Session · ${soiree.length} parties`}
                  </p>
                  <p className="text-sm font-semibold text-gray-800 break-words">{partie.soireeName || 'Sans nom'}</p>
                  {ecart && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {ecart.ecart === 0
                        ? `${ecart.enTete.joueur} et ${ecart.second.joueur} à égalité`
                        : `${ecart.enTete.joueur} devant ${ecart.second.joueur}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {ecart && (
                    <div className="text-right">
                      <p className="text-2xl font-bold text-rose-600 tabular-nums">
                        {ecart.ecart === 0 ? '—' : `+${ecart.ecart}`}
                      </p>
                      <p className="text-xs text-gray-400">d&apos;écart</p>
                    </div>
                  )}
                  <ChevronRight size={20} className="text-gray-300" />
                </div>
              </button>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {/* Colonne gauche : où en est la partie */}
              <div className="space-y-4">
                <ClassementPartie partie={partie} />

                {/* Au SkyJo la limite est une élimination, pas une victoire :
                    on ne l'annonce pas en vert comme un objectif atteint. */}
                {proposerFin && (
                  <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 border ${
                    partie.scoreBasGagne ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
                  }`}>
                    <p className={`text-sm min-w-0 ${partie.scoreBasGagne ? 'text-amber-900' : 'text-emerald-900'}`}>
                      {partie.scoreBasGagne
                        ? 'La limite de points est atteinte. On arrête là ?'
                        : "L'objectif est atteint. On arrête là ?"}
                    </p>
                    <button onClick={basculerTermine}
                      className={`shrink-0 text-white text-sm font-medium px-3 py-2 rounded-xl transition ${
                        partie.scoreBasGagne ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}>
                      Terminer
                    </button>
                  </div>
                )}

                {/* Saisie : un tour, ou l'ordre d'arrivée */}
                {partie.sansPoints ? (
                  <OrdreArrivee partie={partie} lectureSeule={!!partie.termine}
                    onChange={(ordre) => modifier(partie.id, { ordre })} />
                ) : !partie.termine && (
                  <button onClick={() => setTourOuvert({ index: null })}
                    className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-medium py-3 rounded-xl shadow-sm transition">
                    <Plus size={18} />Ajouter un tour
                  </button>
                )}

                {/* Fin de partie */}
                {partie.termine ? (
                  <div className="space-y-2">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-center text-sm font-medium text-emerald-700">
                      {gagnants.length > 0
                        ? `Partie terminée — ${gagnants.join(', ')} l'emporte${gagnants.length > 1 ? 'nt' : ''}`
                        : 'Partie terminée'}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={revanche} disabled={busy}
                        className="flex-1 flex items-center justify-center gap-2 border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60 font-medium py-2.5 rounded-xl transition">
                        <RotateCcw size={15} />{busy ? 'Création…' : 'Revanche'}
                      </button>
                      <button onClick={basculerTermine}
                        className="flex-1 border border-gray-300 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50 transition">
                        Rouvrir
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 text-center">
                      La revanche reprend les mêmes joueurs et rejoint la même session : les points se cumulent.
                    </p>
                  </div>
                ) : partieJouee(partie) && (
                  <button onClick={basculerTermine}
                    className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl transition">
                    <CheckCircle2 size={16} />Terminer la partie
                  </button>
                )}

                {partie.infos && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <StickyNote size={13} />Notes
                    </p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{partie.infos}</p>
                  </div>
                )}
              </div>

              {/* Colonne droite : la feuille de score, puis son analyse */}
              <div className="space-y-5">
                {!partie.sansPoints && (
                  <ToursPartie partie={partie}
                    onModifier={partie.termine ? undefined : (i) => setTourOuvert({ index: i })}
                    onSupprimer={partie.termine ? undefined : supprimerTour} />
                )}
                <StatsPartie partie={partie} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modales — jamais deux ouvertes en même temps (verrou de défilement) */}
      {partie && tourOuvert && (
        <TourModal partie={partie} index={tourOuvert.index}
          onClose={() => setTourOuvert(null)} onEnregistrer={enregistrerTour} />
      )}
      {partie && editOuvert && (
        <ModifierPartieModal partie={partie} onClose={() => setEditOuvert(false)}
          onEnregistrer={(patch) => modifier(partie.id, patch)} />
      )}
      {partie && (
        <PartageJeuModal isOpen={partageOuvert} onClose={() => setPartageOuvert(false)}
          partie={partie} estAuteur={estAuteur(partie)} />
      )}
      {partie && (
        <LierSoireeModal isOpen={soireeOuverte} onClose={() => setSoireeOuverte(false)}
          partie={partie} toutes={items as DuoPartie[]} />
      )}
      <ConfirmSuppression cible={aSupprimer} onClose={() => setASupprimer(null)} />
    </StoreGate>
  )
}
