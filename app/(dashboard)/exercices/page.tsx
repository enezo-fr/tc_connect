'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useExercices } from '@/hooks/useExercices'
import Modal from '@/components/ui/Modal'
import { ChipsPartieCorps, ChipsMulti } from '@/components/exercices/ChampsExercice'
import BlocMedia from '@/components/exercices/BlocMedia'
import { MUSCLES, MATERIEL, PARTIES_CORPS, PARTIE_CORPS_DEFAUT, normalizePartieCorps } from '@/lib/exerciceOptions'
import {
  type TypeMedia, TYPES_MEDIA, CHAMP_URL, CHAMP_SOURCE, urlMedia,
  synchroniserMedias, supprimerMediaSiOrphelin, supprimerExerciceEtMedias,
} from '@/lib/exerciceMedia'
import { PlusIcon, MagnifyingGlassIcon, PhotoIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

function isIncomplete(ex: any) {
  return !ex.image_exercice
    || !ex.explications_commentees_exercice
    || !ex.Muscles || ex.Muscles.length === 0
    || !ex.Materiel || ex.Materiel.length === 0
    || !ex.lien_exercice
}

export default function ExercicesPage() {
  const { exercices, loading, addExercice, updateExercice, deleteExercice } = useExercices()
  const router = useRouter()
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
  const droits = userProfile?.droits

  useEffect(() => {
    if (userProfile && !isAdmin && droits?.exercices !== true) {
      router.replace('/accueil')
    }
  }, [userProfile, isAdmin, droits, router])

  const [search, setSearch] = useState('')
  const [filterPartie, setFilterPartie] = useState('')
  const [filterIncomplet, setFilterIncomplet] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  const FORM_VIDE = {
    nom_exercice: '',
    partie_prioritaire: PARTIE_CORPS_DEFAUT as string,
    explications_commentees_exercice: '',
    lien_exercice: '',
    Materiel: [] as string[],
    Muscles: [] as string[],
    image_exercice: '',
    video_exercice: '',
    image_source_id: '',
    video_source_id: '',
  }

  const [form, setForm] = useState(FORM_VIDE)

  const openAdd = () => {
    setEditItem(null)
    setForm(FORM_VIDE)
    setShowModal(true)
  }

  const openEdit = (ex: any) => {
    setEditItem(ex)
    setForm({
      nom_exercice: ex.nom_exercice || '',
      partie_prioritaire: normalizePartieCorps(ex.partie_prioritaire),
      explications_commentees_exercice: ex.explications_commentees_exercice || '',
      lien_exercice: ex.lien_exercice || '',
      Materiel: ex.Materiel || [],
      Muscles: ex.Muscles || [],
      image_exercice: ex.image_exercice || '',
      video_exercice: ex.video_exercice || '',
      image_source_id: ex.image_source_id || '',
      video_source_id: ex.video_source_id || '',
    })
    setShowModal(true)
  }

  /** Le fichier envoyé puis remplacé AVANT d'enregistrer n'appartient encore à personne → on le nettoie. */
  const majMedia = (type: TypeMedia, url: string, sourceId: string) => {
    const precedente = form[CHAMP_URL[type]]
    const precedentEtaitRepris = !!form[CHAMP_SOURCE[type]]
    setForm((f) => ({ ...f, [CHAMP_URL[type]]: url, [CHAMP_SOURCE[type]]: sourceId }))
    const dejaEnregistree = urlMedia(editItem, type) === precedente
    if (precedente && precedente !== url && !dejaEnregistree && !precedentEtaitRepris) {
      supprimerMediaSiOrphelin(precedente, exercices, [editItem?.id ?? ''])
    }
  }

  /** Fermeture sans enregistrer : les fichiers envoyés pendant la saisie n'ont jamais servi → on les efface. */
  const fermerSansEnregistrer = () => {
    for (const type of TYPES_MEDIA) {
      const url = form[CHAMP_URL[type]]
      if (url && url !== urlMedia(editItem, type) && !form[CHAMP_SOURCE[type]]) {
        supprimerMediaSiOrphelin(url, exercices, [editItem?.id ?? ''])
      }
    }
    setShowModal(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editItem) {
      await updateExercice(editItem.id, form)
      // Répercute sur les exercices qui reprennent ces médias, puis efface l'ancien
      // fichier s'il n'est plus affiché nulle part.
      await synchroniserMedias(editItem.id, editItem, form, exercices, updateExercice)
    } else {
      await addExercice(form as any)
    }
    setShowModal(false)
  }

  const incompletCount = exercices.filter(isIncomplete).length

  const filtered = exercices.filter((ex) => {
    const matchSearch = ex.nom_exercice?.toLowerCase().includes(search.toLowerCase())
    // Comparaison sur la zone normalisée : un exercice encore rangé sous un ancien
    // libellé (« Quadriceps »…) reste trouvable par sa zone.
    const matchPartie = filterPartie ? normalizePartieCorps(ex.partie_prioritaire) === filterPartie : true
    const matchIncomplet = filterIncomplet ? isIncomplete(ex) : true
    return matchSearch && matchPartie && matchIncomplet
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Exercices</h1>
        {isAdmin && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <PlusIcon className="w-4 h-4" />
            Nouvel exercice
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[180px]">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {['', ...PARTIES_CORPS].map((p) => (
            <button
              key={p || 'toutes'}
              onClick={() => setFilterPartie(p)}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition ${
                filterPartie === p
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p || 'Toutes'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setFilterIncomplet((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition ${
            filterIncomplet
              ? 'bg-orange-500 text-white border-orange-500'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <ExclamationTriangleIcon className="w-4 h-4" />
          Incomplets {incompletCount > 0 && <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${filterIncomplet ? 'bg-white text-orange-600' : 'bg-orange-100 text-orange-600'}`}>{incompletCount}</span>}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">Aucun exercice trouvé</p>
          {isAdmin && (
            <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">
              + Créer un exercice
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((ex) => {
            const incomplete = isIncomplete(ex)
            return (
              <div
                key={ex.id}
                className={`bg-white rounded-2xl border shadow-sm cursor-pointer hover:shadow-md transition ${incomplete ? 'border-orange-200' : 'border-gray-100'}`}
                onClick={() => router.push(`/exercices/${ex.id}`)}
              >
                {/* Image compacte ou placeholder */}
                <div className="relative rounded-t-2xl overflow-hidden h-28 bg-gray-50 flex items-center justify-center">
                  {ex.image_exercice ? (
                    <img src={ex.image_exercice} alt={ex.nom_exercice} className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <PhotoIcon className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                  {incomplete && (
                    <div className="absolute top-1.5 right-1.5">
                      <span className="flex items-center gap-1 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        <ExclamationTriangleIcon className="w-3 h-3" />
                        Incomplet
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-800 text-sm truncate">{ex.nom_exercice}</h3>
                      <p className="text-xs text-gray-500">{normalizePartieCorps(ex.partie_prioritaire)}</p>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1.5 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEdit(ex)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition" title="Modifier">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => setShowDeleteConfirm(ex.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition" title="Supprimer">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    )}
                  </div>
                  {ex.Muscles && ex.Muscles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {ex.Muscles.slice(0, 3).map((m: string) => (
                        <span key={m} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{m}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={fermerSansEnregistrer}
        title={editItem ? "Modifier l'exercice" : 'Nouvel exercice'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
            <input type="text" value={form.nom_exercice} onChange={(e) => setForm({ ...form, nom_exercice: e.target.value })} required placeholder="Ex: Squat"
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
            <textarea value={form.explications_commentees_exercice} onChange={(e) => setForm({ ...form, explications_commentees_exercice: e.target.value })}
              rows={3} placeholder="Description technique, consignes..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <BlocMedia
            type="image"
            label="Photo de l'exercice"
            url={form.image_exercice}
            sourceId={form.image_source_id}
            exercices={exercices}
            exerciceId={editItem?.id}
            onChange={(url, sourceId) => majMedia('image', url, sourceId)}
          />

          <BlocMedia
            type="video"
            label="Vidéo de démonstration"
            url={form.video_exercice}
            sourceId={form.video_source_id}
            exercices={exercices}
            exerciceId={editItem?.id}
            onChange={(url, sourceId) => majMedia('video', url, sourceId)}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lien vidéo / externe</label>
            <input
              type="url"
              value={form.lien_exercice}
              onChange={(e) => setForm({ ...form, lien_exercice: e.target.value })}
              placeholder="https://..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={fermerSansEnregistrer}
              className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              {editItem ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirmation suppression */}
      <Modal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title="Supprimer cet exercice ?"
        size="sm"
      >
        <p className="text-sm text-gray-600 mb-4">Cette action est irréversible.</p>
        <div className="flex gap-3">
          <button
            onClick={() => setShowDeleteConfirm(null)}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
          >
            Annuler
          </button>
          <button
            onClick={() => {
              if (!showDeleteConfirm) return
              const ex = exercices.find((e) => e.id === showDeleteConfirm)
              if (!ex) return
              // Nettoyage Storage, sauf si la photo ou la vidéo sert encore à un autre exercice.
              supprimerExerciceEtMedias(ex, exercices, deleteExercice, updateExercice)
                .then(() => setShowDeleteConfirm(null))
            }}
            className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition"
          >
            Supprimer
          </button>
        </div>
      </Modal>
    </div>
  )
}