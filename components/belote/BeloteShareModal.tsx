'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { QRCodeSVG } from 'qrcode.react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/lib/firebase'
import { boutiqueLinkOrigin } from '@/lib/brand'
import {
  activerPartageLien, couperPartageLien, noterEmailPartage, retirerEmailPartage,
} from '@/lib/belote/firebase'
import type { BeloteGame } from '@/lib/belote/types'
import type { User } from '@/types'
import {
  Copy, Check, Link2, Share2, QrCode, ShieldCheck, Search, UserPlus, Power,
  Mail, X, Users,
} from 'lucide-react'

interface Props {
  isOpen: boolean
  onClose: () => void
  game: BeloteGame
  /** L'auteur seul coupe le lien ou retire un accès. */
  estAuteur: boolean
}

interface Membre { uid: string; name: string; isCreator: boolean }

const emailValide = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/**
 * Partage d'UNE partie de belote (et de sa série s'il y en a une) :
 *  - lien public + QR, ouvrable SANS COMPTE ;
 *  - envoi du lien à une adresse email (mailto, comme tous les envois de l'app) ;
 *  - rattachement direct d'un compte existant — ADMIN uniquement.
 */
export function BeloteShareModal({ isOpen, onClose, game, estAuteur }: Props) {
  const { currentUser, userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'

  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const url = game.shareToken ? `${boutiqueLinkOrigin()}/belote-partie/${game.shareToken}` : ''

  const appel = useCallback(async (chemin: string, body: Record<string, unknown>) => {
    if (!currentUser) throw new Error('Session expirée.')
    const idToken = await currentUser.getIdToken()
    const res = await fetch(`/api/belote-share/${chemin}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, ...body }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || 'Une erreur est survenue.')
    return data
  }, [currentUser])

  // ── Membres ────────────────────────────────────────────────────────────────
  const [membres, setMembres] = useState<Membre[]>([])
  const [membresLoading, setMembresLoading] = useState(false)

  const chargerMembres = useCallback(async () => {
    if (!currentUser) return
    setMembresLoading(true)
    try {
      const data = await appel('members', { gameId: game.id })
      setMembres(data.members ?? [])
    } catch { /* la liste reste vide, le partage fonctionne quand même */ }
    finally { setMembresLoading(false) }
  }, [appel, currentUser, game.id])

  useEffect(() => {
    if (isOpen) chargerMembres()
  }, [isOpen, chargerMembres])

  const retirerMembre = async (uid: string) => {
    setWorking(true); setError('')
    try {
      await appel('remove-member', { gameId: game.id, uid })
      await chargerMembres()
    } catch (e) { setError(e instanceof Error ? e.message : 'Retrait impossible.') }
    finally { setWorking(false) }
  }

  // ── Lien public + QR ───────────────────────────────────────────────────────
  const activer = async (): Promise<string> => {
    if (game.shareToken) return `${boutiqueLinkOrigin()}/belote-partie/${game.shareToken}`
    setWorking(true); setError('')
    try {
      const token = await activerPartageLien(game.id)
      return `${boutiqueLinkOrigin()}/belote-partie/${token}`
    } catch {
      setError('Activation impossible.')
      throw new Error('activation')
    } finally { setWorking(false) }
  }

  const couper = async () => {
    setWorking(true); setError('')
    try { await couperPartageLien(game.id) }
    catch { setError('Impossible de couper le partage.') }
    finally { setWorking(false) }
  }

  const copier = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setError('Copie impossible — sélectionnez le lien à la main.') }
  }

  const partager = async () => {
    try {
      await navigator.share({
        title: `Belote — ${game.team1Name} vs ${game.team2Name}`,
        text: 'Suis la partie :',
        url,
      })
    } catch { /* annulé */ }
  }

  // ── Envoi à une adresse email ──────────────────────────────────────────────
  const [email, setEmail] = useState('')
  const emails = useMemo(() => game.sharedEmails ?? [], [game.sharedEmails])

  const envoyerParEmail = async () => {
    const adresse = email.trim().toLowerCase()
    if (!emailValide(adresse)) { setError('Adresse email invalide.'); return }
    setError('')
    let lien = url
    try { lien = await activer() } catch { return }

    try { await noterEmailPartage(game.id, adresse) } catch { /* mémo seulement */ }
    setEmail('')

    // Comme partout dans l'app : le courrier part de la messagerie de l'utilisateur.
    const sujet = `Belote — ${game.team1Name} vs ${game.team2Name}`
    const corps = [
      'Bonjour,',
      '',
      'Je te partage notre partie de belote : tu peux suivre les scores et saisir les tours,',
      'sans avoir besoin de créer un compte.',
      '',
      lien,
      '',
      'À bientôt,',
    ].join('\n')
    window.location.href = `mailto:${encodeURIComponent(adresse)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`
  }

  // ── Rattachement direct d'un compte (ADMIN) ────────────────────────────────
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
    } catch { setError('Impossible de charger la liste des comptes.') }
    finally { setComptesLoading(false) }
  }

  const resultats = useMemo(() => {
    const deja = new Set(membres.map((m) => m.uid))
    const q = recherche.trim().toLowerCase()
    return comptes
      .filter((u) => { const uid = u.uid ?? u.id; return uid && !deja.has(uid) })
      .filter((u) => !q || `${u.prenom ?? ''} ${u.nom ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => `${a.prenom ?? ''}${a.nom ?? ''}`.localeCompare(`${b.prenom ?? ''}${b.nom ?? ''}`))
      .slice(0, 8)
  }, [comptes, recherche, membres])

  // Fermeture : on repart d'une modale propre à la réouverture.
  useEffect(() => {
    if (isOpen) return
    setError('')
    setPickerOuvert(false)
    setRecherche('')
    setEmail('')
  }, [isOpen])

  const rattacher = async (u: User) => {
    const targetUid = u.uid ?? u.id
    if (!targetUid) return
    setAjoutUid(targetUid); setError('')
    try {
      await appel('add-member', { gameId: game.id, uid: targetUid })
      setRecherche('')
      await chargerMembres()
    } catch (e) { setError(e instanceof Error ? e.message : 'Rattachement impossible.') }
    finally { setAjoutUid(null) }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Partager la partie">
      <div className="space-y-5">
        {game.serieId && (
          <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
            Cette partie fait partie d&apos;une série : le partage donne accès à toutes les parties liées,
            et donc à l&apos;écart de points.
          </p>
        )}

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">{error}</div>}

        {/* ── Lien public + QR ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Par lien ou QR — sans compte</h3>
          <p className="text-sm text-gray-500">
            N&apos;importe quel appareil peut ouvrir le lien (ou scanner le QR) pour voir et compléter la
            partie. Sans compte, on ne peut pas créer de nouvelles parties.
          </p>

          {!game.shareToken ? (
            <button onClick={() => { activer().catch(() => {}) }} disabled={working}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition">
              <QrCode size={16} />{working ? 'Activation…' : 'Activer le partage'}
            </button>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-2xl border border-gray-200">
                  <QRCodeSVG value={url} size={188} level="M" />
                </div>
              </div>

              <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                <Link2 size={15} className="text-blue-600 shrink-0" />
                <span className="text-xs text-blue-900 truncate flex-1">{url}</span>
              </div>

              <div className="flex gap-2">
                <button onClick={copier}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
                  {copied ? <><Check size={15} className="text-green-600" />Copié</> : <><Copy size={15} />Copier</>}
                </button>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <button onClick={partager}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-sm transition">
                    <Share2 size={15} />Partager
                  </button>
                )}
              </div>

              {estAuteur && (
                <button onClick={couper} disabled={working}
                  className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-red-500 py-1.5 transition">
                  <Power size={14} />Couper le partage
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Par email ────────────────────────────────────────────────────── */}
        <div className="border-t border-dashed border-gray-200 pt-4 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Par email</h3>
          <div className="flex gap-2">
            <input type="email" inputMode="email" autoComplete="email" placeholder="adresse@exemple.fr"
              value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') envoyerParEmail() }}
              className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
            <button onClick={envoyerParEmail} disabled={working || !emailValide(email)}
              className="shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-3 py-2 rounded-xl transition">
              <Mail size={15} />Envoyer
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Le message s&apos;ouvre dans votre messagerie, avec le lien déjà écrit — vous n&apos;avez qu&apos;à l&apos;envoyer.
          </p>

          {emails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {emails.map((e) => (
                <span key={e} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 rounded-full pl-2.5 pr-1 py-1">
                  {e}
                  <button onClick={() => retirerEmailPartage(game.id, e)} aria-label={`Retirer ${e}`}
                    className="p-0.5 text-gray-400 hover:text-red-500 transition">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Accès en cours ───────────────────────────────────────────────── */}
        <div className="border-t border-dashed border-gray-200 pt-4 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
            <Users size={13} />Comptes ayant accès
          </h3>
          {membresLoading ? (
            <p className="text-xs text-gray-400 py-1">Chargement…</p>
          ) : membres.length === 0 ? (
            <p className="text-xs text-gray-400 py-1 italic">Vous seul pour l&apos;instant.</p>
          ) : (
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 overflow-hidden">
              {membres.map((m) => (
                <div key={m.uid} className="flex items-center justify-between gap-3 px-3 py-2">
                  <p className="text-sm text-gray-800 truncate">
                    {m.name}
                    {m.isCreator && <span className="text-xs text-gray-400 ml-1.5">· auteur</span>}
                  </p>
                  {!m.isCreator && (estAuteur || isAdmin || m.uid === currentUser?.uid) && (
                    <button onClick={() => retirerMembre(m.uid)} disabled={working}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-500 transition">
                      Retirer
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Rattachement direct — ADMIN uniquement ───────────────────────── */}
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
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                          <button onClick={() => rattacher(u)} disabled={!!ajoutUid}
                            className="shrink-0 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition">
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
              Le compte rattaché retrouve la partie dans sa propre app « Belote », en accès gratuit.
              Ce bloc n&apos;apparaît que pour l&apos;administrateur.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
