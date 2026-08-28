'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Timestamp } from 'firebase/firestore'
import { useAuth } from '@/context/AuthContext'
import { useInvoices } from '@/hooks/useInvoices'
import { usePilotageContrats } from '@/hooks/usePilotageContrats'
import { usePilotageCatalogue } from '@/hooks/usePilotageCatalogue'
import { usePilotageSettings } from '@/hooks/usePilotageSettings'
import { useClients } from '@/hooks/useClients'
import { defaultProjetContent, LIVRABLES_DEFAUT } from '@/lib/pilotageProjetTemplates'
import Modal from '@/components/ui/Modal'
import InfraCostEstimator from '@/components/pilotage/InfraCostEstimator'
import EstimateurTarif from '@/components/pilotage/EstimateurTarif'
import { ContratEditModal, emptyContratForm, type ContratForm } from '@/components/pilotage/ContratEditModal'
import { featuresToFonctions, type TarifResult } from '@/lib/pilotageEstimateur'
import { buildSuiviItems } from '@/lib/pilotageSuivi'
import { randomUUID } from '@/lib/uuid'
import type { PilotageContrat, PilotageContratStatut, PilotageEstimation } from '@/types'
import {
  PlusIcon, PencilIcon, TrashIcon, DocumentTextIcon,
  ExclamationTriangleIcon, PresentationChartLineIcon, CalculatorIcon,
  ArrowDownTrayIcon, CheckIcon, EyeIcon, ComputerDesktopIcon, BellAlertIcon,
} from '@heroicons/react/24/outline'

// Plafond micro-entreprise (prestations de services / BNC) — à ajuster si le barème change
const PLAFOND = 77700

// L'estimateur (constantes, calcul, état) vit dans lib/pilotageEstimateur.ts
// et le composant components/pilotage/EstimateurTarif.tsx (partagé avec la fiche contrat).

const STATUT_LABELS: Record<PilotageContratStatut, string> = {
  prospect: 'Prospect', actif: 'Actif', pause: 'En pause', termine: 'Terminé',
}
const STATUT_COLORS: Record<PilotageContratStatut, string> = {
  prospect: 'bg-amber-100 text-amber-700',
  actif: 'bg-green-100 text-green-700',
  pause: 'bg-orange-100 text-orange-700',
  termine: 'bg-gray-100 text-gray-500',
}

const fmtEur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`
// Montants NETS réellement facturés = tarif catalogue − remise du contrat (ce que paie le client).
const netAbo = (c: PilotageContrat) => (c.abonnementMensuel ?? 0) * (1 - (c.remiseAbonnementPct ?? 0) / 100)
const netSetup = (c: PilotageContrat) => (c.fraisMiseEnPlace ?? 0) * (1 - (c.remiseMiseEnPlacePct ?? 0) / 100)
const monthsSince = (ts: Timestamp) => {
  const d = ts.toDate(); const n = new Date()
  return (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth())
}

export default function PilotagePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { currentUser, userProfile } = useAuth()
  const isAdmin = userProfile?.role_app === 'Admin'
  const { invoices } = useInvoices(currentUser?.uid ?? '')
  const { contrats, loading, addContrat, updateContrat, deleteContrat } = usePilotageContrats()
  const { clients } = useClients()

  // Modal d'ajout/édition de contrat (extrait dans <ContratEditModal>, partagé avec la page détail).
  const [showModal, setShowModal] = useState(false)
  const [modalContrat, setModalContrat] = useState<PilotageContrat | null>(null)
  const [modalInitialForm, setModalInitialForm] = useState<ContratForm | undefined>(undefined)
  const [modalCreateExtra, setModalCreateExtra] = useState<Partial<PilotageContrat> | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Amorce le contenu projet depuis l'estimateur (fonctionnalités) + valeurs par défaut.
  // La catégorie est reprise du catalogue (groupe de la brique) quand la fonctionnalité y figure.
  const seedProjet = (est: PilotageEstimation) =>
    defaultProjetContent({
      fonctionnalites: featuresToFonctions(est.features, catalogueItems),
      livrables: [...LIVRABLES_DEFAUT],
    })

  // Contrat dont on rejoue/ajuste l'estimation dans le calculateur
  const [linkedContrat, setLinkedContrat] = useState<PilotageContrat | null>(null)
  const estimateurRef = useRef<HTMLDetailsElement>(null)
  const loadEstimation = (c: PilotageContrat) => {
    if (!c.estimation) return
    setSeedEst(c.estimation)
    setSeedNonce((n) => n + 1)   // déclenche la ré-hydratation du composant
    setLinkedContrat(c)
    setTimeout(() => {
      if (estimateurRef.current) estimateurRef.current.open = true   // ouvre le calculateur (réduit par défaut)
      estimateurRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }
  const updateLinkedContrat = async () => {
    if (!linkedContrat || !live) return
    await updateContrat(linkedContrat.id, {
      estimation: live.est,
      fraisMiseEnPlace: live.tarif.setup,
      abonnementMensuel: live.tarif.abo,
      coutFirebaseMensuel: live.est.infra,
    } as Partial<PilotageContrat>)
    setLinkedContrat(null)
  }

  // Estimateur : état « live » remonté par le composant <EstimateurTarif> + graine de ré-hydratation
  const [live, setLive] = useState<{ est: PilotageEstimation; tarif: TarifResult } | null>(null)
  const [seedEst, setSeedEst] = useState<PilotageEstimation | null>(null)
  const [seedNonce, setSeedNonce] = useState(0)

  // Analyse inversée : à partir de ce qui a été facturé, déduire le taux réalisé
  const [revCreation, setRevCreation] = useState(0)   // montant création facturé (€)
  const [revAbo, setRevAbo] = useState(0)             // abonnement mensuel facturé (€)
  const [revJours, setRevJours] = useState(0)         // jours réellement passés sur la création
  const [revSupportH, setRevSupportH] = useState(0)   // heures de support réelles /mois
  const [revMoisAbo1, setRevMoisAbo1] = useState(12)  // nb de mensualités facturées la 1ère année (souvent 11 si l'abo démarre le mois après la création)
  const analyse = useMemo(() => {
    const tjmReel = revJours > 0 ? revCreation / revJours : null
    const tauxHoraireReel = tjmReel != null ? tjmReel / 7 : null
    const aboAn = revAbo * 12
    const totalAn1 = revCreation + revAbo * revMoisAbo1   // total encaissé la 1ère année = création + N mensualités
    const tauxHoraireRecurrent = revSupportH > 0 ? revAbo / revSupportH : null
    const verdict = tjmReel == null ? null : tjmReel < 400 ? 'bas' : tjmReel <= 650 ? 'marche' : 'haut'
    return { tjmReel, tauxHoraireReel, aboAn, totalAn1, tauxHoraireRecurrent, verdict }
  }, [revCreation, revAbo, revJours, revSupportH, revMoisAbo1])

  const { items: catalogueItems } = usePilotageCatalogue()

  // Valeurs par défaut persistées (modifiables quand tu veux)
  const { settings, saveSettings } = usePilotageSettings()
  const [savingDefaults, setSavingDefaults] = useState<'idle' | 'saving' | 'done'>('idle')

  const saveDefaults = async () => {
    if (!live) return
    setSavingDefaults('saving')
    try {
      const e = live.est
      await saveSettings({
        tjm: e.tjm, overheadPct: e.overheadPct, bufferPct: e.bufferPct, maintPct: e.maintPct,
        infra: e.infra, supportH: e.supportH,
        heuresGagnees: e.heuresGagnees, coutHoraireClient: e.coutHoraireClient, partCaptee: e.partCaptee,
        premiumRevente: e.premiumRevente, nbClientsFinaux: e.nbClientsFinaux, prixReventeMensuel: e.prixReventeMensuel,
        outilsMensuel: e.outilsMensuel, joursFactures: e.joursFactures,
        features: e.features,
      })
      setSavingDefaults('done')
      setTimeout(() => setSavingDefaults('idle'), 2000)
    } catch (err) {
      console.error('[pilotage settings]', err)
      setSavingDefaults('idle')
    }
  }

  const num = (s: string) => { const n = Number(s.trim().replace(',', '.')); return s.trim() && Number.isFinite(n) ? n : null }

  // ── Calculs ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const actifs = contrats.filter((c) => c.statut === 'actif')
    const mrr = actifs.reduce((s, c) => s + netAbo(c), 0)   // net facturé (après remise)
    const couts = actifs.reduce((s, c) => s + (c.coutFirebaseMensuel ?? 0), 0)
    const marge = mrr - couts
    const now = new Date()
    const caYear = invoices
      .filter((f) => (f.type ?? 'facture') === 'facture' && f.status === 'paid')
      // Année de l'ENCAISSEMENT, comme le bilan URSSAF : le plafond micro se juge
      // sur ce qui est entré sur le compte, pas sur ce qui a été facturé.
      .filter((f) => { const ts = f.paymentDate ?? f.date ?? f.createdAt; return ts && new Date(ts.seconds * 1000).getFullYear() === now.getFullYear() })
      .reduce((s, f) => s + (f.total ?? 0), 0)
    // Projection annualisée à partir du CA RÉEL uniquement (jamais les contrats → pas de double comptage)
    const moisEcoules = now.getMonth() + 1
    const projection = moisEcoules > 0 ? (caYear / moisEcoules) * 12 : caYear
    return {
      actifs, mrr, couts, marge, arr: mrr * 12, caYear, projection,
      pctReel: Math.min(100, (caYear / PLAFOND) * 100),
      pctProj: Math.min(100, (projection / PLAFOND) * 100),
    }
  }, [contrats, invoices])

  // « À suivre » : relances/échéances dérivées des contrats + devis (CRM phase 1).
  const suivi = useMemo(() => buildSuiviItems(contrats, invoices), [contrats, invoices])

  const alertes = useMemo(() => {
    const out: { tone: 'warn' | 'danger'; text: string }[] = []
    for (const c of stats.actifs) {
      if (c.premiereAnnee && !c.tarifAnnee2Defini)
        out.push({ tone: 'warn', text: `${c.clientNom} : tarif année 2 non défini.` })
      if (c.premiereAnnee && c.dateDebut && monthsSince(c.dateDebut) >= 10)
        out.push({ tone: 'warn', text: `${c.clientNom} : 1ère année bientôt terminée — revoir le tarif.` })
      if (c.abonnementMensuel != null && (netAbo(c) - (c.coutFirebaseMensuel ?? 0)) <= 0)
        out.push({ tone: 'danger', text: `${c.clientNom} : marge nulle ou négative.` })
    }
    if (stats.projection > PLAFOND * 0.8)
      out.push({ tone: 'warn', text: `Tu approches le plafond micro (projection ${fmtEur(stats.projection)} / ${fmtEur(PLAFOND)}). Anticipe le passage en société.` })
    return out
  }, [stats])

  // ── Actions ──────────────────────────────────────────────────────────────
  const openModal = (contrat: PilotageContrat | null, initialForm?: ContratForm, createExtra?: Partial<PilotageContrat>) => {
    setModalContrat(contrat)
    setModalInitialForm(initialForm)
    setModalCreateExtra(createExtra)
    setShowModal(true)
  }
  const openAdd = () => openModal(null, { ...emptyContratForm, tjm: String(live?.est.tjm ?? 500) })
  const openAddWithPricing = () => {
    if (!live) return
    openModal(
      null,
      {
        ...emptyContratForm,
        abonnementMensuel: String(live.tarif.abo),
        fraisMiseEnPlace: String(live.tarif.setup),
        coutFirebaseMensuel: String(live.est.infra),
        tjm: String(live.est.tjm),
      },
      { estimation: live.est, projet: seedProjet(live.est) },  // snapshot du calcul + contenu projet amorcé
    )
  }
  const openEdit = (c: PilotageContrat) => openModal(c)

  // Ouverture du modal d'édition via deep-link ?edit=<id> (compat ; la page détail embarque désormais le modal).
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkHandled.current || contrats.length === 0) return
    const editParam = searchParams.get('edit')
    if (!editParam) return
    const c = contrats.find((x) => x.id === editParam)
    if (c) { deepLinkHandled.current = true; openEdit(c) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, contrats])

  const confirmDelete = async () => {
    if (!deleteId) return
    try { await deleteContrat(deleteId) } catch (err) { console.error('[pilotage delete]', err) }
    setDeleteId(null)
  }

  if (!isAdmin) return <div className="flex items-center justify-center py-20"><p className="text-gray-500">Accès réservé.</p></div>

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
            <PresentationChartLineIcon className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Pilotage</h1>
            <p className="text-sm text-gray-500">Tes contrats, ton revenu récurrent et ta marge</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => router.push('/pilotage/immobilisations')}
            className="flex items-center gap-2 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition"
            title="Immobilisations / matériel">
            <ComputerDesktopIcon className="w-4 h-4" /> Immobilisations
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <PlusIcon className="w-4 h-4" /> Nouveau contrat
          </button>
        </div>
      </div>

      {/* Estimateur de tarif (création sur-mesure) */}
      <details ref={estimateurRef} className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-semibold text-gray-700">
          <span className="inline-block transition group-open:rotate-90 text-gray-400">▸</span>
          <CalculatorIcon className="w-4 h-4 text-blue-600" /> Estimateur de tarif (création sur-mesure)
        </summary>
        {linkedContrat && (
          <div className="flex items-center justify-between gap-2 flex-wrap bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 mt-2">
            <p className="text-xs text-blue-800">
              Tu ajustes l'estimation de <strong>{linkedContrat.clientNom || 'ce contrat'}</strong>. Modifie les valeurs ci-dessous, puis enregistre.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={updateLinkedContrat}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">
                <CheckIcon className="w-3.5 h-3.5" /> Mettre à jour le contrat
              </button>
              <button onClick={() => setLinkedContrat(null)}
                className="text-xs font-medium text-blue-700 hover:underline">Détacher</button>
            </div>
          </div>
        )}
        <EstimateurTarif
          initial={seedEst}
          seedNonce={seedNonce}
          defaults={settings}
          onChange={(est, t) => setLive({ est, tarif: t })}
          footer={(
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button onClick={openAddWithPricing}
                className="flex items-center gap-2 text-sm font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition">
                <PlusIcon className="w-4 h-4" /> Créer un contrat avec ces tarifs
              </button>
              <button onClick={saveDefaults} disabled={savingDefaults === 'saving'}
                className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                {savingDefaults === 'done' ? (
                  <><CheckIcon className="w-4 h-4 text-green-600" /> Enregistré</>
                ) : savingDefaults === 'saving' ? (
                  'Enregistrement…'
                ) : (
                  <><ArrowDownTrayIcon className="w-4 h-4" /> Enregistrer comme valeurs par défaut</>
                )}
              </button>
            </div>
          )}
        />
      </details>

      {/* Analyse inversée — d'un contrat déjà signé vers le taux réalisé */}
      <details className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-semibold text-gray-700">
          <span className="inline-block transition group-open:rotate-90 text-gray-400">▸</span>
          <CalculatorIcon className="w-4 h-4 text-emerald-600" /> Analyse d'un contrat signé (calcul inversé)
        </summary>
        <p className="text-xs text-gray-400 mb-4 mt-2">
          Tu connais déjà ce que tu as facturé ? Saisis-le pour voir à combien ça revient en taux journalier/horaire réel.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { label: 'Création facturée (€)', val: revCreation, set: setRevCreation, hint: '1ère échéance / mise en place', step: 50, min: 0 },
            { label: 'Abonnement facturé /mois (€)', val: revAbo, set: setRevAbo, hint: 'mensuel récurrent', step: 10, min: 0 },
            { label: 'Mensualités (1ʳᵉ année)', val: revMoisAbo1, set: setRevMoisAbo1, hint: 'souvent 11 (abo le mois après)', step: 1, min: 0 },
            { label: 'Jours réellement passés', val: revJours, set: setRevJours, hint: 'sur la création', step: 0.5, min: 0 },
            { label: 'Support réel (h/mois)', val: revSupportH, set: setRevSupportH, hint: 'temps mensuel passé', step: 0.5, min: 0 },
          ] as const).map((f) => (
            <div key={f.label}>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">{f.label}</label>
              <input type="number" inputMode="decimal" step={f.step} min={f.min} value={f.val}
                onChange={(e) => f.set(Math.max(f.min, Number(e.target.value) || 0))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-gray-400 mt-0.5">{f.hint}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {/* 1) Ce que vaut ton temps sur la création */}
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
            <p className="text-xs text-emerald-700/70">TJM réalisé (création)</p>
            <p className="text-2xl font-bold text-emerald-700">{analyse.tjmReel != null ? fmtEur(analyse.tjmReel) : '—'}</p>
            <p className="text-[10px] text-gray-500 mt-1">
              {analyse.tauxHoraireReel != null ? `≈ ${fmtEur(analyse.tauxHoraireReel)}/h · création ÷ jours (paiement unique)` : 'saisis les jours passés'}
            </p>
            {analyse.verdict && (
              <p className={`text-[10px] mt-1 font-medium ${
                analyse.verdict === 'bas' ? 'text-red-600' : analyse.verdict === 'haut' ? 'text-green-600' : 'text-gray-500'
              }`}>
                {analyse.verdict === 'bas'
                  ? 'Sous le marché (400–650 €/j) — tu te sous-vends.'
                  : analyse.verdict === 'haut'
                    ? 'Au-dessus du marché — très bien joué.'
                    : 'Dans la fourchette marché (400–650 €/j).'}
              </p>
            )}
          </div>
          {/* 2) Le récurrent en rythme de croisière (année pleine) */}
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
            <p className="text-xs text-blue-700/70">Récurrent — année pleine</p>
            <p className="text-2xl font-bold text-blue-700">{fmtEur(analyse.aboAn)}<span className="text-sm font-medium text-blue-700/60">/an</span></p>
            <p className="text-[10px] text-gray-500 mt-1">
              12 mensualités (rythme de croisière, année 2+).{analyse.tauxHoraireRecurrent != null ? ` ≈ ${fmtEur(analyse.tauxHoraireRecurrent)}/h de support.` : ''}
            </p>
          </div>
          {/* 3) Total réellement encaissé la 1ère année (création + N mensualités) */}
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4">
            <p className="text-xs text-indigo-700/70">Total encaissé — 1ʳᵉ année</p>
            <p className="text-2xl font-bold text-indigo-700">{fmtEur(analyse.totalAn1)}</p>
            <p className="text-[10px] text-gray-500 mt-1">
              Création + {revMoisAbo1} mensualité{revMoisAbo1 > 1 ? 's' : ''} : {fmtEur(revCreation)} + {revMoisAbo1} × {fmtEur(revAbo)}.
            </p>
          </div>
        </div>
      </details>

      {/* Estimateur de coûts d'infra (Firebase) — indicatif ; les valeurs sont mémorisées comme modèle par défaut */}
      <InfraCostEstimator key={settings ? 'ready' : 'loading'} initial={settings?.coutFirebaseInputs}
        onCommit={(inputs) => { saveSettings({ coutFirebaseInputs: inputs }) }} />

      {/* Prévisionnel (d'après tes contrats) */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400">Prévisionnel — d'après tes contrats actifs. Distinct de ton CA réel (qui vient de ta facturation).</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'MRR (récurrent /mois)', value: fmtEur(stats.mrr), color: 'text-gray-900', sub: `${stats.actifs.length} client${stats.actifs.length !== 1 ? 's' : ''} actif${stats.actifs.length !== 1 ? 's' : ''}` },
            { label: 'ARR projeté (/an)', value: fmtEur(stats.arr), color: 'text-blue-600', sub: 'MRR × 12' },
            { label: 'Coûts infra /mois', value: fmtEur(stats.couts), color: 'text-orange-600', sub: 'Firebase estimé' },
            { label: 'Marge /mois', value: fmtEur(stats.marge), color: stats.marge >= 0 ? 'text-green-600' : 'text-red-600', sub: 'MRR − coûts' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">
          <strong>MRR</strong> (Monthly Recurring Revenue) = revenu <strong>récurrent mensuel</strong> = somme des abonnements de tes contrats actifs. <strong>ARR</strong> (Annual Recurring Revenue) = le même sur un an (MRR × 12).
        </p>
      </div>

      {/* Jauge plafond */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <h2 className="text-sm font-semibold text-gray-700">Plafond micro-entreprise</h2>
          <span className="text-xs text-gray-400">Plafond {fmtEur(PLAFOND)} (prestations de services)</span>
        </div>
        <div className="relative h-5 bg-gray-100 rounded-full overflow-hidden">
          {/* Projection (clair) */}
          <div className="absolute inset-y-0 left-0 bg-indigo-200" style={{ width: `${stats.pctProj}%` }} />
          {/* CA réel (foncé) */}
          <div className="absolute inset-y-0 left-0 bg-indigo-500" style={{ width: `${stats.pctReel}%` }} />
          {/* Seuil 80% */}
          <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: '80%' }} title="80 %" />
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-indigo-500 inline-block" />CA encaissé {new Date().getFullYear()} : <strong>{fmtEur(stats.caYear)}</strong></span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-indigo-200 inline-block" />Projection annualisée : <strong>{fmtEur(stats.projection)}</strong></span>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          <strong>Projection annualisée</strong> = ton CA encaissé ramené à l'année entière (CA actuel ÷ mois écoulés × 12) — une estimation de ton CA de fin d'année si tu gardes ce rythme. Basé uniquement sur ta facturation réelle (factures payées) ; tes contrats ne sont pas ajoutés ici — pas de double comptage.
        </p>
      </div>

      {/* Alertes */}
      {alertes.length > 0 && (
        <div className="space-y-2">
          {alertes.map((a, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm border ${a.tone === 'danger' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* À suivre — relances & échéances dérivées des contrats (CRM) */}
      {suivi.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <BellAlertIcon className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-700">À suivre</h2>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">{suivi.length}</span>
          </div>
          <div className="space-y-1.5">
            {suivi.slice(0, 12).map((it) => (
              <button key={it.key} onClick={() => router.push(`/pilotage/contrat/${it.contratId}${it.tab ? `?tab=${it.tab}` : ''}`)}
                className="w-full flex items-start gap-2.5 text-left rounded-lg border border-gray-100 hover:border-blue-300 hover:bg-blue-50/40 px-3 py-2 transition">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${it.tone === 'danger' ? 'bg-red-500' : it.tone === 'warn' ? 'bg-amber-500' : 'bg-blue-400'}`} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-gray-800">{it.clientNom}</span>
                  <span className="text-gray-400"> — </span>
                  <span className={it.tone === 'danger' ? 'text-red-700' : 'text-gray-600'}>{it.text}</span>
                </span>
                <span className="text-gray-300 shrink-0">›</span>
              </button>
            ))}
          </div>
          {suivi.length > 12 && <p className="text-[11px] text-gray-400 mt-2">+ {suivi.length - 12} autre{suivi.length - 12 > 1 ? 's' : ''}…</p>}
        </section>
      )}

      {/* Liste des contrats */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Contrats ({contrats.length})</h2>
        {loading ? (
          <div className="text-center py-10 text-gray-400">Chargement…</div>
        ) : contrats.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <PresentationChartLineIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Aucun contrat. Ajoute ton premier client.</p>
            <button onClick={openAdd}
              className="mt-4 inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
              <PlusIcon className="w-4 h-4" /> Nouveau contrat
            </button>
          </div>
        ) : contrats.map((c) => {
          const remMS = c.remiseMiseEnPlacePct ?? 0
          const remAbo = c.remiseAbonnementPct ?? 0
          const marge = netAbo(c) - (c.coutFirebaseMensuel ?? 0)   // marge sur le net facturé
          const cells: { l: string; v: string; sub?: string; color?: string }[] = [
            { l: 'Mise en place', v: c.fraisMiseEnPlace != null ? fmtEur(netSetup(c)) : '—', sub: remMS > 0 && c.fraisMiseEnPlace != null ? fmtEur(c.fraisMiseEnPlace) : undefined },
            { l: 'Abonnement /mois', v: c.abonnementMensuel != null ? fmtEur(netAbo(c)) : '—', sub: remAbo > 0 && c.abonnementMensuel != null ? fmtEur(c.abonnementMensuel) : undefined },
            { l: 'Coût infra /mois', v: c.coutFirebaseMensuel != null ? fmtEur(c.coutFirebaseMensuel) : '—' },
            { l: 'Marge /mois', v: fmtEur(marge), color: marge >= 0 ? 'text-green-600' : 'text-red-600' },
          ]
          return (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{c.clientNom}</span>
                    <span className="text-[10px] font-mono text-gray-400" title="Référence du contrat (commune au devis et aux documents)">Réf {c.id.slice(0, 8)}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUT_COLORS[c.statut]}`}>{STATUT_LABELS[c.statut]}</span>
                    {c.premiereAnnee && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">1ère année</span>}
                  </div>
                  {(c.abonnementTitre || c.appNom) && <p className="text-xs text-gray-400 mt-0.5">{c.abonnementTitre || c.appNom}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"><PencilIcon className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"><TrashIcon className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                {cells.map((x) => (
                  <div key={x.l}>
                    <p className="text-[10px] text-gray-400">{x.l}</p>
                    <p className={`text-sm font-semibold ${x.color ?? 'text-gray-800'}`}>
                      {x.v}
                      {x.sub && <span className="ml-1 text-[10px] font-normal text-gray-400" title="tarif catalogue (avant remise)">{x.sub}</span>}
                    </p>
                  </div>
                ))}
              </div>
              {c.notes && <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{c.notes}</p>}
              {(() => {
                const taches = c.projet?.taches ?? []
                const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                const nFact = taches.filter((t) => t.facturation === 'facturer' && !t.facturee).length
                const nRetard = taches.filter((t) => t.date && t.date < today && !t.fait).length
                if (!nFact && !nRetard) return null
                return (
                  <div className="flex flex-col gap-1 mt-2 text-xs font-medium">
                    {nRetard > 0 && <div className="flex items-center gap-1.5 text-amber-700"><ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /><span>{nRetard} tâche{nRetard > 1 ? 's' : ''} en retard</span></div>}
                    {nFact > 0 && <div className="flex items-center gap-1.5 text-rose-700"><ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /><span>{nFact} évolution{nFact > 1 ? 's' : ''} à facturer</span></div>}
                  </div>
                )
              })()}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50 flex-wrap">
                <button onClick={() => router.push(`/pilotage/contrat/${c.id}`)}
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition">
                  <DocumentTextIcon className="w-3.5 h-3.5" /> Documents
                </button>
                <button onClick={() => router.push(`/pilotage/contrat/${c.id}?tab=taches`)}
                  className="flex items-center gap-1.5 text-xs font-medium text-purple-700 border border-purple-200 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition">
                  <CheckIcon className="w-3.5 h-3.5" /> Tâches
                </button>
                <button onClick={() => router.push(`/pilotage/contrat/${c.id}?tab=calculateur`)}
                  className="flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                  <CalculatorIcon className="w-3.5 h-3.5" /> Calculateur
                </button>
                <button onClick={() => router.push(`/pilotage/contrat/${c.id}?tab=apercu`)}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition">
                  <EyeIcon className="w-3.5 h-3.5" /> Aperçu
                </button>
                {c.estimation && (
                  <button onClick={() => loadEstimation(c)}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                    <CalculatorIcon className="w-3.5 h-3.5" /> Rejouer ici
                  </button>
                )}
                {c.devisId && (
                  <button onClick={() => router.push(`/facturation/${c.devisId}`)}
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition">
                    <DocumentTextIcon className="w-3.5 h-3.5" /> Devis {c.devisNumber || 'relié'}
                  </button>
                )}
                <button onClick={() => router.push('/facturation')}
                  className="flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition">
                  <DocumentTextIcon className="w-3.5 h-3.5" /> Aller à la facturation
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal ajout / édition — composant partagé avec la page détail du contrat */}
      <ContratEditModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        contrat={modalContrat}
        initialForm={modalInitialForm}
        createExtra={modalCreateExtra}
      />

      {/* Confirmation suppression */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Supprimer ce contrat ?" size="sm">
        <p className="text-sm text-gray-600 mb-4">Action <strong>irréversible</strong> : le contrat et <strong>tout son contenu</strong> (tâches, planning, contenu projet, mentions légales et documents générés) seront supprimés. Tes factures ne sont pas affectées.</p>
        <div className="flex gap-3">
          <button onClick={() => setDeleteId(null)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">Annuler</button>
          <button onClick={confirmDelete} className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition">Supprimer</button>
        </div>
      </Modal>

    </div>
  )
}
