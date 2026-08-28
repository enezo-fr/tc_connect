"use client";

import { useEffect, useRef, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useInvoices } from "@/hooks/useInvoices";
import { useCompanies } from "@/hooks/useCompanies";
import { useClients } from "@/hooks/useClients";
import { updateFacture, deleteFacture, generateNextEcheanceFacture } from "@/lib/facturationService";
import { generateInvoicePDFBlob } from "@/lib/invoicePdf";
import { uploadBlob } from "@/lib/uploadImage";
import { Timestamp } from "firebase/firestore";
import type { Facture, FactureStatus, FactureType } from "@/types";

const STATUS_LABEL: Record<FactureStatus, string> = {
  draft: "Brouillon",
  pending: "En attente",
  sent: "Envoyé",
  paid: "Payée",
  encaissement: "À encaisser",
  overdue: "En retard",
  cancelled: "Annulée",
  accepted: "Accepté",
  rejected: "Non validé",
};

const STATUS_COLOR: Record<FactureStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  pending: "bg-yellow-100 text-yellow-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  encaissement: "bg-violet-100 text-violet-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-400",
  accepted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-orange-100 text-orange-700",
};

const STATUSES_FACTURE: FactureStatus[] = ["draft", "pending", "sent", "encaissement", "paid", "overdue", "cancelled"];
const STATUSES_DEVIS: FactureStatus[] = ["draft", "pending", "sent", "accepted", "rejected", "cancelled"];

function ClientMultiSelect({ clients, selected, onChange }: {
  clients: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) { setOpen(false); setSearch(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen((o) => !o);
  };

  const filtered = clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);

  const label = selected.length === 0
    ? "Tous les clients"
    : selected.length === 1
    ? (clients.find((c) => c.id === selected[0])?.name ?? "1 client")
    : `${selected.length} clients`;

  return (
    <div className="flex-1 min-w-[160px]">
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className={`w-full flex items-center justify-between gap-2 border rounded-lg px-2.5 py-2 text-sm bg-white outline-none transition ${selected.length > 0 ? "border-blue-400 text-blue-700 font-medium" : "border-gray-200 text-gray-600"}`}
      >
        <span className="truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: Math.max(pos.width, 260) }}
          className="z-[9999] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b">
            <input
              autoFocus
              type="text"
              placeholder="Rechercher un client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            />
          </div>
          {selected.length > 0 && (
            <div className="px-3 py-1.5 border-b">
              <button onClick={() => onChange([])} className="text-xs text-red-400 hover:text-red-600 font-medium transition">
                Tout désélectionner ({selected.length})
              </button>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-400 text-center">Aucun résultat</div>
            ) : filtered.map((c) => {
              const checked = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition ${checked ? "bg-blue-50" : ""}`}
                >
                  <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition ${checked ? "bg-blue-600 border-blue-600" : "border-gray-300"}`}>
                    {checked && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </span>
                  <span className={checked ? "font-medium text-blue-700" : "text-gray-700"}>{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChanger({ facture }: { facture: Facture }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isDevis = facture.type === "devis";
  const statuses = isDevis ? STATUSES_DEVIS : STATUSES_FACTURE;
  const labels: Record<FactureStatus, string> = { ...STATUS_LABEL, sent: isDevis ? "Envoyé" : "Envoyée" };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((o) => !o);
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLOR[facture.status]}`}
      >
        {labels[facture.status]}
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-[9999] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden min-w-[180px]"
          onClick={(e) => e.stopPropagation()}
        >
          {statuses.filter((s) => s !== facture.status).map((s) => (
            <button
              key={s}
              onClick={(e) => {
                e.stopPropagation();
                // « Payée » pose la date de règlement du jour si elle manque : c'est
                // elle qui décide du mois de déclaration URSSAF (encaissement).
                updateFacture(facture.id, s === "paid" && !facture.paymentDate
                  ? { status: s, paymentDate: Timestamp.now() }
                  : { status: s });
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition border-b border-gray-50 last:border-0"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLOR[s].split(" ")[0].replace("100", "400")}`} />
              {labels[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(ts: Facture["createdAt"]): string {
  if (!ts) return "—";
  return new Date(ts.seconds * 1000).toLocaleDateString("fr-FR");
}

export default function FacturationPage() {
  const { currentUser } = useAuth();
  const { invoices, loading } = useInvoices(currentUser?.uid ?? "");
  const { companies } = useCompanies();
  const { clients } = useClients();

  const resolveClientName = (f: Facture): string => {
    const client = clients.find((c) => c.id === f.clientId);
    if (client) return [client.nom, client.prenom].filter(Boolean).join(" ");
    // fallback : stocker "undefined" → le nettoyer
    return (f.clientName ?? "").replace(/\bundefined\b/gi, "").replace(/\s+/g, " ").trim() || "—";
  };
  const searchParams = useSearchParams();

  const savedFilters = (() => {
    try { return JSON.parse(sessionStorage.getItem("facturation_filters") ?? "null") ?? {}; }
    catch { return {}; }
  })();

  const [docTab, setDocTab] = useState<FactureType>(() =>
    searchParams.get("tab") === "devis" ? "devis" : (savedFilters.docTab ?? "facture")
  );
  const [filter, setFilter] = useState<FactureStatus | "all">(savedFilters.filter ?? "all");
  const [search, setSearch] = useState(savedFilters.search ?? "");
  const [filterCompany, setFilterCompany] = useState(savedFilters.filterCompany ?? "");
  const [filterYear, setFilterYear] = useState(savedFilters.filterYear ?? "");
  const [filterMonth, setFilterMonth] = useState(savedFilters.filterMonth ?? "");
  const [filterClients, setFilterClients] = useState<string[]>(savedFilters.filterClients ?? []);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [batchUploading, setBatchUploading] = useState(false);
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); setLastSelectedIdx(null); };
  const [confirmFixGaps, setConfirmFixGaps] = useState(false);
  const [fixingGaps, setFixingGaps] = useState(false);
  const [confirmReorderByDate, setConfirmReorderByDate] = useState(false);
  const [reorderingByDate, setReorderingByDate] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; field: "number" | "date"; value: string } | null>(null);
  const [generatingEcheance, setGeneratingEcheance] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    sessionStorage.setItem("facturation_filters", JSON.stringify({
      docTab, filter, search, filterCompany, filterYear, filterMonth, filterClients,
    }));
  }, [docTab, filter, search, filterCompany, filterYear, filterMonth, filterClients]);

  useEffect(() => {
    if (!loading) {
      const saved = sessionStorage.getItem("facturation_scroll");
      if (saved !== null) {
        sessionStorage.removeItem("facturation_scroll");
        const y = parseInt(saved, 10);
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
      }

      const now = Date.now();
      const overdue = invoices.filter((f) => {
        if ((f.type ?? "facture") !== "facture") return false;
        if (f.status !== "sent") return false;
        const ts = f.date ?? f.createdAt;
        return ts && new Date(ts.seconds * 1000).getTime() < now;
      });
      if (overdue.length > 0) {
        overdue.forEach((f) => updateFacture(f.id, { status: "overdue" }));
      }
    }
  }, [loading]);

  const toDateInput = (f: Facture) => {
    const ts = f.date ?? f.createdAt;
    return ts ? new Date(ts.seconds * 1000).toISOString().split("T")[0] : "";
  };
  const saveEditCell = async (cell: { id: string; field: "number" | "date"; value: string }) => {
    setEditCell(null);
    if (!cell.value.trim()) return;
    if (cell.field === "number") {
      await updateFacture(cell.id, { number: cell.value.trim() });
    } else {
      await updateFacture(cell.id, { date: Timestamp.fromDate(new Date(cell.value)) });
    }
  };

  const uploadPdf = async (f: Facture) => {
    setUploadingIds((p) => new Set(p).add(f.id));
    try {
      const co = companies.find((c) => c.id === f.companyId) ?? null;
      const blob = await generateInvoicePDFBlob(f, co);
      const url = await uploadBlob(blob, `users/${f.userId}/factures/${f.id}.pdf`);
      await updateFacture(f.id, { pdfUrl: url });
    } catch { /* silencieux */ }
    finally { setUploadingIds((p) => { const s = new Set(p); s.delete(f.id); return s; }); }
  };
  const toggleSelect = (id: string, idx: number, shiftKey = false) => {
    if (shiftKey && lastSelectedIdx !== null) {
      const lo = Math.min(lastSelectedIdx, idx);
      const hi = Math.max(lastSelectedIdx, idx);
      const rangeIds = visible.slice(lo, hi + 1).map((f) => f.id);
      setSelectedIds((p) => { const s = new Set(p); rangeIds.forEach((rid) => s.add(rid)); return s; });
    } else {
      setSelectedIds((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
      setLastSelectedIdx(idx);
    }
  };

  const seqNum = (number: string) => parseInt(number?.split("_")[1] ?? "0", 10);
  const factures = invoices
    .filter((f) => (f.type ?? "facture") === docTab)
    .sort((a, b) => seqNum(b.number) - seqNum(a.number));

  const availableYears = [...new Set(
    factures.map(f => { const ts = f.date ?? f.createdAt; return ts ? new Date(ts.seconds * 1000).getFullYear() : null; }).filter(Boolean) as number[]
  )].sort((a, b) => b - a);

  const availableClients = (() => {
    const seen = new Set<string>();
    return factures
      .filter(f => { if (!f.clientId || seen.has(f.clientId)) return false; seen.add(f.clientId); return true; })
      .map(f => ({ id: f.clientId, name: resolveClientName(f) }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  })();

  const MONTHS_FR_FULL = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  const visible = factures
    .filter((f) => filter === "all" || f.status === filter)
    .filter((f) => !filterCompany || f.companyId === filterCompany)
    .filter((f) => filterClients.length === 0 || filterClients.includes(f.clientId))
    .filter((f) => {
      if (!filterYear && !filterMonth) return true;
      const ts = f.date ?? f.createdAt;
      if (!ts) return false;
      const d = new Date(ts.seconds * 1000);
      if (filterYear && d.getFullYear() !== parseInt(filterYear)) return false;
      if (filterMonth && d.getMonth() + 1 !== parseInt(filterMonth)) return false;
      return true;
    })
    .filter(
      (f) =>
        !search ||
        f.number?.toLowerCase().includes(search.toLowerCase()) ||
        resolveClientName(f).toLowerCase().includes(search.toLowerCase())
    );

  // ── Alertes numérotation ──────────────────────────────────────────────────
  const sortedNums = [...factures].sort((a, b) => seqNum(a.number) - seqNum(b.number)).map(f => seqNum(f.number)).filter(n => n > 0);
  const dupNums = sortedNums.filter((n, i) => sortedNums.indexOf(n) !== i);
  const dupIds = new Set(factures.filter(f => dupNums.includes(seqNum(f.number))).map(f => f.id));
  const gapNums: number[] = [];
  for (let i = 1; i < sortedNums.length; i++) {
    for (let g = sortedNums[i - 1] + 1; g < sortedNums[i]; g++) gapNums.push(g);
  }

  const fixGaps = async () => {
    setFixingGaps(true);
    try {
      const sorted = [...factures].sort((a, b) => seqNum(a.number) - seqNum(b.number));
      await Promise.all(
        sorted.flatMap((f, idx) => {
          const parts = f.number?.split("_") ?? [];
          if (parts.length < 3) return [];
          const newNum = `${parts[0]}_${String(idx + 1).padStart(3, "0")}_${parts.slice(2).join("_")}`;
          return newNum !== f.number ? [updateFacture(f.id, { number: newNum })] : [];
        })
      );
    } finally {
      setFixingGaps(false);
      setConfirmFixGaps(false);
    }
  };

  const allVisibleSelected = visible.length > 0 && visible.every((f) => selectedIds.has(f.id));
  const toggleAll = () => setSelectedIds(allVisibleSelected ? new Set() : new Set(visible.map((f) => f.id)));
  const uploadSelected = async () => {
    setBatchUploading(true);
    const toUpload = visible.filter((f) => selectedIds.has(f.id));
    for (const f of toUpload) await uploadPdf(f);
    setBatchUploading(false);
    setSelectedIds(new Set());
  };

  // ── Alerte numéros non chronologiques par rapport aux dates ───────────────
  // Sort stable : à date égale, on garde l'ordre des seqNum existants (pas de faux positif)
  const sortByDateThenSeq = (arr: typeof factures) =>
    [...arr].sort((a, b) => {
      const ta = (a.date ?? a.createdAt)?.seconds ?? 0;
      const tb = (b.date ?? b.createdAt)?.seconds ?? 0;
      return ta !== tb ? ta - tb : seqNum(a.number) - seqNum(b.number);
    });

  const dateOrderAnomalies = (() => {
    const withDate = factures.filter((f) => f.date || f.createdAt);
    const byDate = sortByDateThenSeq(withDate);
    const issues: { lo: (typeof factures)[0]; hi: (typeof factures)[0] }[] = [];
    for (let i = 0; i < byDate.length - 1; i++) {
      if (seqNum(byDate[i].number) > seqNum(byDate[i + 1].number)) {
        issues.push({ lo: byDate[i], hi: byDate[i + 1] });
      }
    }
    return issues;
  })();

  const reorderByDate = async () => {
    setReorderingByDate(true);
    try {
      const withDate = factures.filter((f) => f.date || f.createdAt);
      const sorted = sortByDateThenSeq(withDate);
      await Promise.all(sorted.flatMap((f, idx) => {
        const parts = f.number?.split("_") ?? [];
        if (parts.length < 3) return [];
        const newNum = `${parts[0]}_${String(idx + 1).padStart(3, "0")}_${parts.slice(2).join("_")}`;
        return newNum !== f.number ? [updateFacture(f.id, { number: newNum })] : [];
      }));
    } finally {
      setReorderingByDate(false);
      setConfirmReorderByDate(false);
    }
  };

  // ── Alertes dates facture < devis ─────────────────────────────────────────
  const fmtD = (ts: { seconds: number }) => new Date(ts.seconds * 1000).toLocaleDateString("fr-FR");
  const dateAnomalies = invoices
    .filter((f) => (f.type ?? "facture") === "facture" && f.devisRef)
    .flatMap((f) => {
      const devis = invoices.find((d) => d.id === f.devisRef);
      if (!devis) return [];
      const fd = f.date ?? f.createdAt;
      const dd = devis.date ?? devis.createdAt;
      if (!fd || !dd || fd.seconds >= dd.seconds) return [];
      return [{ facture: f.number, devis: devis.number, fDate: fmtD(fd), dDate: fmtD(dd), fId: f.id }];
    });

  const paidFactures = invoices.filter((f) => f.status === "paid" && (f.type ?? "facture") === "facture");
  const ca = paidFactures.reduce((acc, f) => acc + (f.total ?? 0), 0);
  const pending = invoices.filter((f) => (f.status === "pending" || f.status === "sent" || f.status === "overdue") && (f.type ?? "facture") === "facture").length;
  const overdue = invoices.filter((f) => f.status === "overdue" && (f.type ?? "facture") === "facture").length;
  const drafts = invoices.filter((f) => f.status === "draft").length;
  const devisCount = invoices.filter((f) => f.type === "devis").length;
  const devisSent = invoices.filter((f) => f.type === "devis" && f.status === "sent").length;

  const now = new Date();
  const getMonthCA = (offset: number) => {
    let m = now.getMonth() + offset;
    let y = now.getFullYear();
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    return paidFactures
      .filter((f) => { const ts = f.date ?? f.createdAt; if (!ts) return false; const d = new Date(ts.seconds * 1000); return d.getMonth() === m && d.getFullYear() === y; })
      .reduce((acc, f) => acc + (f.total ?? 0), 0);
  };
  const caM0 = getMonthCA(0);
  const caM1 = getMonthCA(-1);
  const caM2 = getMonthCA(-2);
  const caYear = paidFactures
    .filter((f) => { const ts = f.date ?? f.createdAt; if (!ts) return false; return new Date(ts.seconds * 1000).getFullYear() === now.getFullYear(); })
    .reduce((acc, f) => acc + (f.total ?? 0), 0);
  const monthTrend = caM1 > 0 ? Math.round(((caM0 - caM1) / caM1) * 100) : null;

  const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const monthName = (offset: number) => { let m = now.getMonth() + offset; while (m < 0) m += 12; while (m > 11) m -= 12; return MONTHS_FR[m]; };

  // Devis acceptés avec échéancier dont toutes les factures ne sont pas encore émises
  const pendingEcheances = invoices
    .filter((f) => f.type === "devis" && f.status === "accepted" && f.echeances && f.echeances.length > 0)
    .flatMap((devis) => {
      const already = (devis.convertedToFactureIds ?? (devis.convertedToFactureId ? [devis.convertedToFactureId] : [])).length;
      return (devis.echeances ?? []).slice(already).map((ech, i) => ({
        devis,
        echeance: ech,
        index: already + i,
        daysLeft: ech.date ? Math.round(((ech.date as any).toMillis() - Date.now()) / 86400000) : null,
      }));
    })
    .filter(({ daysLeft }) => daysLeft === null || daysLeft <= 7)
    .sort((a, b) => {
      const ta = a.echeance.date ? (a.echeance.date as any).toMillis() : 0;
      const tb = b.echeance.date ? (b.echeance.date as any).toMillis() : 0;
      return ta - tb;
    });

  const handleGenerateEcheance = async (devisId: string) => {
    if (!currentUser) return;
    setGeneratingEcheance(devisId);
    try {
      const newId = await generateNextEcheanceFacture(devisId, currentUser.uid);
      if (newId) router.push(`/facturation/${newId}`);
    } finally {
      setGeneratingEcheance(null);
    }
  };

  return (
    <div className="min-h-screen">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Facturation</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gérez vos factures et paiements</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/facturation/bilan"
            className="border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg text-sm font-medium transition whitespace-nowrap"
          >
            Bilan URSSAF
          </Link>
          <Link
            href={`/facturation/create${docTab === "devis" ? "?type=devis" : ""}`}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg text-sm font-medium transition whitespace-nowrap"
          >
            {docTab === "devis" ? "+ Nouveau devis" : "+ Nouvelle facture"}
          </Link>
        </div>
      </div>

      {/* ALERTE ÉCHÉANCES À ÉMETTRE */}
      {pendingEcheances.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-orange-500 text-lg shrink-0">⚠</span>
            <p className="text-sm font-semibold text-orange-800">
              {pendingEcheances.length} facture{pendingEcheances.length > 1 ? "s" : ""} à émettre (échéancier)
            </p>
          </div>
          <div className="pl-7 space-y-2">
            {pendingEcheances.map(({ devis, echeance, index, daysLeft }) => {
              const label = echeance.label || `Règlement ${index + 1}/${devis.echeances!.length}`;
              const dateStr = echeance.date
                ? (echeance.date as any).toDate().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
                : "—";
              const tag = daysLeft === null ? null : daysLeft < 0
                ? { text: `en retard de ${-daysLeft}j`, cls: "text-red-600 font-semibold" }
                : daysLeft === 0
                  ? { text: "aujourd'hui", cls: "text-orange-600 font-semibold" }
                  : { text: `dans ${daysLeft}j`, cls: "text-orange-500" };
              const isGenerating = generatingEcheance === devis.id;
              return (
                <div key={`${devis.id}-${index}`} className="flex items-center gap-3 text-xs py-1.5 px-2 -mx-2 rounded-lg bg-white/50 border border-orange-100">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-800">{devis.clientName || "—"}</span>
                    <span className="text-gray-400 mx-1">·</span>
                    <span className="text-gray-600">{label}</span>
                    <span className="text-gray-400 mx-1">·</span>
                    <span className="text-gray-500">{dateStr}</span>
                    {tag && <span className={`ml-1 ${tag.cls}`}>({tag.text})</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => router.push(`/facturation/${devis.id}`)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Voir devis
                    </button>
                    <button
                      onClick={() => handleGenerateEcheance(devis.id)}
                      disabled={isGenerating}
                      className="text-xs font-medium bg-orange-600 hover:bg-orange-700 text-white px-2.5 py-1 rounded-lg transition disabled:opacity-50"
                    >
                      {isGenerating ? "…" : "Émettre"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STATS */}
      <div className="space-y-3 mb-6">
        {/* Ligne 1 — CA */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard title="CA de l'année" value={`${caYear.toLocaleString("fr-FR")} €`} sub={String(now.getFullYear())} color="text-green-600" />
          <StatCard
            title={`CA ${monthName(0)}`}
            value={`${caM0.toLocaleString("fr-FR")} €`}
            sub="Ce mois"
            color="text-green-600"
            trend={monthTrend !== null ? monthTrend : undefined}
          />
          <StatCard title="CA total" value={`${ca.toLocaleString("fr-FR")} €`} sub="Toutes périodes payées" color="text-gray-900" />
          <StatCard title="Envoyé(e)s" value={String(pending)} sub="Envoyées / En retard" color="text-orange-600" />
        </div>
        {/* Ligne 2 — Documents */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard title="Factures émises" value={String(invoices.filter((f) => (f.type ?? "facture") === "facture").length)} sub="Toutes statuts" color="text-gray-900" />
          <StatCard title="En retard" value={String(overdue)} sub="Paiement dépassé" color="text-red-600" />
          <StatCard title="Brouillons" value={String(drafts)} sub="Factures + devis" color="text-gray-400" />
          <StatCard title="Devis en attente" value={String(devisSent)} sub={`Sur ${devisCount} devis total`} color="text-purple-600" />
        </div>
        {/* Tendance CA — 3 derniers mois */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="text-xs font-medium text-gray-500 mb-3">Tendance CA — 3 derniers mois</div>
          <div className="grid grid-cols-3 gap-3">
            {([{ label: monthName(-2), ca: caM2, cur: false }, { label: monthName(-1), ca: caM1, cur: false }, { label: monthName(0), ca: caM0, cur: true }] as const).map(({ label, ca: mca, cur }, i, arr) => {
              const prev = i > 0 ? arr[i - 1].ca : null;
              const tpct = prev !== null && prev > 0 ? Math.round(((mca - prev) / prev) * 100) : null;
              return (
                <div key={i} className={`text-center px-3 py-3 rounded-lg ${cur ? "bg-blue-50 border border-blue-100" : "bg-gray-50"}`}>
                  <div className="text-xs text-gray-500 mb-1 font-medium">{label}</div>
                  <div className={`text-lg font-bold ${cur ? "text-blue-700" : "text-gray-700"}`}>{mca.toLocaleString("fr-FR")} €</div>
                  {tpct !== null && (
                    <div className={`text-xs font-medium mt-1 ${tpct > 0 ? "text-green-600" : tpct < 0 ? "text-red-500" : "text-gray-400"}`}>
                      {tpct > 0 ? "↑" : tpct < 0 ? "↓" : "="} {Math.abs(tpct)}% vs mois préc.
                    </div>
                  )}
                  {tpct === null && prev === 0 && i > 0 && (
                    <div className="text-xs text-gray-400 mt-1">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* TABLE CARD */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {/* TABS */}
        <div className="px-4 pt-3 border-b flex gap-1">
          {(["facture", "devis"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setDocTab(t); setFilter("all"); setFilterYear(""); setFilterMonth(""); setFilterClients([]); }}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition -mb-px border-b-2 ${
                docTab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "facture" ? "Factures" : `Devis (${devisCount})`}
            </button>
          ))}
        </div>

        {/* FILTERS */}
        <div className="px-4 py-3 border-b flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Rechercher par numéro ou client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
            />
            {companies.length > 1 && (
              <select
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className={`border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-400 transition bg-white ${filterCompany ? "border-blue-400 text-blue-700 font-medium" : "text-gray-600"}`}
              >
                <option value="">Toutes sociétés</option>
                {companies.map((co) => <option key={co.id} value={co.id}>{co.nom}</option>)}
              </select>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filterYear}
              onChange={(e) => { setFilterYear(e.target.value); if (!e.target.value) setFilterMonth(""); }}
              className={`border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-400 transition bg-white ${filterYear ? "border-blue-400 text-blue-700 font-medium" : "text-gray-600"}`}
            >
              <option value="">Toutes années</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              disabled={!filterYear}
              className={`border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-400 transition bg-white disabled:opacity-40 ${filterMonth ? "border-blue-400 text-blue-700 font-medium" : "text-gray-600"}`}
            >
              <option value="">Tous les mois</option>
              {MONTHS_FR_FULL.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <ClientMultiSelect
              clients={availableClients}
              selected={filterClients}
              onChange={setFilterClients}
            />
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              {(docTab === "devis"
                ? (["all", "draft", "pending", "sent", "accepted", "rejected", "cancelled"] as const)
                : (["all", "draft", "pending", "sent", "paid", "overdue", "cancelled"] as const)
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    filter === s
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {s === "all" ? "Toutes" : STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {(filter !== "all" || search || filterYear || filterMonth || filterClients.length > 0 || filterCompany) && (
              <button
                onClick={() => { setFilter("all"); setSearch(""); setFilterYear(""); setFilterMonth(""); setFilterClients([]); setFilterCompany(""); }}
                className="text-xs text-red-400 hover:text-red-600 font-medium transition whitespace-nowrap"
              >
                ✕ Réinitialiser les filtres
              </button>
            )}
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-lg border transition whitespace-nowrap ${selectMode ? "bg-blue-50 border-blue-300 text-blue-600" : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"}`}
            >
              {selectMode ? "✕ Annuler sélection" : "Sélectionner"}
            </button>
          </div>
        </div>

        {/* ALERTES NUMÉROTATION */}
        {(dupNums.length > 0 || gapNums.length > 0) && (
          <div className="mx-4 mb-3 space-y-2">
            {dupNums.length > 0 && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <span className="text-base leading-none shrink-0">⚠️</span>
                <span><strong>Numéros en double :</strong> {dupNums.map(n => String(n).padStart(3, "0")).join(", ")} — deux documents ont le même numéro.</span>
              </div>
            )}
            {gapNums.length > 0 && (
              <div className="flex items-start justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none shrink-0">🚨</span>
                  <span><strong>Trou dans la numérotation :</strong> numéro{gapNums.length > 1 ? "s" : ""} manquant{gapNums.length > 1 ? "s" : ""} — {gapNums.map(n => String(n).padStart(3, "0")).join(", ")}. La numérotation doit être continue.</span>
                </div>
                <div className="shrink-0">
                  {confirmFixGaps ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">Renuméroter ?</span>
                      <button onClick={fixGaps} disabled={fixingGaps} className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-lg font-medium transition disabled:opacity-50">{fixingGaps ? "…" : "Oui"}</button>
                      <button onClick={() => setConfirmFixGaps(false)} className="text-xs border border-red-300 px-2 py-1 rounded-lg font-medium hover:bg-red-100 transition">Non</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmFixGaps(true)} className="text-xs border border-red-300 text-red-600 hover:bg-red-100 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap">
                      Corriger
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ALERTE ORDRE CHRONOLOGIQUE */}
        {dateOrderAnomalies.length > 0 && docTab === "facture" && (
          <div className="mx-4 mb-3">
            <div className="flex items-start justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Numéros non chronologiques :</strong> {dateOrderAnomalies.length} cas où une facture plus récente a un numéro plus petit — la numérotation doit suivre l'ordre des dates (obligatoire légalement).
                </span>
              </div>
              <div className="shrink-0">
                {confirmReorderByDate ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">Reclasser par date ?</span>
                    <button onClick={reorderByDate} disabled={reorderingByDate} className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-lg font-medium transition disabled:opacity-50">{reorderingByDate ? "…" : "Oui"}</button>
                    <button onClick={() => setConfirmReorderByDate(false)} className="text-xs border border-red-300 px-2 py-1 rounded-lg font-medium hover:bg-red-100 transition">Non</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmReorderByDate(true)} className="text-xs border border-red-300 text-red-600 hover:bg-red-100 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap">
                    Réordonner par date
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ALERTES DATES */}
        {dateAnomalies.length > 0 && (
          <div className="mx-4 mb-3 space-y-1.5">
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs font-semibold text-orange-700 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full">
                {dateAnomalies.length} facture{dateAnomalies.length > 1 ? "s" : ""} antérieure{dateAnomalies.length > 1 ? "s" : ""} à leur devis
              </span>
            </div>
            {dateAnomalies.map((a) => (
              <div key={a.fId} className="flex items-start justify-between gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-orange-800">
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none shrink-0">📅</span>
                  <span>
                    <strong>{a.facture}</strong> (datée du {a.fDate}) est antérieure à son devis <strong>{a.devis}</strong> (daté du {a.dDate}) — vérifiez la date.
                  </span>
                </div>
                <button
                  onClick={() => { sessionStorage.setItem("facturation_scroll", window.scrollY.toString()); router.push(`/facturation/${a.fId}`); }}
                  className="shrink-0 text-xs border border-orange-300 text-orange-700 hover:bg-orange-100 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap"
                >
                  Voir →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* COLUMN HEADERS — desktop only */}
        <div className={`hidden sm:grid px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide border-b bg-gray-50 gap-3 items-center ${selectMode ? "grid-cols-[20px_1fr_1fr_1fr_1fr_1fr]" : "grid-cols-5"}`}>
          {selectMode && <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded accent-blue-600 cursor-pointer" />}
          <span>Numéro</span>
          <span>Client</span>
          <span>Date</span>
          <span>Statut</span>
          <span className="text-right">Total</span>
        </div>

        {/* ROWS */}
        <div className="divide-y">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse px-4 py-4">
                {/* Mobile skeleton */}
                <div className="sm:hidden space-y-2">
                  <div className="flex justify-between">
                    <div className="h-4 bg-gray-100 rounded w-32" />
                    <div className="h-5 bg-gray-100 rounded w-16" />
                  </div>
                  <div className="h-3.5 bg-gray-100 rounded w-40" />
                  <div className="flex justify-between">
                    <div className="h-3.5 bg-gray-100 rounded w-20" />
                    <div className="h-4 bg-gray-100 rounded w-16" />
                  </div>
                </div>
                {/* Desktop skeleton */}
                <div className="hidden sm:grid grid-cols-5 gap-3">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className={`h-4 bg-gray-100 rounded ${j === 4 ? "ml-auto w-16" : ""}`} />
                  ))}
                </div>
              </div>
            ))}

          {!loading && visible.length === 0 && (
            <div className="py-14 text-center">
              <p className="text-gray-400 text-sm">
                {factures.length === 0
                  ? `Aucun ${docTab === "devis" ? "devis" : "facture"} pour l'instant`
                  : "Aucun résultat"}
              </p>
              {factures.length === 0 && (
                <Link
                  href={`/facturation/create${docTab === "devis" ? "?type=devis" : ""}`}
                  className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition shadow-sm"
                >
                  <span className="text-base leading-none">+</span>
                  {docTab === "devis" ? "Créer votre premier devis" : "Créer votre première facture"}
                </Link>
              )}
            </div>
          )}

          {!loading &&
            visible.map((f, fIdx) => {
              const isDeleting = pendingDelete === f.id;
              const deleteBtn = isDeleting ? (
                <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-red-600 font-medium whitespace-nowrap">Supprimer ?</span>
                  <button onClick={async (e) => { e.stopPropagation(); await deleteFacture(f.id); setPendingDelete(null); }} className="text-xs bg-red-600 hover:bg-red-700 text-white px-1.5 py-0.5 rounded font-medium transition">Oui</button>
                  <button onClick={(e) => { e.stopPropagation(); setPendingDelete(null); }} className="text-xs border border-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-medium hover:bg-gray-50 transition">Non</button>
                </span>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); setPendingDelete(f.id); }} title="Supprimer" className="text-gray-300 hover:text-red-500 transition p-0.5 shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              );
              return (
              <div
                key={f.id}
                onClick={(e) => { if (selectMode) { toggleSelect(f.id, fIdx, e.shiftKey); } else { sessionStorage.setItem("facturation_scroll", window.scrollY.toString()); router.push(`/facturation/${f.id}`); } }}
                className={`cursor-pointer transition ${dupIds.has(f.id) ? "bg-red-50 hover:bg-red-100 border-l-2 border-red-400" : "hover:bg-gray-50"}`}
              >
                {/* Mobile card */}
                <div className="sm:hidden px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      {selectMode && <input type="checkbox" checked={selectedIds.has(f.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(f.id, fIdx, e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey); }} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded accent-blue-600 cursor-pointer shrink-0" />}
                      {editCell?.id === f.id && editCell.field === "number" ? (
                        <input autoFocus value={editCell.value} onChange={(e) => setEditCell({ ...editCell, value: e.target.value })} onBlur={() => saveEditCell(editCell)} onKeyDown={(e) => { if (e.key === "Enter") saveEditCell(editCell); if (e.key === "Escape") setEditCell(null); }} onClick={(e) => e.stopPropagation()} className="text-sm font-semibold border-b border-blue-400 outline-none bg-transparent w-32" />
                      ) : (
                        <span className="text-sm font-semibold text-gray-900 leading-tight cursor-text hover:text-blue-600 transition truncate" onClick={(e) => { e.stopPropagation(); setEditCell({ id: f.id, field: "number", value: f.number }); }}>{f.number}</span>
                      )}
                    </div>
                    <StatusChanger facture={f} />
                  </div>
                  <div className="text-sm text-gray-600 truncate">{resolveClientName(f)}</div>
                  {f.abonnementTitre && <div className="text-xs text-indigo-500 truncate mb-1">{f.abonnementTitre}</div>}
                  <div className="flex items-center justify-between mt-1.5">
                    {editCell?.id === f.id && editCell.field === "date" ? (
                      <input autoFocus type="date" value={editCell.value} onChange={(e) => setEditCell({ ...editCell, value: e.target.value })} onBlur={() => saveEditCell(editCell)} onKeyDown={(e) => { if (e.key === "Escape") setEditCell(null); }} onClick={(e) => e.stopPropagation()} className="text-xs border-b border-blue-400 outline-none bg-transparent" />
                    ) : (
                      <span className="text-xs text-gray-400 cursor-text hover:text-blue-500 transition" onClick={(e) => { e.stopPropagation(); setEditCell({ id: f.id, field: "date", value: toDateInput(f) }); }}>{formatDate(f.date ?? f.createdAt)}</span>
                    )}
                    <div className="flex items-center gap-2">
                      {f.pdfUrl && (
                        <a
                          href={f.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Voir le PDF stocké"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 transition shrink-0"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          PDF
                        </a>
                      )}
                      <button onClick={async (e) => { e.stopPropagation(); await uploadPdf(f); }} disabled={uploadingIds.has(f.id)} title={f.pdfUrl ? "Mettre à jour le PDF" : "Stocker le PDF"} className={`shrink-0 p-1 rounded transition disabled:opacity-40 ${f.pdfUrl ? "text-green-500 hover:text-green-700" : "text-gray-300 hover:text-blue-500"}`}>
                        {uploadingIds.has(f.id)
                          ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                          : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        }
                      </button>
                      <span className="text-sm font-semibold text-gray-900">
                        {(f.total ?? 0).toLocaleString("fr-FR")} €
                      </span>
                      {deleteBtn}
                    </div>
                  </div>
                </div>

                {/* Desktop row */}
                <div className={`hidden sm:grid px-4 py-3.5 items-center gap-3 ${selectMode ? "grid-cols-[20px_1fr_1fr_1fr_1fr_1fr]" : "grid-cols-5"}`}>
                  {selectMode && <input type="checkbox" checked={selectedIds.has(f.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(f.id, fIdx); }} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded accent-blue-600 cursor-pointer" />}
                  {editCell?.id === f.id && editCell.field === "number" ? (
                    <input autoFocus value={editCell.value} onChange={(e) => setEditCell({ ...editCell, value: e.target.value })} onBlur={() => saveEditCell(editCell)} onKeyDown={(e) => { if (e.key === "Enter") saveEditCell(editCell); if (e.key === "Escape") setEditCell(null); }} onClick={(e) => e.stopPropagation()} className="text-sm font-semibold border-b border-blue-400 outline-none bg-transparent w-32" />
                  ) : (
                    <span className="text-sm font-semibold text-gray-900 cursor-text hover:text-blue-600 transition" onClick={(e) => { e.stopPropagation(); setEditCell({ id: f.id, field: "number", value: f.number }); }}>{f.number}</span>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm text-gray-600 truncate">{resolveClientName(f)}</div>
                    {f.abonnementTitre && <div className="text-xs text-indigo-500 truncate">{f.abonnementTitre}</div>}
                  </div>
                  {editCell?.id === f.id && editCell.field === "date" ? (
                    <input autoFocus type="date" value={editCell.value} onChange={(e) => setEditCell({ ...editCell, value: e.target.value })} onBlur={() => saveEditCell(editCell)} onKeyDown={(e) => { if (e.key === "Escape") setEditCell(null); }} onClick={(e) => e.stopPropagation()} className="text-sm border-b border-blue-400 outline-none bg-transparent" />
                  ) : (
                    <span className="text-sm text-gray-500 cursor-text hover:text-blue-500 transition" onClick={(e) => { e.stopPropagation(); setEditCell({ id: f.id, field: "date", value: toDateInput(f) }); }}>{formatDate(f.date ?? f.createdAt)}</span>
                  )}
                  <StatusChanger facture={f} />
                  <div className="flex items-center justify-end gap-2">
                    {f.pdfUrl && (
                      <a
                        href={f.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Télécharger le PDF"
                        className="text-gray-400 hover:text-blue-600 transition shrink-0"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6M9 16h4" />
                        </svg>
                      </a>
                    )}
                    <span className="text-sm font-semibold text-gray-900">
                      {(f.total ?? 0).toLocaleString("fr-FR")} €
                    </span>
                    {deleteBtn}
                  </div>
                </div>
              </div>
            );
            })}
        </div>
      </div>
    {/* BARRE SÉLECTION FLOTTANTE */}
    {selectedIds.size > 0 && (
      <div className="fixed bottom-[env(safe-area-inset-bottom,0px)] inset-x-0 lg:left-64 z-50 px-4 py-3 bg-gray-900 text-white flex items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <button onClick={exitSelectMode} className="text-gray-400 hover:text-white transition text-lg leading-none">✕</button>
          <span className="text-sm font-medium">{selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}</span>
        </div>
        <button
          onClick={uploadSelected}
          disabled={batchUploading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition"
        >
          {batchUploading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          )}
          Stocker {selectedIds.size} PDF{selectedIds.size > 1 ? "s" : ""}
        </button>
      </div>
    )}
    </div>
  );
}

function StatCard({
  title,
  value,
  sub,
  color,
  trend,
}: {
  title: string;
  value: string;
  sub: string;
  color: string;
  trend?: number;
}) {
  return (
    <div className="bg-white p-4 rounded-xl border shadow-sm">
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-xs text-gray-400">{sub}</span>
        {trend !== undefined && (
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${trend > 0 ? "bg-green-50 text-green-600" : trend < 0 ? "bg-red-50 text-red-500" : "bg-gray-100 text-gray-400"}`}>
            {trend > 0 ? "↑" : trend < 0 ? "↓" : "="}{Math.abs(trend)}%
          </span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FactureStatus }) {
  return (
    <span className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLOR[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
