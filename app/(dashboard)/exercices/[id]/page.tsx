'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useExercices } from '@/hooks/useExercices'
import Modal from '@/components/ui/Modal'
import { ChipsPartieCorps, ChipsMulti } from '@/components/exercices/ChampsExercice'
import BlocMedia from '@/components/exercices/BlocMedia'
import BoutonTelechargerMedia from '@/components/exercices/BoutonTelechargerMedia'
import { MUSCLES, MATERIEL, normalizePartieCorps } from '@/lib/exerciceOptions'
import {
  type TypeMedia, TYPES_MEDIA, CHAMP_URL, CHAMP_SOURCE, urlMedia, sourceMedia, repreneurs,
  synchroniserMedias, supprimerMediaSiOrphelin, supprimerExerciceEtMedias,
} from '@/lib/exerciceMedia'
import type { Exercice } from '@/types'
import {
  ArrowLeftIcon, PencilIcon, TrashIcon,
  PhotoIcon, LinkIcon, PlayIcon,
} from '@heroicons/react/24/outline'

/**
 * Sous une photo ou une vidéo : d'où elle vient (exercice de référence), ou combien
 * d'autres exercices la reprennent — à savoir AVANT de la remplacer, puisque le
 * changement leur est répercuté.
 */
function NoteMedia({ type, exercice, exercices }: { type: TypeMedia; exercice: any; exercices: Exercice[] }) {
  const sourceId = sourceMedia(exercice, type)
  const source = sourceId ? exercices.find((e) => e.id === sourceId) : null
  const suiveurs = sourceId ? [] : repreneurs(exercice.id, type, exercices)
  if (!sourceId && suiveurs.length === 0) return null

  const libelle = type === 'image' ? 'Photo' : 'Vidéo'
  const texte = sourceId
    ? `${libelle} reprise de « ${source?.nom_exercice ?? 'un autre exercice'} »`
    : `${libelle} de référence, reprise par ${suiveurs.length} autre${suiveurs.length > 1 ? 's' : ''} exercice${suiveurs.length > 1 ? 's' : ''} : ${suiveurs.map((e) => e.nom_exercice).join(', ')}`

  return <p className="px-3 py-2 text-xs text-gray-500 break-words">{texte}</p>
}

function MissingBadge() {
  return (
    <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">
      ✗ Non rempli
    </span>
  )
}

export default function DetailExercicePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { exercices, updateExercice, deleteExercice } = useExercices()

  const [exercice, setExercice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [form, setForm] = useState({
    nom_exercice: '',
    partie_prioritaire: '',
    explications_commentees_exercice: '',
    lien_exercice: '',
    Materiel: [] as string[],
    Muscles: [] as string[],
    image_exercice: '',
    video_exercice: '',
    image_source_id: '',
    video_source_id: '',
  })

  // Fetch direct par ID — rapide, pas besoin de charger toute la collection
  useEffect(() => {
    if (!id) return
    getDoc(doc(db, 'exercices', id)).then((snap) => {
      if (snap.exists()) setExercice({ id: snap.id, ...snap.data() })
    }).catch(console.error).finally(() => setLoading(false))
  }, [id])

  const openEdit = () => {
    setForm({
      nom_exercice: exercice.nom_exercice || '',
      partie_prioritaire: normalizePartieCorps(exercice.partie_prioritaire),
      explications_commentees_exercice: exercice.explications_commentees_exercice || '',
      lien_exercice: exercice.lien_exercice || '',
      Materiel: exercice.Materiel || [],
      Muscles: exercice.Muscles || [],
      image_exercice: exercice.image_exercice || '',
      video_exercice: exercice.video_exercice || '',
      image_source_id: exercice.image_source_id || '',
      video_source_id: exercice.video_source_id || '',
    })
    setShowEditModal(true)
  }

  /** Fichier envoyé puis remplacé AVANT d'enregistrer : il n'appartient encore à personne → nettoyage.
   *  (Le média déjà enregistré, lui, n'est touché qu'à l'enregistrement — rien de perdu si on annule.) */
  const majMedia = (type: TypeMedia, url: string, sourceId: string) => {
    const precedente = form[CHAMP_URL[type]]
    const precedentEtaitRepris = !!form[CHAMP_SOURCE[type]]
    setForm((f) => ({ ...f, [CHAMP_URL[type]]: url, [CHAMP_SOURCE[type]]: sourceId }))
    const dejaEnregistree = urlMedia(exercice, type) === precedente
    if (precedente && precedente !== url && !dejaEnregistree && !precedentEtaitRepris) {
      supprimerMediaSiOrphelin(precedente, exercices, [id])
    }
  }

  /** Fermeture sans enregistrer : les fichiers envoyés pendant la saisie n'ont jamais servi → on les efface. */
  const fermerSansEnregistrer = () => {
    for (const type of TYPES_MEDIA) {
      const url = form[CHAMP_URL[type]]
      if (url && url !== urlMedia(exercice, type) && !form[CHAMP_SOURCE[type]]) {
        supprimerMediaSiOrphelin(url, exercices, [id])
      }
    }
    setShowEditModal(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateExercice(id, form)
    // Répercute sur les exercices qui reprennent ces médias, puis efface l'ancien fichier
    // s'il n'est plus affiché nulle part.
    await synchroniserMedias(id, exercice, form, exercices, updateExercice)
    setExercice({ ...exercice, ...form })
    setShowEditModal(false)
  }

  const handleDelete = async () => {
    await supprimerExerciceEtMedias(exercice, exercices, deleteExercice, updateExercice)
    router.push('/exercices')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!exercice) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400">Exercice introuvable.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/exercices')} className="p-2 rounded-lg hover:bg-gray-100 transition">
            <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">{exercice.nom_exercice}</h1>
          <span className="hidden sm:inline-block text-xs bg-blue-100 text-blue-700 font-medium px-2.5 py-1 rounded-full">
            {normalizePartieCorps(exercice.partie_prioritaire)}
          </span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={openEdit}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition">
            <PencilIcon className="w-4 h-4" />
            Modifier
          </button>
          <button onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition">
            <TrashIcon className="w-4 h-4" />
            Supprimer
          </button>
        </div>
      </div>

      {/* Contenu en 2 colonnes sur PC */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Colonne gauche : image + liens */}
        <div className="space-y-4">
          {/* Image */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {exercice.image_exercice ? (
              <img src={exercice.image_exercice} alt={exercice.nom_exercice}
                className="w-full h-56 object-contain bg-gray-50" />
            ) : (
              <div className="h-40 flex flex-col items-center justify-center gap-2 bg-gray-50">
                <PhotoIcon className="w-8 h-8 text-gray-300" />
                <MissingBadge />
              </div>
            )}
            <NoteMedia type="image" exercice={exercice} exercices={exercices} />
            {exercice.image_exercice && (
              <div className="px-3 pb-3">
                <BoutonTelechargerMedia url={exercice.image_exercice} type="image" nomExercice={exercice.nom_exercice} />
              </div>
            )}
          </div>

          {/* Vidéo de démonstration */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {exercice.video_exercice ? (
              <video src={exercice.video_exercice} controls playsInline className="w-full max-h-56 bg-black" />
            ) : (
              <div className="h-28 flex flex-col items-center justify-center gap-2 bg-gray-50">
                <PlayIcon className="w-7 h-7 text-gray-300" />
                <MissingBadge />
              </div>
            )}
            <NoteMedia type="video" exercice={exercice} exercices={exercices} />
            {exercice.video_exercice && (
              <div className="px-3 pb-3">
                <BoutonTelechargerMedia url={exercice.video_exercice} type="video" nomExercice={exercice.nom_exercice} />
              </div>
            )}
          </div>

          {/* Liens */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Lien externe</p>
            {exercice.lien_exercice ? (
              <a href={exercice.lien_exercice} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-600 hover:underline break-all">
                <LinkIcon className="w-4 h-4 shrink-0" />
                {exercice.lien_exercice}
              </a>
            ) : <MissingBadge />}
          </div>
        </div>

        {/* Colonne droite : infos */}
        <div className="lg:col-span-2 space-y-4">

          {/* Muscles + Matériel */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-500 mb-2">Muscles ciblés</p>
              {exercice.Muscles && exercice.Muscles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {exercice.Muscles.map((m: string) => (
                    <span key={m} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">{m}</span>
                  ))}
                </div>
              ) : <MissingBadge />}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500 mb-2">Matériel</p>
              {exercice.Materiel && exercice.Materiel.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {exercice.Materiel.map((m: string) => (
                    <span key={m} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium">{m}</span>
                  ))}
                </div>
              ) : <MissingBadge />}
            </div>
          </div>

          {/* Explications */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-500 mb-2">Explications</p>
            {exercice.explications_commentees_exercice ? (
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {exercice.explications_commentees_exercice}
              </p>
            ) : <MissingBadge />}
          </div>
        </div>
      </div>

      {/* Modal modification */}
      <Modal isOpen={showEditModal} onClose={fermerSansEnregistrer} title="Modifier l'exercice" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
            <input type="text" value={form.nom_exercice} onChange={(e) => setForm({ ...form, nom_exercice: e.target.value })} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Partie prioritaire</label>
            <ChipsPartieCorps valeur={form.partie_prioritaire} onChange={(p) => setForm({ ...form, partie_prioritaire: p })} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Muscles ciblés</label>
            <ChipsMulti options={MUSCLES} valeurs={form.Muscles} onChange={(v) => setForm((f) => ({ ...f, Muscles: v }))} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Matériel</label>
            <ChipsMulti options={MATERIEL} valeurs={form.Materiel} onChange={(v) => setForm((f) => ({ ...f, Materiel: v }))} couleur="gray" avecAutre placeholderAutre="Élastique rouge, charge…" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Explications</label>
            <textarea value={form.explications_commentees_exercice}
              onChange={(e) => setForm({ ...form, explications_commentees_exercice: e.target.value })}
              rows={4} placeholder="Description technique, consignes..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <BlocMedia
            type="image"
            label="Photo"
            url={form.image_exercice}
            sourceId={form.image_source_id}
            exercices={exercices}
            exerciceId={id}
            onChange={(url, sourceId) => majMedia('image', url, sourceId)}
          />

          <BlocMedia
            type="video"
            label="Vidéo de démonstration"
            url={form.video_exercice}
            sourceId={form.video_source_id}
            exercices={exercices}
            exerciceId={id}
            onChange={(url, sourceId) => majMedia('video', url, sourceId)}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lien vidéo / externe</label>
            <input type="url" value={form.lien_exercice} onChange={(e) => setForm({ ...form, lien_exercice: e.target.value })}
              placeholder="https://..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={fermerSansEnregistrer}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition">Annuler</button>
            <button type="submit"
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition">Enregistrer</button>
          </div>
        </form>
      </Modal>

      {/* Confirmation suppression */}
      <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Supprimer cet exercice ?" size="sm">
        <p className="text-sm text-gray-600 mb-5">Cette action est irréversible.</p>
        <div className="flex gap-3">
          <button onClick={() => setShowDeleteConfirm(false)}
            className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition">Annuler</button>
          <button onClick={handleDelete}
            className="flex-1 bg-red-500 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-red-600 transition">Supprimer</button>
        </div>
      </Modal>
    </div>
  )
}
