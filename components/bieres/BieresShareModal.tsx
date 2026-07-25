'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/lib/firebase'
import { boutiqueLinkOrigin } from '@/lib/brand'
import { Copy, Check, Link2, Trash2, UserPlus, Share2, Beer, ShieldCheck, Search } from 'lucide-react'
import type { User } from '@/types'

interface Member { uid: string; name: string; isCreator: boolean }
interface PendingInvite { token: string; expiresAt: number }

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** Partage du catalogue de bières avec une autre personne : lien d'invitation. */
export function BieresShareModal({ isOpen, onClose }: Props) {
  const { currentUser, userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
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
      const data = await call('/api/bieres-invite/list')
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

  const inviteUrl = invites.length
    ? `${boutiqueLinkOrigin()}/bieres-invitation/${invites[0].token}`
    : ''

  const handleGenerate = async () => {
    setWorking(true); setError('')
    try {
      await call('/api/bieres-invite/create')
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
        title: 'Bible de la bière',
        text: 'Rejoins-moi sur notre catalogue de bières partagé :',
        url: inviteUrl,
      })
    } catch { /* partage annulé */ }
  }

  const handleRevoke = async (token: string) => {
    setWorking(true); setError('')
    try {
      await call('/api/bieres-invite/revoke', { token })
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Annulation impossible.')
    } finally {
      setWorking(false)
    }
  }

  // ── Rattachement direct d'un compte (ADMIN uniquement) ────────────────────
  const [pickerOuvert, setPickerOuvert] = useState(false)
  const [comptes, setComptes] = useState<User[]>([])
  const [comptesLoading, setComptesLoading] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [ajoutUid, setAjoutUid] = useState<string | null>(null)

  const ouvrirPicker = async () => {
    setPickerOuvert(true)
    if (comptes.length || comptesLoading) return
    setComptesLoading(true)
    try {
      const snap = await getDocs(collection(db, 'users'))
      setComptes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as User))
    } catch {
      setError('Impossible de charger la liste des comptes.')
    } finally {
      setComptesLoading(false)
    }
  }

  const resultats = useMemo(() => {
    const deja = new Set(members.map((m) => m.uid))
    const q = recherche.trim().toLowerCase()
    return comptes
      .filter((u) => { const uid = u.uid ?? u.id; return uid && !deja.has(uid) })
      .filter((u) => !q || `${u.prenom ?? ''} ${u.nom ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => `${a.prenom ?? ''}${a.nom ?? ''}`.localeCompare(`${b.prenom ?? ''}${b.nom ?? ''}`))
      .slice(0, 8)
  }, [comptes, recherche, members])

  const handleRattacher = async (u: User) => {
    const targetUid = u.uid ?? u.id
    if (!targetUid) return
    setAjoutUid(targetUid); setError('')
    try {
      await call('/api/bieres-invite/add-member', { uid: targetUid })
      setRecherche('')
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Rattachement impossible.')
    } finally {
      setAjoutUid(null)
    }
  }

  const partage = members.length > 1

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Partager le catalogue">
      <div className="space-y-5">

        <p className="text-sm text-gray-500">
          La personne invitée voit et complète le même catalogue de bières et les dégustations,
          en temps réel, depuis son propre compte. Tout l'historique lui devient visible.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
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

            {partage ? (
              <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 py-1">
                <Beer size={12} className="text-amber-500" />
                <span>Vos deux comptes sont liés — le catalogue est partagé.</span>
              </div>
            ) : (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Inviter une personne</h3>

                {invites.length === 0 ? (
                  <button onClick={handleGenerate} disabled={working}
                    className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition">
                    <UserPlus size={16} />
                    {working ? 'Génération…' : 'Générer un lien d\'invitation'}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                      <Link2 size={15} className="text-amber-600 shrink-0" />
                      <span className="text-xs text-amber-900 truncate flex-1">{inviteUrl}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleCopy}
                        className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
                        {copied ? <><Check size={15} className="text-green-600" />Copié</> : <><Copy size={15} />Copier</>}
                      </button>
                      {typeof navigator !== 'undefined' && 'share' in navigator && (
                        <button onClick={handleShare}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-xl text-sm transition">
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
                      la personne l'a accepté.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Rattachement direct — ADMIN uniquement ──────────────────── */}
            {isAdmin && !partage && (
              <div className="border-t border-dashed border-gray-200 pt-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  Rattacher un compte
                  <span className="inline-flex items-center gap-1 normal-case tracking-normal text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                    <ShieldCheck size={11} />Admin
                  </span>
                </h3>

                {!pickerOuvert ? (
                  <button onClick={ouvrirPicker}
                    className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                    <UserPlus size={16} />Choisir un compte existant
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" autoFocus placeholder="Nom, prénom ou email…"
                        value={recherche} onChange={(e) => setRecherche(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                    </div>

                    {comptesLoading ? (
                      <p className="text-xs text-gray-400 py-2">Chargement des comptes…</p>
                    ) : resultats.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 italic">Aucun compte ne correspond.</p>
                    ) : (
                      <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 overflow-hidden">
                        {resultats.map((u) => {
                          const uid = (u.uid ?? u.id) as string
                          const nom = [u.prenom, u.nom].filter(Boolean).join(' ').trim()
                          return (
                            <div key={uid} className="flex items-center justify-between gap-3 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-sm text-gray-800 truncate">{nom || u.email || 'Compte sans nom'}</p>
                                {nom && u.email && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
                              </div>
                              <button onClick={() => handleRattacher(u)} disabled={!!ajoutUid}
                                className="shrink-0 text-xs font-medium bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition">
                                {ajoutUid === uid ? 'Ajout…' : 'Rattacher'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-2">
                  Accès donné immédiatement, sans lien ni validation de la personne — elle en est
                  avertie par notification. Ce bloc n&apos;apparaît que pour l&apos;administrateur.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
