'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, deleteField } from 'firebase/firestore'
import { QRCodeSVG } from 'qrcode.react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/lib/firebase'
import { boutiqueLinkOrigin } from '@/lib/brand'
import { Copy, Check, Link2, Share2, QrCode, ShieldCheck, Search, UserPlus, Power } from 'lucide-react'
import type { Commande, User } from '@/types'

interface Props {
  isOpen: boolean
  onClose: () => void
  commande: Commande
  /** `modifier` du hook useCommandes (updateDoc sur bar_commandes). */
  modifier: (id: string, data: Record<string, unknown>) => Promise<unknown>
}

const genToken = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** Partage d'UNE commande : lien public + QR à scanner, et rattachement Admin. */
export function CommandeShareModal({ isOpen, onClose, commande, modifier }: Props) {
  const { currentUser, userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const url = commande.shareToken ? `${boutiqueLinkOrigin()}/commande/${commande.shareToken}` : ''

  const activer = async () => {
    setWorking(true); setError('')
    try {
      await modifier(commande.id, { shareToken: genToken() })
    } catch { setError('Activation impossible.') } finally { setWorking(false) }
  }
  const couper = async () => {
    setWorking(true); setError('')
    try {
      await modifier(commande.id, { shareToken: deleteField() })
    } catch { setError('Impossible de couper le partage.') } finally { setWorking(false) }
  }

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setError('Copie impossible — sélectionnez le lien à la main.') }
  }
  const handleShare = async () => {
    try {
      await navigator.share({ title: `Commande — ${commande.lieu || 'Tournée'}`, text: 'Voici notre commande :', url })
    } catch { /* annulé */ }
  }

  // ── Rattachement direct d'un compte (ADMIN uniquement) ────────────────────
  const call = useCallback(async (u: string, body: Record<string, unknown>) => {
    if (!currentUser) throw new Error('Session expirée.')
    const idToken = await currentUser.getIdToken()
    const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, ...body }) })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || 'Une erreur est survenue.')
    return data
  }, [currentUser])

  const [pickerOuvert, setPickerOuvert] = useState(false)
  const [comptes, setComptes] = useState<User[]>([])
  const [comptesLoading, setComptesLoading] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [ajoutUid, setAjoutUid] = useState<string | null>(null)

  useEffect(() => { if (!isOpen) { setPickerOuvert(false); setRecherche(''); setError('') } }, [isOpen])

  const ouvrirPicker = async () => {
    setPickerOuvert(true)
    if (comptes.length || comptesLoading) return
    setComptesLoading(true)
    try {
      const snap = await getDocs(collection(db, 'users'))
      setComptes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as User))
    } catch { setError('Impossible de charger la liste des comptes.') } finally { setComptesLoading(false) }
  }

  const resultats = useMemo(() => {
    const deja = new Set(commande.members ?? [])
    const q = recherche.trim().toLowerCase()
    return comptes
      .filter((u) => { const uid = u.uid ?? u.id; return uid && !deja.has(uid) })
      .filter((u) => !q || `${u.prenom ?? ''} ${u.nom ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => `${a.prenom ?? ''}${a.nom ?? ''}`.localeCompare(`${b.prenom ?? ''}${b.nom ?? ''}`))
      .slice(0, 8)
  }, [comptes, recherche, commande.members])

  const handleRattacher = async (u: User) => {
    const targetUid = u.uid ?? u.id
    if (!targetUid) return
    setAjoutUid(targetUid); setError('')
    try {
      await call('/api/commande-share/add-member', { commandeId: commande.id, uid: targetUid })
      setRecherche('')
    } catch (e: any) { setError(e?.message || 'Rattachement impossible.') } finally { setAjoutUid(null) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Partager la commande">
      <div className="space-y-5">
        <p className="text-sm text-gray-500">
          N&apos;importe qui peut ouvrir le lien (ou scanner le QR) pour voir la commande et la
          compléter, sans compte. Le QR se scanne directement depuis ton téléphone.
        </p>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{error}</div>}

        {!commande.shareToken ? (
          <button onClick={activer} disabled={working}
            className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition">
            <QrCode size={16} />{working ? 'Activation…' : 'Activer le partage'}
          </button>
        ) : (
          <div className="space-y-3">
            {/* QR code */}
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-2xl border border-gray-200">
                <QRCodeSVG value={url} size={188} level="M" />
              </div>
            </div>

            <div className="flex items-center gap-2 bg-sky-50 border border-sky-100 rounded-xl px-3 py-2">
              <Link2 size={15} className="text-sky-600 shrink-0" />
              <span className="text-xs text-sky-900 truncate flex-1">{url}</span>
            </div>

            <div className="flex gap-2">
              <button onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
                {copied ? <><Check size={15} className="text-green-600" />Copié</> : <><Copy size={15} />Copier</>}
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button onClick={handleShare}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white py-2 rounded-xl text-sm transition">
                  <Share2 size={15} />Partager
                </button>
              )}
            </div>

            <button onClick={couper} disabled={working}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-red-500 py-1.5 transition">
              <Power size={14} />Couper le partage
            </button>
          </div>
        )}

        {/* ── Rattachement direct — ADMIN uniquement ──────────────────────────── */}
        {isAdmin && (
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
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
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
                            className="shrink-0 text-xs font-medium bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition">
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
              Le compte rattaché retrouve cette commande dans sa propre app « Commandes », en accès
              gratuit. Ce bloc n&apos;apparaît que pour l&apos;administrateur.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
