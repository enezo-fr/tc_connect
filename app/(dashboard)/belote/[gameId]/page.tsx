'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useBeloteGame } from '@/hooks/useBeloteGame'
import { useBeloteGames } from '@/hooks/useBeloteGames'
import { createBeloteGame, lierPartieASerie } from '@/lib/belote/firebase'
import { cumulSerie, ecartSerie, nomSerieParDefaut, nouvelleSerieId, partiesDeSerie } from '@/lib/belote/serie'
import ScoreBoard from '@/components/belote/ScoreBoard'
import RoundHistory from '@/components/belote/RoundHistory'
import StatsJoueurs from '@/components/belote/StatsJoueurs'
import { BeloteShareModal } from '@/components/belote/BeloteShareModal'
import { LierPartieModal } from '@/components/belote/LierPartieModal'
import ReglesSelector from '@/components/belote/ReglesSelector'
import Modal from '@/components/ui/Modal'
import { REGLES_DEFAUT } from '@/lib/belote/rules'
import { ArrowLeftIcon, PlusIcon, PencilIcon, TrashIcon, ShareIcon, LinkIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import type { BeloteEndCondition, BeloteRegles } from '@/lib/belote/types'

export default function GameDetailPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const router = useRouter()
  const { currentUser } = useAuth()
  const { game, rounds, pot, regles, loading, removeRound, updateGameSettings, deleteGame, estAuteur } = useBeloteGame(gameId)
  const { games } = useBeloteGames()

  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState<{ endCondition: BeloteEndCondition; endValue: string; regles: BeloteRegles }>(
    { endCondition: 'score', endValue: '1000', regles: REGLES_DEFAUT })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showLier, setShowLier] = useState(false)
  const [busy, setBusy] = useState(false)

  // ── Série (parties liées) ────────────────────────────────────────────────
  const serie = useMemo(
    () => (game?.serieId ? partiesDeSerie(games, game.serieId) : []),
    [games, game],
  )
  const ecart = useMemo(() => (serie.length > 1 ? ecartSerie(cumulSerie(serie)) : null), [serie])

  /**
   * Revanche : nouvelle partie avec les mêmes équipes et les mêmes réglages,
   * rattachée à la même série (créée au besoin). Les accès de la partie d'origine
   * sont recopiés, sinon les invités perdraient la revanche.
   */
  const lancerRevanche = async () => {
    if (!game || !currentUser) return
    setBusy(true)
    try {
      const serieId = game.serieId ?? nouvelleSerieId()
      const serieName = game.serieName ?? nomSerieParDefaut(game)
      if (!game.serieId) await lierPartieASerie(game.id, serieId, serieName)

      const ref = await createBeloteGame({
        team1Id: game.team1Id,
        team2Id: game.team2Id,
        team1Name: game.team1Name,
        team2Name: game.team2Name,
        team1Players: game.team1Players ?? [],
        team2Players: game.team2Players ?? [],
        regles,
        endCondition: game.endCondition,
        endValue: game.endValue,
        status: 'in_progress',
        winnerId: null,
        totalScore: { team1: 0, team2: 0 },
        createdBy: currentUser.uid,
        members: Array.from(new Set([...(game.members ?? []), game.createdBy, currentUser.uid].filter(Boolean) as string[])),
        serieId,
        serieName,
        finishedAt: null,
      })
      router.push(`/belote/${(ref as { id: string }).id}`)
    } finally { setBusy(false) }
  }

  const capots = rounds.filter(r => r.capot).length
  const dedans = rounds.filter(r => r.dedans).length
  const belotes = rounds.filter(r => r.beloteRebelote).length

  const openEdit = () => {
    if (!game) return
    setEditForm({ endCondition: game.endCondition, endValue: String(game.endValue), regles })
    setShowEdit(true)
  }

  const handleSaveSettings = async () => {
    setBusy(true)
    try {
      await updateGameSettings({
        endCondition: editForm.endCondition,
        endValue: Number(editForm.endValue) || 1,
        regles: editForm.regles,
      })
      setShowEdit(false)
    } finally { setBusy(false) }
  }

  const handleDelete = async () => {
    setBusy(true)
    try { await deleteGame(); router.push('/belote') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      {/* Titre sur toute la largeur : les noms d'équipes ne tiennent pas sur une
          ligne de téléphone, ils passent à la ligne plutôt que d'être coupés. */}
      <div className="flex items-start gap-3">
        <button onClick={() => router.push('/belote')} aria-label="Retour"
          className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0">
          <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-lg font-bold text-gray-800 flex-1 min-w-0 break-words pt-1.5">
          {game ? `${game.team1Name} vs ${game.team2Name}` : 'Partie'}
        </h1>
        {game && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
              <ShareIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Partager</span>
            </button>
            <button onClick={() => setShowLier(true)} aria-label="Lier à une autre partie"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
              <LinkIcon className="w-4 h-4" />
            </button>
            <button onClick={openEdit} aria-label="Modifier la partie"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
              <PencilIcon className="w-4 h-4" />
            </button>
            {estAuteur && (
              <button onClick={() => setConfirmDelete(true)} aria-label="Supprimer la partie"
                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                <TrashIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Série : cumul et écart de points sur les parties liées */}
      {game?.serieId && serie.length > 1 && (
        <button onClick={() => router.push(`/belote/serie/${game.serieId}`)}
          className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3 hover:shadow-md transition text-left">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Série · {serie.length} parties liées
            </p>
            <p className="text-sm font-semibold text-gray-800 break-words">{game.serieName || 'Sans nom'}</p>
            {ecart && (
              <p className="text-xs text-gray-500 mt-0.5">
                {ecart.ecart === 0
                  ? `${ecart.enTete.name} et ${ecart.second.name} à égalité`
                  : `${ecart.enTete.name} devant ${ecart.second.name}`}
              </p>
            )}
          </div>
          {ecart && (
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-blue-600 tabular-nums">
                {ecart.ecart === 0 ? '—' : `+${ecart.ecart}`}
              </p>
              <p className="text-xs text-gray-400">d&apos;écart</p>
            </div>
          )}
        </button>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          <div className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
        </div>
      ) : !game ? (
        <div className="text-center py-20 text-gray-400 text-sm">Partie introuvable.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* Colonne gauche : score + actions + bilan */}
          <div className="space-y-4">
            <ScoreBoard game={game} rounds={rounds} pot={pot} />

            {game.status === 'in_progress' ? (
              <button onClick={() => router.push(`/belote/${gameId}/nouveau-tour`)}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition">
                <PlusIcon className="w-5 h-5" /> Nouveau tour
              </button>
            ) : (
              <div className="space-y-2">
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center text-sm font-medium text-green-700">
                  Partie terminée
                </div>
                <button onClick={lancerRevanche} disabled={busy}
                  className="w-full flex items-center justify-center gap-2 border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60 font-medium py-2.5 rounded-xl transition">
                  <ArrowPathIcon className="w-4 h-4" />
                  {busy ? 'Création…' : 'Revanche'}
                </button>
                <p className="text-xs text-gray-400 text-center">
                  La revanche reprend les mêmes équipes et se lie à cette partie : les points se cumulent.
                </p>
              </div>
            )}

            {/* Bilan des événements */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Bilan</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-bold text-purple-600">{capots}</p>
                  <p className="text-xs text-gray-500">Capot{capots > 1 ? 's' : ''}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-500">{dedans}</p>
                  <p className="text-xs text-gray-500">Dedans</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-600">{belotes}</p>
                  <p className="text-xs text-gray-500">Belote{belotes > 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Colonne droite : historique des tours puis statistiques */}
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Tours</h2>
              <RoundHistory
                game={game}
                rounds={rounds}
                onEdit={(id) => router.push(`/belote/${gameId}/nouveau-tour?roundId=${id}`)}
                onDelete={removeRound}
              />
            </div>
            <StatsJoueurs parties={[{ game, rounds }]} titre="Statistiques de la partie" />
          </div>
        </div>
      )}

      {/* Partage : lien + QR, email, comptes */}
      {game && (
        <BeloteShareModal isOpen={showShare} onClose={() => setShowShare(false)} game={game} estAuteur={estAuteur} />
      )}

      {/* Lier à une autre partie (revanche, belle…) */}
      {game && (
        <LierPartieModal isOpen={showLier} onClose={() => setShowLier(false)} game={game} toutes={games} />
      )}

      {/* Modale modifier la partie */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Modifier la partie">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fin de partie</label>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {([['score', 'Par score'], ['rounds', 'Par tours']] as [BeloteEndCondition, string][]).map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setEditForm(f => ({ ...f, endCondition: k }))}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${editForm.endCondition === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editForm.endCondition === 'score' ? 'Score cible' : 'Nombre de tours'}
            </label>
            <input type="number" inputMode="numeric" min={1} value={editForm.endValue}
              onChange={e => setEditForm(f => ({ ...f, endValue: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <div className="border-t border-dashed border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Règles de la table</h3>
            <ReglesSelector valeur={editForm.regles} avertirRecalcul={rounds.length > 0}
              onChange={(r) => setEditForm(f => ({ ...f, regles: r }))} />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => setShowEdit(false)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
            <button onClick={handleSaveSettings} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">Enregistrer</button>
          </div>
        </div>
      </Modal>

      {/* Confirmation suppression partie */}
      <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} title="Supprimer la partie" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Supprimer cette partie et tous ses tours ? Cette action est irréversible.</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">Annuler</button>
            <button onClick={handleDelete} disabled={busy} className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">Supprimer</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
