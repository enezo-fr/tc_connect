'use client'

import { useEffect, useState } from 'react'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { fichierDepuisUrl, enregistrerFichier } from '@/lib/telechargerMedia'
import { LIBELLE_MEDIA, type TypeMedia } from '@/lib/exerciceMedia'

/**
 * Enregistrer la photo ou la vidéo d'un exercice sur son appareil.
 *
 * Deux chemins :
 *  - **iPhone** : la feuille de partage native (« Enregistrer dans Fichiers » /
 *    « Enregistrer l'image ») est le canal fiable. ⚠️ `navigator.share` exige d'être
 *    appelé dans la foulée du clic : un `await` avant l'appel fait perdre le geste et
 *    iOS refuse. D'où le pré-chargement du fichier — mais UNIQUEMENT pour les photos,
 *    une vidéo pouvant peser jusqu'à 50 Mo qu'on ne va pas rapatrier « au cas où ».
 *  - **partout ailleurs** (et pour les vidéos) : téléchargement classique au clic.
 */
export default function BoutonTelechargerMedia({
  url,
  type,
  nomExercice,
}: {
  url: string
  type: TypeMedia
  nomExercice: string
}) {
  const [prepare, setPrepare] = useState<File | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [echec, setEchec] = useState(false)

  // Pré-chargement des photos seulement (léger), pour que le partage iOS reste possible.
  useEffect(() => {
    if (!url || type !== 'image') { setPrepare(null); return }
    let annule = false
    fichierDepuisUrl(url, nomExercice).then((f) => { if (!annule) setPrepare(f) })
    return () => { annule = true }
  }, [url, type, nomExercice])

  if (!url) return null

  const partageable = !!prepare
    && typeof navigator !== 'undefined'
    && !!navigator.canShare?.({ files: [prepare] })

  const cliquer = () => {
    setEchec(false)

    // Chemin iOS : appel synchrone, sans await avant, sinon le geste est perdu.
    if (partageable && prepare) {
      navigator.share({ files: [prepare] }).catch(() => {
        // Partage annulé ou refusé → on retombe sur le téléchargement classique.
        enregistrerFichier(prepare)
      })
      return
    }

    if (prepare) { enregistrerFichier(prepare); return }

    setEnCours(true)
    fichierDepuisUrl(url, nomExercice)
      .then((f) => {
        if (f) enregistrerFichier(f)
        else setEchec(true)
      })
      .finally(() => setEnCours(false))
  }

  return (
    <div>
      <button
        type="button"
        onClick={cliquer}
        disabled={enCours}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
      >
        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
        {enCours ? 'Préparation…' : 'Enregistrer sur mon appareil'}
      </button>
      {echec && (
        <p className="mt-1 text-xs text-red-500">
          {`Impossible de récupérer la ${LIBELLE_MEDIA[type]}. Réessaie, ou ouvre-la puis enregistre-la depuis le navigateur.`}
        </p>
      )}
    </div>
  )
}
