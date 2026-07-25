'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Heart } from 'lucide-react'

interface Preview {
  status: 'ok' | 'used' | 'expired' | 'invalid'
  inviterName: string
}

/** Page publique d'acceptation d'une invitation « Sarah & Ted ». */
export default function DuoInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const { currentUser, loading: loadingAuth } = useAuth()

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/duo-invite/${token}`)
      .then(async (r) => r.json())
      .then((d) => setPreview(d))
      .catch(() => setPreview({ status: 'invalid', inviterName: '' }))
      .finally(() => setLoading(false))
  }, [token])

  const handleJoin = async () => {
    if (!currentUser) return
    setJoining(true); setError('')
    try {
      const idToken = await currentUser.getIdToken()
      const res = await fetch(`/api/duo-invite/${token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Impossible de rejoindre.')
      router.push('/sarah-et-ted')
    } catch (e: any) {
      setError(e?.message || 'Impossible de rejoindre.')
      setJoining(false)
    }
  }

  const loginUrl = (tab: 'creer' | 'connexion') =>
    `/login?redirect=${encodeURIComponent(`/duo-invitation/${token}`)}&tab=${tab}`

  if (loading || loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-rose-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const invalid = !preview || preview.status !== 'ok'
  const messages: Record<string, string> = {
    used: "Ce lien a déjà été utilisé. Demandez à la personne qui vous a invité d'en générer un nouveau.",
    expired: "Ce lien d'invitation a expiré. Demandez-en un nouveau.",
    invalid: "Ce lien d'invitation n'est pas valide.",
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">

          <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Heart size={32} className="text-rose-600" />
          </div>

          {invalid ? (
            <>
              <h1 className="text-lg font-bold text-gray-800 mb-2">Invitation indisponible</h1>
              <p className="text-sm text-gray-500">{messages[preview?.status ?? 'invalid']}</p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-gray-800">
                {preview!.inviterName} vous invite
              </h1>
              <p className="text-sm text-gray-500 mt-1.5">
                Partagez à deux vos films & séries, vos activités et les scores de vos parties,
                synchronisés en temps réel.
              </p>

              <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-4 mb-5">
                <Heart size={12} />
                <span>Accès partagé, gratuit pour le second compte</span>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 mb-4">{error}</div>
              )}

              {currentUser ? (
                <button onClick={handleJoin} disabled={joining}
                  className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition">
                  {joining ? 'Liaison en cours…' : 'Rejoindre'}
                </button>
              ) : (
                <div className="space-y-2">
                  <a href={loginUrl('creer')}
                    className="block w-full bg-rose-600 hover:bg-rose-700 text-white font-medium py-2.5 rounded-xl text-sm transition">
                    Créer mon compte
                  </a>
                  <a href={loginUrl('connexion')}
                    className="block w-full border border-gray-300 text-gray-700 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                    J'ai déjà un compte
                  </a>
                  <p className="text-xs text-gray-400 pt-1">
                    Revenez sur ce lien après connexion pour valider l'accès.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
