"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Timestamp } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useInvoices } from "@/hooks/useInvoices";
import { useUrssafPeriodes } from "@/hooks/useUrssafPeriodes";
import { upsertUrssafPeriode } from "@/lib/urssafService";

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Date qui compte pour l'URSSAF : celle de l'ENCAISSEMENT.
 *
 * 🔑 En micro-entreprise, on déclare ce qui a été ENCAISSÉ dans le mois, pas ce
 * qui a été facturé : une facture émise le 31/07 et réglée en septembre se
 * déclare en septembre. On prend donc `paymentDate` en priorité ; la date du
 * document ne sert que de repli pour les factures d'avant ce champ (elles sont
 * signalées à l'écran pour être corrigées).
 */
function dateEncaissement(f: { paymentDate?: Timestamp; date?: Timestamp; createdAt?: Timestamp }) {
  return f.paymentDate ?? f.date ?? f.createdAt ?? null;
}

function fmtDate(ts?: Timestamp) {
  if (!ts) return null;
  return new Date(ts.seconds * 1000).toLocaleDateString("fr-FR");
}

function StatCard({ title, value, sub, color = "text-gray-900" }: {
  title: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function BilanUrssafPage() {
  const { currentUser } = useAuth();
  const { invoices, loading: invoicesLoading } = useInvoices(currentUser?.uid ?? "");
  const { periodes, loading: periodesLoading } = useUrssafPeriodes(currentUser?.uid ?? "");
  const loading = invoicesLoading || periodesLoading;

  const currentYear = new Date().getFullYear();
  const [annee, setAnnee] = useState(currentYear);
  const [defaultTaux, setDefaultTaux] = useState(24.2);

  /** Mois dont on affiche le détail des factures (un seul à la fois) */
  const [moisOuvert, setMoisOuvert] = useState<number | null>(null);

  // Taux editing state
  const [editingMois, setEditingMois] = useState<number | null>(null);
  const [editTauxValue, setEditTauxValue] = useState("");

  // Build month rows
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mois = i + 1;
      const periode = periodes.find((p) => p.annee === annee && p.mois === mois);
      // Gardées, et pas seulement additionnées : on veut pouvoir montrer À QUOI
      // correspond le montant d'un mois sans aller fouiller la liste des factures.
      const factures = invoices
        .filter((f) => {
          if ((f.type ?? "facture") !== "facture") return false;
          if (f.status !== "paid") return false;
          const ts = dateEncaissement(f);
          if (!ts) return false;
          const d = new Date(ts.seconds * 1000);
          return d.getFullYear() === annee && d.getMonth() === i;
        })
        .sort((a, b) => (dateEncaissement(a)?.seconds ?? 0) - (dateEncaissement(b)?.seconds ?? 0));
      const ca = factures.reduce((acc, f) => acc + (f.total ?? 0), 0);
      const taux = periode?.taux ?? defaultTaux;
      const cotisations = Math.round(ca * taux) / 100;
      return { mois, ca, taux, cotisations, periode, factures };
    });
  }, [invoices, periodes, annee, defaultTaux]);

  /** Factures « Payée » sans date de paiement : rangées par défaut à leur date d'émission */
  const sansDatePaiement = useMemo(
    () => invoices.filter((f) => {
      if ((f.type ?? "facture") !== "facture" || f.status !== "paid" || f.paymentDate) return false;
      const ts = f.date ?? f.createdAt;
      return !!ts && new Date(ts.seconds * 1000).getFullYear() === annee;
    }),
    [invoices, annee],
  );

  const totalCA = months.reduce((s, m) => s + m.ca, 0);
  const totalCotisations = months.reduce((s, m) => s + m.cotisations, 0);
  const caADeclarer = months.filter((m) => m.ca > 0 && !m.periode?.declare).reduce((s, m) => s + m.ca, 0);
  const cotisationsARester = months.filter((m) => !m.periode?.regle).reduce((s, m) => s + m.cotisations, 0);
  const caEtMoisActuel = new Date().getFullYear() === annee ? months[new Date().getMonth()].ca : null;

  async function toggleField(mois: number, field: "declare" | "regle") {
    if (!currentUser) return;
    const month = months.find((m) => m.mois === mois)!;
    const current = field === "declare" ? (month.periode?.declare ?? false) : (month.periode?.regle ?? false);
    const newVal = !current;

    const data: Record<string, unknown> = {
      [field]: newVal,
      taux: month.taux,
    };
    if (field === "declare") {
      data.dateDeclaration = newVal ? Timestamp.now() : null;
    } else {
      data.dateReglement = newVal ? Timestamp.now() : null;
    }
    try {
      await upsertUrssafPeriode(currentUser.uid, annee, mois, data as Parameters<typeof upsertUrssafPeriode>[3]);
    } catch (e) {
      console.error("URSSAF toggleField échec", e);
      alert("Impossible d'enregistrer : " + ((e as Error)?.message ?? e));
    }
  }

  async function saveTaux(mois: number) {
    const parsed = parseFloat(editTauxValue.replace(",", "."));
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      setEditingMois(null);
      return;
    }
    if (currentUser) {
      try {
        await upsertUrssafPeriode(currentUser.uid, annee, mois, { taux: parsed });
      } catch (e) {
        console.error("URSSAF saveTaux échec", e);
        alert("Impossible d'enregistrer le taux : " + ((e as Error)?.message ?? e));
      }
    }
    setEditingMois(null);
  }

  return (
    <div className="min-h-screen">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/facturation"
            className="text-gray-400 hover:text-gray-600 transition text-sm"
          >
            ← Facturation
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Bilan URSSAF</h1>
            <p className="text-sm text-gray-500 mt-0.5">Suivi déclarations et cotisations auto-entrepreneur</p>
          </div>
        </div>

        {/* Year nav */}
        <div className="flex items-center gap-1 bg-white border rounded-xl shadow-sm px-1 py-1">
          <button
            onClick={() => setAnnee((y) => y - 1)}
            className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition font-medium"
          >
            ‹
          </button>
          <span className="px-3 text-sm font-semibold text-gray-900 min-w-[3.5rem] text-center">
            {annee}
          </span>
          <button
            onClick={() => setAnnee((y) => y + 1)}
            disabled={annee >= currentYear}
            className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition font-medium disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ›
          </button>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          title={`CA ${annee}`}
          value={`${fmt(totalCA)} €`}
          sub="Factures encaissées"
          color="text-green-700"
        />
        <StatCard
          title="Cotisations estimées"
          value={`${fmt(totalCotisations)} €`}
          sub={`Toutes périodes (${defaultTaux} %)`}
          color="text-orange-600"
        />
        <StatCard
          title="À déclarer"
          value={`${fmt(caADeclarer)} €`}
          sub="CA non encore déclaré"
          color={caADeclarer > 0 ? "text-red-600" : "text-gray-400"}
        />
        <StatCard
          title="Cotisations restantes"
          value={`${fmt(cotisationsARester)} €`}
          sub="Non encore réglées"
          color={cotisationsARester > 0 ? "text-red-600" : "text-gray-400"}
        />
      </div>

      {/* DEFAULT TAUX BAR */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <span className="text-sm text-blue-800 font-medium">Taux de cotisations par défaut :</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={defaultTaux}
            onChange={(e) => setDefaultTaux(parseFloat(e.target.value) || 24.2)}
            className="w-20 border rounded-lg px-2 py-1 text-sm text-center font-medium bg-white focus:outline-none focus:border-blue-400"
          />
          <span className="text-sm text-blue-700 font-medium">%</span>
          <span className="text-xs text-blue-600 ml-1">
            (coaching sportif BNC : 24,2 % · BIC : 22 % · vente : 12,3 %)
          </span>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <div className="min-w-[620px]">
        {/* Column headers */}
        <div className="grid grid-cols-[110px_1fr_80px_1fr_130px_140px] px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide border-b bg-gray-50 gap-3">
          <span>Mois</span>
          <span>CA encaissé</span>
          <span className="text-center">Taux</span>
          <span>Cotisations</span>
          <span>Déclaré URSSAF</span>
          <span>Réglé</span>
        </div>

        <div className="divide-y">
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="grid grid-cols-6 px-4 py-4 gap-3 animate-pulse">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="h-4 bg-gray-100 rounded" />
                ))}
              </div>
            ))}

          {!loading &&
            months.map(({ mois, ca, taux, cotisations, periode, factures }) => {
              const isCurrentMonth =
                annee === currentYear && mois === new Date().getMonth() + 1;
              const isFuture =
                annee > currentYear ||
                (annee === currentYear && mois > new Date().getMonth() + 1);

              const ouvert = moisOuvert === mois;

              return (
                <div key={mois}>
                <div
                  className={`grid grid-cols-[110px_1fr_80px_1fr_130px_140px] px-4 py-3.5 gap-3 items-center text-sm transition-colors ${
                    isCurrentMonth ? "bg-blue-50/50" : ""
                  } ${isFuture ? "opacity-40" : ""}`}
                >
                  {/* Mois */}
                  <div className="font-medium text-gray-800 flex items-center gap-1.5">
                    {MONTHS_FR[mois - 1]}
                    {isCurrentMonth && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-semibold">
                        en cours
                      </span>
                    )}
                  </div>

                  {/* CA — cliquable : il ouvre le détail des factures du mois */}
                  <div className="font-medium">
                    {ca > 0 ? (
                      <button
                        onClick={() => setMoisOuvert((m) => (m === mois ? null : mois))}
                        title="Voir les factures de ce mois"
                        className="flex items-center gap-1 text-green-700 hover:text-green-800 hover:underline transition"
                      >
                        {`${fmt(ca)} €`}
                        <span className={`text-[10px] text-green-600/70 transition-transform ${ouvert ? "rotate-180" : ""}`}>▾</span>
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </div>

                  {/* Taux */}
                  <div className="w-20 text-center">
                    {editingMois === mois ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={editTauxValue}
                        onChange={(e) => setEditTauxValue(e.target.value)}
                        onBlur={() => saveTaux(mois)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveTaux(mois);
                          if (e.key === "Escape") setEditingMois(null);
                        }}
                        className="w-16 border border-blue-400 rounded px-1 py-0.5 text-xs text-center focus:outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setEditingMois(mois);
                          setEditTauxValue(String(taux));
                        }}
                        className="text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded px-2 py-1 transition"
                        title="Cliquer pour modifier le taux"
                      >
                        {taux} %
                      </button>
                    )}
                  </div>

                  {/* Cotisations */}
                  <div className={`font-medium ${ca > 0 ? "text-orange-600" : "text-gray-300"}`}>
                    {ca > 0 ? `${fmt(cotisations)} €` : "—"}
                  </div>

                  {/* Déclaré */}
                  <div>
                    {isFuture ? (
                      <span className="text-gray-300">—</span>
                    ) : periode?.declare ? (
                      <button
                        onClick={() => toggleField(mois, "declare")}
                        className="flex items-center gap-1.5 group"
                        title="Cliquer pour annuler"
                      >
                        <span className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs font-bold group-hover:bg-red-100 group-hover:text-red-500 transition">
                          ✓
                        </span>
                        <span className="text-xs text-gray-500 group-hover:text-red-400 transition">
                          {fmtDate(periode.dateDeclaration) ?? "Déclaré"}
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleField(mois, "declare")}
                        disabled={ca === 0}
                        className="text-xs px-2.5 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition disabled:opacity-30 disabled:cursor-not-allowed font-medium"
                      >
                        Déclarer
                      </button>
                    )}
                  </div>

                  {/* Réglé */}
                  <div>
                    {isFuture ? (
                      <span className="text-gray-300">—</span>
                    ) : periode?.regle ? (
                      <button
                        onClick={() => toggleField(mois, "regle")}
                        className="flex items-center gap-1.5 group"
                        title="Cliquer pour annuler"
                      >
                        <span className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs font-bold group-hover:bg-red-100 group-hover:text-red-500 transition">
                          ✓
                        </span>
                        <span className="text-xs text-gray-500 group-hover:text-red-400 transition">
                          {fmtDate(periode.dateReglement) ?? "Réglé"}
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleField(mois, "regle")}
                        disabled={cotisations === 0}
                        className="text-xs px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-30 disabled:cursor-not-allowed font-medium"
                      >
                        Marquer réglé
                      </button>
                    )}
                  </div>
                </div>

                {/* Détail : les factures encaissées ce mois-là */}
                {ouvert && (
                  <div className="px-4 pb-3 pt-1 bg-gray-50/70 space-y-1.5">
                    {factures.map((f) => (
                      <Link
                        key={f.id}
                        href={`/facturation/${f.id}`}
                        className="flex items-center justify-between gap-3 bg-white border rounded-lg px-3 py-2 hover:border-blue-300 transition"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {`${f.number} · ${f.clientName ?? ""}`}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {`émise le ${fmtDate(f.date ?? f.createdAt) ?? "—"}`}
                            {f.paymentDate
                              ? ` · encaissée le ${fmtDate(f.paymentDate)}`
                              : " · aucune date de règlement, comptée sur sa date d'émission"}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-green-700 shrink-0">{`${fmt(f.total ?? 0)} €`}</span>
                      </Link>
                    ))}
                  </div>
                )}
                </div>
              );
            })}
        </div>

        {/* TOTAL ROW */}
        {!loading && (
          <div className="grid grid-cols-[110px_1fr_80px_1fr_130px_140px] px-4 py-3.5 gap-3 items-center border-t bg-gray-50">
            <span className="text-sm font-semibold text-gray-700">Total {annee}</span>
            <span className="text-sm font-bold text-green-700">{fmt(totalCA)} €</span>
            <span />
            <span className="text-sm font-bold text-orange-600">{fmt(totalCotisations)} €</span>
            <span className="text-xs text-gray-500">
              {months.filter((m) => m.periode?.declare).length} mois déclaré(s)
            </span>
            <span className="text-xs text-gray-500">
              {months.filter((m) => m.periode?.regle).length} mois réglé(s)
            </span>
          </div>
        )}
        </div>{/* min-w */}
        </div>{/* overflow-x-auto */}
      </div>

      {/* Factures encaissées dont on ignore la date de règlement */}
      {sansDatePaiement.length > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            {sansDatePaiement.length === 1
              ? "1 facture payée sans date de règlement"
              : `${sansDatePaiement.length} factures payées sans date de règlement`}
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            Faute de mieux, elles sont comptées au mois de leur émission — ce qui peut les placer
            dans le mauvais mois de déclaration. Ouvrez-les et renseignez la date à laquelle
            l&apos;argent est arrivé.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {sansDatePaiement.map((f) => (
              <Link key={f.id} href={`/facturation/${f.id}`}
                className="text-xs font-medium bg-white border border-amber-200 text-amber-800 rounded-lg px-2.5 py-1 hover:bg-amber-100 transition">
                {f.number} · {fmt(f.total ?? 0)} €
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* INFOS BAS */}
      <div className="mt-4 bg-gray-50 border rounded-xl px-4 py-3 text-xs text-gray-500 space-y-1">
        <p>
          <strong>Comment ça marche :</strong> le CA est calculé à partir de vos factures ayant le
          statut <em>Payée</em>, rangées au mois de leur <strong>date de paiement</strong> — en
          micro-entreprise on déclare ce qui a été <strong>encaissé</strong> dans le mois, pas ce
          qui a été facturé.
        </p>
        <p>
          Une facture émise le 31/07 et réglée en septembre se déclare donc en septembre : laissez-la
          en <em>Envoyée</em> ou <em>À encaisser</em> tant qu&apos;elle n&apos;est pas réglée, puis
          passez-la en <em>Payée</em> — la date du jour est posée automatiquement, et reste
          modifiable dans la fiche (bloc <em>Règlement</em>).
        </p>
        <p>
          <strong>Cliquez sur un montant de CA</strong> pour voir les factures qui le composent,
          avec leur date d&apos;émission et leur date d&apos;encaissement.
        </p>
        <p>
          Cochez <strong>Déclarer</strong> après chaque déclaration mensuelle sur autoentrepreneur.urssaf.fr,
          puis <strong>Marquer réglé</strong> une fois le paiement prélevé.
        </p>
        <p>
          Le taux par défaut s'applique aux mois sans taux personnalisé. Cliquez sur un taux pour le modifier pour un mois donné.
        </p>
      </div>
    </div>
  );
}
