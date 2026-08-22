'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import ClassementPartie from '@/components/duo/jeux/ClassementPartie'
import ClassementSoiree from '@/components/duo/jeux/ClassementSoiree'
import ToursPartie from '@/components/duo/jeux/ToursPartie'
import StatsPartie from '@/components/duo/jeux/StatsPartie'
import TourModal from '@/components/duo/jeux/TourModal'
import OrdreArrivee from '@/components/duo/jeux/OrdreArrivee'
import { baremeDeSoiree, vainqueurs } from '@/lib/duoJeux'
import type { PartiePublique } from '@/lib/jeuxShare'
import type { DuoPartie, DuoTour } from '@/types'
import { Copy, Check, QrCode, Share2, UserPlus, Plus, Dices, CheckCircle2, RotateCcw } from 'lucide-react'

/**
 * Les composants du module Jeux ne lisent que des champs présents dans la vue
 * publique — jamais un `Timestamp` Firestore, que cette page n'a pas. Le cast est
 * le même parti pris que la page publique de belote.
 */
const asPartie = (p: PartiePublique) => p as unknown as DuoPartie

/**
 * Page publique d'une partie, ouverte par lien ou QR — SANS COMPTE.
 *
 * Le porteur du lien voit et complète la partie (et toutes celles de la même
 * session), mais ne peut pas en créer de nouvelles : c'est la différence avec
 * l'app, réservée aux comptes.
 */
export default function PartieJeuPubliquePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const { currentUser } = useAuth()

  const [parties, setParties] = useState<PartiePublique[]>([])
  const [partieId, setPartieId] = useState('')
  const [status, setStatus] = useState<'loading' | 'ok' | 'invalid'>('loading')
  const [erreur, setErreur] = useState('')

  const [tourOuvert, setTourOuvert] = useState<{ index: number | null } | null>(null)
  const [partageOuvert, setPartageOuvert] = useState(false)
  const [copie, setCopie] = useState(false)
  const [rejoint, setRejoint] = useState(false)
  const [busy, setBusy] = useState(false)

  const partie = useMemo(
    () => parties.find((p) => p.id === partieId) ?? parties[0] ?? null,
    [parties, partieId],
  )

  const charger = useCallback(async () => {
    try {
      const res = await fetch(`/api/jeux-share/${token}`)
      const data = await res.json()
      if (!res.ok || data.status !== 'ok') { setStatus('invalid'); return }
      setParties(data.parties ?? [])
      setPartieId((id) => id || data.partieId)
      setStatus('ok')
    } catch {
      setStatus((s) => (s === 'loading' ? 'invalid' : s))
    }
  }, [token])

  useEffect(() => { charger() }, [charger])

  // Rafraîchissement doux : plusieurs appareils peuvent saisir la même partie.
  // Suspendu pendant une saisie, sinon le formulaire ouvert serait écrasé.
  useEffect(() => {
    if (status !== 'ok' || tourOuvert !== null) return
    const t = setInterval(() => charger(), 12000)
    return () => clearInterval(t)
  }, [status, charger, tourOuvert])

  const url = typeof window !== 'undefined' ? window.location.href : ''

  const appel = async (chemin: string, body: Record<string, unknown>) => {
    setBusy(true); setErreur('')
    try {
      const res = await fetch(`/api/jeux-share/${token}/${chemin}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partieId: partie?.id, ...body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Une erreur est survenue.')
      if (data.parties) setParties(data.parties)
      return data
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Une erreur est survenue.')
      throw e
    } finally { setBusy(false) }
  }

  const enregistrerTour = async (tour: DuoTour) => {
    await appel('tour', {
      action: tourOuvert?.index == null ? 'add' : 'update',
      index: tourOuvert?.index ?? undefined,
      scores: tour.scores,
      nom: tour.nom ?? '',
    })
    setTourOuvert(null)
  }

  const supprimerTour = async (index: number) => {
    // Pas de modale de confirmation ici : la page publique est déjà une modale
    // de fait sur téléphone, et deux se disputeraient le verrou de défilement.
    if (!window.confirm(`Supprimer le tour ${index + 1} ?`)) return
    try { await appel('tour', { action: 'delete', index }) } catch { /* message affiché */ }
  }

  const rejoindre = async () => {
    if (!currentUser) return
    setBusy(true); setErreur('')
    try {
      const idToken = await currentUser.getIdToken()
      const res = await fetch(`/api/jeux-share/${token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Rattachement impossible.')
      setRejoint(true)
      router.push(`/sarah-et-ted/jeux/${data.partieId}`)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Rattachement impossible.')
    } finally { setBusy(false) }
  }

  const copier = async () => {
    try { await navigator.clipboard.writeText(url); setCopie(true); setTimeout(() => setCopie(false), 2000) }
    catch { setErreur('Copie impossible — sélectionnez le lien à la main.') }
  }

  const partager = async () => {
    try { await navigator.share({ title: `Partie de ${partie?.jeu ?? 'jeu'}`, text: 'Suis les scores :', url }) }
    catch { /* annulé */ }
  }

  const bareme = useMemo(
    () => baremeDeSoiree(parties.map(asPartie)),
    [parties],
  )

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'invalid' || !partie) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <Dices size={40} className="text-gray-300 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Lien invalide</h1>
          <p className="text-sm text-gray-500">
            Ce lien de partage n&apos;existe plus. Demandez-en un nouveau à la personne qui vous l&apos;a envoyé.
          </p>
        </div>
      </div>
    )
  }

  const courante = asPartie(partie)
  const gagnants = vainqueurs(courante)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 py-6 space-y-5 max-w-5xl mx-auto">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-800 break-words">{partie.jeu}</h1>
            <p className="text-sm text-gray-500 mt-0.5 break-words">
              {partie.dateMs
                ? new Date(partie.dateMs).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
                : 'Partie partagée'}
              {' · '}{partie.joueurs.join(', ')}
            </p>
          </div>
          <button onClick={() => setPartageOuvert(true)}
            className="shrink-0 flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition">
            <QrCode size={15} />Partager
          </button>
        </div>

        {erreur && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600">{erreur}</div>
        )}

        {/* Rattachement à un compte */}
        {currentUser && !rejoint && (
          <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-rose-900 min-w-0">
              Vous êtes connecté : rattachez cette partie à votre compte pour la retrouver dans l&apos;app.
            </p>
            <button onClick={rejoindre} disabled={busy}
              className="shrink-0 flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-xl transition">
              <UserPlus size={15} />Rejoindre
            </button>
          </div>
        )}

        {/* Sélecteur de partie (session) */}
        {parties.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {parties.map((p, i) => (
              <button key={p.id} onClick={() => setPartieId(p.id)}
                className={`shrink-0 px-3 py-2 rounded-xl text-sm font-medium border transition ${
                  p.id === partie.id ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {p.jeu || `Partie ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <div className="space-y-4">
            <ClassementPartie partie={courante} />

            {partie.sansPoints ? (
              <OrdreArrivee partie={courante} lectureSeule={partie.termine}
                onChange={(ordre) => appel('tour', { action: 'ordre', ordre }).catch(() => {})} />
            ) : !partie.termine && (
              <button onClick={() => setTourOuvert({ index: null })}
                className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-medium py-3 rounded-xl transition">
                <Plus size={18} />Ajouter un tour
              </button>
            )}

            {partie.termine ? (
              <div className="space-y-2">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-center text-sm font-medium text-emerald-700">
                  {gagnants.length > 0
                    ? `Partie terminée — ${gagnants.join(', ')} l'emporte${gagnants.length > 1 ? 'nt' : ''}`
                    : 'Partie terminée'}
                </div>
                <button onClick={() => appel('etat', { termine: false }).catch(() => {})} disabled={busy}
                  className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 py-1.5 transition">
                  <RotateCcw size={14} />Rouvrir la partie
                </button>
              </div>
            ) : (
              <button onClick={() => appel('etat', { termine: true }).catch(() => {})} disabled={busy}
                className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl transition">
                <CheckCircle2 size={16} />Terminer la partie
              </button>
            )}

            <p className="text-xs text-gray-400 text-center">
              Vous pouvez voir et compléter {parties.length > 1 ? 'ces parties' : 'cette partie'}.
              Créer de nouvelles parties demande un compte.
            </p>
          </div>

          <div className="space-y-5">
            {!partie.sansPoints && (
              <ToursPartie partie={courante}
                onModifier={partie.termine ? undefined : (i) => setTourOuvert({ index: i })}
                onSupprimer={partie.termine ? undefined : supprimerTour} />
            )}

            <StatsPartie partie={courante} avecAide={false} />

            {parties.length > 1 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">
                  {partie.soireeName || 'Classement de la session'}
                </h2>
                <ClassementSoiree parties={parties.map(asPartie)} bareme={bareme} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Saisie d'un tour */}
      {tourOuvert && (
        <TourModal partie={courante} index={tourOuvert.index}
          onClose={() => setTourOuvert(null)} onEnregistrer={enregistrerTour} />
      )}

      {/* Repartager le lien depuis la page publique */}
      <Modal isOpen={partageOuvert} onClose={() => setPartageOuvert(false)} title="Partager la partie">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Faites scanner ce QR code, ou envoyez le lien : chacun peut suivre et compléter les scores,
            sans créer de compte.
          </p>
          <div className="flex justify-center">
            <div className="bg-white p-3 rounded-2xl border border-gray-200">
              <QRCodeSVG value={url} size={188} level="M" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={copier}
              className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm hover:bg-gray-50 transition">
              {copie ? <><Check size={15} className="text-green-600" />Copié</> : <><Copy size={15} />Copier</>}
            </button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button onClick={partager}
                className="flex-1 flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white py-2 rounded-xl text-sm transition">
                <Share2 size={15} />Partager
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
