'use client'

import { useCallback, useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { boutiqueLinkOrigin } from '@/lib/brand'
import { Copy, Check, Link2, Trash2, UserPlus, Share2, Heart } from 'lucide-react'

interface Member { uid: string; name: string; isCreator: boolean }
interface PendingInvite { token: string; expiresAt: number }

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** Partage de l'app « Sarah & Ted » avec l'autre : lien d'invitation unique. */
export function DuoShareModal({ isOpen, onClose }: Props) {
  const { currentUser } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const call = useCallback(async (url: string, body: Record<string, unknown> = {}) => {
    if (!currentUser) throw new Error('Session expirée.')
    const idToken = await currentUser.getIdToken()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, ...body }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || 'Une erreur est survenue.')
    return data
  }, [currentUser])

  const refresh = useCallback(async () => {
    setError('')
    try {
      const data = await call('/api/duo-invite/list')
      setMembers(data.members ?? [])
      setInvites(data.invites ?? [])
    } catch (e: any) {
      setError(e?.message || 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [call])

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    refresh()
  }, [isOpen, refresh])

  // Lien destiné à l'autre personne (hors app) → toujours sur le domaine Enezo.
  const inviteUrl = invites.length
    ? `${boutiqueLinkOrigin()}/duo-invitation/${invites[0].token}`
    : ''

  const handleGenerate = async () => {
    setWorking(true); setError('')
    try {
      await call('/api/duo-invite/create')
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Génération impossible.')
    } finally {
      setWorking(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copie impossible — sélectionnez le lien à la main.')
    }
  }

  const handleShare = async () => {
    try {
      await navigator.share({
        title: 'Sarah & Ted',
        text: 'Rejoins-moi sur notre appli à deux (films, activités, scores) :',
        url: inviteUrl,
      })
    } catch { /* partage annulé */ }
  }

  const handleRevoke = async (token: string) => {
    setWorking(true); setError('')
    try {
      await call('/api/duo-invite/revoke', { token })
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Annulation impossible.')
    } finally {
      setWorking(false)
    }
  }

  const partage = members.length > 1

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Partager avec l'autre">
      <div className="space-y-5">

        <p className="text-sm text-gray-500">
          Une fois lié, l'autre voit et complète les mêmes listes (films, activités, scores)
          en temps réel, depuis son propre compte. Tout l'historique déjà saisi lui devient
          visible.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Qui a accès ─────────────────────────────────────────────── */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Qui a accès</h3>
              <div className="space-y-1.5">
                {members.map((m) => (
                  <div key={m.uid} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {m.name}{m.uid === currentUser?.uid && <span className="text-gray-400 font-normal"> (vous)</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Lien d'invitation ───────────────────────────────────────── */}
            {partage ? (
              <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 py-1">
                <Heart size={12} className="text-rose-500" />
                <span>Vos deux comptes sont liés — tout est partagé.</span>
              </div>
            ) : (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Inviter l'autre</h3>

                {invites.length === 0 ? (
                  <button onClick={handleGenerate} disabled={working}
                    className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition">
                    <UserPlus size={16} />
                    {working ? 'Génération…' : 'Générer un lien d\'invitation'}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                      <Link2 size={15} className="text-rose-600 shrink-0" />
                      <span className="text-xs text-rose-900 truncate flex-1">{inviteUrl}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleCopy}
                        className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
                        {copied ? <><Check size={15} className="text-green-600" />Copié</> : <><Copy size={15} />Copier</>}
                      </button>
                      {typeof navigator !== 'undefined' && 'share' in navigator && (
                        <button onClick={handleShare}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white py-2 rounded-xl text-sm transition">
                          <Share2 size={15} />Partager
                        </button>
                      )}
                      <button onClick={() => handleRevoke(invites[0].token)} disabled={working}
                        title="Annuler ce lien"
                        className="px-3 rounded-xl border border-gray-300 text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">
                      Valable 7 jours et utilisable une seule fois. Le lien devient inactif dès que
                      l'autre l'a accepté.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
