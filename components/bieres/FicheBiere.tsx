'use client'

import { useState } from 'react'
import { Pencil, Trash2, Star, MapPin, Beer } from 'lucide-react'
import Lightbox from '@/components/bieres/Lightbox'
import { PastilleMeteo, PastilleRessenti } from '@/components/bieres/Icones'
import { formatNote, moyenneDegustation, moyennePersonne, type BiereCalculee } from '@/lib/biereModel'
import type { Degustation } from '@/types'

/**
 * Fiche détaillée d'une bière : l'identité en tête, la galerie, puis les
 * dégustations en journal chronologique.
 *
 * Remplace l'ancien dépliage dans la liste : une bière bue cinq fois, avec
 * photos et avis, ne tient pas dans une ligne qu'on déroule.
 */
export default function FicheBiere({
  b, prenom, onNouvelleDegustation, onModifierFiche, onEditerDegustation,
  onSupprimerDegustation, onSupprimerBiere,
}: {
  b: BiereCalculee
  prenom: (uid: string) => string
  onNouvelleDegustation: () => void
  onModifierFiche: () => void
  onEditerDegustation: (d: Degustation) => void
  onSupprimerDegustation: (d: Degustation) => void
  onSupprimerBiere: () => void
}) {
  const [zoom, setZoom] = useState<{ photos: string[]; index: number } | null>(null)

  const toutesPhotos = b.degustations.flatMap((d) => d.photos ?? [])
  const membres = [...new Set(b.degustations.flatMap((d) => Object.keys(d.notes ?? {})))]

  // Les plus récentes d'abord ; celles sans date ferment la marche
  const degustations = [...b.degustations].sort((x, y) => {
    if (!x.date && !y.date) return 0
    if (!x.date) return 1
    if (!y.date) return -1
    return y.date.seconds - x.date.seconds
  })

  const couleurNote = (n: number | null) =>
    n === null ? 'bg-gray-100 text-gray-400'
    : n >= 4 ? 'bg-emerald-100 text-emerald-700'
    : n >= 3 ? 'bg-lime-100 text-lime-700'
    : n >= 2 ? 'bg-amber-100 text-amber-700'
    : 'bg-rose-100 text-rose-700'

  return (
    <div className="space-y-5">
      {/* ── Identité ──────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${couleurNote(b.moyenne)}`}>
          {b.moyenne !== null ? (
            // Sur une seule ligne : « 4,5 » avec un « /5 » discret à la suite,
            // empilés ils se lisaient comme deux informations séparées.
            <span className="flex items-baseline gap-0.5">
              <span className="text-2xl font-bold leading-none">{formatNote(b.moyenne)}</span>
              <span className="text-xs font-medium opacity-50">/5</span>
            </span>
          ) : (
            <Beer size={22} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Chaque caractéristique porte son intitulé : « Rousse · Pression · 6° »
              empilé sans libellé se lisait comme une liste de mots sans lien. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {[
              { l: 'Type', v: b.biere.type },
              { l: 'Typologie', v: b.biere.typologie },
              { l: 'Service', v: b.biere.service },
              { l: 'Degré', v: b.biere.degres != null ? `${formatNote(b.biere.degres)}°` : null },
              { l: 'Amertume', v: b.biere.ibu != null && b.biere.ibu > 0 ? `IBU ${b.biere.ibu}` : null },
              { l: 'Origine', v: b.biere.origine },
            ].filter((c) => c.v).map((c) => (
              <div key={c.l} className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 leading-none">{c.l}</p>
                <p className="text-sm text-gray-800 truncate">{c.v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2.5 pt-2 border-t border-gray-100">
            {b.nbDegustations === 0
              ? 'Jamais dégustée'
              : `Bue ${b.nbDegustations} fois${b.lieux.length ? ` · ${b.lieux.length} lieu${b.lieux.length > 1 ? 'x' : ''}` : ''}`}
          </p>
        </div>
      </div>

      {/* Notes par personne : ce qu'on regarde en premier dans un catalogue à deux */}
      {membres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {membres.map((m) => {
            const n = moyennePersonne(b.degustations, m)
            return (
              <div key={m} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <span className="text-xs text-gray-500">{prenom(m)}</span>
                <span className={`text-sm font-semibold px-2 py-0.5 rounded-lg ${couleurNote(n)}`}>
                  {n !== null ? formatNote(n) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Galerie ───────────────────────────────────────────────────────── */}
      {toutesPhotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {toutesPhotos.map((p, i) => (
            <button key={p} onClick={() => setZoom({ photos: toutesPhotos, index: i })}
              className="shrink-0" title="Voir en grand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" className="w-24 h-24 rounded-xl object-cover hover:opacity-90 transition" />
            </button>
          ))}
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <button onClick={onNouvelleDegustation}
          className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition">
          <Star size={15} />Noter une dégustation
        </button>
        <button onClick={onModifierFiche}
          className="flex items-center gap-1.5 border border-gray-300 text-gray-700 text-sm px-3 py-2 rounded-xl hover:bg-gray-50 transition">
          <Pencil size={15} />Modifier la fiche
        </button>
        <button onClick={onSupprimerBiere}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-600 px-3 py-2 rounded-xl transition">
          <Trash2 size={15} />Supprimer
        </button>
      </div>

      {/* ── Journal des dégustations ──────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Dégustations · {degustations.length}
        </p>
        {degustations.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Aucune dégustation enregistrée.</p>
        ) : (
          <div className="space-y-3">
            {degustations.map((d) => {
              const note = moyenneDegustation(d)
              return (
                <div key={d.id} className="border border-gray-100 rounded-2xl overflow-hidden">
                  <div className="bg-gray-50/70 px-4 py-2.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      {d.date ? (
                        <p className="text-sm font-semibold text-gray-800">
                          {d.date.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                      ) : (
                        <p className="text-sm italic text-gray-400">Date inconnue</p>
                      )}
                      {(d.lieu || d.ville) && (
                        <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                          <MapPin size={11} className="shrink-0 text-gray-400" />
                          {d.lieu && <span className="font-medium text-gray-600">{d.lieu}</span>}
                          {d.lieu && d.ville && <span className="text-gray-300">·</span>}
                          {d.ville && <span>{d.ville}</span>}
                        </p>
                      )}
                    </div>
                    {note !== null && (
                      <span className={`flex items-baseline gap-0.5 px-2.5 py-1 rounded-lg shrink-0 ${couleurNote(note)}`}>
                        <span className="text-base font-bold leading-none">{formatNote(note)}</span>
                        <span className="text-[10px] font-medium opacity-50">/5</span>
                      </span>
                    )}
                  </div>

                  <div className="px-4 py-3 space-y-2.5">
                    {/* Une pastille par personne : « Sarah 4,5  Moi 4,5 » en texte
                        brut ne se distinguait pas du reste de la carte. */}
                    {d.notes && Object.keys(d.notes).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(d.notes).map(([u, n]) => (
                          <span key={u} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border border-gray-200 bg-white">
                            <span className="text-xs text-gray-500">{prenom(u)}</span>
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${couleurNote(n)}`}>
                              {formatNote(n)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* L'avis est une citation : c'est le texte qu'on relit */}
                    {d.analyse && (
                      <p className="text-sm text-gray-700 break-words border-l-2 border-amber-200 pl-3 italic">
                        {d.analyse}
                      </p>
                    )}

                    {/* Vrai bouton, pas un lien minuscule : sur mobile, une cible
                        de 11 px se rate une fois sur deux. */}
                    {d.gps && (
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(d.gps)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 transition">
                        <MapPin size={15} />
                        Voir sur la carte
                      </a>
                    )}

                    {(d.contexte || d.evenement || d.meteo || d.ressenti || d.temperature != null) && (
                      <div className="flex flex-wrap gap-1.5">
                        {[d.contexte, d.evenement].filter(Boolean).map((t, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">{t}</span>
                        ))}
                        {/* Météo et ressenti en icônes : les emoji restent la valeur
                            stockée, seul l'affichage change. La température suit la
                            météo — c'est celle du jour, pas celle de la bière. */}
                        <PastilleMeteo valeur={d.meteo} />
                        {d.temperature != null && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">
                            {d.temperature} °C dehors
                          </span>
                        )}
                        <PastilleRessenti valeur={d.ressenti} />
                      </div>
                    )}

                    {(d.photos?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {d.photos!.map((p, i) => (
                          <button key={p} onClick={() => setZoom({ photos: d.photos!, index: i })} title="Voir en grand">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p} alt="" className="w-20 h-20 rounded-xl object-cover hover:opacity-90 transition" />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Actions de la dégustation, en toutes lettres et à la bonne
                        taille : des icônes de 14 px sans libellé se ratent au doigt. */}
                    <div className="flex flex-wrap gap-2 pt-1.5 border-t border-dashed border-gray-100 mt-1">
                      <button onClick={() => onEditerDegustation(d)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition">
                        <Pencil size={15} />Modifier
                      </button>
                      <button onClick={() => onSupprimerDegustation(d)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-red-50 hover:border-red-300 hover:text-red-700 transition">
                        <Trash2 size={15} />Supprimer
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {zoom && (
        <Lightbox photos={zoom.photos} index={zoom.index}
          onClose={() => setZoom(null)}
          onIndex={(i) => setZoom((z) => (z ? { ...z, index: i } : z))} />
      )}
    </div>
  )
}
