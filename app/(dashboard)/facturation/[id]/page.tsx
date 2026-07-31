"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useCustomPrestations } from "@/hooks/useCustomPrestations";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  getFacture, updateFacture, deleteFacture, convertDevisToFacture, generateNextEcheanceFacture,
} from "@/lib/facturationService";
import { getCompany, listenCompanies } from "@/lib/companyService";
import { publicLinkOrigin, brandConfig } from "@/lib/brand";
import { getClient, updateClient } from "@/lib/clientService";
import { downloadInvoicePDF, generateInvoicePDFBlob, itemNetTotal } from "@/lib/invoicePdf";
import { uploadBlob, deleteImage } from "@/lib/uploadImage";
import { buildInvoiceEmailText } from "@/lib/invoiceEmailTemplate";
import { Timestamp } from "firebase/firestore";
import type { Facture, FactureItem, FactureStatus, Echeance, EcheanceRef, Company, Client } from "@/types";

// ── Prestations suggestions ───────────────────────────────────────────────────

const PRESTATIONS_LABELS = [
  "Séance coaching individuel",
  "Séance coaching en groupe",
  "Bilan initial",
  "Bilan de mi-parcours",
  "Bilan final",
  "Programme personnalisé",
  "Suivi mensuel",
  "Abonnement mensuel",
  "Forfait 5 séances",
  "Forfait 10 séances",
  "Forfait 20 séances",
  "Préparation physique",
  "Récupération",
];

const ECHEANCE_LABELS = [
  "Acompte 30 %", "Acompte 40 %", "Acompte 50 %",
  "Acompte 60 %", "Acompte 70 %", "Acompte 100 %",
  "Solde", "Paiement comptant",
  "1ère mensualité", "2ème mensualité", "3ème mensualité", "4ème mensualité", "5ème mensualité", "6ème mensualité", "7ème mensualité", "8ème mensualité", "9ème mensualité", "10ème mensualité",
];

const MENSUALITE_LABELS = [
  "1ère mensualité", "2ème mensualité", "3ème mensualité", "4ème mensualité",
  "5ème mensualité", "6ème mensualité", "7ème mensualité", "8ème mensualité",
  "9ème mensualité", "10ème mensualité",
];
const mensualiteLabel = (n: number) => MENSUALITE_LABELS[n - 1] ?? `${n}ème mensualité`;

function SuggestDropdown({ value, onChange, options, placeholder, wrapperClassName, inputClassName, onCommit, removableLabels, onRemoveOption }: {
  value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string; wrapperClassName?: string; inputClassName?: string;
  onCommit?: (v: string) => void;
  removableLabels?: string[]; onRemoveOption?: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() =>
    value.trim() ? options.filter((s) => s.toLowerCase().includes(value.toLowerCase())) : options,
    [value, options]
  );

  useEffect(() => {
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  return (
    <div ref={ref} className={`relative ${wrapperClassName ?? ""}`}>
      <input type="text" value={value} placeholder={placeholder}
        className={inputClassName}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={(e) => { setOpen(false); onCommit?.(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter") { setOpen(false); onCommit?.((e.target as HTMLInputElement).value); } }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-44 overflow-y-auto">
          {filtered.map((s) => {
            const isRemovable = removableLabels?.includes(s);
            return (
              <div key={s} className="flex items-center border-b border-gray-50 last:border-0">
                <button type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={() => { onChange(s); setOpen(false); }}
                  className="flex-1 text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 transition">
                  {s}
                </button>
                {isRemovable && onRemoveOption && (
                  <button type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={() => onRemoveOption(s)}
                    className="px-2 py-2 text-gray-300 hover:text-red-500 transition shrink-0" title="Supprimer de la liste">
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<FactureStatus, string> = {
  draft: "Brouillon", pending: "En attente", sent: "Envoyé", paid: "Payée",
  encaissement: "À encaisser",
  overdue: "En retard", cancelled: "Annulée", accepted: "Accepté", rejected: "Non validé",
};
const STATUS_STYLE: Record<FactureStatus, string> = {
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  sent: "bg-blue-50 text-blue-700 border-blue-200",
  paid: "bg-green-50 text-green-700 border-green-200",
  encaissement: "bg-violet-50 text-violet-700 border-violet-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-400 border-gray-200",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-orange-50 text-orange-700 border-orange-200",
};
const STATUSES_FACTURE: FactureStatus[] = ["draft", "pending", "sent", "encaissement", "paid", "overdue", "cancelled"];
const STATUSES_DEVIS: FactureStatus[] = ["draft", "pending", "sent", "accepted", "rejected", "cancelled"];

const STATUS_DOT: Record<FactureStatus, string> = {
  draft: "bg-gray-400",
  pending: "bg-yellow-400",
  sent: "bg-blue-500",
  paid: "bg-green-500",
  encaissement: "bg-violet-500",
  overdue: "bg-red-500",
  cancelled: "bg-gray-300",
  accepted: "bg-emerald-500",
  rejected: "bg-orange-500",
};

function StatusSelect({ current, statuses, onChange, labels = STATUS_LABEL }: {
  current: FactureStatus;
  statuses: FactureStatus[];
  onChange: (s: FactureStatus) => void;
  labels?: Record<FactureStatus, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition ${STATUS_STYLE[current]}`}
      >
        {labels[current]}
        <svg className={`w-3 h-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden min-w-[170px]">
          {statuses.map((s) => {
            const isCurrent = s === current;
            return (
              <button
                key={s}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { if (!isCurrent) { onChange(s); } setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition border-b border-gray-50 last:border-0 ${
                  isCurrent
                    ? "bg-gray-50 cursor-default"
                    : "hover:bg-gray-50 cursor-pointer"
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s]}`} />
                <span className={`font-medium ${isCurrent ? "text-gray-900" : "text-gray-700"}`}>
                  {labels[s]}
                </span>
                {isCurrent && (
                  <span className="ml-auto text-[10px] font-semibold text-gray-400 uppercase tracking-wide">actuel</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmtDate(ts?: { seconds: number } | null) {
  if (!ts) return "—";
  return new Date(ts.seconds * 1000).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}
function fmtDateShort(ts?: { seconds: number } | null) {
  if (!ts) return "—";
  return new Date(ts.seconds * 1000).toLocaleDateString("fr-FR");
}
function fmtMoney(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) + " €";
}
function calNum(number: string) {
  return number.replace(/^FAC_/, 'Fac ').replace(/^DEV_/, 'Dev ')
}
function toDateInputValue(ts?: { seconds: number } | null) {
  if (!ts) return "";
  return new Date(ts.seconds * 1000).toISOString().split("T")[0];
}

// ── Google Agenda ─────────────────────────────────────────────────────────────

function addCalEvent(title: string, date: Date, details: string) {
  const toGcal = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const start = new Date(date)
  start.setHours(12, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toGcal(start)}/${toGcal(end)}`,
    details,
  })
  window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank')
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FactureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser } = useAuth();

  const [facture, setFacture] = useState<Facture | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [linkedFactures, setLinkedFactures] = useState<Facture[]>([]);
  const [siblingIds, setSiblingIds] = useState<string[]>([]);
  const [siblingTotals, setSiblingTotals] = useState<number[]>([]);
  const [devisExpectedTotal, setDevisExpectedTotal] = useState<number | null>(null);
  const [editingNumber, setEditingNumber] = useState(false);
  const [draftNumber, setDraftNumber] = useState("");
  const { allLabels: allPrestations, customLabels, addCustomLabel, removeCustomLabel, priceMap, savePriceForLabel, removePriceForLabel } = useCustomPrestations(PRESTATIONS_LABELS, currentUser?.uid);
  const [items, setItems] = useState<FactureItem[]>([]);
  const [echeances, setEcheances] = useState<Echeance[]>([]);
  const [notes, setNotes] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [validiteJours, setValiditeJours] = useState<number>(30);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [generatingNextEcheance, setGeneratingNextEcheance] = useState(false);
  const [signModal, setSignModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [emailModal, setEmailModal] = useState<{ to: string; cc: string; cci: string } | null>(null);

  // Facturer à (override coordonnées)
  const [factureNom, setFactureNom] = useState("");
  const [factureAdresse, setFactureAdresse] = useState("");
  const [factureCodePostal, setFactureCodePostal] = useState("");
  const [factureVille, setFactureVille] = useState("");
  const [factureEmail, setFactureEmail] = useState("");
  const [showFactureA, setShowFactureA] = useState(false);
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");

  useEffect(() => {
    getFacture(id).then((data) => {
      setFacture(data);
      setDraftNumber(data.number ?? "");
      setItems(data.items ?? []);
      setEcheances(data.echeances ?? []);
      setNotes(data.notes ?? "");
      setDocumentDate(toDateInputValue(data.date ?? data.createdAt ?? null));
      setValiditeJours(data.validiteJours ?? 30);
      setFactureNom(data.factureNom ?? "");
      setFactureAdresse(data.factureAdresse ?? "");
      setFactureCodePostal(data.factureCodePostal ?? "");
      setFactureVille(data.factureVille ?? "");
      setFactureEmail(data.factureEmail ?? "");
      if (data.factureNom) setShowFactureA(true);
      setPaymentDate(toDateInputValue(data.paymentDate ?? null));
      setPaymentMethod(data.paymentMethod ?? "");
      if (data.companyId) getCompany(data.companyId).then(setCompany).catch(() => null);
      if (data.clientId) getClient(data.clientId).then(setClient).catch(() => null);
      if (data.type === "devis") {
        const ids = data.convertedToFactureIds ?? (data.convertedToFactureId ? [data.convertedToFactureId] : []);
        if (ids.length) Promise.all(ids.map((fid) => getFacture(fid))).then(setLinkedFactures).catch(() => {});
      }
      if (data.type !== "devis" && data.devisRef) {
        getFacture(data.devisRef).then(async (devis) => {
          const ids = devis.convertedToFactureIds ?? (devis.convertedToFactureId ? [devis.convertedToFactureId] : []);
          if (ids.length > 1) setSiblingIds(ids);
          setDevisExpectedTotal(devis.total ?? null);
          if (ids.length > 0) {
            const siblings = await Promise.all(ids.map((fid) => getFacture(fid)));
            setSiblingTotals(siblings.map((f) => f.total ?? 0));
          }
          // Recalcule le cumul réellement réglé avant cette échéance depuis le devis (échéances éventuellement inégales)
          const er = data.echeanceRef as EcheanceRef | undefined;
          if (er && Array.isArray(devis.echeances) && devis.echeances.length > 0) {
            const realCumul = devis.echeances.slice(0, er.index).reduce((acc, e) => acc + (e.montant ?? 0), 0);
            if (er.cumulPrecedent !== realCumul) {
              const fixedEr = { ...er, cumulPrecedent: realCumul };
              setFacture((p) => p ? ({ ...p, echeanceRef: fixedEr }) : p);
              updateFacture(id, { echeanceRef: fixedEr }).catch(() => {});
            }
          }
        }).catch(() => {});
      }
    });
  }, [id]);

  // Charge toutes les sociétés pour le sélecteur inline
  useEffect(() => {
    if (!currentUser) return
    return listenCompanies(currentUser.uid, setCompanies)
  }, [currentUser])

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // Sauvegarde uniquement les coordonnées "Facturé à" sur la facture
  const [savingFactureA, setSavingFactureA] = useState(false);
  const saveFactureA = async () => {
    setSavingFactureA(true);
    try {
      await updateFacture(id, {
        factureNom: factureNom.trim() || undefined,
        factureAdresse: factureAdresse.trim() || undefined,
        factureCodePostal: factureCodePostal.trim() || undefined,
        factureVille: factureVille.trim() || undefined,
        factureEmail: factureEmail.trim() || undefined,
      });
      setFacture((p) => p ? { ...p, factureNom: factureNom.trim() || undefined, factureAdresse: factureAdresse.trim() || undefined, factureCodePostal: factureCodePostal.trim() || undefined, factureVille: factureVille.trim() || undefined, factureEmail: factureEmail.trim() || undefined } : null);
      showToast("Coordonnées de facturation enregistrées");
    } catch { showToast("Erreur lors de l'enregistrement", false); }
    finally { setSavingFactureA(false); }
  };

  // Enregistre les coordonnées "Facturé à" actuelles comme contact réutilisable du client
  const [savingContact, setSavingContact] = useState(false);
  const saveAsReusableContact = async () => {
    if (!client || !factureNom.trim()) return;
    setSavingContact(true);
    try {
      const newContact = {
        nom: factureNom.trim() || undefined,
        adresse: factureAdresse.trim() || undefined,
        codePostal: factureCodePostal.trim() || undefined,
        ville: factureVille.trim() || undefined,
        email: factureEmail.trim() || undefined,
      };
      const existing = ((client as any).contactsSupplementaires as any[]) ?? [];
      // Éviter un doublon exact (même nom)
      if (existing.some((c) => [c.nom, c.prenom].filter(Boolean).join(" ") === factureNom.trim())) {
        showToast("Ce contact existe déjà"); setSavingContact(false); return;
      }
      const updated = [...existing, newContact];
      await updateClient(client.id, { contactsSupplementaires: updated } as any);
      setClient((p) => p ? ({ ...p, contactsSupplementaires: updated } as any) : p);
      showToast("Contact enregistré pour réutilisation");
    } catch { showToast("Erreur lors de l'enregistrement du contact", false); }
    finally { setSavingContact(false); }
  };

  // ── Items ─────────────────────────────────────────────────
  const updateItem = (i: number, field: keyof FactureItem, value: string | number) =>
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const addItem = () => setItems((p) => [...p, { label: "", quantity: 1, price: 0 }]);
  const removeItem = (i: number) => { if (items.length > 1) setItems((p) => p.filter((_, idx) => idx !== i)); };
  const duplicateItem = (i: number) => setItems((p) => { const copy = [...p]; copy.splice(i + 1, 0, { ...p[i] }); return copy; });
  const toggleDiscountType = (i: number) =>
    setItems((p) => p.map((it, idx) =>
      idx === i ? { ...it, discountType: it.discountType === "percent" ? "amount" : "percent" } : it
    ));

  // ── Échéancier ────────────────────────────────────────────
  const toggleEcheance = (i: number) =>
    setEcheances((p) =>
      p.map((e, idx) => idx === i ? { ...e, statut: e.statut === "payé" ? "en_attente" : "payé" } : e)
    );

  type DraftEcheance = { label: string; date: string; montant: string; manualMontant?: boolean };
  const [showEcheancierBuilder, setShowEcheancierBuilder] = useState(false);
  const [editingEcheanceRefMontant, setEditingEcheanceRefMontant] = useState(false);
  const [draftEcheanceRefMontant, setDraftEcheanceRefMontant] = useState("");
  const [draftEcheances, setDraftEcheances] = useState<DraftEcheance[]>([
    { label: "Acompte 50%", date: "", montant: "" },
    { label: "Solde 50%", date: "", montant: "" },
  ]);
  const [autoBalance, setAutoBalance] = useState(true);
  const [copiedMontant, setCopiedMontant] = useState<string | null>(null);

  const distributeEvenly = (rows: DraftEcheance[], t: number): DraftEcheance[] => {
    if (rows.length === 0 || t <= 0) return rows;
    const share = Math.floor((t / rows.length) * 100) / 100;
    const last = Math.round((t - share * (rows.length - 1)) * 100) / 100;
    return rows.map((e, idx) => ({ ...e, montant: String(idx === rows.length - 1 ? last : share), manualMontant: false }));
  };

  const addOneMonth = (dateStr: string): string => {
    if (!dateStr) return "";
    const [y, m, dayStr] = dateStr.split("-").map(Number);
    const newMonth = m % 12;
    const newYear = m === 12 ? y + 1 : y;
    const daysInMonth = new Date(newYear, newMonth + 1, 0).getDate();
    const finalDay = Math.min(dayStr, daysInMonth);
    return `${newYear}-${String(newMonth + 1).padStart(2, "0")}-${String(finalDay).padStart(2, "0")}`;
  };

  const updateDraft = (i: number, field: keyof DraftEcheance, value: string) => {
    if (field === "montant") setAutoBalance(false);
    setDraftEcheances((p) => p.map((e, idx) =>
      idx === i ? { ...e, [field]: value, ...(field === "montant" ? { manualMontant: true } : {}) } : e
    ));
  };
  const addDraftRow = () =>
    setDraftEcheances((p) => {
      const n = p.length + 1;
      const lastDate = p[p.length - 1]?.date ?? "";
      const nextDate = lastDate ? addOneMonth(lastDate) : "";
      const next = [...p, { label: mensualiteLabel(n), date: nextDate, montant: "" }];
      return autoBalance ? distributeEvenly(next, total) : next;
    });
  const removeDraftRow = (i: number) =>
    setDraftEcheances((p) => {
      const next = p.filter((_, idx) => idx !== i);
      return autoBalance ? distributeEvenly(next, total) : next;
    });

  const recalcDraft = (i: number) => {
    setDraftEcheances((p) => p.map((e, idx) => {
      if (idx !== i) return e;
      const pct = Number(e.label.match(/(\d+)\s*%/)?.[1] ?? 0);
      return pct > 0 ? { ...e, montant: String(Math.round(total * pct) / 100), manualMontant: false } : e;
    }));
  };

  const applyEcheancierBuilder = async () => {
    const converted: Echeance[] = draftEcheances.map((e) => ({
      label: e.label,
      date: e.date ? Timestamp.fromDate(new Date(e.date)) : Timestamp.now(),
      montant: Number(e.montant) || 0,
      statut: "en_attente" as const,
    }));
    setEcheances(converted);
    setShowEcheancierBuilder(false);
    setSaving(true);
    try {
      const dateTs = documentDate ? Timestamp.fromDate(new Date(documentDate)) : undefined;
      await updateFacture(id, { items, total, echeances: converted, notes, ...(dateTs ? { date: dateTs } : {}) });
      setFacture((p) => p ? { ...p, items, total, echeances: converted, notes } : null);
      showToast("Échéancier créé.");
    } catch { showToast("Erreur lors de l'enregistrement.", false); }
    finally { setSaving(false); }
  };

  const openEditEcheancier = () => {
    setAutoBalance(false);
    setDraftEcheances(echeances.map((e) => ({
      label: e.label ?? "",
      date: e.date ? new Date(e.date.seconds * 1000).toISOString().split("T")[0] : "",
      montant: String(e.montant),
      manualMontant: true,
    })));
    setShowEcheancierBuilder(true);
  };

  const deleteEcheancier = async () => {
    if (!window.confirm("Supprimer l'échéancier ?")) return;
    setEcheances([]);
    setSaving(true);
    try {
      await updateFacture(id, { echeances: [] });
      setFacture((p) => p ? { ...p, echeances: [] } : null);
      showToast("Échéancier supprimé.");
    } catch { showToast("Erreur lors de la suppression.", false); }
    finally { setSaving(false); }
  };

  const echeanceRef = (facture as any)?.echeanceRef as EcheanceRef | undefined;

  const saveEcheanceRefMontant = async () => {
    if (!echeanceRef) return;
    const newMontant = parseFloat(draftEcheanceRefMontant.replace(",", "."));
    if (isNaN(newMontant) || newMontant < 0) { setEditingEcheanceRefMontant(false); return; }
    const updated = { ...echeanceRef, montant: newMontant };
    setSaving(true);
    try {
      await updateFacture(id, { echeanceRef: updated, total: newMontant });
      setFacture((p) => p ? { ...p, echeanceRef: updated as any, total: newMontant } : null);
      const idx = siblingIds.indexOf(id);
      if (idx !== -1) setSiblingTotals((prev) => { const next = [...prev]; next[idx] = newMontant; return next; });
      showToast("Montant mis à jour.");
    } catch { showToast("Erreur lors de la sauvegarde.", false); }
    finally { setSaving(false); setEditingEcheanceRefMontant(false); }
  };
  const itemsTotal = items.reduce((acc, i) => acc + itemNetTotal(i), 0);
  // Factures issues d'un devis à échéancier : le total à facturer est l'échéance, pas la somme des lignes
  const total = echeanceRef ? echeanceRef.montant : itemsTotal;
  const paidTotal = echeances.filter((e) => e.statut === "payé").reduce((s, e) => s + e.montant, 0);
  const pendingTotal = echeances.filter((e) => e.statut !== "payé").reduce((s, e) => s + e.montant, 0);

  // ── Save ──────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      const dateTs = documentDate ? Timestamp.fromDate(new Date(documentDate)) : undefined;
      await updateFacture(id, {
        items, total, echeances, notes,
        ...(facture?.type === "devis" ? { validiteJours } : {}),
        ...(echeanceRef ? { echeanceRef } : {}),
        ...(dateTs ? { date: dateTs } : {}),
        factureNom: factureNom.trim() || undefined,
        factureAdresse: factureAdresse.trim() || undefined,
        factureCodePostal: factureCodePostal.trim() || undefined,
        factureVille: factureVille.trim() || undefined,
        factureEmail: factureEmail.trim() || undefined,
      });
      setFacture((p) => p ? { ...p, items, total, echeances, notes, ...(p.type === "devis" ? { validiteJours } : {}), factureNom: factureNom.trim() || undefined, factureEmail: factureEmail.trim() || undefined, ...(dateTs ? { date: dateTs } : {}) } : null);
      showToast("Sauvegardé");
    } catch {
      showToast("Erreur lors de la sauvegarde", false);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: FactureStatus) => {
    try {
      await updateFacture(id, { status });
      setFacture((p) => p ? { ...p, status } : null);
      showToast(`Statut : ${statusLabels[status]}`);
    } catch {
      showToast("Erreur lors du changement de statut", false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFacture(id);
      router.push("/facturation");
    } catch {
      showToast("Erreur lors de la suppression", false);
    }
  };

  const handleConvert = async () => {
    if (!facture) return;
    try {
      const ids = await convertDevisToFacture(id, currentUser!.uid);
      showToast(ids.length > 1 ? `Devis converti en ${ids.length} factures !` : "Devis converti en facture !");
      router.push(`/facturation/${ids[0]}`);
    } catch {
      showToast("Erreur lors de la conversion", false);
    } finally {
      setConfirmConvert(false);
    }
  };

  // Régénère le PDF stocké (pdfUrl) pour qu'il reflète l'état de signature courant
  // et écrase l'ancien. Ne fait rien si aucun PDF n'a encore été stocké/partagé.
  const syncStoredPdf = async (overrides: Partial<Facture> = {}, base?: Facture) => {
    const src = base ?? facture;
    if (!src || !src.pdfUrl) return;
    const snapshot: Facture = {
      ...src, items, total, echeances, notes,
      ...(src.type === "devis" ? { validiteJours } : {}), ...overrides,
    };
    const blob = await generateInvoicePDFBlob(snapshot, company);
    const pdfUrl = await uploadBlob(blob, `users/${currentUser!.uid}/factures/${id}.pdf`);
    await updateFacture(id, { pdfUrl, pdfReflectsSignature: !!snapshot.signed });
    setFacture((p) => p ? { ...p, pdfUrl, pdfReflectsSignature: !!snapshot.signed } : null);
  };

  const handleSignConfirm = async (dataUrl: string) => {
    try {
      const arr = dataUrl.split(",");
      const mime = arr[0].match(/:(.*?);/)?.[1] ?? "image/png";
      const bytes = atob(arr[1]);
      const u8 = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) u8[i] = bytes.charCodeAt(i);
      const blob = new Blob([u8], { type: mime });
      const signatureUrl = await uploadBlob(blob, `users/${currentUser!.uid}/signatures/${id}.png`);
      const now = Timestamp.now();
      await updateFacture(id, { signed: true, signedAt: now, signatureUrl });
      setFacture((p) => p ? { ...p, signed: true, signedAt: now, signatureUrl } : null);
      setSignModal(false);
      showToast("Devis signé !");
      // Régénère le PDF stocké avec la signature (écrase l'ancien) — non bloquant.
      syncStoredPdf({ signed: true, signedAt: now, signatureUrl }).catch(() => {});
    } catch {
      showToast("Erreur lors de la signature", false);
    }
  };

  // Annule la signature → le devis redevient signable par le client (rétractation / modification).
  const handleUnsign = async () => {
    if (!facture) return;
    if (!confirm("Annuler la signature ?\n\nLe devis redeviendra signable par le client (utile s'il se rétracte ou si le devis doit être modifié).")) return;
    try {
      const oldUrl = facture.signatureUrl;
      await updateFacture(id, { signed: false, status: "sent", signatureUrl: "" });
      setFacture((p) => p ? { ...p, signed: false, status: "sent", signatureUrl: "" } : null);
      // Supprime aussi le fichier de signature du Storage (signature admin = .png ;
      // signature via le portail = data URL, déjà retirée du document → rien à supprimer).
      if (oldUrl && oldUrl.startsWith("http")) await deleteImage(oldUrl);
      showToast("Signature annulée — le devis est de nouveau signable.");
      // Régénère le PDF stocké en version non signée (écrase l'ancien qui portait la signature) — non bloquant.
      syncStoredPdf({ signed: false, status: "sent", signatureUrl: "" }).catch(() => {});
    } catch {
      showToast("Erreur lors de l'annulation", false);
    }
  };

  // Lien public de signature en ligne : le client consulte + signe le devis sans compte.
  const activateSignLink = async () => {
    if (!facture) return;
    const token = crypto.randomUUID().replace(/-/g, "");
    try {
      await updateFacture(id, { signToken: token });
      setFacture((p) => p ? { ...p, signToken: token } : null);
      showToast("Lien de signature activé.");
    } catch {
      showToast("Erreur lors de l'activation du lien", false);
    }
  };

  const regenerateSignLink = async () => {
    if (!facture) return;
    if (!confirm("Régénérer le lien ?\n\nL'ancien lien cessera de fonctionner.")) return;
    const token = crypto.randomUUID().replace(/-/g, "");
    try {
      await updateFacture(id, { signToken: token });
      setFacture((p) => p ? { ...p, signToken: token } : null);
      showToast("Nouveau lien généré.");
    } catch {
      showToast("Erreur lors de la régénération", false);
    }
  };

  const handleUploadAndShare = async () => {
    if (!facture) return;
    setPdfUploading(true);
    try {
      const snapshot: Facture = { ...facture, items, total, echeances, notes, ...(facture.type === "devis" ? { validiteJours } : {}) };
      const blob = await generateInvoicePDFBlob(snapshot, company);
      const pdfUrl = await uploadBlob(blob, `users/${currentUser!.uid}/factures/${id}.pdf`);
      const updates: Partial<Omit<Facture, "id">> = { pdfUrl, pdfReflectsSignature: !!facture.signed };
      if (facture.status === "draft") updates.status = "sent";
      await updateFacture(id, updates);
      setFacture((p) => p ? { ...p, ...updates } : null);
      showToast("PDF prêt à partager !");
    } catch {
      showToast("Erreur lors de l'upload du PDF", false);
    } finally {
      setPdfUploading(false);
    }
  };

  // Signature en ligne (client) : ton navigateur n'était pas ouvert au moment de signer,
  // donc le PDF stocké n'a pas pu être régénéré. On le met à jour à l'ouverture du devis.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (autoSyncedRef.current || !facture || !company) return;
    if (facture.type === "devis" && facture.signed && facture.pdfUrl && !facture.pdfReflectsSignature) {
      autoSyncedRef.current = true;
      syncStoredPdf({}, facture)
        .then(() => showToast("PDF mis à jour avec la signature."))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facture, company]);

  const handlePDF = async () => {
    if (!facture) return;
    setGeneratingPdf(true);
    try {
      let newStatus = facture.status;
      if (facture.status === "draft") {
        await updateFacture(id, { status: "sent" });
        setFacture((p) => p ? { ...p, status: "sent" } : null);
        newStatus = "sent";
      }
      const dateTs = documentDate ? Timestamp.fromDate(new Date(documentDate)) : undefined;
      const snapshot: Facture = { ...facture, status: newStatus, items, total, echeances, notes, ...(facture.type === "devis" ? { validiteJours } : {}), ...(dateTs ? { date: dateTs } : {}) };
      await downloadInvoicePDF(snapshot, company);
    } catch {
      showToast("Erreur lors de la génération du PDF", false);
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (!facture) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isDevis = facture.type === "devis";
  const docLabel = isDevis ? "Devis" : "Facture";
  const statusLabels: Record<FactureStatus, string> = { ...STATUS_LABEL, sent: isDevis ? "Envoyé" : "Envoyée", pending: "En attente" };

  const echeanceIsPaid = (i: number): boolean => {
    if (!isDevis) return echeances[i]?.statut === "payé";
    const lf = linkedFactures.find((f) => (f.echeanceRef as any)?.index === i);
    return lf?.status === "paid";
  };
  const displayPaidTotal = isDevis
    ? echeances.reduce((sum, e, i) => {
        const lf = linkedFactures.find((f) => (f.echeanceRef as any)?.index === i);
        return sum + (lf?.status === "paid" ? e.montant : 0);
      }, 0)
    : paidTotal;
  const displayPendingTotal = total - displayPaidTotal;
  const docDate = documentDate ? new Date(documentDate) : (facture.createdAt ? new Date(facture.createdAt.seconds * 1000) : new Date());

  const gcalAdd = (title: string, date: Date, details: string) =>
    addCalEvent(title, date, details);

  return (
    <div className="min-h-screen">
      {signModal && (
        <SignaturePad
          onConfirm={handleSignConfirm}
          onCancel={() => setSignModal(false)}
        />
      )}
      {emailModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEmailModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Envoyer par email</h3>
            <p className="text-xs text-gray-500 mb-4">{docLabel} {facture.number}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Destinataire</label>
                <input type="email" value={emailModal.to} onChange={(e) => setEmailModal({ ...emailModal, to: e.target.value })}
                  placeholder="destinataire@email.com"
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CC <span className="text-gray-400 font-normal">(séparés par des virgules)</span></label>
                <input type="text" value={emailModal.cc} onChange={(e) => setEmailModal({ ...emailModal, cc: e.target.value })}
                  placeholder="copie@email.com, autre@email.com"
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CCI <span className="text-gray-400 font-normal">(copie cachée)</span></label>
                <input type="text" value={emailModal.cci} onChange={(e) => setEmailModal({ ...emailModal, cci: e.target.value })}
                  placeholder="copie-cachee@email.com"
                  className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEmailModal(null)} className="flex-1 border rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition">Annuler</button>
              <button
                onClick={() => {
                  const clientName = client
                    ? `${(client.nom ?? "").toUpperCase()} ${client.prenom ?? ""}`.trim()
                    : (facture.clientName || "");
                  const dateEcheance = fmtDate((facture.dateEcheance ?? facture.date ?? facture.createdAt) ?? null);
                  // Émetteur = la société du document (une facture coaching ne doit pas s'annoncer « Enezo »)
                  const emetteur = company?.nom?.trim() || brandConfig(company?.marque).nom;
                  // Devis : on joint le lien de signature en ligne s'il a été activé
                  const signLink = isDevis && facture.signToken
                    ? `${publicLinkOrigin(company?.marque, typeof window !== "undefined" ? window.location.origin : "")}/signer-devis/${facture.signToken}`
                    : undefined;
                  const subject = encodeURIComponent(`${docLabel} ${facture.number} — ${emetteur}`);
                  const body = encodeURIComponent(buildInvoiceEmailText({
                    clientName, docLabel, number: facture.number, isDevis,
                    montant: fmtMoney(total), dateEcheance,
                    ...(isDevis ? { validiteJours, signLink } : {}),
                  }));
                  const params: string[] = [`subject=${subject}`, `body=${body}`];
                  const cleanList = (s: string) => s.split(",").map((e) => e.trim()).filter(Boolean).join(",");
                  const cc = cleanList(emailModal.cc);
                  const cci = cleanList(emailModal.cci);
                  if (cc) params.push(`cc=${encodeURIComponent(cc)}`);
                  if (cci) params.push(`bcc=${encodeURIComponent(cci)}`);
                  window.open(`mailto:${encodeURIComponent(emailModal.to)}?${params.join("&")}`, "_blank");
                  setEmailModal(null);
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium transition"
              >
                Ouvrir l'email
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <div className="mb-6">
        {/* Barre de navigation : retour + pager */}
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => router.push(`/facturation${facture.type === "devis" ? "?tab=devis" : ""}`)} title="Retour à la facturation" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 text-sm font-medium transition shrink-0">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Retour
          </button>
          {siblingIds.length > 1 && (() => {
            const idx = siblingIds.indexOf(id);
            const prev = siblingIds[idx - 1];
            const next = siblingIds[idx + 1];
            return (
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => router.push(`/facturation/${prev}`)}
                  disabled={!prev}
                  className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition"
                  title="Facture précédente"
                ><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                <span className="text-xs font-semibold text-gray-600 px-2 tabular-nums select-none">{idx + 1} / {siblingIds.length}</span>
                <button
                  onClick={() => router.push(`/facturation/${next}`)}
                  disabled={!next}
                  className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition"
                  title="Facture suivante"
                ><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></button>
              </div>
            );
          })()}
        </div>

        {/* Titre + actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              {editingNumber ? (
                <input
                  autoFocus
                  value={draftNumber}
                  onChange={(e) => setDraftNumber(e.target.value)}
                  onBlur={async () => {
                    setEditingNumber(false);
                    const trimmed = draftNumber.trim();
                    if (trimmed && trimmed !== facture.number) {
                      await updateFacture(id, { number: trimmed });
                      setFacture((p) => p ? { ...p, number: trimmed } : null);
                    } else {
                      setDraftNumber(facture.number);
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraftNumber(facture.number); setEditingNumber(false); } }}
                  className="text-2xl font-semibold text-gray-900 border-b-2 border-blue-400 outline-none bg-transparent min-w-[120px]"
                />
              ) : (
                <button
                  onClick={() => setEditingNumber(true)}
                  className="group flex items-center gap-1.5"
                  title="Modifier le numéro"
                >
                  <h1 className="text-2xl font-semibold text-gray-900">{facture.number}</h1>
                  <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-500 transition shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
              {isDevis && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">Devis</span>}
              {facture.signed && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">Signé</span>}
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[facture.status]}`}>{STATUS_LABEL[facture.status]}</span>
              {facture.contratId && (
                <button
                  onClick={() => router.push(`/pilotage/contrat/${facture.contratId}?tab=documents`)}
                  title="Ouvrir le contrat lié"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Contrat
                </button>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {facture.clientName || "—"} · {fmtDate((facture.date ?? facture.createdAt) ?? null)}
            </p>

            {/* Liens de relation devis ⇄ factures */}
            {(() => {
              const backLink = facture.devisNumber && facture.devisRef && !isDevis
              const multiFactures = isDevis && facture.convertedToFactureIds && facture.convertedToFactureIds.length > 1
              const singleFacture = isDevis && facture.convertedToFactureId
              if (!backLink && !multiFactures && !singleFacture) return null
              return (
                <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                  {backLink && (
                    <button
                      onClick={() => router.push(`/facturation/${facture.devisRef}`)}
                      title={`Revenir au devis ${facture.devisNumber}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 hover:border-purple-300 transition"
                    >
                      Devis {facture.devisNumber}
                    </button>
                  )}
                  {multiFactures && (
                    <>
                      <span className="text-xs text-gray-400 mr-0.5">Factures :</span>
                      {facture.convertedToFactureIds!.map((fid, i) => (
                        <button
                          key={fid}
                          onClick={() => router.push(`/facturation/${fid}`)}
                          title={`Ouvrir la facture ${i + 1}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition"
                        >
                          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          Facture {i + 1}
                        </button>
                      ))}
                    </>
                  )}
                  {!multiFactures && singleFacture && (
                    <button
                      onClick={() => router.push(`/facturation/${facture.convertedToFactureId}`)}
                      title="Voir la facture créée"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition"
                    >
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Voir la facture créée
                    </button>
                  )}
                </div>
              )
            })()}
          </div>

          {/* ACTIONS */}
          <div className="flex items-center gap-2 flex-wrap sm:shrink-0">
          <button onClick={handlePDF} disabled={generatingPdf} className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            {generatingPdf ? "Génération…" : "PDF"}
          </button>
          {facture.pdfUrl && (
            <a href={facture.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              Voir PDF
            </a>
          )}

          {isDevis && !facture.signed && (
            <button onClick={() => setSignModal(true)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition">
              ✍ Signer le devis
            </button>
          )}

          {isDevis && facture.signed && (
            <button onClick={handleUnsign} className="px-3 py-2 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg text-sm font-medium transition">
              ↩ Annuler la signature
            </button>
          )}

          {isDevis && !facture.convertedToFactureId && !confirmConvert && facture.status !== 'rejected' && (
            <button onClick={() => setConfirmConvert(true)} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
              → {echeances.length > 1 ? `Convertir (1ère échéance sur ${echeances.length})` : "Convertir en facture"}
            </button>
          )}
          {isDevis && facture.convertedToFactureId && echeances.length > 0 && (() => {
            const already = (facture.convertedToFactureIds ?? [facture.convertedToFactureId]).length
            const nextIndex = already
            if (nextIndex >= echeances.length) return null
            const next = echeances[nextIndex]
            const label = next.label || `Règlement ${nextIndex + 1}/${echeances.length}`
            return (
              <button
                onClick={async () => {
                  if (!currentUser) return
                  setGeneratingNextEcheance(true)
                  try {
                    const newId = await generateNextEcheanceFacture(facture.id, currentUser.uid)
                    if (newId) router.push(`/facturation/${newId}`)
                  } finally { setGeneratingNextEcheance(false) }
                }}
                disabled={generatingNextEcheance}
                className="px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
              >
                {generatingNextEcheance ? "…" : `→ Émettre ${label}`}
              </button>
            )
          })()}
          {isDevis && confirmConvert && (
            <div className="flex gap-1.5">
              <button onClick={handleConvert} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">Confirmer</button>
              <button onClick={() => setConfirmConvert(false)} className="px-3 py-2 border rounded-lg text-sm font-medium hover:bg-gray-100 transition">Annuler</button>
            </div>
          )}

          <StatusSelect
            current={facture.status}
            statuses={isDevis ? STATUSES_DEVIS : STATUSES_FACTURE}
            onChange={changeStatus}
            labels={statusLabels}
          />

          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="px-3 py-2 border border-red-200 text-red-500 rounded-lg text-sm font-medium hover:bg-red-50 transition">Supprimer</button>
          ) : (
            <div className="flex gap-1.5">
              <button onClick={handleDelete} className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition">Confirmer la suppression</button>
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 border rounded-lg text-sm font-medium hover:bg-gray-100 transition">Annuler</button>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT */}
        <div className="lg:col-span-2 space-y-4">

          {/* DATE */}
          <div className="bg-white border rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Date du document</h2>
            <div className="flex flex-wrap items-start gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date d'émission</label>
                <input
                  type="date"
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                  onBlur={save}
                  className="h-[42px] border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition"
                />
                <p className="text-xs text-gray-400 mt-1.5">Modifiable (ex : facturation groupée envoyée ultérieurement)</p>
              </div>
              {isDevis && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Validité du devis</label>
                  <div className="flex items-center gap-2 h-[42px]">
                    <input
                      type="number" min="1"
                      value={validiteJours}
                      onChange={(e) => setValiditeJours(Math.max(1, Number(e.target.value)))}
                      onBlur={save}
                      className="h-[42px] w-20 border rounded-lg px-3 py-2.5 text-sm text-right outline-none focus:border-blue-400 transition"
                    />
                    <span className="text-sm text-gray-500">jours</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">30 jours par défaut</p>
                </div>
              )}
            </div>
          </div>

          {/* FACTURER À */}
          {(() => {
            const contacts = (client as any)?.contactsSupplementaires as import("@/types").ContactSupplementaire[] | undefined ?? [];
            const hasOverride = !!factureNom;
            return (
              <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowFactureA((v) => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-700">Facturer à</span>
                    {hasOverride && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                        {factureNom}
                      </span>
                    )}
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${showFactureA ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showFactureA && (
                  <div className="px-5 pb-5 space-y-3 border-t pt-4">
                    <p className="text-xs text-gray-400">
                      À utiliser si le client souhaite une facture à un autre nom ou une autre adresse (employeur, conjoint, société…). Laissez vide pour utiliser les coordonnées habituelles du client.
                    </p>
                    {contacts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => { setFactureNom(""); setFactureAdresse(""); setFactureCodePostal(""); setFactureVille(""); }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${!factureNom ? "bg-blue-600 text-white border-blue-600" : "text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                        >
                          Client
                        </button>
                        {contacts.map((c, i) => (
                          <button
                            type="button"
                            key={i}
                            onClick={() => {
                              setFactureNom([c.nom, c.prenom].filter(Boolean).join(" ") || c.label || "");
                              setFactureAdresse(c.adresse ?? "");
                              setFactureCodePostal(c.codePostal ?? "");
                              setFactureVille(c.ville ?? "");
                              setFactureEmail(c.email ?? "");
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${factureNom === [c.nom, c.prenom].filter(Boolean).join(" ") ? "bg-indigo-600 text-white border-indigo-600" : "text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                          >
                            {c.label || [c.nom, c.prenom].filter(Boolean).join(" ")}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder={`Nom / Raison sociale (défaut : ${facture?.clientName || "—"})`}
                        value={factureNom}
                        onChange={(e) => setFactureNom(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
                      />
                      <input
                        type="text"
                        placeholder={`Adresse (défaut : ${facture?.clientAddress || "—"})`}
                        value={factureAdresse}
                        onChange={(e) => setFactureAdresse(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Code postal"
                          value={factureCodePostal}
                          onChange={(e) => setFactureCodePostal(e.target.value)}
                          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
                        />
                        <input
                          type="text"
                          placeholder="Ville"
                          value={factureVille}
                          onChange={(e) => setFactureVille(e.target.value)}
                          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
                        />
                      </div>
                      <input
                        type="email"
                        placeholder={`Email de facturation (défaut : ${client?.email || "—"})`}
                        value={factureEmail}
                        onChange={(e) => setFactureEmail(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
                      />
                      <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                        {hasOverride ? (
                          <button
                            type="button"
                            onClick={() => { setFactureNom(""); setFactureAdresse(""); setFactureCodePostal(""); setFactureVille(""); setFactureEmail(""); }}
                            className="text-xs text-red-400 hover:text-red-600 transition"
                          >
                            Réinitialiser — utiliser les coordonnées du client
                          </button>
                        ) : <span />}
                        <div className="flex items-center gap-2 shrink-0">
                          {hasOverride && (
                            <button
                              type="button"
                              onClick={saveAsReusableContact}
                              disabled={savingContact}
                              className="text-xs font-medium border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition"
                              title="Enregistrer ce contact sur le client pour le réutiliser sur d'autres factures"
                            >
                              {savingContact ? "…" : "Enregistrer comme contact"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={saveFactureA}
                            disabled={savingFactureA}
                            className="text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
                          >
                            {savingFactureA ? "Enregistrement…" : "Enregistrer le « Facturé à »"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ITEMS */}
          <div className="bg-white border rounded-xl shadow-sm p-5">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Lignes de facturation</h2>
                {echeanceRef && (
                  <p className="text-xs text-gray-400 mt-0.5">Prestations du devis réf. {facture.devisNumber}</p>
                )}
              </div>
              {!echeanceRef && (
                <button onClick={addItem} className="text-sm text-blue-600 hover:text-blue-800 font-medium transition">+ Ajouter</button>
              )}
            </div>
            <div className="space-y-3">
              {items.map((item, i) => {
                const net = itemNetTotal(item);
                const isSaved = item.label.trim() ? priceMap[item.label.trim()] === item.price : false;
                const pinBtn = (
                  <button
                    type="button"
                    onClick={() => isSaved ? removePriceForLabel(item.label) : savePriceForLabel(item.label, item.price)}
                    title={isSaved ? "Tarif mémorisé — cliquer pour oublier" : "Mémoriser ce tarif"}
                    className={`shrink-0 w-6 h-6 flex items-center justify-center rounded transition ${isSaved ? "text-amber-500 hover:text-gray-400" : "text-gray-300 hover:text-amber-500"}`}
                  >
                    <svg className="w-3.5 h-3.5" fill={isSaved ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </button>
                );
                return (
                  <div key={i} className="space-y-1.5 pb-3 border-b last:border-b-0 last:pb-0">
                    {/* Mobile layout */}
                    <div className="sm:hidden space-y-1.5">
                      <div className="flex gap-2 items-center">
                        <SuggestDropdown
                          value={item.label}
                          onChange={(v) => updateItem(i, "label", v)}
                          options={allPrestations}
                          placeholder="Description"
                          wrapperClassName="flex-1"
                          inputClassName="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition"
                          onCommit={(v) => { addCustomLabel(v); const p = priceMap[v.trim()]; if (p !== undefined) updateItem(i, "price", p); }}
                          removableLabels={customLabels}
                          onRemoveOption={removeCustomLabel}
                        />
                        <button type="button" onClick={() => duplicateItem(i)} title="Dupliquer" className="shrink-0 w-7 h-7 flex items-center justify-center text-gray-300 hover:text-blue-500 transition rounded-lg hover:bg-blue-50">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button onClick={() => removeItem(i)} disabled={items.length === 1} className="shrink-0 w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-500 disabled:opacity-0 transition rounded-lg hover:bg-red-50">✕</button>
                      </div>
                      <div className="flex gap-2 items-center">
                        <input className="w-14 shrink-0 border rounded-lg px-2 py-2 text-sm text-center outline-none focus:border-blue-400 transition" type="number" min="1" value={item.quantity} onChange={(e) => updateItem(i, "quantity", Math.max(1, Number(e.target.value)))} />
                        <input className="min-w-0 flex-1 border rounded-lg px-2 py-2 text-sm text-right outline-none focus:border-blue-400 transition" type="number" min="0" step="0.01" value={item.price} onChange={(e) => updateItem(i, "price", Number(e.target.value))} />
                        {item.label.trim() && pinBtn}
                        <span className="text-sm font-semibold text-gray-700 shrink-0 text-right">{fmtMoney(net)}</span>
                      </div>
                    </div>
                    {/* Desktop layout */}
                    <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                      <SuggestDropdown
                        value={item.label}
                        onChange={(v) => updateItem(i, "label", v)}
                        options={allPrestations}
                        placeholder="Description"
                        wrapperClassName="col-span-4"
                        inputClassName="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition"
                        onCommit={(v) => { addCustomLabel(v); const p = priceMap[v.trim()]; if (p !== undefined) updateItem(i, "price", p); }}
                        removableLabels={customLabels}
                        onRemoveOption={removeCustomLabel}
                      />
                      <input className="col-span-2 border rounded-lg px-3 py-2.5 text-sm text-center outline-none focus:border-blue-400 transition" type="number" min="1" value={item.quantity} onChange={(e) => updateItem(i, "quantity", Math.max(1, Number(e.target.value)))} />
                      <div className="col-span-2 flex items-center gap-1">
                        <input className="min-w-0 flex-1 border rounded-lg px-2 py-2.5 text-sm text-right outline-none focus:border-blue-400 transition" type="number" min="0" step="0.01" value={item.price} onChange={(e) => updateItem(i, "price", Number(e.target.value))} />
                        {item.label.trim() && pinBtn}
                      </div>
                      <span className="col-span-2 text-xs font-semibold text-gray-700 text-right pr-1">{fmtMoney(net)}</span>
                      <button type="button" onClick={() => duplicateItem(i)} title="Dupliquer" className="col-span-1 flex justify-center text-gray-300 hover:text-blue-500 transition rounded-lg hover:bg-blue-50">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      </button>
                      <button onClick={() => removeItem(i)} disabled={items.length === 1} className="col-span-1 flex justify-center text-gray-300 hover:text-red-500 disabled:opacity-0 transition">✕</button>
                    </div>
                    {/* Ligne remise */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 items-center ml-1">
                      <span className="text-xs text-gray-400 shrink-0">Remise :</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleDiscountType(i)}
                          className="px-2 py-1 rounded border text-xs font-medium text-gray-600 hover:bg-gray-100 transition shrink-0"
                          title="Basculer % / €"
                        >
                          {item.discountType === "amount" ? "€" : "%"}
                        </button>
                        <input
                          type="number" min="0" step="0.01"
                          placeholder="0"
                          value={item.discountValue || ""}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            updateItem(i, "discountValue", v);
                            if (!item.discountType) updateItem(i, "discountType", "percent");
                          }}
                          className="w-20 border rounded-lg px-2 py-1 text-xs text-right outline-none focus:border-blue-400 transition"
                        />
                      </div>
                      {item.discountValue ? (
                        <span className="text-xs text-orange-500">
                          - {item.discountType === "percent"
                            ? `${item.discountValue}% = ${fmtMoney(item.quantity * item.price * item.discountValue / 100)}`
                            : fmtMoney(item.discountValue)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Footer lignes */}
            <div className="mt-4 pt-3 border-t flex justify-between items-center">
              <span className="text-sm text-gray-500">
                {echeanceRef ? "Sous-total prestations" : "Total HT"}
              </span>
              <span className={`text-lg font-bold ${echeanceRef ? "text-gray-400" : "text-gray-900"}`}>
                {fmtMoney(itemsTotal)}
              </span>
            </div>

            {/* Section "Facturation actuelle" — visible uniquement sur les factures issues d'un devis à échéancier */}
            {echeanceRef && (
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-blue-800">Facturation actuelle</h3>
                  <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2.5 py-0.5 rounded-full">
                    Échéance {echeanceRef.index + 1}/{echeanceRef.count}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-blue-900 font-medium">{echeanceRef.label}</span>
                  {editingEcheanceRefMontant ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        step="0.01"
                        value={draftEcheanceRefMontant}
                        onChange={(e) => setDraftEcheanceRefMontant(e.target.value)}
                        onBlur={saveEcheanceRefMontant}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEcheanceRefMontant(); if (e.key === "Escape") setEditingEcheanceRefMontant(false); }}
                        className="w-32 text-right text-xl font-bold border-b-2 border-blue-400 bg-transparent outline-none text-blue-900"
                      />
                      <span className="text-blue-900 font-bold">€</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setDraftEcheanceRefMontant(String(echeanceRef.montant)); setEditingEcheanceRefMontant(true); }}
                      title="Modifier le montant"
                      className="text-2xl font-bold text-blue-900 hover:text-blue-600 transition cursor-text"
                    >
                      {fmtMoney(echeanceRef.montant)}
                    </button>
                  )}
                </div>
                {(facture.dateEcheance ?? facture.date) && (
                  <p className="text-xs text-blue-500 mt-1.5">Règlement attendu le {fmtDate((facture.dateEcheance ?? facture.date)!)}</p>
                )}
                {devisExpectedTotal !== null && siblingTotals.length > 0 && (() => {
                  const billed = siblingTotals.reduce((s, t) => s + t, 0);
                  const diff = Math.round((billed - devisExpectedTotal) * 100) / 100;
                  const balanced = Math.abs(diff) <= 0.01;
                  return (
                    <div className={`mt-3 pt-3 border-t flex items-center justify-between text-xs ${balanced ? "border-blue-200" : "border-orange-300"}`}>
                      <span className={balanced ? "text-blue-600" : "text-orange-700"}>
                        Total facturé sur ce devis
                      </span>
                      <span className={`font-semibold ${balanced ? "text-green-600" : "text-orange-700"}`}>
                        {fmtMoney(billed)} {balanced
                          ? "✓ équilibré"
                          : diff > 0
                            ? `(+${fmtMoney(diff)} excédent)`
                            : `(manque ${fmtMoney(-diff)})`
                        }
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            <button onClick={save} disabled={saving} className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-semibold transition">
              {saving ? "Sauvegarde…" : "Sauvegarder les modifications"}
            </button>
          </div>

          {/* ÉCHÉANCIER */}
          {echeances.length > 0 && !showEcheancierBuilder && (
            <div className="bg-white border rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">Échéancier de paiement</h2>
                <div className="flex gap-2">
                  <button onClick={openEditEcheancier} className="text-xs text-blue-600 hover:text-blue-800 font-medium transition">Modifier</button>
                  <button onClick={deleteEcheancier} className="text-xs text-red-400 hover:text-red-600 font-medium transition">Supprimer</button>
                </div>
              </div>
              {/* Barre de progression */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span className="text-green-600 font-medium">Reçu : {fmtMoney(displayPaidTotal)}</span>
                  <span className="text-orange-500 font-medium">Restant : {fmtMoney(displayPendingTotal)}</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: total > 0 ? `${Math.min(100, displayPaidTotal / total * 100)}%` : "0%" }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                {echeances.map((e, i) => {
                  const isPaid = echeanceIsPaid(i);
                  const echDate = e.date ? new Date(e.date.seconds * 1000) : new Date();
                  return (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition ${isPaid ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"}`}>
                      {!isDevis && (
                        <button onClick={() => toggleEcheance(i)} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition ${isPaid ? "bg-green-500 border-green-500" : "border-gray-400"}`} title={isPaid ? "Marquer non payé" : "Marquer payé"}>
                          {isPaid && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        </button>
                      )}
                      {isDevis && (
                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isPaid ? "bg-green-500 border-green-500" : "border-gray-300 bg-white"}`}>
                          {isPaid && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{e.label || `Échéance ${i + 1}`}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{fmtDateShort(e.date ?? null)}</div>
                      </div>
                      <div className="text-sm font-semibold text-gray-900 shrink-0">{fmtMoney(e.montant)}</div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${isPaid ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {isPaid ? "Payée" : "En attente"}
                      </span>
                      {!isDevis && (
                        <button
                          onClick={() => {
                            const mm = String(echDate.getMonth() + 1).padStart(2, '0')
                            const yyyy = echDate.getFullYear()
                            gcalAdd(
                              `Encaiss ${fmtMoney(e.montant)} ${facture.clientName} (${i + 1}/${echeances.length}) ${mm}/${yyyy} ${calNum(facture.number)}`,
                              echDate,
                              `Montant : ${fmtMoney(e.montant)} · ${facture.clientName}`
                            )
                          }}
                          className="shrink-0 text-gray-400 hover:text-blue-600 transition" title="Ajouter à Google Agenda"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {!isDevis && (
                <button onClick={save} disabled={saving} className="mt-4 w-full border border-blue-200 text-blue-600 hover:bg-blue-50 py-2 rounded-lg text-sm font-medium transition">
                  {saving ? "Sauvegarde…" : "Sauvegarder l'échéancier"}
                </button>
              )}
            </div>
          )}

          {/* CRÉER / MODIFIER ÉCHÉANCIER */}
          {(echeances.length === 0 || showEcheancierBuilder) && facture && (
            <div className="bg-white border rounded-xl shadow-sm p-5">
              {!showEcheancierBuilder ? (
                <button
                  onClick={() => {
                    const date1 = documentDate || "";
                    const date2 = date1 ? addOneMonth(date1) : "";
                    const initialRows: DraftEcheance[] = [
                      { label: "1ère mensualité", date: date1, montant: "" },
                      { label: "2ème mensualité", date: date2, montant: "" },
                    ];
                    setAutoBalance(true);
                    setDraftEcheances(total > 0 ? distributeEvenly(initialRows, total) : initialRows);
                    setShowEcheancierBuilder(true);
                  }}
                  className="w-full border-2 border-dashed border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 py-3 rounded-xl text-sm font-medium transition"
                >
                  + Créer un échéancier de paiement
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-700">{echeances.length > 0 ? "Modifier l'échéancier" : "Nouvel échéancier"}</h2>
                    <div className="flex items-center gap-2">
                      {autoBalance && total > 0 && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Auto</span>
                      )}
                      {!autoBalance && total > 0 && (
                        <button
                          type="button"
                          onClick={() => { setAutoBalance(true); setDraftEcheances((p) => distributeEvenly(p, total)); }}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2.5 py-0.5 rounded-full transition"
                        >
                          Rééquilibrer
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {draftEcheances.map((e, i) => (
                      <div key={i} className="space-y-1.5 pb-3 border-b last:border-b-0 last:pb-0 sm:pb-0 sm:border-b-0">
                        {/* Mobile layout */}
                        <div className="sm:hidden space-y-1.5">
                          <div className="flex gap-2 items-center">
                            <SuggestDropdown
                              value={e.label}
                              onChange={(v) => {
                                updateDraft(i, "label", v);
                                if (!autoBalance && !draftEcheances[i].manualMontant) {
                                  const pct = Number(v.match(/(\d+)\s*%/)?.[1] ?? 0);
                                  if (pct > 0) setDraftEcheances((p) => p.map((r, idx) =>
                                    idx === i ? { ...r, label: v, montant: String(Math.round(total * pct) / 100) } : r
                                  ));
                                }
                              }}
                              options={ECHEANCE_LABELS}
                              placeholder="Libellé"
                              wrapperClassName="flex-1"
                              inputClassName="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            {draftEcheances.length > 1 && (
                              <button onClick={() => removeDraftRow(i)} className="text-gray-400 hover:text-red-500 transition p-1 shrink-0">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            )}
                          </div>
                          <div className="flex gap-2 items-center">
                            <input
                              type="date"
                              value={e.date}
                              onChange={(ev) => updateDraft(i, "date", ev.target.value)}
                              className="flex-1 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <div className="flex items-center gap-1 flex-1">
                              <input
                                type="number"
                                value={e.montant}
                                onChange={(ev) => updateDraft(i, "montant", ev.target.value)}
                                placeholder="Montant"
                                className="flex-1 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                              />
                              {e.manualMontant && !autoBalance && /\d+\s*%/.test(e.label) && (
                                <button type="button" onClick={() => recalcDraft(i)} title="Recalculer d'après le %"
                                  className="text-xs text-blue-500 hover:text-blue-700 px-1">↻</button>
                              )}
                              {e.montant && (
                                <button type="button" onClick={() => setCopiedMontant(copiedMontant === e.montant ? null : e.montant)} title={copiedMontant === e.montant ? "Copié — cliquer pour effacer" : "Copier ce montant"} className={`shrink-0 transition ${copiedMontant === e.montant ? "text-blue-500" : "text-gray-300 hover:text-gray-500"}`}>
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                </button>
                              )}
                              {copiedMontant !== null && copiedMontant !== e.montant && (
                                <button type="button" onClick={() => { updateDraft(i, "montant", copiedMontant); setAutoBalance(false); }} title={`Coller ${copiedMontant} €`} className="shrink-0 text-blue-400 hover:text-blue-600 transition">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Desktop layout */}
                        <div className="hidden sm:grid grid-cols-12 gap-2 items-start">
                          <div className="col-span-4">
                            <SuggestDropdown
                              value={e.label}
                              onChange={(v) => {
                                updateDraft(i, "label", v);
                                if (!autoBalance && !draftEcheances[i].manualMontant) {
                                  const pct = Number(v.match(/(\d+)\s*%/)?.[1] ?? 0);
                                  if (pct > 0) setDraftEcheances((p) => p.map((r, idx) =>
                                    idx === i ? { ...r, label: v, montant: String(Math.round(total * pct) / 100) } : r
                                  ));
                                }
                              }}
                              options={ECHEANCE_LABELS}
                              placeholder="Libellé"
                              inputClassName="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              type="date"
                              value={e.date}
                              onChange={(ev) => updateDraft(i, "date", ev.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          </div>
                          <div className="col-span-3 flex items-center gap-1">
                            <input
                              type="number"
                              value={e.montant}
                              onChange={(ev) => updateDraft(i, "montant", ev.target.value)}
                              placeholder="Montant"
                              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            {e.manualMontant && !autoBalance && /\d+\s*%/.test(e.label) && (
                              <button type="button" onClick={() => recalcDraft(i)} title="Recalculer d'après le %"
                                className="text-xs text-blue-500 hover:text-blue-700 px-1">↻</button>
                            )}
                            {e.montant && (
                              <button type="button" onClick={() => setCopiedMontant(copiedMontant === e.montant ? null : e.montant)} title={copiedMontant === e.montant ? "Copié — cliquer pour effacer" : "Copier ce montant"} className={`shrink-0 transition ${copiedMontant === e.montant ? "text-blue-500" : "text-gray-300 hover:text-gray-500"}`}>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              </button>
                            )}
                            {copiedMontant !== null && copiedMontant !== e.montant && (
                              <button type="button" onClick={() => { updateDraft(i, "montant", copiedMontant); setAutoBalance(false); }} title={`Coller ${copiedMontant} €`} className="shrink-0 text-blue-400 hover:text-blue-600 transition">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                              </button>
                            )}
                          </div>
                          <div className="col-span-2 flex justify-end">
                            {draftEcheances.length > 1 && (
                              <button onClick={() => removeDraftRow(i)} className="text-gray-400 hover:text-red-500 transition p-1">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={addDraftRow} className="mt-3 text-sm text-blue-600 hover:underline">+ Ajouter une échéance</button>
                  {total > 0 && (() => {
                    const draftSum = draftEcheances.reduce((s, e) => s + (Number(e.montant) || 0), 0);
                    const diff = total - draftSum;
                    const balanced = Math.abs(diff) <= 0.01;
                    return (
                      <div className="mt-3 pt-3 border-t flex justify-between text-sm">
                        <span className="text-gray-500">Total échéances</span>
                        <span className={`font-semibold ${balanced ? "text-green-600" : "text-red-500"}`}>
                          {fmtMoney(draftSum)}{!balanced && ` (manque ${fmtMoney(diff)})`}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => setShowEcheancierBuilder(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition">
                      Annuler
                    </button>
                    <button onClick={applyEcheancierBuilder} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition">
                      {saving ? "Sauvegarde…" : "Appliquer l'échéancier"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* NOTES */}
          <div className="bg-white border rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Notes</h2>
            <textarea rows={3} className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition resize-none" placeholder="Conditions de paiement, mentions…" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={save} />
          </div>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          {/* RÉSUMÉ */}
          <div className="bg-white border rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Résumé</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-gray-600"><span>Total HT</span><span>{fmtMoney(total)}</span></div>
              {echeances.length > 0 && (
                <>
                  <div className="flex justify-between text-gray-500 text-xs"><span>Reçu</span><span className="text-green-600 font-medium">{fmtMoney(displayPaidTotal)}</span></div>
                  <div className="flex justify-between text-gray-500 text-xs"><span>Restant</span><span className="text-orange-600 font-medium">{fmtMoney(displayPendingTotal)}</span></div>
                </>
              )}
              <div className="border-t pt-3 flex justify-between font-bold text-gray-900">
                <span>Total</span><span className="text-lg">{fmtMoney(total)}</span>
              </div>
            </div>
          </div>

          {/* INFOS */}
          <div className="bg-white border rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Informations</h2>
            <div className="space-y-2.5 text-sm">
              <InfoRow label="Numéro" value={facture.number} />
              <InfoRow label="Type" value={docLabel} />
              <InfoRow label="Client" value={facture.clientName || "—"} />
              <InfoRow label="Date doc." value={fmtDate((facture.date ?? facture.createdAt) ?? null)} />
              {facture.devisNumber && facture.devisRef && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Réf. devis</span>
                  <button onClick={() => router.push(`/facturation/${facture.devisRef}`)} className="text-purple-600 hover:text-purple-800 hover:underline font-medium transition">
                    {facture.devisNumber}
                  </button>
                </div>
              )}
              {/* Abonnement — éditable inline */}
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-500 shrink-0">Abonnement</span>
                <input
                  type="text"
                  value={facture.abonnementTitre ?? ""}
                  onChange={(e) => setFacture((p) => p ? { ...p, abonnementTitre: e.target.value } : null)}
                  onBlur={async (e) => {
                    const v = e.target.value.trim() || undefined
                    await updateFacture(id, { abonnementTitre: v ?? null as any })
                  }}
                  placeholder="—"
                  className="text-right text-gray-900 font-medium text-sm bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 outline-none transition w-40 min-w-0"
                />
              </div>
              {/* Société — sélecteur inline */}
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-500 shrink-0">Société</span>
                <select
                  value={facture.companyId ?? ""}
                  onChange={async (e) => {
                    const cid = e.target.value
                    const picked = companies.find(c => c.id === cid) ?? null
                    await updateFacture(id, { companyId: cid || null as any })
                    setFacture((p) => p ? { ...p, companyId: cid || undefined } : null)
                    setCompany(picked)
                  }}
                  className="text-right text-gray-900 font-medium text-sm bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 outline-none transition max-w-[160px] cursor-pointer"
                >
                  <option value="">— Aucune —</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
              <InfoRow label="Statut" value={statusLabels[facture.status]} />
              <InfoRow label="Lignes" value={`${items.length} prestation${items.length > 1 ? "s" : ""}`} />
              {echeances.length > 0 && <InfoRow label="Échéances" value={`${echeances.filter((_, i) => echeanceIsPaid(i)).length}/${echeances.length} payées`} />}
              {echeanceRef && (() => {
                const grandTotal = itemsTotal;
                const dejaRegle = echeanceRef.cumulPrecedent ?? (echeanceRef.count > 0 ? (grandTotal / echeanceRef.count) * echeanceRef.index : 0);
                const reste = grandTotal - dejaRegle - echeanceRef.montant;
                return (
                  <>
                    <InfoRow label="Règlement actuel" value={fmtMoney(echeanceRef.montant)} />
                    {dejaRegle > 0.005 && <InfoRow label="Déjà réglé précédemment" value={fmtMoney(dejaRegle)} />}
                    {reste > 0.005 && <InfoRow label="Restera à régler ensuite" value={fmtMoney(reste)} />}
                  </>
                );
              })()}
              {facture.signed && <InfoRow label="Signé le" value={fmtDate(facture.signedAt ?? null)} />}
            </div>
          </div>

          {/* RÈGLEMENT */}
          {!isDevis && (
            <div className="bg-white border rounded-xl shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Règlement</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Date de paiement</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    onBlur={async () => {
                      const ts = paymentDate ? Timestamp.fromDate(new Date(paymentDate)) : undefined;
                      await updateFacture(id, { paymentDate: ts ?? null as any });
                      setFacture((p) => p ? { ...p, paymentDate: ts } : null);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Mode de paiement</label>
                  <select
                    value={paymentMethod}
                    onChange={async (e) => {
                      const v = e.target.value;
                      setPaymentMethod(v);
                      await updateFacture(id, { paymentMethod: v || null as any });
                      setFacture((p) => p ? { ...p, paymentMethod: v || undefined } : null);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition bg-white"
                  >
                    <option value="">— Non renseigné —</option>
                    <option value="Virement bancaire">Virement bancaire</option>
                    <option value="Chèque">Chèque</option>
                    <option value="Espèces">Espèces</option>
                    <option value="Carte bancaire">Carte bancaire</option>
                    <option value="Prélèvement automatique">Prélèvement automatique</option>
                    <option value="Autre">Autre</option>
                  </select>
                </div>
                {(paymentDate || paymentMethod) && (
                  <button
                    onClick={async () => {
                      setPaymentDate(""); setPaymentMethod("");
                      await updateFacture(id, { paymentDate: null as any, paymentMethod: null as any });
                      setFacture((p) => p ? { ...p, paymentDate: undefined, paymentMethod: undefined } : null);
                    }}
                    className="text-xs text-red-400 hover:text-red-600 transition"
                  >
                    Effacer
                  </button>
                )}
              </div>
            </div>
          )}

          {/* GOOGLE AGENDA */}
          <div className="bg-white border rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Google Agenda</h2>
            <div className="space-y-2">
              <button
                onClick={() => gcalAdd(
                  `Envoi ${calNum(facture.number)} ${fmtMoney(total)} ${facture.clientName}`,
                  docDate,
                  `${docLabel} de ${fmtMoney(total)} pour ${facture.clientName}`
                )}
                className="flex items-center gap-2 w-full px-3 py-2.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                Ajouter envoi au calendrier
              </button>
              <button
                onClick={() => gcalAdd(
                  `Relance ${calNum(facture.number)} ${fmtMoney(total)} ${facture.clientName}`,
                  new Date(docDate.getTime() + 30 * 24 * 3600 * 1000),
                  `Relancer le client pour le règlement du ${docLabel.toLowerCase()} ${facture.number}`
                )}
                className="flex items-center gap-2 w-full px-3 py-2.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                <svg className="w-4 h-4 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                Ajouter relance (J+30) au calendrier
              </button>
              {!isDevis && (() => {
                const mm = String(docDate.getMonth() + 1).padStart(2, '0')
                const yyyy = docDate.getFullYear()
                const seq = echeanceRef
                  ? `(${echeanceRef.index + 1}/${echeanceRef.count})`
                  : '(1/1)'
                return (
                  <button
                    onClick={() => gcalAdd(
                      `Encaiss ${fmtMoney(total)} ${facture.clientName} ${seq} ${mm}/${yyyy} ${calNum(facture.number)}`,
                      docDate,
                      `Montant : ${fmtMoney(total)} · ${facture.clientName}`
                    )}
                    className="flex items-center gap-2 w-full px-3 py-2.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Encaiss {seq} — {fmtMoney(total)} — {mm}/{yyyy}
                  </button>
                )
              })()}
            </div>
          </div>

          {/* TÉLÉCHARGER + PARTAGER PDF */}
          <div className="space-y-2">
            {facture.pdfUrl && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
                <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-xs font-semibold text-green-700">PDF stocké en ligne</span>
                <a href={facture.pdfUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-green-600 hover:text-green-800 underline transition">Voir</a>
              </div>
            )}
            <button onClick={handlePDF} disabled={generatingPdf} className="w-full flex items-center justify-center gap-2 py-3 bg-gray-800 hover:bg-gray-900 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              {generatingPdf ? "Génération…" : `Télécharger ${docLabel.toLowerCase()} PDF`}
            </button>
            <button onClick={handleUploadAndShare} disabled={pdfUploading} className="w-full flex items-center justify-center gap-2 py-2.5 border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-60 rounded-xl text-sm font-medium transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              {pdfUploading ? "Upload en cours…" : facture.pdfUrl ? "Mettre à jour & Partager" : "Stocker & Partager"}
            </button>
            {facture.pdfUrl && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-blue-700">Partager :</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const phone = (client?.telephone ?? "").replace(/\D/g, "");
                      const msg = encodeURIComponent(`Bonjour,\n\nVeuillez trouver votre ${docLabel.toLowerCase()} ${facture.number} ici :\n\n${facture.pdfUrl}\n\nCordialement`);
                      window.open(phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                  </button>
                  <button
                    onClick={() => {
                      const clientEmail = client?.email ?? "";
                      const billingEmail = facture.factureEmail ?? "";
                      const billingSet = !!facture.factureNom;
                      // "Facturé à" renseigné avec un email → destinataire = facturé à, client en CC
                      if (billingSet && billingEmail) {
                        setEmailModal({ to: billingEmail, cc: clientEmail && clientEmail !== billingEmail ? clientEmail : "", cci: "" });
                      } else {
                        setEmailModal({ to: clientEmail, cc: "", cci: "" });
                      }
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    Email
                  </button>
                  <button
                    onClick={() => { navigator.clipboard.writeText(facture.pdfUrl!); showToast("Lien copié !"); }}
                    className="px-3 py-2 border rounded-lg text-xs text-gray-600 hover:bg-gray-100 transition"
                    title="Copier le lien"
                  >
                    📋
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SIGNATURE EN LIGNE (lien public) */}
          {isDevis && (
            <div className="bg-white border rounded-xl shadow-sm p-4 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                <p className="text-sm font-semibold text-gray-800">Signature en ligne</p>
              </div>
              {!facture.signToken ? (
                <>
                  <p className="text-xs text-gray-500">Génère un lien sécurisé pour que le client consulte et signe ce devis en ligne (sans compte).</p>
                  <button onClick={activateSignLink} className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition">
                    Activer la signature en ligne
                  </button>
                </>
              ) : (() => {
                // Lien sur le domaine de la MARQUE de la société (Enezo → app.enezo.fr) : pas d'URL « tc-connect » à un client Enezo.
                const origin = publicLinkOrigin(company?.marque, typeof window !== "undefined" ? window.location.origin : "");
                const signLink = `${origin}/signer-devis/${facture.signToken}`;
                const msg = `Bonjour,\n\nVoici votre devis ${facture.number} à consulter et signer en ligne :\n\n${signLink}\n\nCordialement`;
                const phone = (client?.telephone ?? "").replace(/\D/g, "");
                return (
                  <>
                    <div className="flex gap-2">
                      <input readOnly value={signLink} onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 min-w-0 text-xs text-gray-600 bg-gray-50 border rounded-lg px-2.5 py-2 outline-none" />
                      <button onClick={() => { navigator.clipboard.writeText(signLink); showToast("Lien copié !"); }}
                        className="px-3 py-2 border rounded-lg text-xs text-gray-600 hover:bg-gray-100 transition" title="Copier le lien">📋</button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank")}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        WhatsApp
                      </button>
                      <button onClick={() => setEmailModal({ to: client?.email ?? "", cc: "", cci: "" })}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        Email
                      </button>
                      <a href={`sms:${(client?.telephone ?? "").trim()}?&body=${encodeURIComponent(msg)}`}
                        className="flex items-center justify-center px-3 py-2 border rounded-lg text-xs text-gray-600 hover:bg-gray-100 transition" title="SMS">SMS</a>
                    </div>
                    {facture.signed && (
                      <p className="text-xs text-emerald-700">✓ Devis déjà signé en ligne — le lien n'est plus signable.</p>
                    )}
                    <button onClick={regenerateSignLink} className="text-xs text-gray-400 hover:text-red-500 transition underline">
                      Régénérer le lien (révoque l'ancien)
                    </button>
                  </>
                );
              })()}
            </div>
          )}

          {/* SIGNATURE */}
          {isDevis && facture.signed && facture.signatureUrl && (
            <div className="bg-white border rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-600 mb-2">Signature</p>
              <img src={facture.signatureUrl} alt="Signature" className="max-h-20 border rounded-lg bg-gray-50 p-1" />
              {facture.signedAt && <p className="text-xs text-gray-400 mt-1">Signé le {fmtDate(facture.signedAt)}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right ml-2">{value}</span>
    </div>
  );
}

function SignaturePad({ onConfirm, onCancel }: { onConfirm: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * sx, y: ((e as React.MouseEvent).clientY - rect.top) * sy };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    setDrawing(true);
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPos.current) return;
    e.preventDefault();
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    setHasStroke(true);
  };

  const endDraw = () => { setDrawing(false); lastPos.current = null; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  };

  const importFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        setHasStroke(true);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-0.5">Signature du devis</h2>
        <p className="text-xs text-gray-500 mb-4">Dessinez ci-dessous ou importez une image de signature.</p>
        <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-gray-50 cursor-crosshair select-none">
          <canvas
            ref={canvasRef}
            width={600}
            height={180}
            className="w-full touch-none"
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button onClick={clear} className="text-xs text-gray-400 hover:text-red-500 transition underline">Effacer</button>
          <label className="text-xs text-blue-600 hover:text-blue-800 transition underline cursor-pointer">
            Importer une image
            <input type="file" accept="image/*" className="hidden" onChange={importFile} />
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 border rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-100 transition">Annuler</button>
          <button
            onClick={() => { const c = canvasRef.current; if (c && hasStroke) onConfirm(c.toDataURL("image/png")); }}
            disabled={!hasStroke}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg py-2.5 text-sm font-semibold transition"
          >
            ✓ Confirmer la signature
          </button>
        </div>
      </div>
    </div>
  );
}
