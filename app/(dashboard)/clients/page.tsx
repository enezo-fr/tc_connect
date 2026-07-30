"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { publicLinkOrigin } from "@/lib/brand";
import { useClients } from "@/hooks/useClients";
import { useCompanies } from "@/hooks/useCompanies";
import { useClientNotes } from "@/hooks/useClientNotes";
import {
  createClient, updateClient, deleteClient,
} from "@/lib/clientService";
import {
  createAbonnement, updateAbonnement, deleteAbonnement, listenAbonnements,
} from "@/lib/abonnementService";
import { Timestamp, collection, addDoc, query, where, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  CalendarDaysIcon, ChevronRightIcon, PencilIcon, TrashIcon, PlusIcon,
} from "@heroicons/react/24/outline";
import { PhoneIcon, EnvelopeIcon, ChatBubbleLeftEllipsisIcon } from "@heroicons/react/24/outline";
import type { Client, Abonnement, AbonnementEtat, Objectif, AntecedentMedical, AntecedentSportif, MaterialItem, StructureItem, AutreCoachItem, PlanningSlot, MouvementDetail, ZoneCorporelle } from "@/types";
import AdresseAutocomplete from "@/components/ui/AdresseAutocomplete";
import MaterielSelect from "@/components/ui/MaterielSelect";
import SuggestInput from "@/components/ui/SuggestInput";
import {
  SPORTS, NIVEAUX, PRIORITE_STYLE, parseFlexDate, calcArretSport, BODY_ZONES,
  MouvementsDetailSelector, ZonesCorporellesSelector, zoneLabel,
} from "@/components/ui/ClientForms";
import ClientEditModal from "@/components/ui/ClientEditModal";
import { AbonnementModal } from "@/components/ui/AbonnementModal";
import { buildWhatsAppUrl } from "@/components/ui/PhoneInput";
import { useAbonnementsByClientId } from "@/hooks/useAbonnementsByClientId";
import PipelineBoard, { type PipelineStage } from "@/components/clients/PipelineBoard";

// ── Constantes planning ───────────────────────────────────────────────────────
const TYPES_RDV_CLIENTS = [
  { groupe: 'TC', options: ['Séance', 'Programme', 'Rendez-vous informations', 'Rendez-vous bilan', 'Règlement TC', 'Séance en autonomie', 'Autre activité', 'Parcours sportif'] },
  { groupe: 'Enezo', options: ['Rendez-vous infos Enezo', 'Rendez-vous bilan Enezo', 'Règlement Enezo'] },
  { groupe: 'FFD', options: ['Détection', 'Règlement FFD'] },
  { groupe: 'EMF', options: ['Séminaire', 'Règlement EMF'] },
]
const MATERIEL_DEFAUT_CLIENTS = ['Sac', 'Tapis', 'Enceinte', 'Chrono']
const ETATS_RDV = ['Non calé', 'Calé', 'Annulé', 'Effectué']
const MODES_RDV = ['Présentiel', 'Visioconférence', 'Téléphone']

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = "w-full min-w-0 border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition";
const toUpperName = (s: string) => s.toUpperCase();
const toProperName = (s: string) =>
  s.split(/([\s-])/).map((p) => /[\s-]/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");

// Formate une Date en 'YYYY-MM-DD' en heure LOCALE. toISOString() renvoie l'UTC,
// ce qui décale la date à J-1 pour une date stockée à minuit local (France UTC+2).
function toDateInputStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toDateInput(ts?: { seconds: number } | null) {
  if (!ts) return "";
  return toDateInputStr(new Date(ts.seconds * 1000));
}
function fromDateInput(s: string) {
  return s ? Timestamp.fromDate(new Date(s)) : undefined;
}

function getNoteTypeStyle(type: string) {
  switch (type) {
    case "Alerte":            return { card: "bg-red-50 border-red-200",     badge: "bg-red-100 text-red-700" };
    case "Bilan":             return { card: "bg-sky-50 border-sky-200",     badge: "bg-sky-100 text-sky-700" };
    case "Objectif":          return { card: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700" };
    case "Observation":       return { card: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-700" };
    case "Absence/Vacances":  return { card: "bg-purple-50 border-purple-200", badge: "bg-purple-100 text-purple-700" };
    default:                  return { card: "bg-gray-50 border-gray-200",   badge: "bg-gray-100 text-gray-500" };
  }
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`);
    const data = await res.json();
    const coords = data.features?.[0]?.geometry?.coordinates;
    if (!coords) return null;
    return { lat: coords[1], lng: coords[0] };
  } catch { return null; }
}

async function calculateRoute(fromLat: number, fromLng: number, toLat: number, toLng: number): Promise<{ distanceKm: number; duration: string }> {
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`
  );
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error("Pas de route trouvée");
  const km = Math.round(route.distance / 100) / 10;
  const mins = Math.round(route.duration / 60);
  const duration = mins >= 60
    ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`
    : `${mins} min`;
  return { distanceKm: km, duration };
}

function isNonDiffusible(s: string | undefined | null): boolean {
  return !s || s.includes("[NON-DIFFUSIBLE]");
}

async function lookupSiret(siret: string): Promise<{ nom?: string; adresse?: string } | null> {
  const clean = siret.replace(/[\s.]/g, "");
  if (clean.length !== 14) return null;
  try {
    const res = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${clean}&per_page=1`
    );
    const data = await res.json();
    const r = data.results?.[0];
    if (!r) return null;
    const rawNom = (r.nom_complet ?? r.nom_raison_sociale ?? "").trim();
    const nom = !isNonDiffusible(rawNom) ? rawNom : undefined;
    const adresseParts = [r.siege?.adresse, r.siege?.code_postal, r.siege?.commune]
      .filter((p) => p && !isNonDiffusible(p));
    const adresse = adresseParts.join(", ").trim() || undefined;
    return { nom, adresse };
  } catch { return null; }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROFESSIONS = [
  "Agriculteur", "Architecte", "Assistant maternel", "Auxiliaire de vie",
  "Avocat", "Cadre dirigeant", "Chef cuisinier", "Chef d'entreprise",
  "Chercheur", "Chômeur", "Chirurgien", "Comptable", "Consultant",
  "Dentiste", "Designer", "Développeur", "Directeur commercial",
  "Éducateur sportif", "Électricien", "Enseignant", "Entrepreneur",
  "Étudiant", "Formateur", "Graphiste", "Infirmier", "Ingénieur",
  "Journaliste", "Juriste", "Kinésithérapeute", "Logisticien",
  "Manager", "Médecin", "Militaire", "Ostéopathe", "Pharmacien",
  "Photographe", "Plombier", "Police / Gendarmerie", "Pompier",
  "Professeur", "Psychologue", "Retraité", "Sans emploi",
  "Technicien", "Traducteur", "Vétérinaire",
];

const RELATIONS_URGENCE = ["Père", "Mère", "Conjoint(e)", "Frère", "Sœur", "Ami(e)", "Collègue", "Autre"];
const POSITIONS_TRAVAIL = ["Sédentaire (bureau)", "Debout / Piétinement", "Mixte", "Physique", "En déplacement"];
const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const NAP_CATEGORIES = [
  { id: "sedentaire",  label: "Sédentaire",          coef: 1.2,   desc: "Peu ou pas d'exercice · boulot de bureau" },
  { id: "leger",       label: "Légèrement actif",     coef: 1.375, desc: "Exercice léger 1–3 jours / semaine" },
  { id: "modere",      label: "Modérément actif",     coef: 1.55,  desc: "Exercice modéré 3–5 jours / semaine" },
  { id: "tres_actif",  label: "Très actif",           coef: 1.725, desc: "Exercice intense 6–7 jours / semaine" },
  { id: "extreme",     label: "Extrêmement actif",    coef: 1.9,   desc: "Exercice très intense + travail physique" },
];

const SERVICES_SUIVIS = [
  "Kinésithérapeute", "Ostéopathe", "Médecin du sport", "Podologue",
  "Diététicien(ne)", "Nutritionniste", "Psychologue", "Prépa mentale",
  "Sophrologie", "Acupuncture", "Cardiologue", "Rhumatologue",
  "Chirurgien orthopédique", "Ergothérapeute", "Masseur", "Coach sportif",
];

const ETAT_STYLE: Record<string, string> = {
  Prospect: "bg-purple-100 text-purple-700",
  Actif: "bg-green-100 text-green-700",
  Inactif: "bg-red-100 text-red-600",
};
const ETAT_OPTIONS: AbonnementEtat[] = ["Prospect", "Actif", "Inactif"];

const CATEGORIES_ABO = ["Teddy Coaching", "FFD", "EMF", "Enezo"];

const TYPE_SUIVI_OPTIONS: Record<string, string[]> = {
  "Teddy Coaching": ["Coaching", "Plan d'entrainement", "Coaching + Plan d'entrainement", "Parcours Sportif", "Testing", "Suivi collectif à distance", "Programme 20 minutes - 1 Objectif", "Boutique TC"],
  "FFD": ["Détection", "Suivi de joueurs", "Pack d'accompagnement FFD", "Formation FFD"],
  "EMF": ["Formation EMF"],
  "Enezo": ["Enezo", "Acces TC-Connect"],
};

const STATUT_STYLE: Record<string, string> = {
  Prospect: "bg-purple-100 text-purple-700",
  Actif: "bg-blue-100 text-blue-700",
  Inactif: "bg-gray-100 text-gray-500",
};

// ── Types formulaires ─────────────────────────────────────────────────────────

type ClientForm = {
  prenom: string; nom: string; email: string; telephone: string;
  dateNaissance: string; adresse: string; ville: string; codePostal: string;
  profession: string; sportPratique: string; niveauSportif: string;
  actif: boolean;
  // Entreprise
  siret: string; nomEntreprise: string; adresseEntreprise: string;
  // Structured
  objectifs: Objectif[];
  antecedentsMedicaux: AntecedentMedical[];
  antecedentsSportifs: AntecedentSportif[];
  // Équipement (nouveau : tableaux)
  materielItems: MaterialItem[];
  structureItems: StructureItem[];
  autreCoachItems: AutreCoachItem[];
  // Contact urgence
  contactUrgenceNom: string; contactUrgenceTel: string; contactUrgenceRelation: string;
  // Logistique
  lieuSeance: string; lieuSeanceLat: number | null; lieuSeanceLng: number | null;
  distanceKm: number | null; tempsRouteSeance: string;
  nbSeancesParSemaine: string;
  planningSlots: Record<string, PlanningSlot[]>;
  // Conditions de vie
  joursTravail: string[]; positionTravail: string; tempsRouteTravail: string; tempsTravailSemaine: string;
  // NAP
  napCategorie: string;
  // Notes en attente (avant création)
  pendingNotes: Array<{ texte: string; type_note: string }>;
};

type AboNoteItem = { texte: string; type_note: string };

const RAISONS_ARRET_SUIVI = [
  "Objectif atteint",
  "Raisons financières",
  "Manque de temps",
  "Déménagement",
  "Changement de coach",
  "Blessure / Problème de santé",
  "Reprise autonome",
  "Pause temporaire",
  "Insatisfaction",
  "Fin de contrat",
  "Non-renouvellement client",
  "Décès",
  "Autre",
];

type AboForm = {
  categorie: string; companyId: string;
  typeSuivi: string;
  dateDebut: string; dateFin: string; etat: AbonnementEtat;
  objectifs: Objectif[];
  resumeSuivi: string;
  indications: string;
  notesInternes: AboNoteItem[];
  arretSuivi: string;
};

const EMPTY_CLIENT: ClientForm = {
  prenom: "", nom: "", email: "", telephone: "", dateNaissance: "",
  adresse: "", ville: "", codePostal: "", profession: "", sportPratique: "",
  niveauSportif: "", actif: true,
  siret: "", nomEntreprise: "", adresseEntreprise: "",
  objectifs: [], antecedentsMedicaux: [], antecedentsSportifs: [],
  materielItems: [], structureItems: [], autreCoachItems: [],
  contactUrgenceNom: "", contactUrgenceTel: "", contactUrgenceRelation: "",
  lieuSeance: "", lieuSeanceLat: null, lieuSeanceLng: null, distanceKm: null, tempsRouteSeance: "",
  nbSeancesParSemaine: "", planningSlots: {},
  joursTravail: [], positionTravail: "", tempsRouteTravail: "", tempsTravailSemaine: "",
  napCategorie: "",
  pendingNotes: [],
};

const EMPTY_ABO: AboForm = {
  categorie: "", companyId: "",
  typeSuivi: "",
  dateDebut: "", dateFin: "", etat: "Actif",
  objectifs: [], resumeSuivi: "", indications: "", notesInternes: [],
  arretSuivi: "",
};

// ── Helpers formulaires ───────────────────────────────────────────────────────

function calcNap(q: { travail: string; sportFreq: string; sportIntens: string; mvtQuotidien: string }): string {
  let score = 0;
  if (q.travail === "leger") score += 1;
  else if (q.travail === "physique") score += 2;
  if (q.sportFreq === "1-2") score += 1;
  else if (q.sportFreq === "3-4") score += 2;
  else if (q.sportFreq === "5+") score += 3;
  if (q.sportIntens === "modere") score += 1;
  else if (q.sportIntens === "intense") score += 2;
  if (q.mvtQuotidien === "moyen") score += 1;
  else if (q.mvtQuotidien === "beaucoup") score += 2;
  if (score <= 1) return "sedentaire";
  if (score <= 3) return "leger";
  if (score <= 5) return "modere";
  if (score <= 7) return "tres_actif";
  return "extreme";
}

// ── Sous-composants listes structurées ────────────────────────────────────────

function ObjectifsList({ value, onChange, simple }: { value: Objectif[]; onChange: (v: Objectif[]) => void; simple?: boolean }) {
  const empty: Objectif = { texte: "", priorite: "Primaire", dateObjectif: "", donneeChiffree: "", commentaire: "" };
  const [form, setForm] = useState<Objectif>(empty);
  const [open, setOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const submit = () => {
    if (!form.texte.trim()) return;
    if (editIdx !== null) { onChange(value.map((v, i) => (i === editIdx ? form : v))); setEditIdx(null); }
    else onChange([...value, form]);
    setForm(empty); setOpen(false);
  };

  const grouped = (["Primaire", "Secondaire", "Tertiaire"] as const).map((p) => ({
    label: p, items: value.map((o, i) => ({ o, i })).filter(({ o }) => o.priorite === p),
  })).filter(({ items }) => items.length > 0);

  return (
    <div className="space-y-3">
      {grouped.map(({ label, items }) => (
        <div key={label}>
          {!simple && <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full mb-1.5 ${PRIORITE_STYLE[label]}`}>{label}</div>}
          <div className="space-y-1.5 pl-1">
            {items.map(({ o, i }) => (
              <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg border text-sm">
                <div className="flex-1 min-w-0">
                  {!simple && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      {o.donneeChiffree && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{o.donneeChiffree}</span>}
                      {o.dateObjectif && <span className="text-xs text-gray-400">avant le {new Date(o.dateObjectif).toLocaleDateString("fr-FR")}</span>}
                    </div>
                  )}
                  <p className="text-gray-800">{o.texte}</p>
                  {o.commentaire && <p className="text-xs text-gray-500 mt-0.5 italic">{o.commentaire}</p>}
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <button type="button" onClick={() => { setForm({ ...empty, ...o, dateObjectif: o.dateObjectif ?? "", donneeChiffree: o.donneeChiffree ?? "", commentaire: o.commentaire ?? "" }); setEditIdx(i); setOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 transition"><PencilIcon className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition"><TrashIcon className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {open ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <input type="text" placeholder="Décrivez l'objectif..." value={form.texte} onChange={(e) => setForm((f) => ({ ...f, texte: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          {!simple && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Catégorie</label>
                <select value={form.priorite} onChange={(e) => setForm((f) => ({ ...f, priorite: e.target.value as any }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
                  {(["Primaire", "Secondaire", "Tertiaire"] as const).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Donnée chiffrée</label>
                <input type="text" placeholder="Ex : 80 kg" value={form.donneeChiffree ?? ""} onChange={(e) => setForm((f) => ({ ...f, donneeChiffree: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
              </div>
              <div className="min-w-0">
                <label className="block text-xs text-gray-500 mb-1">Date objectif</label>
                <input type="date" value={form.dateObjectif ?? ""} onChange={(e) => setForm((f) => ({ ...f, dateObjectif: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400 min-w-0" style={{ minWidth: 0 }} />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Commentaire</label>
            <textarea rows={2} placeholder="Notes ou contexte sur cet objectif..." value={form.commentaire ?? ""} onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setEditIdx(null); setForm(empty); }} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={submit} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">{editIdx !== null ? "Modifier" : "Ajouter"}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setForm(empty); setOpen(true); }} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter un objectif</button>
      )}
    </div>
  );
}

const TYPES_BLESSURE = ["Osseuse", "Tendineuse", "Musculaire", "Ligamentaire", "Neurologique", "Chronique / Maladie", "Autre"];


type FlexDateMode = 'Année' | 'Mois' | 'Date'

function detectFlexMode(value: string): FlexDateMode {
  if (!value) return 'Année'
  if (/^\d{4}$/.test(value)) return 'Année'
  if (/^\d{1,2}\/\d{4}$/.test(value)) return 'Mois'
  return 'Date'
}

function FlexDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = React.useState<FlexDateMode>(() => detectFlexMode(value))

  const initParts = (v: string) => {
    const d = parseFlexDate(v)
    return {
      annee: d ? String(d.getFullYear()) : '',
      mo: d ? String(d.getMonth() + 1).padStart(2, '0') : '',
      yr: d ? String(d.getFullYear()) : '',
    }
  }
  const [annee, setAnnee] = React.useState(() => initParts(value).annee)
  const [moisMo, setMoisMo] = React.useState(() => initParts(value).mo)
  const [moisYr, setMoisYr] = React.useState(() => initParts(value).yr)

  const isoVal = React.useMemo(() => {
    const d = parseFlexDate(value)
    if (!d) return ''
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [value])

  const switchMode = (newMode: FlexDateMode) => {
    const d = parseFlexDate(value)
    setMode(newMode)
    if (newMode === 'Année') {
      const yr = d ? String(d.getFullYear()) : ''
      setAnnee(yr)
      if (yr) onChange(yr)
    } else if (newMode === 'Mois') {
      const mo = d ? String(d.getMonth() + 1).padStart(2, '0') : ''
      const yr = d ? String(d.getFullYear()) : ''
      setMoisMo(mo); setMoisYr(yr)
      if (mo && yr) onChange(`${mo}/${yr}`)
    } else {
      if (d) {
        const dy = String(d.getDate()).padStart(2, '0')
        const mo = String(d.getMonth() + 1).padStart(2, '0')
        onChange(`${dy}/${mo}/${d.getFullYear()}`)
      }
    }
  }

  const tabCls = (m: FlexDateMode) =>
    `flex-1 py-1 text-xs font-medium transition ${mode === m ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`

  return (
    <div className="space-y-1">
      <div className="flex rounded overflow-hidden border border-gray-200">
        {(['Année', 'Mois', 'Date'] as FlexDateMode[]).map((m) => (
          <button key={m} type="button" onClick={() => switchMode(m)} className={tabCls(m)}>{m}</button>
        ))}
      </div>

      {mode === 'Année' && (
        <input type="number" min={1900} max={2100} placeholder="2018"
          value={annee}
          onChange={(e) => { setAnnee(e.target.value); if (/^\d{4}$/.test(e.target.value)) onChange(e.target.value); else if (!e.target.value) onChange('') }}
          className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
      )}

      {mode === 'Mois' && (
        <div className="flex gap-1">
          <select value={moisMo}
            onChange={(e) => { setMoisMo(e.target.value); if (e.target.value && moisYr) onChange(`${e.target.value}/${moisYr}`) }}
            className="flex-1 border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
            <option value="">Mois</option>
            {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input type="number" min={1900} max={2100} placeholder="Année"
            value={moisYr}
            onChange={(e) => { setMoisYr(e.target.value); if (moisMo && /^\d{4}$/.test(e.target.value)) onChange(`${moisMo}/${e.target.value}`) }}
            className="w-24 border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
        </div>
      )}

      {mode === 'Date' && (
        <input type="date" value={isoVal}
          onChange={(e) => {
            if (!e.target.value) { onChange(''); return }
            const [y, m, d] = e.target.value.split('-')
            onChange(`${d}/${m}/${y}`)
          }}
          className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400 min-w-0"
          style={{ minWidth: 0 }} />
      )}
    </div>
  )
}

function AntecedentsMedicauxList({ value, onChange }: { value: AntecedentMedical[]; onChange: (v: AntecedentMedical[]) => void }) {
  const empty: AntecedentMedical = {
    description: "", typeBlessure: "", estContreIndication: false, estChronique: false,
    cote: "", zonesCorps: [], anneeDebut: "", anneeFin: "", arretSport: "",
    douleurPresente: false, mouvementsDetail: [],
    operation: false, dateOperation: "",
  };
  const [form, setForm] = useState<AntecedentMedical>(empty);
  const [open, setOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const arretManual = useRef(false);

  const submit = () => {
    if (!form.description.trim()) return;
    if (editIdx !== null) { onChange(value.map((v, i) => (i === editIdx ? form : v))); setEditIdx(null); }
    else onChange([...value, form]);
    setForm(empty); setOpen(false);
  };

  const openEdit = (a: AntecedentMedical, i: number) => {
    arretManual.current = !!a.arretSport;
    const detail: MouvementDetail[] = a.mouvementsDetail && a.mouvementsDetail.length > 0
      ? a.mouvementsDetail
      : (a.mouvementsDouloureux ? a.mouvementsDouloureux.split(', ').filter(Boolean).map(label => ({ label, intensite: a.gradeDouleur ?? 5 })) : []);
    setForm({
      ...empty, ...a,
      zonesCorps: (a.zonesCorps ?? []).map((z: any) =>
        typeof z === 'string' ? { partie: BODY_ZONES.find((bz: any) => bz.id === z)?.label ?? z } : z
      ) as ZoneCorporelle[],
      mouvementsDetail: detail,
      dateOperation: a.dateOperation ?? "",
      anneeDebut: a.anneeDebut ?? (a as any).annee ?? "",
    });
    setEditIdx(i); setOpen(true);
  };

  return (
    <div className="space-y-2">
      {value.map((a, i) => (
        <div key={i} className={`flex items-start gap-2 p-2.5 rounded-lg border text-sm ${a.estChronique ? "bg-orange-50 border-orange-200" : a.estContreIndication ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              {a.typeBlessure && <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-medium">{a.typeBlessure}</span>}
              {a.estChronique && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Chronique</span>}
              {a.estContreIndication && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Contre-indication</span>}
              {a.operation && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">Op.{a.dateOperation ? ` ${new Date(a.dateOperation).getFullYear()}` : ""}</span>}
              {(a.anneeDebut || (a as any).annee) && <span className="text-xs text-gray-400">{a.anneeDebut ?? (a as any).annee}{a.anneeFin ? ` → ${a.anneeFin}` : ""}</span>}
            </div>
            <p className="text-gray-800 font-medium">{a.description}</p>
            {a.douleurPresente && (
              (a.mouvementsDetail && a.mouvementsDetail.length > 0)
                ? <p className="text-xs text-red-600 mt-0.5">Douleur · {a.mouvementsDetail.map(m => `${m.label} (${m.intensite}/10)`).join(' · ')}</p>
                : <p className="text-xs text-red-600 mt-0.5">Douleur présente{a.gradeDouleur ? ` · ${a.gradeDouleur}/10` : ""}{a.mouvementsDouloureux ? ` · ${a.mouvementsDouloureux}` : ""}</p>
            )}
            {(a.zonesCorps ?? []).length > 0 && (
              <p className="text-xs text-blue-600 mt-0.5">
                {(a.zonesCorps ?? []).map((z: any) => typeof z === 'string' ? z : zoneLabel(z)).join(' | ')}
              </p>
            )}
            {a.arretSport && <p className="text-xs text-gray-400 mt-0.5">Arrêt sport : {a.arretSport}</p>}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button type="button" onClick={() => openEdit(a, i)} className="p-1 text-gray-400 hover:text-blue-600 transition"><PencilIcon className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition"><TrashIcon className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="border border-blue-200 rounded-xl p-4 space-y-3 bg-blue-50">
          {/* Description */}
          <input type="text" placeholder="Nom / description (ex: Entorse cheville, Asthme, Lombalgie...)" value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />

          {/* Type + Côté */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={form.typeBlessure ?? ""} onChange={(e) => setForm((f) => ({ ...f, typeBlessure: e.target.value }))}
                className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
                <option value="">— Choisir —</option>
                {TYPES_BLESSURE.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Côté</label>
              <select value={form.cote ?? ""} onChange={(e) => setForm((f) => ({ ...f, cote: e.target.value }))}
                className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
                {["", "Gauche", "Droite", "Bilatéral", "Central", "N/A"].map((c) => <option key={c} value={c}>{c || "—"}</option>)}
              </select>
            </div>
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.estContreIndication ?? false} onChange={(e) => setForm((f) => ({ ...f, estContreIndication: e.target.checked }))} className="rounded" />
              Contre-indication
            </label>
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.estChronique ?? false} onChange={(e) => setForm((f) => ({ ...f, estChronique: e.target.checked }))} className="rounded" />
              Chronique / permanent
            </label>
          </div>

          {/* Dates + Arrêt */}
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="min-w-0">
                <label className="block text-xs text-gray-500 mb-1">Date début</label>
                <FlexDateInput value={form.anneeDebut ?? ""}
                  onChange={(debut) => setForm((f) => {
                    const auto = calcArretSport(debut, f.anneeFin ?? "");
                    return { ...f, anneeDebut: debut, arretSport: arretManual.current ? f.arretSport : auto };
                  })} />
              </div>
              <div className="min-w-0">
                <label className="block text-xs text-gray-500 mb-1">Date fin <span className="text-gray-300">(vide = actif)</span></label>
                <FlexDateInput value={form.anneeFin ?? ""}
                  onChange={(fin) => setForm((f) => {
                    const auto = calcArretSport(f.anneeDebut ?? "", fin);
                    return { ...f, anneeFin: fin, arretSport: arretManual.current ? f.arretSport : auto };
                  })} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Arrêt sport <span className="text-gray-300">(auto)</span></label>
              <input type="text" placeholder="3 mois" value={form.arretSport ?? ""}
                onChange={(e) => { arretManual.current = true; setForm((f) => ({ ...f, arretSport: e.target.value })); }}
                className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>

          {/* Opération */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.operation ?? false} onChange={(e) => setForm((f) => ({ ...f, operation: e.target.checked }))} className="rounded" />
              Opération chirurgicale
            </label>
            {form.operation && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date d'opération</label>
                <input type="date" value={form.dateOperation ?? ""} onChange={(e) => setForm((f) => ({ ...f, dateOperation: e.target.value }))}
                  className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
              </div>
            )}
          </div>

          {/* Douleur */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.douleurPresente ?? false} onChange={(e) => setForm((f) => ({ ...f, douleurPresente: e.target.checked }))} className="rounded" />
              Douleur encore présente
            </label>
            {form.douleurPresente && (
              <div className="space-y-2 pl-2 border-l-2 border-orange-300">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Mouvements douloureux <span className="text-gray-400">(intensité par mouvement)</span></label>
                  <MouvementsDetailSelector
                    value={form.mouvementsDetail ?? []}
                    onChange={(v) => setForm((f) => ({ ...f, mouvementsDetail: v }))} />
                </div>
              </div>
            )}
          </div>

          {/* Zones corps */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Localisation (zones corporelles)</label>
            <ZonesCorporellesSelector value={(form.zonesCorps ?? []) as ZoneCorporelle[]} onChange={(v) => setForm((f) => ({ ...f, zonesCorps: v }))} />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { setOpen(false); setEditIdx(null); setForm(empty); }}
              className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={submit}
              className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">{editIdx !== null ? "Modifier" : "Ajouter"}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { arretManual.current = false; setForm(empty); setOpen(true); }}
          className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">
          + Ajouter un antécédent / contre-indication
        </button>
      )}
    </div>
  );
}

function AntecedentsSportifsList({ value, onChange }: { value: AntecedentSportif[]; onChange: (v: AntecedentSportif[]) => void }) {
  const empty: AntecedentSportif = { sport: "", anneeDebut: "", anneeFin: "", niveau: "" };
  const [form, setForm] = useState<AntecedentSportif>(empty);
  const [open, setOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const submit = () => {
    if (!form.sport.trim()) return;
    if (editIdx !== null) { onChange(value.map((v, i) => (i === editIdx ? form : v))); setEditIdx(null); }
    else onChange([...value, form]);
    setForm(empty); setOpen(false);
  };

  return (
    <div className="space-y-2">
      {value.map((a, i) => (
        <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg border text-sm">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              {(a.anneeDebut || a.anneeFin) && <span className="text-xs text-gray-400">{a.anneeDebut}{a.anneeDebut && a.anneeFin ? " → " : ""}{a.anneeFin}</span>}
              {a.niveau && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{a.niveau}</span>}
            </div>
            <p className="text-gray-800">{a.sport}</p>
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button type="button" onClick={() => { setForm(a); setEditIdx(i); setOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 transition"><PencilIcon className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition"><TrashIcon className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <SuggestInput value={form.sport} onChange={(v) => setForm((f) => ({ ...f, sport: v }))} suggestions={SPORTS} placeholder="Sport pratiqué..." className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Début</label>
              <input type="text" placeholder="2010" value={form.anneeDebut} onChange={(e) => setForm((f) => ({ ...f, anneeDebut: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fin</label>
              <input type="text" placeholder="2020 / En cours" value={form.anneeFin} onChange={(e) => setForm((f) => ({ ...f, anneeFin: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Niveau</label>
              <select value={form.niveau} onChange={(e) => setForm((f) => ({ ...f, niveau: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
                <option value="">—</option>
                {NIVEAUX.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setEditIdx(null); setForm(empty); }} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={submit} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">{editIdx !== null ? "Modifier" : "Ajouter"}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setForm(empty); setOpen(true); }} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter un antécédent sportif</button>
      )}
    </div>
  );
}

function MaterialItemsList({ value, onChange }: { value: MaterialItem[]; onChange: (v: MaterialItem[]) => void }) {
  const empty: MaterialItem = { nom: "", localisation: "", observations: "" };
  const [form, setForm] = useState<MaterialItem>(empty);
  const [open, setOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const submit = () => {
    if (!form.nom.trim()) return;
    if (editIdx !== null) { onChange(value.map((v, i) => (i === editIdx ? form : v))); setEditIdx(null); }
    else onChange([...value, form]);
    setForm(empty); setOpen(false);
  };

  return (
    <div className="space-y-2">
      {value.map((m, i) => (
        <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg border text-sm">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-800">{m.nom}</p>
            {m.localisation && <p className="text-xs text-gray-500 mt-0.5">📍 {m.localisation}</p>}
            {m.observations && <p className="text-xs text-gray-400 italic mt-0.5">{m.observations}</p>}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button type="button" onClick={() => { setForm(m); setEditIdx(i); setOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 transition"><PencilIcon className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition"><TrashIcon className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <input type="text" placeholder="Ex : Haltères, Tapis, Vélo d'appartement..." value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input type="text" placeholder="Localisation (salle, domicile...)" value={form.localisation ?? ""} onChange={(e) => setForm((f) => ({ ...f, localisation: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input type="text" placeholder="Observations..." value={form.observations ?? ""} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setEditIdx(null); setForm(empty); }} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={submit} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">{editIdx !== null ? "Modifier" : "Ajouter"}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setForm(empty); setOpen(true); }} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter du matériel</button>
      )}
    </div>
  );
}

function StructureItemsList({ value, onChange }: { value: StructureItem[]; onChange: (v: StructureItem[]) => void }) {
  const empty: StructureItem = { nom: "", adresse: "", observations: "" };
  const [form, setForm] = useState<StructureItem>(empty);
  const [open, setOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const submit = () => {
    if (!form.nom.trim()) return;
    if (editIdx !== null) { onChange(value.map((v, i) => (i === editIdx ? form : v))); setEditIdx(null); }
    else onChange([...value, form]);
    setForm(empty); setOpen(false);
  };

  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg border text-sm">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-800">{s.nom}</p>
            {s.adresse && <p className="text-xs text-gray-500 mt-0.5">📍 {s.adresse}</p>}
            {s.observations && <p className="text-xs text-gray-400 italic mt-0.5">{s.observations}</p>}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button type="button" onClick={() => { setForm(s); setEditIdx(i); setOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 transition"><PencilIcon className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition"><TrashIcon className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <input type="text" placeholder="Nom de la salle / structure..." value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <AdresseAutocomplete
            value={form.adresse ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, adresse: v }))}
            onSelectFull={(data) => setForm((f) => ({ ...f, adresse: data.label }))}
            placeholder="Adresse de la structure..."
          />
          <input type="text" placeholder="Observations..." value={form.observations ?? ""} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setEditIdx(null); setForm(empty); }} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={submit} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">{editIdx !== null ? "Modifier" : "Ajouter"}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setForm(empty); setOpen(true); }} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter une structure</button>
      )}
    </div>
  );
}

function AutreCoachList({ value, onChange }: { value: AutreCoachItem[]; onChange: (v: AutreCoachItem[]) => void }) {
  const empty: AutreCoachItem = { service: "", nom: "", tel: "", mail: "", observations: "" };
  const [form, setForm] = useState<AutreCoachItem>(empty);
  const [open, setOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const submit = () => {
    if (!form.service?.trim() && !form.nom?.trim()) return;
    if (editIdx !== null) { onChange(value.map((v, i) => (i === editIdx ? form : v))); setEditIdx(null); }
    else onChange([...value, form]);
    setForm(empty); setOpen(false);
  };

  return (
    <div className="space-y-2">
      {value.map((c, i) => (
        <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg border text-sm">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {c.service && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">{c.service}</span>}
              {c.nom && <span className="font-medium text-gray-800">{c.nom}</span>}
            </div>
            {c.tel && <p className="text-xs text-gray-500 mt-0.5">📞 {c.tel}</p>}
            {c.mail && <p className="text-xs text-gray-500">✉ {c.mail}</p>}
            {c.observations && <p className="text-xs text-gray-400 italic mt-0.5">{c.observations}</p>}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button type="button" onClick={() => { setForm(c); setEditIdx(i); setOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 transition"><PencilIcon className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition"><TrashIcon className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      {open ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Service / spécialité</label>
              <SuggestInput value={form.service ?? ""} onChange={(v) => setForm((f) => ({ ...f, service: v }))} suggestions={SERVICES_SUIVIS} placeholder="Kiné, ostéo..." className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nom</label>
              <input type="text" value={form.nom ?? ""} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Téléphone</label>
              <input type="tel" value={form.tel ?? ""} onChange={(e) => setForm((f) => ({ ...f, tel: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input type="email" value={form.mail ?? ""} onChange={(e) => setForm((f) => ({ ...f, mail: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>
          <input type="text" placeholder="Observations..." value={form.observations ?? ""} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setEditIdx(null); setForm(empty); }} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={submit} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">{editIdx !== null ? "Modifier" : "Ajouter"}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setForm(empty); setOpen(true); }} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter un suivi</button>
      )}
    </div>
  );
}

function WeeklyPlanningSlots({ value, onChange }: { value: Record<string, PlanningSlot[]>; onChange: (v: Record<string, PlanningSlot[]>) => void }) {
  const addSlot = (jour: string) =>
    onChange({ ...value, [jour]: [...(value[jour] ?? []), { activite: "", heureDebut: "", duree: "" }] });

  const removeSlot = (jour: string, idx: number) => {
    const slots = (value[jour] ?? []).filter((_, i) => i !== idx);
    const next = { ...value };
    if (slots.length) next[jour] = slots; else delete next[jour];
    onChange(next);
  };

  const updateSlot = (jour: string, idx: number, field: keyof PlanningSlot, val: string) =>
    onChange({ ...value, [jour]: (value[jour] ?? []).map((s, i) => i === idx ? { ...s, [field]: val } : s) });

  return (
    <div className="space-y-2">
      {JOURS_SEMAINE.map((jour) => (
        <div key={jour} className="border rounded-xl p-3 bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700">{jour}</span>
            <button type="button" onClick={() => addSlot(jour)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium transition">+ Activité</button>
          </div>
          {(value[jour] ?? []).length === 0 && (
            <p className="text-xs text-gray-400 italic">Repos — cliquez sur « + Activité » pour ajouter un créneau</p>
          )}
          {(value[jour] ?? []).map((slot, idx) => (
            <div key={idx} className="flex gap-1.5 mb-1.5 items-center flex-wrap">
              <input type="time"
                value={slot.heureDebut ?? ""}
                onChange={(e) => updateSlot(jour, idx, "heureDebut", e.target.value)}
                className="w-24 border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white shrink-0" />
              <input type="text" placeholder="Activité (coaching, running...)"
                value={slot.activite}
                onChange={(e) => updateSlot(jour, idx, "activite", e.target.value)}
                className="flex-1 min-w-[120px] border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white" />
              <input type="text" placeholder="Durée"
                value={slot.duree ?? ""}
                onChange={(e) => updateSlot(jour, idx, "duree", e.target.value)}
                className="w-16 border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white" />
              <button type="button" onClick={() => removeSlot(jour, idx)} className="p-1 text-gray-400 hover:text-red-500 transition shrink-0">
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function NapCalculator({ onApply }: { onApply: (napId: string) => void }) {
  const [q, setQ] = useState({ travail: "", sportFreq: "", sportIntens: "", mvtQuotidien: "" });
  const [show, setShow] = useState(false);
  const result = q.travail && q.sportFreq && q.sportIntens && q.mvtQuotidien
    ? calcNap(q) : null;

  if (!show) return (
    <button type="button" onClick={() => setShow(true)}
      className="w-full text-xs text-blue-600 border border-dashed border-blue-200 rounded-lg py-2 hover:bg-blue-50 transition">
      Calculer le NAP par questionnaire
    </button>
  );

  type Opt = { val: string; label: string };
  const Radio = ({ name, opts, selected, onSelect }: { name: string; opts: Opt[]; selected: string; onSelect: (v: string) => void }) => (
    <div className="space-y-1">
      {opts.map((o) => (
        <label key={o.val} className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="radio" name={name} checked={selected === o.val} onChange={() => onSelect(o.val)} className="accent-blue-600" />
          {o.label}
        </label>
      ))}
    </div>
  );

  return (
    <div className="border border-blue-200 rounded-xl p-4 space-y-4 bg-blue-50">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">Calculateur NAP</p>
        <button type="button" onClick={() => setShow(false)} className="text-xs text-gray-400 hover:text-gray-600">Fermer</button>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1.5">1. Activité professionnelle :</p>
        <Radio name="nap_travail" selected={q.travail} onSelect={(v) => setQ((qq) => ({ ...qq, travail: v }))} opts={[
          { val: "sedentaire", label: "Sédentaire (bureau, télétravail)" },
          { val: "leger",      label: "Légèrement actif (debout, déplacements)" },
          { val: "physique",   label: "Travail physique (chantier, sport professionnel…)" },
        ]} />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1.5">2. Fréquence d'exercice par semaine :</p>
        <Radio name="nap_freq" selected={q.sportFreq} onSelect={(v) => setQ((qq) => ({ ...qq, sportFreq: v }))} opts={[
          { val: "0",   label: "Jamais / rarement" },
          { val: "1-2", label: "1 à 2 fois" },
          { val: "3-4", label: "3 à 4 fois" },
          { val: "5+",  label: "5 fois ou plus" },
        ]} />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1.5">3. Intensité des séances :</p>
        <Radio name="nap_intens" selected={q.sportIntens} onSelect={(v) => setQ((qq) => ({ ...qq, sportIntens: v }))} opts={[
          { val: "leger",  label: "Légère (marche, yoga, étirements)" },
          { val: "modere", label: "Modérée (vélo, natation, fitness)" },
          { val: "intense",label: "Intense (HIIT, course rapide, sports collectifs)" },
        ]} />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1.5">4. Activité quotidienne hors sport :</p>
        <Radio name="nap_mvt" selected={q.mvtQuotidien} onSelect={(v) => setQ((qq) => ({ ...qq, mvtQuotidien: v }))} opts={[
          { val: "peu",      label: "Très sédentaire (voiture, ascenseur…)" },
          { val: "moyen",    label: "Modérée (marche ~30 min/j)" },
          { val: "beaucoup", label: "Importante (vélo, marche >1h/j)" },
        ]} />
      </div>

      {result && (() => {
        const cat = NAP_CATEGORIES.find((n) => n.id === result)!;
        return (
          <div className="bg-white rounded-xl p-3 border border-blue-200">
            <p className="text-xs text-gray-500 mb-0.5">Résultat suggéré :</p>
            <p className="text-sm font-semibold text-blue-700">{cat.label} <span className="font-normal text-gray-400">× {cat.coef}</span></p>
            <p className="text-xs text-gray-400 mt-0.5">{cat.desc}</p>
            <button type="button" onClick={() => { onApply(result); setShow(false); }}
              className="mt-2 w-full bg-blue-600 text-white text-xs rounded-lg py-1.5 hover:bg-blue-700 transition">
              Appliquer ce NAP
            </button>
          </div>
        );
      })()}
    </div>
  );
}

function ClientNotesPanel({
  clientId, linkedUserId,
  pendingNotes, onPendingChange,
}: {
  clientId: string | null; linkedUserId?: string;
  pendingNotes?: Array<{ texte: string; type_note: string; date_max?: string }>;
  onPendingChange?: (notes: Array<{ texte: string; type_note: string; date_max?: string }>) => void;
}) {
  const { notes, loading, addNote, deleteNote } = useClientNotes(clientId ?? undefined, linkedUserId);
  const [addingNote, setAddingNote] = useState(false);
  const [noteForm, setNoteForm] = useState({ texte: "", type_note: "Observation", date_max: "", customType: "" });

  const NOTE_TYPES = ["Observation", "Alerte", "Bilan", "Objectif", "Absence/Vacances", "Autre"];
  const emptyForm = { texte: "", type_note: "Observation", date_max: "", customType: "" };

  if (!clientId) {
    const pending = pendingNotes ?? [];
    return (
      <div className="space-y-3">
        <p className="text-xs text-gray-400 italic">Ces notes seront enregistrées à la création du client.</p>
        {pending.map((n, i) => (
          <div key={i} className={`rounded-xl border p-3 ${getNoteTypeStyle(n.type_note).card}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${getNoteTypeStyle(n.type_note).badge}`}>{n.type_note}</span>
                <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{n.texte}</p>
              </div>
              <button type="button" onClick={() => onPendingChange?.(pending.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500"><TrashIcon className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {addingNote ? (
          <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
            <select value={noteForm.type_note} onChange={(e) => setNoteForm((f) => ({ ...f, type_note: e.target.value, customType: "" }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
              {NOTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {noteForm.type_note === "Autre" && (
              <input type="text" placeholder="Type personnalisé..." value={noteForm.customType} onChange={(e) => setNoteForm((f) => ({ ...f, customType: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            )}
            <textarea rows={3} placeholder="Contenu de la note..." value={noteForm.texte} onChange={(e) => setNoteForm((f) => ({ ...f, texte: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none" />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setAddingNote(false); setNoteForm(emptyForm); }} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
              <button type="button" onClick={() => {
                if (!noteForm.texte.trim()) return;
                const finalType = noteForm.type_note === "Autre" && noteForm.customType.trim() ? noteForm.customType.trim() : noteForm.type_note;
                onPendingChange?.([...pending, { texte: noteForm.texte, type_note: finalType, date_max: noteForm.date_max || undefined }]);
                setNoteForm(emptyForm);
                setAddingNote(false);
              }} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">Ajouter</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAddingNote(true)} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter une note</button>
        )}
      </div>
    );
  }

  const handleAdd = async () => {
    if (!noteForm.texte.trim()) return;
    const finalType = noteForm.type_note === "Autre" && noteForm.customType.trim() ? noteForm.customType.trim() : noteForm.type_note;
    await addNote({
      ref_client: clientId,
      ...(linkedUserId ? { ref_users: doc(db, "users", linkedUserId) } : {}),
      notes: noteForm.texte,
      type_note: finalType,
      date_create: Timestamp.now(),
      date_max_note_active: noteForm.date_max ? Timestamp.fromDate(new Date(noteForm.date_max)) : null,
    } as any);
    setNoteForm(emptyForm);
    setAddingNote(false);
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
      ) : notes.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Aucune note pour ce client.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {notes.map((note) => {
            const s = getNoteTypeStyle(note.type_note);
            const expired = note.date_max_note_active ? (note.date_max_note_active as any).toDate() < new Date() : false;
            return (
              <div key={note.id} className={`rounded-xl border p-3 ${expired ? "bg-white border-gray-200" : s.card}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${expired ? "bg-gray-100 text-gray-500" : s.badge}`}>{note.type_note}</span>
                      {note.date_create && <span className="text-xs text-gray-400">{(note.date_create as any).toDate().toLocaleDateString("fr-FR")}</span>}
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.notes}</p>
                  </div>
                  <button type="button" onClick={() => deleteNote(note.id)} className="p-1 text-gray-400 hover:text-red-500 transition shrink-0"><TrashIcon className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {addingNote ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <select value={noteForm.type_note} onChange={(e) => setNoteForm((f) => ({ ...f, type_note: e.target.value, customType: "" }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
            {NOTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {noteForm.type_note === "Autre" && (
            <input type="text" placeholder="Type personnalisé..." value={noteForm.customType} onChange={(e) => setNoteForm((f) => ({ ...f, customType: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
          )}
          <textarea rows={3} placeholder="Contenu de la note..." value={noteForm.texte} onChange={(e) => setNoteForm((f) => ({ ...f, texte: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none" />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Expiration (optionnel)</label>
            <input type="date" value={noteForm.date_max} onChange={(e) => setNoteForm((f) => ({ ...f, date_max: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAddingNote(false)} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={handleAdd} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">Ajouter</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAddingNote(true)} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter une note</button>
      )}
    </div>
  );
}

// ── Tab Nav ───────────────────────────────────────────────────────────────────

type FormTab = "identite" | "sport" | "sante" | "conditions" | "notes";
const FORM_TABS: { key: FormTab; label: string }[] = [
  { key: "identite", label: "Identité" },
  { key: "sport", label: "Sport & Objectifs" },
  { key: "sante", label: "Santé" },
  { key: "conditions", label: "Conditions" },
  { key: "notes", label: "Notes & Urgence" },
];

// ── Notes panel pour abonnement ──────────────────────────────────────────────

function AboNotesPanel({ value, onChange }: { value: Array<{ texte: string; type_note: string }>; onChange: (v: Array<{ texte: string; type_note: string }>) => void }) {
  const [adding, setAdding] = useState(false);
  const [noteForm, setNoteForm] = useState({ texte: "", type_note: "Observation" });
  const NOTE_TYPES = ["Observation", "Alerte", "Bilan", "Objectif", "Absence/Vacances", "Autre"];
  return (
    <div className="space-y-3">
      {value.map((n, i) => (
        <div key={i} className={`rounded-xl border p-3 ${getNoteTypeStyle(n.type_note).card}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${getNoteTypeStyle(n.type_note).badge}`}>{n.type_note}</span>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{n.texte}</p>
            </div>
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition">
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      {adding ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <select value={noteForm.type_note} onChange={(e) => setNoteForm((f) => ({ ...f, type_note: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
            {NOTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea rows={3} placeholder="Contenu de la note..." value={noteForm.texte} onChange={(e) => setNoteForm((f) => ({ ...f, texte: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setAdding(false); setNoteForm({ texte: "", type_note: "Observation" }); }} className="flex-1 border rounded-lg py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
            <button type="button" onClick={() => { if (!noteForm.texte.trim()) return; onChange([...value, { texte: noteForm.texte, type_note: noteForm.type_note }]); setNoteForm({ texte: "", type_note: "Observation" }); setAdding(false); }} className="flex-1 bg-blue-600 text-white rounded-lg py-1.5 text-sm hover:bg-blue-700 transition">Ajouter</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition">+ Ajouter une note</button>
      )}
    </div>
  );
}

// ── Composant abonnement row ──────────────────────────────────────────────────

function aboExpiryAlert(abo: Abonnement): { label: string; cls: string } | null {
  // Seul un abonnement Actif peut être "à échéance" ou "expiré".
  // Un Prospect (ou Inactif) ne doit jamais apparaître comme expiré ni déclencher d'alerte.
  if (!abo.dateFin || abo.etat !== "Actif") return null
  const now = Date.now()
  const endMs = abo.dateFin.toMillis()
  const diffDays = Math.round((endMs - now) / 86400000)
  if (diffDays < 0) return { label: "Expiré", cls: "bg-red-100 text-red-600" }
  if (diffDays <= 7) return { label: `${diffDays}j restants`, cls: "bg-red-100 text-red-600" }
  if (diffDays <= 15) return { label: `${diffDays}j restants`, cls: "bg-orange-100 text-orange-600" }
  return null
}

function AboCard({ abo, onEdit, onDelete, onClick, displayName, isHighlighted, rdvCount }: { abo: Abonnement; onEdit: () => void; onDelete: () => void; onClick: () => void; displayName?: string; isHighlighted?: boolean; rdvCount?: number }) {
  const expiryAlert = aboExpiryAlert(abo)
  const missingFields = !abo.categorie || !abo.companyId || !abo.dateDebut || !abo.etat
  const title = displayName ?? ((abo.titre && abo.titre !== '0' && !abo.titre.endsWith('N°0')) ? abo.titre : abo.categorie)
  return (
    <div onClick={onClick} className={`bg-gray-50 border rounded-lg px-3 py-2.5 flex items-start gap-2 group cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition ${isHighlighted ? "ring-2 ring-blue-500 border-blue-400 bg-blue-50" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-medium text-sm text-gray-800 truncate">{title}</div>
          {missingFields && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-yellow-100 text-yellow-700">⚠ Incomplet</span>}
          {expiryAlert && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${expiryAlert.cls}`}>{expiryAlert.label}</span>}
        </div>
        {abo.companyNom && <div className="text-xs text-blue-600 mt-0.5">{abo.companyNom}</div>}
        {(abo.dateDebut || abo.dateFin) && (
          <div className="text-xs text-gray-400 mt-0.5">
            {abo.dateDebut ? abo.dateDebut.toDate().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            {" → "}
            {abo.dateFin ? abo.dateFin.toDate().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—"}
          </div>
        )}
        {abo.typeSuivi && <div className="text-xs text-gray-500">{abo.typeSuivi}{abo.frequence ? ` · ${abo.frequence}` : ""}</div>}
        {abo.resumeSuivi && <div className="text-xs text-gray-500 mt-0.5 italic line-clamp-2">{abo.resumeSuivi}</div>}
        {abo.tarifUnitaire != null && abo.tarifUnitaire > 0 && (
          <div className="text-xs font-semibold text-gray-700 mt-0.5">{abo.tarifUnitaire} € {abo.tarifLabel ?? ""}</div>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${ETAT_STYLE[abo.etat] ?? "bg-gray-100 text-gray-600"}`}>{abo.etat}</span>
          {rdvCount !== undefined && (
            <span className="text-xs text-gray-500">
              {abo.nbSeancesTotal ? `${rdvCount} / ${abo.nbSeancesTotal} rdv` : `${rdvCount} rdv`}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0 pt-0.5">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1 rounded hover:bg-gray-200 text-gray-500 transition" title="Modifier">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition" title="Supprimer">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
      </div>
    </div>
  );
}

function isSCOnly(abonnements: Abonnement[]) {
  // Enezo (ex « Solutions & Connect ») : companyNom migré = « Enezo » ; on garde « solutions » pour les non-migrés.
  return abonnements.length > 0 && abonnements.every((a) => {
    const n = (a.companyNom ?? "").toLowerCase().replace(/[&\s]/g, "")
    return n.includes("solutions") || n.includes("enezo")
  })
}

function ClientRow({ client, isAdmin, abonnements, aboLoading, collapseAllTick, highlightAboId, rdvCountsMap, onEdit, onDelete, onAddAbo, onEditAbo, onDeleteAbo, onViewAbo }: {
  client: Client; isAdmin: boolean;
  abonnements: Abonnement[]; aboLoading: boolean;
  collapseAllTick?: number; highlightAboId?: string;
  rdvCountsMap: Record<string, number>;
  onEdit: (sc: boolean) => void; onDelete: () => void; onAddAbo: () => void;
  onEditAbo: (a: Abonnement) => void; onDeleteAbo: (id: string) => void;
  onViewAbo: (a: Abonnement, linkedUserId: string | undefined) => void;
}) {
  const router = useRouter();
  const { brand } = useBrand();
  const [open, setOpen] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (collapseAllTick) setOpen(false);
  }, [collapseAllTick]);

  useEffect(() => {
    if (highlightAboId) setOpen(true);
  }, [highlightAboId]);

  useEffect(() => {
    if (open && highlightAboId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [open, highlightAboId]);
  const loading = aboLoading;
  const initials = ((client.prenom?.[0] ?? "") + (client.nom?.[0] ?? "")).toUpperCase() || "?";

  const aboNumbers = useMemo(() => {
    const catCounters: Record<string, number> = {};
    const result: Record<string, number> = {};
    [...abonnements]
      .sort((a, b) => (a.dateDebut?.toMillis?.() ?? 0) - (b.dateDebut?.toMillis?.() ?? 0))
      .forEach((a) => {
        catCounters[a.categorie] = (catCounters[a.categorie] ?? 0) + 1;
        result[a.id] = catCounters[a.categorie];
      });
    return result;
  }, [abonnements]);

  const actifCount = abonnements.filter((a) => a.etat === "Actif").length;
  const inactifCount = abonnements.filter((a) => a.etat === "Inactif").length;
  const prospectCount = abonnements.filter((a) => a.etat === "Prospect").length;
  const hasIncomplete = abonnements.some((a) => !a.categorie || !a.companyId || !a.dateDebut || !a.etat);

  return (
    <div className="border-b last:border-0">
      <div className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition cursor-pointer" onClick={() => setOpen((o) => !o)}>
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-sm shrink-0 mt-0.5">{initials}</div>

        {/* Contenu central */}
        <div className="flex-1 min-w-0">
          {/* Ligne 1 : nom + badges statut/actif */}
          <div className="flex items-center flex-wrap gap-1.5 leading-tight">
            <span className="font-medium text-sm text-gray-900 mr-0.5">{client.nom} {client.prenom}</span>
            {client.statut && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium leading-none ${STATUT_STYLE[client.statut] ?? "bg-gray-100 text-gray-500"}`}>{client.statut}</span>
            )}
            {!client.actif && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium leading-none">Inactif</span>
            )}
          </div>

          {/* Ligne 2 : sport / profession */}
          {client.sportPratique && (
            <div className="text-xs text-gray-400 mt-0.5 truncate">{client.sportPratique}{client.niveauSportif ? ` · ${client.niveauSportif}` : ""}{client.distanceKm ? ` · ${client.distanceKm} km` : ""}</div>
          )}

          {/* Ligne 3 : abonnements + liens rapides */}
          <div className="flex items-center flex-wrap gap-1.5 mt-1">
            {!loading && actifCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium leading-none">{actifCount} actif{actifCount > 1 ? "s" : ""}</span>}
            {!loading && inactifCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium leading-none">{inactifCount} inactif{inactifCount > 1 ? "s" : ""}</span>}
            {!loading && prospectCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium leading-none">{prospectCount} prospect{prospectCount > 1 ? "s" : ""}</span>}
            {!loading && hasIncomplete && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium leading-none">⚠ Incomplet</span>}
            {client.email && (
              <a href={`mailto:${client.email}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition leading-none">
                <EnvelopeIcon className="w-3 h-3 shrink-0" />Mail
              </a>
            )}
            {client.telephone && (
              <>
                <a href={`tel:${client.telephone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-green-200 text-green-700 hover:bg-green-50 transition leading-none">
                  <PhoneIcon className="w-3 h-3 shrink-0" />Tel
                </a>
                <a href={`sms:${client.telephone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 transition leading-none">
                  <ChatBubbleLeftEllipsisIcon className="w-3 h-3 shrink-0" />SMS
                </a>
              </>
            )}
          </div>
        </div>

        {/* Actions droite : icônes uniquement + chevron */}
        <div className="flex items-center gap-1 shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
          {isAdmin && (
            <>
              {(client as any).linkedUserId && (
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(`/clients/${(client as any).linkedUserId}/stats`) }}
                  className="p-1.5 rounded-lg hover:bg-purple-50 text-purple-500 transition"
                  title="Évolution"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); onEdit(isSCOnly(abonnements)); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition" title="Modifier">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition" title="Supprimer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </>
          )}
          <div className="p-1.5 pointer-events-none">
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
      </div>
      {open && (
        <div className="px-5 pb-4 ml-14 space-y-4">
          {/* Envoyer l'accès app */}
          {isAdmin && (client.email || client.telephone) && (() => {
            // Lien envoyé au client → domaine de l'ESPACE ACTIF (cf. publicLinkOrigin), jamais
            // le domaine de navigation (une PWA installée sur app.enezo.fr donnerait un lien Enezo).
            const appUrl = publicLinkOrigin(brand, typeof window !== "undefined" ? window.location.origin : "");
            const appNom = brand === "enezo" ? "Enezo" : "TC Connect";
            const msg = encodeURIComponent(`Bonjour ${client.prenom || client.nom}, voici votre accès à l'application ${appNom} : ${appUrl}\nConnectez-vous avec votre adresse email${client.email ? ` : ${client.email}` : ""}.`);
            return (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Envoyer l'accès app</p>
                <div className="flex flex-wrap gap-2">
                  {client.email && (
                    <a href={`mailto:${client.email}?subject=${encodeURIComponent(`Votre accès ${appNom}`)}&body=${msg}`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition">
                      <EnvelopeIcon className="w-3.5 h-3.5" /> Email
                    </a>
                  )}
                  {client.telephone && (
                    <>
                      <a href={`sms:${client.telephone}?body=${msg}`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition">
                        <ChatBubbleLeftEllipsisIcon className="w-3.5 h-3.5" /> SMS
                      </a>
                      <a href={buildWhatsAppUrl((client as any).indicatif_tel || '+33', client.telephone, msg)}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        WhatsApp
                      </a>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Abonnements</p>
            {loading ? (
              <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}</div>
            ) : (
              <div className="space-y-2">
                {abonnements.length === 0 && (
                  <p className="text-xs text-gray-400 italic">Aucun abonnement enregistré</p>
                )}
                {[...abonnements].sort((a, b) => (a.dateDebut?.toMillis?.() ?? 0) - (b.dateDebut?.toMillis?.() ?? 0)).map((a) => (
                  <div key={a.id} ref={highlightAboId === a.id ? highlightRef : null}>
                    <AboCard abo={a}
                      displayName={aboNumbers[a.id] ? `${a.categorie} - N°${aboNumbers[a.id]}` : a.categorie}
                      rdvCount={rdvCountsMap[`${client.id}_${a.id}`]}
                      onClick={() => onViewAbo(a, client.linkedUserId)}
                      onEdit={() => onEditAbo(a)}
                      onDelete={() => onDeleteAbo(a.id)}
                      isHighlighted={highlightAboId === a.id}
                    />
                  </div>
                ))}
                {isAdmin && (
                  <button onClick={onAddAbo}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 border-2 border-dashed border-blue-200 text-blue-600 hover:border-blue-400 hover:bg-blue-50 rounded-xl text-sm font-medium transition">
                    <PlusIcon className="w-4 h-4" />
                    Nouvel abonnement
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const router = useRouter();
  const { currentUser, userProfile } = useAuth();
  const { clients, loading } = useClients();
  const { companies } = useCompanies();
  const isAdmin = userProfile?.role_app === "Admin";

  useEffect(() => {
    if (userProfile && !isAdmin) router.replace("/accueil");
  }, [userProfile, isAdmin, router]);

  const [allAbosMap, setAllAbosMap] = useState<Record<string, Abonnement[]>>({});
  const [allAbosLoaded, setAllAbosLoaded] = useState(false);
  const [expiringAbos, setExpiringAbos] = useState<Abonnement[]>([]);
  const [rdvCountsMap, setRdvCountsMap] = useState<Record<string, number>>({});
  const sessionsDoneNotifRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUser || !isAdmin) return;
    const unsub = listenAbonnements(currentUser.uid, (abos) => {
      const map: Record<string, Abonnement[]> = {};
      for (const a of abos) {
        if (!map[a.clientId]) map[a.clientId] = [];
        map[a.clientId].push(a);
      }
      setAllAbosMap(map);
      setAllAbosLoaded(true);

      const in30 = Date.now() + 15 * 86400000;
      const expiring = abos.filter((a) =>
        a.etat === "Actif" && a.dateFin && (a.dateFin as any).toMillis() <= in30
      );
      setExpiringAbos(expiring);
      // La notification push "Abonnements à renouveler" est envoyée (et dédupliquée) depuis
      // le layout du dashboard, avec la même exclusion des clients supprimés/désactivés.
    });
    return unsub;
  }, [currentUser]);

  // Charger le nb de rdv effectués pour tous les abos
  useEffect(() => {
    if (!allAbosLoaded || clients.length === 0) return;
    let cancelled = false;
    async function loadCounts() {
      const counts: Record<string, number> = {};
      for (const client of clients) {
        const linkedUserId = (client as any).linkedUserId as string | undefined;
        if (!linkedUserId) continue;
        const clientAbos = allAbosMap[client.id] ?? [];
        if (clientAbos.length === 0) continue;
        try {
          const userRef = doc(db, "users", linkedUserId);
          const [s1, s2] = await Promise.all([
            getDocs(query(collection(db, "planning_pro"), where("ref_users", "==", userRef))).catch(() => ({ docs: [] as any[] })),
            getDocs(query(collection(db, "planning_pro"), where("ref_client", "==", userRef))).catch(() => ({ docs: [] as any[] })),
          ]);
          const seen = new Set<string>();
          const plannings = [...s1.docs, ...s2.docs]
            .filter((d) => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
            .map((d) => d.data() as any);
          for (const abo of clientAbos) {
            const startMs = abo.dateDebut ? (abo.dateDebut as any).toMillis() : 0;
            const endMs = abo.dateFin ? (abo.dateFin as any).toMillis() : Date.now();
            counts[`${client.id}_${abo.id}`] = plannings.filter((p) => {
              const ms = (p.date_planning?.seconds ?? p.heure_planning_debut?.seconds ?? 0) * 1000;
              if (!ms) return false;
              return ms >= startMs && ms <= endMs;
            }).length;
          }
        } catch {}
      }
      if (!cancelled) setRdvCountsMap(counts);
    }
    loadCounts();
    return () => { cancelled = true; };
  }, [allAbosLoaded, allAbosMap, clients]);

  // Ajouter dans expiringAbos les abos dont toutes les séances sont faites + notif admin
  useEffect(() => {
    if (!currentUser || Object.keys(rdvCountsMap).length === 0) return;
    const sessionDone = Object.values(allAbosMap).flat().filter((a) => {
      if (a.etat !== "Actif" || !a.nbSeancesTotal) return false;
      const count = rdvCountsMap[`${a.clientId}_${a.id}`];
      return count !== undefined && count >= a.nbSeancesTotal;
    });
    if (sessionDone.length === 0) return;

    setExpiringAbos((prev) => {
      const existingIds = new Set(prev.map((a) => a.id));
      const newOnes = sessionDone.filter((a) => !existingIds.has(a.id));
      return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
    });

    for (const abo of sessionDone) {
      if ((abo as any).sansRappelRenouvellement) continue; // push coupé pour cet abo (reste dans le bandeau)
      if (sessionsDoneNotifRef.current.has(abo.id)) continue;
      sessionsDoneNotifRef.current.add(abo.id);
      const storageKey = `tc_sessions_done_${abo.id}`;
      if (localStorage.getItem(storageKey)) continue;
      const client = clients.find((c) => c.id === abo.clientId);
      const clientName = client ? [client.nom, client.prenom].filter(Boolean).join(" ") : "Client";
      fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.uid,
          persist: true,
          type: "SEANCES",
          title: "Toutes les séances effectuées",
          body: `${clientName} — ${abo.categorie} : ${abo.nbSeancesTotal} séances réalisées. Renouvellement à prévoir.`,
          url: "/clients",
          dedupeKey: `sessions_done_${abo.id}`,
        }),
      }).catch(() => {});
      localStorage.setItem(storageKey, "1");
    }
  }, [rdvCountsMap, allAbosMap, clients, currentUser]);

  // Exclure les clients inactifs (actif === false) et les abos orphelins (client supprimé) du bilan "à renouveler"
  const filteredExpiringAbos = useMemo(() =>
    expiringAbos.filter((a) => { const cl = clients.find((c) => c.id === a.clientId); return cl != null && cl.actif !== false; }),
    [expiringAbos, clients]
  );

  const [showBannerDetail, setShowBannerDetail] = useState(false);
  const [search, setSearch] = useState("");
  const [filterActif, setFilterActif] = useState<"all" | "actif" | "inactif">("all");
  const [view, setView] = useState<"liste" | "pipeline">("liste");
  const [filterAbo, setFilterAbo] = useState<"incomplet" | "a-renouveler" | "sans-abo" | "abo-actif" | "prospect" | null>(null);
  const [filterCategorie, setFilterCategorie] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterTypeSuivi, setFilterTypeSuivi] = useState("");

  const allTypeSuivi = useMemo(() => {
    const set = new Set<string>();
    for (const abos of Object.values(allAbosMap)) {
      for (const a of abos) { if (a.typeSuivi) set.add(a.typeSuivi); }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [allAbosMap]);

  const visible = clients.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (c.nom ?? "").toLowerCase().includes(q) || (c.prenom ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
    const matchActif = filterActif === "all" || (filterActif === "actif" ? c.actif : !c.actif);
    if (!matchSearch || !matchActif) return false;
    if (allAbosLoaded) {
      const abos = allAbosMap[c.id] ?? [];
      const now = Date.now();
      const in30 = now + 15 * 86400000;
      if (filterAbo) {
        if (filterAbo === "incomplet" && !abos.some((a) => !a.categorie || !a.companyId || !a.dateDebut || !a.etat)) return false;
        if (filterAbo === "a-renouveler") {
          const hasExpiring = abos.some((a) => a.etat === "Actif" && a.dateFin && (a.dateFin as any).toMillis() <= in30);
          const hasAllDone = abos.some((a) => {
            if (a.etat !== "Actif" || !a.nbSeancesTotal) return false;
            const count = rdvCountsMap[`${c.id}_${a.id}`];
            return count !== undefined && count >= a.nbSeancesTotal;
          });
          if (!hasExpiring && !hasAllDone) return false;
        }
        if (filterAbo === "sans-abo" && abos.length !== 0) return false;
        if (filterAbo === "abo-actif" && !abos.some((a) => a.etat === "Actif")) return false;
        if (filterAbo === "prospect" && !abos.some((a) => a.etat === "Prospect")) return false;
      }
      if (filterCategorie && !abos.some((a) => a.categorie === filterCategorie)) return false;
      if (filterCompanyId && !abos.some((a) => a.companyId === filterCompanyId)) return false;
      if (filterTypeSuivi && !abos.some((a) => a.typeSuivi === filterTypeSuivi)) return false;
    }
    return true;
  });

  // ── Modal client ──────────────────────────────────────────
  const [clientModal, setClientModal] = useState<{ open: boolean; editing: Client | null; isSC: boolean }>({ open: false, editing: null, isSC: false });
  const [confirmDeleteClient, setConfirmDeleteClient] = useState<string | null>(null);

  // ── Modal abonnement ──────────────────────────────────────
  const [collapseAllTick, setCollapseAllTick] = useState(0);
  const [highlightAbo, setHighlightAbo] = useState<{ clientId: string; aboId: string } | null>(null);
  const [aboModal, setAboModal] = useState<{ open: boolean; clientId: string; editing: Abonnement | null }>({ open: false, clientId: "", editing: null });
  const [aboForm, setAboForm] = useState<AboForm>(EMPTY_ABO);
  const [aboSaving, setAboSaving] = useState(false);
  const [aboError, setAboError] = useState("");
  const [confirmDeleteAbo, setConfirmDeleteAbo] = useState<string | null>(null);
  const [aboDetail, setAboDetail] = useState<{ abo: Abonnement; linkedUserId: string | null } | null>(null);

  useEffect(() => {
    if (!highlightAbo) return;
    const t = setTimeout(() => setHighlightAbo(null), 3500);
    return () => clearTimeout(t);
  }, [highlightAbo]);

  const openAddAbo = (clientId: string, clientObjectifs?: Objectif[]) => {
    const defaultCo = companies.find((c) => c.nom.toLowerCase().includes("teddy")) ?? companies[0];
    setAboForm({ ...EMPTY_ABO, companyId: defaultCo?.id ?? "", objectifs: clientObjectifs ?? [] });
    setAboError("");
    setAboModal({ open: true, clientId, editing: null });
  };
  const openEditAbo = (a: Abonnement) => {
    setAboForm({
      categorie: a.categorie, companyId: a.companyId ?? "",
      typeSuivi: a.typeSuivi ?? "",
      dateDebut: toDateInput(a.dateDebut ?? null), dateFin: toDateInput(a.dateFin ?? null),
      etat: (["Prospect", "Actif", "Inactif"].includes(a.etat) ? a.etat : "Actif") as AbonnementEtat,
      objectifs: Array.isArray(a.objectifs) ? a.objectifs : [],
      resumeSuivi: a.resumeSuivi ?? "",
      indications: a.indications ?? "",
      notesInternes: Array.isArray((a as any).notesInternes) ? (a as any).notesInternes : [],
      arretSuivi: (a as any).arretSuivi ?? "",
    });
    setAboError(""); setAboModal({ open: true, clientId: a.clientId, editing: a });
  };

  const setA = (f: keyof Pick<AboForm, "categorie" | "companyId" | "typeSuivi" | "dateDebut" | "dateFin" | "etat" | "resumeSuivi" | "indications">) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setAboForm((p) => ({ ...p, [f]: e.target.value }));

  const submitAbo = async () => {
    if (!aboForm.categorie.trim()) return setAboError("La catégorie est requise.");
    setAboSaving(true);
    try {
      const company = companies.find((c) => c.id === aboForm.companyId);
      const base = {
        userId: currentUser!.uid, clientId: aboModal.clientId,
        companyId: aboForm.companyId || undefined, companyNom: company?.nom || undefined,
        categorie: aboForm.categorie,
        typeSuivi: aboForm.typeSuivi || undefined,
        dateDebut: fromDateInput(aboForm.dateDebut), dateFin: fromDateInput(aboForm.dateFin),
        etat: aboForm.etat,
        objectifs: aboForm.objectifs.length ? aboForm.objectifs : undefined,
        resumeSuivi: aboForm.resumeSuivi || undefined,
        indications: aboForm.indications || undefined,
        notesInternes: aboForm.notesInternes.length ? aboForm.notesInternes : undefined,
        arretSuivi: aboForm.arretSuivi || undefined,
      };
      if (aboModal.editing) {
        await updateAbonnement(aboModal.editing.id, base);
      } else {
        await createAbonnement(base as Omit<Abonnement, "id" | "createdAt" | "updatedAt">);
      }

      // Synchroniser résumé + arret_suivi dans database_users_details si le client a un compte lié
      const linkedClient = clients.find((c) => c.id === aboModal.clientId);
      const linkedUserId = (linkedClient as any)?.linkedUserId as string | undefined;
      if (linkedUserId && (aboForm.arretSuivi || aboForm.resumeSuivi)) {
        const snap = await getDocs(
          query(collection(db, "database_users_details"), where("refUsers", "==", doc(db, "users", linkedUserId)))
        );
        const updates: Record<string, any> = {};
        if (aboForm.arretSuivi) updates.arret_suivi = aboForm.arretSuivi;
        if (aboForm.resumeSuivi) updates.resume_suivi = aboForm.resumeSuivi;
        await Promise.all(snap.docs.map((d) => updateDoc(doc(db, "database_users_details", d.id), updates)));
      }

      setAboModal({ open: false, clientId: "", editing: null });
    } catch { setAboError("Erreur lors de l'enregistrement."); }
    finally { setAboSaving(false); }
  };


  if (!userProfile || !isAdmin) return null;

  // Déplace un prospect dans le pipeline (drag ou select). Le statut suit l'étape :
  // « Signé » → Actif, « Perdu » → Inactif, autres étapes → Prospect.
  const movePipeline = async (client: Client, stage: PipelineStage) => {
    const statut = stage === "signe" ? "Actif" : stage === "perdu" ? "Inactif" : "Prospect";
    try {
      await updateClient(client.id, { pipelineStage: stage, statut, pipelineUpdatedAt: Timestamp.now() });
    } catch (e) { console.error("[pipeline move]", e); }
  };

  return (
    <div className="min-h-screen">
      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{clients.length} client{clients.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-white overflow-hidden">
            {(["liste", "pipeline"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-2 text-sm font-medium transition ${view === v ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                {v === "liste" ? "Liste" : "Pipeline"}
              </button>
            ))}
          </div>
          <button onClick={() => setClientModal({ open: true, editing: null, isSC: false })} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">
            + Nouveau client
          </button>
        </div>
      </div>

      {/* FILTRES */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 sm:max-w-xs">
            <input type="text" placeholder="Rechercher par nom, prénom ou email..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 pr-8 text-sm outline-none focus:border-blue-400 transition bg-white" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {(["all", "actif", "inactif"] as const).map((f) => (
              <button key={f} onClick={() => setFilterActif(f)} className={`px-3 py-2 rounded-lg text-xs font-medium transition ${filterActif === f ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"}`}>
                {f === "all" ? "Tous" : f === "actif" ? "Actifs" : "Inactifs"}
              </button>
            ))}
          </div>
        </div>
        {view === "liste" && (<>
        <div className="flex gap-1.5 flex-wrap items-center">
          {([
            { key: "abo-actif",    label: "Abo actif",        on: "bg-green-600 text-white",  off: "bg-white border text-gray-600 hover:bg-gray-50" },
            { key: "prospect",     label: "Prospect",         on: "bg-purple-600 text-white", off: "bg-white border text-gray-600 hover:bg-gray-50" },
            { key: "a-renouveler", label: "À renouveler",     on: "bg-orange-500 text-white", off: "bg-white border text-gray-600 hover:bg-gray-50" },
            { key: "incomplet",    label: "⚠ Incomplet",      on: "bg-yellow-500 text-white", off: "bg-white border text-gray-600 hover:bg-gray-50" },
            { key: "sans-abo",     label: "Sans abonnement",  on: "bg-gray-700 text-white",   off: "bg-white border text-gray-600 hover:bg-gray-50" },
          ] as const).map(({ key, label, on, off }) => (
            <button key={key} onClick={() => setFilterAbo((f) => f === key ? null : key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterAbo === key ? on : off}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={filterCategorie} onChange={(e) => setFilterCategorie(e.target.value)}
            className={`border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 transition bg-white ${filterCategorie ? "border-blue-400 text-blue-700 font-medium" : "text-gray-600"}`}>
            <option value="">Toutes catégories</option>
            {CATEGORIES_ABO.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterCompanyId} onChange={(e) => setFilterCompanyId(e.target.value)}
            className={`border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 transition bg-white ${filterCompanyId ? "border-blue-400 text-blue-700 font-medium" : "text-gray-600"}`}>
            <option value="">Toutes sociétés</option>
            {companies.map((co) => <option key={co.id} value={co.id}>{co.nom}</option>)}
          </select>
          {allTypeSuivi.length > 0 && (
            <select value={filterTypeSuivi} onChange={(e) => setFilterTypeSuivi(e.target.value)}
              className={`border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 transition bg-white max-w-[200px] ${filterTypeSuivi ? "border-blue-400 text-blue-700 font-medium" : "text-gray-600"}`}>
              <option value="">Tous types de suivi</option>
              {allTypeSuivi.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {(filterCategorie || filterCompanyId || filterTypeSuivi) && (
            <button onClick={() => { setFilterCategorie(""); setFilterCompanyId(""); setFilterTypeSuivi(""); }}
              className="text-xs text-gray-400 hover:text-red-500 transition underline">
              Réinitialiser
            </button>
          )}
        </div>
        </>)}
      </div>

      {/* ALERTE ABONNEMENTS EXPIRANT */}
      {view === "liste" && filteredExpiringAbos.length > 0 && (() => {
        const now = Date.now();
        const overdue = filteredExpiringAbos.filter((a) => (a.dateFin as any).toMillis() < now);
        const soon = filteredExpiringAbos.filter((a) => (a.dateFin as any).toMillis() >= now);
        const parts = [
          overdue.length ? `${overdue.length} expiré${overdue.length > 1 ? "s" : ""}` : "",
          soon.length ? `${soon.length} expire${soon.length > 1 ? "nt" : ""} sous 15 j` : "",
        ].filter(Boolean);
        const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
        return (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-orange-500 text-lg shrink-0">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-orange-800">Abonnements à renouveler</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-xs text-orange-600">{parts.join(" · ")}</p>
                  <button onClick={() => setShowBannerDetail((d) => !d)} className="text-xs text-orange-700 underline hover:text-orange-900 transition">
                    {showBannerDetail ? "Masquer" : "Voir le détail"}
                  </button>
                </div>
              </div>
              <button onClick={() => { setExpiringAbos([]); setShowBannerDetail(false); }} className="text-orange-400 hover:text-orange-600 shrink-0 text-xs">✕</button>
            </div>
            {showBannerDetail && (
              <div className="mt-3 pl-7 space-y-1 max-h-52 overflow-y-auto">
                {[...filteredExpiringAbos]
                  .sort((a, b) => (a.dateFin as any).toMillis() - (b.dateFin as any).toMillis())
                  .map((a) => {
                    const c = clientMap[a.clientId];
                    const clientName = c ? ([c.nom, c.prenom].filter(Boolean).join(' ') || 'Client inconnu') : 'Client inconnu';
                    const daysLeft = Math.round(((a.dateFin as any).toMillis() - now) / 86400000);
                    const tag = daysLeft < 0
                      ? { label: `expiré depuis ${-daysLeft}j`, cls: "text-red-600" }
                      : { label: `${daysLeft}j restants`, cls: "text-orange-600" };
                    return (
                      <div key={a.id}
                        onClick={() => { setHighlightAbo({ clientId: a.clientId, aboId: a.id }); setShowBannerDetail(false); }}
                        className="flex items-center gap-2 text-xs py-1 px-2 -mx-2 rounded-lg cursor-pointer hover:bg-orange-100 transition">
                        <span className="font-medium text-gray-800 min-w-[120px]">{clientName}</span>
                        <span className="text-gray-500">{a.categorie}</span>
                        <span className={`ml-auto shrink-0 font-medium ${tag.cls}`}>{tag.label}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })()}

      {/* PIPELINE (Kanban des prospects) */}
      {view === "pipeline" && (
        <PipelineBoard
          clients={clients}
          search={search}
          onOpen={(c) => setClientModal({ open: true, editing: c, isSC: false })}
          onMove={movePipeline}
        />
      )}

      {/* LISTE */}
      {view === "liste" && (<>
      <div className="flex justify-end mb-1.5">
        <button onClick={() => setCollapseAllTick((t) => t + 1)} className="text-xs text-gray-400 hover:text-gray-600 transition underline">
          Tout réduire
        </button>
      </div>
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-4 flex gap-4 animate-pulse border-b">
            <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
            <div className="flex-1 space-y-2 py-0.5"><div className="h-4 bg-gray-100 rounded w-1/3" /><div className="h-3 bg-gray-100 rounded w-1/4" /></div>
          </div>
        ))}
        {!loading && visible.length === 0 && (
          <div className="py-14 text-center"><p className="text-gray-400 text-sm">{clients.length === 0 ? "Aucun client" : "Aucun résultat"}</p></div>
        )}
        {!loading && visible.map((c) => (
          <ClientRow key={c.id} client={c} isAdmin={isAdmin}
            abonnements={allAbosMap[c.id] ?? []}
            aboLoading={!allAbosLoaded}
            collapseAllTick={collapseAllTick}
            highlightAboId={highlightAbo?.clientId === c.id ? highlightAbo.aboId : undefined}
            rdvCountsMap={rdvCountsMap}
            onEdit={(sc) => setClientModal({ open: true, editing: c, isSC: sc })}
            onDelete={() => setConfirmDeleteClient(c.id)}
            onAddAbo={() => openAddAbo(c.id, c.objectifs ?? [])}
            onEditAbo={(a) => openEditAbo(a)}
            onDeleteAbo={(id) => setConfirmDeleteAbo(id)}
            onViewAbo={(a, linkedId) => setAboDetail({ abo: a, linkedUserId: linkedId ?? null })}
          />
        ))}
      </div>
      </>)}

      <ClientEditModal
        client={clientModal.editing}
        isOpen={clientModal.open}
        isSC={clientModal.isSC}
        onClose={() => setClientModal({ open: false, editing: null, isSC: false })}
      />

      {/* ── MODAL ABONNEMENT ──────────────────────────────── */}
      <AbonnementModal
        isOpen={aboModal.open}
        onClose={() => setAboModal({ open: false, clientId: "", editing: null })}
        onSaved={(id, etat, arretSuivi, resumeSuivi) => {
          setHighlightAbo({ clientId: aboModal.clientId, aboId: id });
          setAboModal({ open: false, clientId: "", editing: null });
          // Sync arret_suivi + resume_suivi vers database_users_details
          const linkedClient = clients.find((c) => c.id === aboModal.clientId);
          const linkedUserId = (linkedClient as any)?.linkedUserId as string | undefined;
          if (linkedUserId) {
            getDocs(query(collection(db, "database_users_details"), where("refUsers", "==", doc(db, "users", linkedUserId))))
              .then((snap) => {
                snap.docs.forEach((d) => {
                  const updates: Record<string, any> = {};
                  if (arretSuivi !== undefined) updates.arret_suivi = arretSuivi;
                  if (resumeSuivi !== undefined) updates.resume_suivi = resumeSuivi;
                  if (Object.keys(updates).length > 0) {
                    updateDoc(doc(db, "database_users_details", d.id), updates).catch(() => {});
                  }
                });
              })
              .catch(() => {});
          }
        }}
        clientId={aboModal.clientId}
        userId={currentUser!.uid}
        editing={aboModal.editing}
        defaultObjectifs={clients.find((c) => c.id === aboModal.clientId)?.objectifs}
      />

      {/* ── MODAL DÉTAIL ABONNEMENT ───────────────────────── */}
      {aboDetail && (
        <AboDetailModal
          abo={aboDetail.abo}
          linkedUserId={aboDetail.linkedUserId}
          clientAddress={(() => { const c = clients.find((cl) => cl.id === aboDetail.abo.clientId); return [c?.adresse, c?.codePostal, c?.ville].filter(Boolean).join(', '); })()}
          onClose={() => setAboDetail(null)}
          onEdit={() => { openEditAbo(aboDetail.abo); setAboDetail(null); }}
          onDelete={() => { setConfirmDeleteAbo(aboDetail.abo.id); setAboDetail(null); }}
        />
      )}

      {/* Confirm delete client */}
      {confirmDeleteClient && (
        <Modal title="Supprimer ce client ?" onClose={() => setConfirmDeleteClient(null)}>
          <p className="text-sm text-gray-600 mb-5">Cette action supprimera le client mais pas ses factures existantes.</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDeleteClient(null)} className="flex-1 border rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition">Annuler</button>
            <button onClick={async () => { await deleteClient(confirmDeleteClient); setConfirmDeleteClient(null); }} className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-red-700 transition">Supprimer</button>
          </div>
        </Modal>
      )}

      {/* Confirm delete abonnement */}
      {confirmDeleteAbo && (
        <Modal title="Supprimer cet abonnement ?" onClose={() => setConfirmDeleteAbo(null)}>
          <p className="text-sm text-gray-600 mb-5">Cette action est irréversible.</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDeleteAbo(null)} className="flex-1 border rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition">Annuler</button>
            <button onClick={async () => { await deleteAbonnement(confirmDeleteAbo); setConfirmDeleteAbo(null); }} className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-red-700 transition">Supprimer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">{msg}</div>;
}

function ModalActions({ onCancel, onSubmit, saving, label }: { onCancel: () => void; onSubmit: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex gap-3 pt-4 border-t border-gray-100 mt-4">
      <button onClick={onCancel} className="flex-1 border rounded-lg py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Annuler</button>
      <button onClick={onSubmit} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-semibold transition">
        {saving ? "Enregistrement..." : label}
      </button>
    </div>
  );
}

const EMPTY_RDV_FORM = {
  date: '', heure_debut: '', heure_fin: '',
  type_planning: 'Séance', mode_rdv: 'Présentiel',
  adresse_rdv: '', etat_planning_rdv: 'Non calé',
  observations_rdv: '', materiel: [...MATERIEL_DEFAUT_CLIENTS],
  abonnement_id: '',
};

function AboDetailModal({ abo, linkedUserId, clientAddress, onClose, onEdit, onDelete }: {
  abo: Abonnement; linkedUserId: string | null; clientAddress: string;
  onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { currentUser } = useAuth();
  const [rdvs, setRdvs] = useState<any[]>([]);
  const [loadingRdvs, setLoadingRdvs] = useState(false);
  const [rdvForm, setRdvForm] = useState<typeof EMPTY_RDV_FORM | null>(null); // null = liste, object = form
  const [editingRdvId, setEditingRdvId] = useState<string | null>(null);
  const [savingRdv, setSavingRdv] = useState(false);
  const { abonnements: clientAbos } = useAbonnementsByClientId(abo.clientId);

  const loadRdvs = async () => {
    if (!linkedUserId) { setRdvs([]); return; }
    setLoadingRdvs(true);
    try {
      // ref_users peut être stocké comme référence Firestore OU comme chaîne — on interroge les deux
      const userRef = doc(db, "users", linkedUserId);
      const [snapRef, snapStr] = await Promise.all([
        getDocs(query(collection(db, "planning_pro"), where("ref_users", "==", userRef))),
        getDocs(query(collection(db, "planning_pro"), where("ref_users", "==", linkedUserId))).catch(() => ({ docs: [] as any[] })),
      ]);
      const seen = new Set<string>();
      const all = [...snapRef.docs, ...snapStr.docs]
        .filter((d) => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
        .map((d) => ({ id: d.id, ...d.data() as any }));
      const sod = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() };
      const eod = (ms: number) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime() };
      const startMs = abo.dateDebut?.toMillis ? sod(abo.dateDebut.toMillis()) : 0;
      const endMs = abo.dateFin?.toMillis ? eod(abo.dateFin.toMillis()) : Infinity;
      setRdvs(
        all
          // Inclure si lié explicitement à cet abonnement OU si dans la période de l'abonnement (comparaison par jour)
          .filter((r) => {
            if (r.abonnementId === abo.id) return true;
            const ms = r.date_planning?.toMillis ? sod(r.date_planning.toMillis()) : 0;
            return ms >= startMs && ms <= endMs;
          })
          .sort((a, b) => (a.date_planning?.toMillis?.() ?? 0) - (b.date_planning?.toMillis?.() ?? 0))
      );
    } catch (e) { console.error(e); }
    finally { setLoadingRdvs(false); }
  };

  useEffect(() => { loadRdvs(); }, [linkedUserId, abo.id]);

  const fmtDate = (ts: any) => ts?.toDate?.()?.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) ?? "—";
  const fmtTime = (ts: any) => { const d = ts?.toDate?.(); return d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : ""; };
  const ETAT_RDV: Record<string, string> = {
    "Effectué": "bg-blue-100 text-blue-700", "Calé": "bg-green-100 text-green-700",
    "Non calé": "bg-orange-100 text-orange-700", "Annulé": "bg-red-100 text-red-600",
  };

  const addMinutesToTime = (time: string, minutes: number): string => {
    if (!time) return time;
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  const openCreate = () => {
    const d = new Date();
    const now = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    setRdvForm({
      ...EMPTY_RDV_FORM,
      date: toDateInputStr(d),
      heure_debut: now,
      heure_fin: addMinutesToTime(now, 60),
      adresse_rdv: clientAddress,
      abonnement_id: abo.id,
    });
    setEditingRdvId(null);
  };

  const openEdit = (rdv: any) => {
    const date = rdv.date_planning?.toDate?.();
    const debut = rdv.heure_planning_debut?.toDate?.();
    const fin = rdv.heure_planning_fin?.toDate?.();
    // Si pas d'abonnementId, essayer de trouver l'abonnement actif à la date du RDV
    let abonnementId = rdv.abonnementId || '';
    if (!abonnementId && rdv.date_planning) {
      const rdvMs = rdv.date_planning.toMillis?.() ?? 0;
      const match = clientAbos.find((a) => {
        const start = a.dateDebut?.toMillis?.() ?? 0;
        const end = a.dateFin?.toMillis?.() ?? Infinity;
        return rdvMs >= start && rdvMs <= end;
      });
      if (match) abonnementId = match.id;
    }
    setRdvForm({
      date: date ? toDateInputStr(date) : '',
      heure_debut: debut ? `${String(debut.getHours()).padStart(2,'0')}:${String(debut.getMinutes()).padStart(2,'0')}` : '',
      heure_fin: fin ? `${String(fin.getHours()).padStart(2,'0')}:${String(fin.getMinutes()).padStart(2,'0')}` : '',
      type_planning: rdv.type_planning || 'Séance',
      mode_rdv: rdv.mode_rdv || 'Présentiel',
      adresse_rdv: rdv.adresse_rdv || '',
      etat_planning_rdv: rdv.etat_planning_rdv || 'Non calé',
      observations_rdv: rdv.observations_rdv || '',
      materiel: Array.isArray(rdv.materiel) ? rdv.materiel : rdv.materiel ? [rdv.materiel] : [...MATERIEL_DEFAUT_CLIENTS],
      abonnement_id: abonnementId,
    });
    setEditingRdvId(rdv.id);
  };

  const saveRdv = async () => {
    if (!rdvForm || !currentUser || !linkedUserId) return;
    setSavingRdv(true);
    try {
      const [y, m, d] = rdvForm.date.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const [hD, mD] = (rdvForm.heure_debut || '09:00').split(':').map(Number);
      const [hF, mF] = (rdvForm.heure_fin || '10:00').split(':').map(Number);
      const dateDebut = new Date(dateObj); dateDebut.setHours(hD, mD, 0);
      const dateFin = new Date(dateObj); dateFin.setHours(hF, mF, 0);
      const userRef = doc(db, 'users', linkedUserId);
      const payload: any = {
        date_planning: Timestamp.fromDate(dateObj),
        heure_planning_debut: Timestamp.fromDate(dateDebut),
        heure_planning_fin: Timestamp.fromDate(dateFin),
        ref_users: userRef, ref_client: userRef,
        type_planning: rdvForm.type_planning,
        mode_rdv: rdvForm.mode_rdv,
        adresse_rdv: rdvForm.adresse_rdv,
        etat_planning_rdv: rdvForm.etat_planning_rdv,
        observations_rdv: rdvForm.observations_rdv,
        materiel: rdvForm.materiel,
        rdv_cree_par: doc(db, 'users', currentUser.uid),
      };
      if (rdvForm.abonnement_id) payload.abonnementId = rdvForm.abonnement_id;
      if (editingRdvId) {
        await updateDoc(doc(db, 'planning_pro', editingRdvId), payload);
      } else {
        payload.rdv_pret = ''; payload.rdv_effectue = ''; payload.questionnaire_rempli = false;
        payload.date_create = Timestamp.now();
        await addDoc(collection(db, 'planning_pro'), payload);
      }
      setRdvForm(null);
      setEditingRdvId(null);
      loadRdvs();
    } catch (e) { console.error(e); }
    finally { setSavingRdv(false); }
  };

  return (
    <Modal title={abo.categorie || "Abonnement"} onClose={onClose} wide actions={
      <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition" title="Modifier">
        <PencilIcon className="w-4 h-4" />
      </button>
    }>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {abo.categorie && (<div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">Catégorie</p><p className="text-sm font-medium text-gray-800">{abo.categorie}</p></div>)}
          <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">État</p><span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${ETAT_STYLE[abo.etat] ?? "bg-gray-100 text-gray-600"}`}>{abo.etat}</span></div>
          {(abo.dateDebut || abo.dateFin) && (<div className="bg-gray-50 rounded-xl p-3 sm:col-span-2"><p className="text-xs text-gray-400 mb-0.5">Période</p><p className="text-sm font-medium text-gray-800">{abo.dateDebut ? fmtDate(abo.dateDebut) : "—"} → {abo.dateFin ? fmtDate(abo.dateFin) : "En cours"}</p></div>)}
          {abo.companyNom && (<div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">Société</p><p className="text-sm font-medium text-blue-600">{abo.companyNom}</p></div>)}
          {abo.tarifUnitaire != null && abo.tarifUnitaire > 0 && (<div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">Tarif</p><p className="text-sm font-semibold text-gray-800">{abo.tarifUnitaire} € {abo.tarifLabel ?? ""}</p></div>)}
        </div>
        {Array.isArray(abo.objectifs) && abo.objectifs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Objectifs</p>
            <div className="space-y-1.5">
              {abo.objectifs.map((o, i) => (
                <div key={i} className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                  <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${o.priorite === "Primaire" ? "bg-blue-500" : "bg-gray-300"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{o.texte}</p>
                    {o.donneeChiffree && <p className="text-xs text-gray-500 mt-0.5">{o.donneeChiffree}</p>}
                  </div>
                  {o.dateObjectif && <span className="text-xs text-gray-400 shrink-0">avant le {new Date(o.dateObjectif).toLocaleDateString("fr-FR")}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {abo.indications && (<div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Indications</p><p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 whitespace-pre-wrap">{abo.indications}</p></div>)}
        {Array.isArray((abo as any).notesInternes) && (abo as any).notesInternes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes internes</p>
            <div className="space-y-2">
              {((abo as any).notesInternes as Array<{ texte: string; type_note: string }>).map((n, i) => (
                <div key={i} className={`rounded-xl border p-3 ${getNoteTypeStyle(n.type_note).card}`}>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${getNoteTypeStyle(n.type_note).badge}`}>{n.type_note}</span>
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{n.texte}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {abo.resumeSuivi && (<div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Résumé du suivi</p><p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 whitespace-pre-wrap">{abo.resumeSuivi}</p></div>)}
        {/* ── FORMULAIRE RDV ── */}
        {rdvForm !== null ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">{editingRdvId ? "Modifier le RDV" : "Nouveau RDV"}</p>
              <button onClick={() => { setRdvForm(null); setEditingRdvId(null); }} className="text-xs text-gray-400 hover:text-gray-600 transition">← Retour</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input type="date" value={rdvForm.date} onChange={(e) => setRdvForm({ ...rdvForm, date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Début</label>
                <input type="time" value={rdvForm.heure_debut} onChange={(e) => {
                  const debut = e.target.value;
                  setRdvForm({ ...rdvForm, heure_debut: debut, heure_fin: rdvForm.heure_fin || addMinutesToTime(debut, 60) });
                }} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fin</label>
                <input type="time" value={rdvForm.heure_fin} onChange={(e) => setRdvForm({ ...rdvForm, heure_fin: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
                {rdvForm.heure_debut && (
                  <div className="flex gap-1 mt-1">
                    {[15, 30, 60].map((min) => (
                      <button key={min} type="button"
                        onClick={() => setRdvForm({ ...rdvForm, heure_fin: addMinutesToTime(rdvForm.heure_debut, min) })}
                        className="flex-1 text-xs py-0.5 rounded bg-gray-100 hover:bg-blue-50 hover:text-blue-600 text-gray-500 transition">
                        +{min < 60 ? `${min}min` : '1h'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type de RDV</label>
                <select value={rdvForm.type_planning} onChange={(e) => setRdvForm({ ...rdvForm, type_planning: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition bg-white">
                  {TYPES_RDV_CLIENTS.map((g) => (
                    <optgroup key={g.groupe} label={g.groupe}>
                      {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mode</label>
                <select value={rdvForm.mode_rdv} onChange={(e) => setRdvForm({ ...rdvForm, mode_rdv: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition bg-white">
                  {MODES_RDV.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Adresse</label>
              <AdresseAutocomplete value={rdvForm.adresse_rdv} onChange={(v) => setRdvForm({ ...rdvForm, adresse_rdv: v })} placeholder="Rechercher une adresse..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">État</label>
                <select value={rdvForm.etat_planning_rdv} onChange={(e) => setRdvForm({ ...rdvForm, etat_planning_rdv: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition bg-white">
                  {ETATS_RDV.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              {clientAbos.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Abonnement</label>
                  <select value={rdvForm.abonnement_id} onChange={(e) => setRdvForm({ ...rdvForm, abonnement_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition bg-white">
                    <option value="">— Aucun —</option>
                    {clientAbos.map((a, i) => <option key={a.id} value={a.id}>N°{i + 1} — {a.categorie} ({a.etat})</option>)}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Matériel</label>
              <MaterielSelect value={rdvForm.materiel} onChange={(v) => setRdvForm({ ...rdvForm, materiel: v })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Observations</label>
              <textarea rows={2} value={rdvForm.observations_rdv} onChange={(e) => setRdvForm({ ...rdvForm, observations_rdv: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition resize-none" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={saveRdv} disabled={!rdvForm.date || savingRdv} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">
                {savingRdv ? "Enregistrement…" : editingRdvId ? "Enregistrer" : "Créer le RDV"}
              </button>
              <button onClick={() => { setRdvForm(null); setEditingRdvId(null); }} className="border px-4 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">Annuler</button>
            </div>
          </div>
        ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CalendarDaysIcon className="w-4 h-4 text-gray-400" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rendez-vous{abo.dateDebut || abo.dateFin ? " de la période" : ""}</p>
              {!loadingRdvs && rdvs.length > 0 && (
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{rdvs.length}</span>
              )}
            </div>
            {linkedUserId && (
              <button onClick={openCreate} className="text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 px-2.5 py-1 rounded-lg transition">
                + Nouveau RDV
              </button>
            )}
          </div>
          {!linkedUserId ? (<p className="text-xs text-gray-400 italic">Client non lié à un compte — aucun RDV disponible.</p>)
            : loadingRdvs ? (<div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}</div>)
            : rdvs.length === 0 ? (<p className="text-xs text-gray-400 italic">Aucun rendez-vous sur cette période.</p>)
            : (
              <div className="space-y-1.5">
                {rdvs.map((rdv) => (
                  <div key={rdv.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100 hover:bg-blue-50 hover:border-blue-100 transition">
                    <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => openEdit(rdv)}>
                      <CalendarDaysIcon className="w-4 h-4 text-gray-300 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800">{fmtDate(rdv.date_planning)}{rdv.heure_planning_debut ? ` · ${fmtTime(rdv.heure_planning_debut)}` : ""}</p>
                        {rdv.type_planning && <p className="text-xs text-gray-500">{rdv.type_planning}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {rdv.etat_planning_rdv && (<span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ETAT_RDV[rdv.etat_planning_rdv] ?? "bg-gray-100 text-gray-500"}`}>{rdv.etat_planning_rdv}</span>)}
                      <button onClick={() => openEdit(rdv)} title="Modifier" className="p-1 hover:bg-gray-200 rounded-lg transition">
                        <PencilIcon className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
        )}
        {rdvForm === null && (
          <div className="flex gap-3 pt-1 border-t border-gray-100">
            <button onClick={onEdit} className="flex-1 border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg py-2.5 text-sm font-medium transition">Modifier</button>
            <button onClick={onDelete} className="border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-4 py-2.5 text-sm font-medium transition">Supprimer</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children, wide, actions }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; actions?: React.ReactNode }) {
  useEffect(() => {
    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" style={{ touchAction: 'none' }}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto overflow-x-hidden`}
        style={{ overscrollBehavior: 'contain', touchAction: 'pan-y' } as React.CSSProperties}>
        <div className="px-6 pt-6 pb-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <div className="flex items-center gap-1">
            {actions}
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 transition">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="px-6 py-5 overflow-x-hidden min-w-0">{children}</div>
      </div>
    </div>
  );
}
