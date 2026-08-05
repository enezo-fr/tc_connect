'use client'

import { useMemo, useRef, useState } from 'react'
import { PhotoIcon, VideoCameraIcon, MagnifyingGlassIcon, ArrowPathIcon, LinkIcon } from '@heroicons/react/24/outline'
import { uploadImage, uploadVideo } from '@/lib/uploadImage'
import {
  type TypeMedia, LIBELLE_MEDIA, exercicesAvecMedia, racineMedia, urlMedia,
} from '@/lib/exerciceMedia'
import type { Exercice } from '@/types'

const TAILLE_MAX = { image: 10, video: 50 } // Mo — doit rester aligné sur storage.rules

/**
 * Photo ou vidéo d'un exercice : envoi depuis l'appareil, OU reprise du média d'un
 * autre exercice. Reprendre ne recopie aucun fichier — on réutilise celui qui est déjà
 * stocké, ce qui évite de doubler la place occupée pour deux variantes du même mouvement.
 */
export default function BlocMedia({
  type,
  label,
  url,
  sourceId,
  exercices,
  exerciceId,
  onChange,
}: {
  type: TypeMedia
  label: string
  url: string
  sourceId: string
  exercices: Exercice[]
  exerciceId?: string
  onChange: (url: string, sourceId: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [envoi, setEnvoi] = useState(false)
  const [choix, setChoix] = useState(false)
  const [recherche, setRecherche] = useState('')

  const source = sourceId ? exercices.find((e) => e.id === sourceId) : null

  const candidats = useMemo(() => {
    const base = exercicesAvecMedia(exercices, type, exerciceId)
    const q = recherche.trim().toLowerCase()
    return (q ? base.filter((e) => e.nom_exercice?.toLowerCase().includes(q)) : base).slice(0, 40)
  }, [exercices, type, exerciceId, recherche])

  const envoyer = async (file: File) => {
    const mo = file.size / (1024 * 1024)
    if (mo > TAILLE_MAX[type]) {
      alert(`Ce fichier pèse ${mo.toFixed(1)} Mo — la limite est de ${TAILLE_MAX[type]} Mo pour une ${LIBELLE_MEDIA[type]}.`)
      return
    }
    setEnvoi(true)
    try {
      const chemin = type === 'image'
        ? `exercices/${Date.now()}_${file.name}`
        : `exercices_videos/${Date.now()}_${file.name}`
      const nouvelle = type === 'image' ? await uploadImage(file, chemin) : await uploadVideo(file, chemin)
      // Le fichier remplacé n'est effacé qu'à l'enregistrement (et seulement s'il n'est
      // plus utilisé ailleurs) : rien n'est perdu si on annule la modification.
      onChange(nouvelle, '')
    } catch {
      alert(`Erreur lors de l'envoi de la ${LIBELLE_MEDIA[type]}`)
    } finally {
      setEnvoi(false)
    }
  }

  const reprendre = (ex: Exercice) => {
    // On pointe sur l'exercice qui possède vraiment le fichier, pas sur un intermédiaire
    // qui le reprend lui aussi — sinon la chaîne casse dès qu'on modifie le maillon du milieu.
    const racineId = racineMedia(ex.id, type, exercices)
    const racine = exercices.find((e) => e.id === racineId) ?? ex
    onChange(urlMedia(racine, type), racine.id)
    setChoix(false)
    setRecherche('')
  }

  const Icone = type === 'image' ? PhotoIcon : VideoCameraIcon

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>

      <input
        ref={inputRef}
        type="file"
        accept={type === 'image' ? 'image/*' : 'video/*'}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) envoyer(f); e.target.value = '' }}
      />

      {url ? (
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden bg-gray-100">
            {type === 'image' ? (
              <img src={url} alt="Aperçu" className="w-full h-40 object-contain" />
            ) : (
              <video src={url} controls playsInline className="w-full max-h-48 bg-black" />
            )}
            <button
              type="button"
              onClick={() => onChange('', '')}
              title={`Retirer la ${LIBELLE_MEDIA[type]}`}
              className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
            >✕</button>
          </div>

          {source && (
            <p className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5">
              <LinkIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="break-words">
                {`${type === 'image' ? 'Photo reprise' : 'Vidéo reprise'} de « ${source.nom_exercice} » — aucun fichier en double`}
              </span>
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={envoi}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
              <ArrowPathIcon className="w-3.5 h-3.5" />
              {envoi ? 'Envoi…' : 'Remplacer'}
            </button>
            <button type="button" onClick={() => setChoix((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition">
              <LinkIcon className="w-3.5 h-3.5" />
              Reprendre celle d&apos;un autre exercice
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={envoi}
            className="w-full h-24 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition disabled:opacity-50"
          >
            <Icone className="w-7 h-7" />
            <span className="text-sm">
              {envoi ? 'Envoi en cours…' : `Cliquer pour ajouter une ${LIBELLE_MEDIA[type]}`}
            </span>
          </button>
          <button type="button" onClick={() => setChoix((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition">
            <LinkIcon className="w-3.5 h-3.5" />
            Reprendre celle d&apos;un autre exercice
          </button>
        </div>
      )}

      {/* Sélecteur de l'exercice à qui emprunter le média — panneau replié dans le formulaire */}
      {choix && (
        <div className="mt-2 border border-blue-100 bg-blue-50/40 rounded-xl p-3 space-y-2">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              autoFocus
              placeholder="Rechercher un exercice…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {candidats.length === 0 ? (
            <p className="text-xs text-gray-500 py-2">
              {`Aucun autre exercice n'a de ${LIBELLE_MEDIA[type]} à reprendre.`}
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100 bg-white rounded-lg border border-gray-100">
              {candidats.map((ex) => (
                <li key={ex.id}>
                  <button type="button" onClick={() => reprendre(ex)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left hover:bg-blue-50 transition">
                    {type === 'image' ? (
                      <img src={urlMedia(ex, 'image')} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100 shrink-0" />
                    ) : (
                      <span className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <VideoCameraIcon className="w-4 h-4 text-gray-400" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-gray-800 break-words">{ex.nom_exercice}</span>
                      <span className="block text-[11px] text-gray-400">{ex.partie_prioritaire}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { setChoix(false); setRecherche('') }}
            className="text-xs text-gray-500 hover:text-gray-700">Fermer</button>
        </div>
      )}
    </div>
  )
}
