"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useStoreApps } from "@/hooks/useStoreApps";
import { useStoreSubscriptions } from "@/hooks/useStoreSubscriptions";
import { useClients } from "@/hooks/useClients";
import { useUsers } from "@/hooks/useUsers";
import {
  createStoreApp, updateStoreApp, deleteStoreApp,
  createStoreSubscription, updateStoreSubscription, deleteStoreSubscription,
  updateSubWithEvent, SUB_EVENT_LABELS,
  orderRef, computeDateFin, suspendExpiredSubscriptions,
} from "@/lib/storeService";
import { copyText } from "@/lib/clipboard";
import { Timestamp, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { uploadImage } from "@/lib/uploadImage";
import RichTextEditor from "@/components/ui/RichTextEditor";
import type { StoreApp, StoreSubscription, StoreSubStatut } from "@/types";

const STATUT_LABEL: Record<StoreSubStatut, string> = {
  active: "Actif",
  pending: "En attente",
  suspended: "Suspendu",
  cancelled: "Annulé",
};

const STATUT_COLOR: Record<StoreSubStatut, string> = {
  active: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  suspended: "bg-red-100 text-red-600",
  cancelled: "bg-gray-100 text-gray-500",
};

const PERIOD_LABEL: Record<StoreApp["periodicite"], string> = {
  mensuel: "/mois",
  annuel: "/an",
  unique: "unique",
};

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
const EMOJIS = ["🃏", "📊", "🏃", "💪", "🧠", "🎯", "📅", "📆", "⚡", "🔥", "🏆", "📱", "🎮", "🚴", "🍼", "📋"];

function toDateStr(ts?: { seconds: number } | null) {
  if (!ts) return "";
  return new Date(ts.seconds * 1000).toLocaleDateString("fr-FR");
}

function toInput(ts?: { seconds: number } | null) {
  if (!ts) return "";
  return new Date(ts.seconds * 1000).toISOString().split("T")[0];
}

type ChangelogRow = { id: string; title: string; description: string; type: "update" | "upcoming"; date: string };
type LimiteRow = { key: string; label: string; defaultValue: string };

export default function BoutiqueAdminPage() {
  const router = useRouter();
  const { currentUser, userProfile } = useAuth();
  const isAdmin = userProfile?.role_app === "Admin";
  const { apps, loading: loadingApps } = useStoreApps();
  const { subscriptions, loading: loadingSubs } = useStoreSubscriptions();
  const { clients } = useClients();
  const { users } = useUsers();

  // Bascule automatiquement en "suspended" les abonnements dont la date de fin est dépassée
  useEffect(() => {
    if (!isAdmin || subscriptions.length === 0) return;
    suspendExpiredSubscriptions(subscriptions);
  }, [isAdmin, subscriptions]);

  const nonAdminUsers = users
    .filter(u => u.role_app !== "Admin" && u.uid)
    .sort((a, b) => {
      const ka = `${a.nom ?? ""} ${a.prenom ?? ""}`.trim().toLowerCase();
      const kb = `${b.nom ?? ""} ${b.prenom ?? ""}`.trim().toLowerCase();
      return ka.localeCompare(kb, "fr");
    });

  const pendingCount = subscriptions.filter((s) => s.statut === "pending").length;
  const [tab, setTab] = useState<"apps" | "subs" | "rib">("apps");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── RIB / Paiement ────────────────────────────────────────────────────────
  const [ribIban, setRibIban] = useState("");
  const [ribBic, setRibBic] = useState("");
  const [ribSaving, setRibSaving] = useState(false);
  // Charger le RIB boutique
  useEffect(() => {
    getDoc(doc(db, "settings", "boutique")).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.iban) setRibIban(d.iban);
        if (d.bic) setRibBic(d.bic);
      }
    }).catch(() => {});
  }, []);
  const handleSaveRib = async () => {
    setRibSaving(true);
    try {
      await setDoc(doc(db, "settings", "boutique"), {
        iban: ribIban.replace(/\s/g, "").toUpperCase(),
        bic: ribBic.trim().toUpperCase(),
      }, { merge: true });
      setToast({ msg: "RIB enregistré.", ok: true });
      setTimeout(() => setToast(null), 3000);
    } catch {
      setToast({ msg: "Erreur lors de l'enregistrement.", ok: false });
      setTimeout(() => setToast(null), 3000);
    }
    setRibSaving(false);
  };

  // ── App modal state ───────────────────────────────────────────────────────
  const [showAppModal, setShowAppModal] = useState(false);
  const [editApp, setEditApp] = useState<StoreApp | null>(null);
  const [appForm, setAppForm] = useState({
    nom: "", shortDesc: "", description: "", icon: "🎯", iconUrl: "", couleur: "#6366f1",
    prix: "", periodicite: "mensuel" as StoreApp["periodicite"], actif: true, ordre: "0", route: "", tags: "",
    visibleUserIds: [] as string[],
    hiddenUserIds: [] as string[],
  });
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [appChangelogs, setAppChangelogs] = useState<ChangelogRow[]>([]);
  const [showChangelogForm, setShowChangelogForm] = useState(false);
  const [visibleSearch, setVisibleSearch] = useState("");
  const [hiddenSearch, setHiddenSearch] = useState("");
  const [newChangelog, setNewChangelog] = useState<Omit<ChangelogRow, "id">>({
    title: "", description: "", type: "update", date: new Date().toISOString().split("T")[0],
  });
  const [appLimites, setAppLimites] = useState<LimiteRow[]>([]);
  const [savingApp, setSavingApp] = useState(false);

  // ── Sub modal state ───────────────────────────────────────────────────────
  const [showSubModal, setShowSubModal] = useState(false);
  const [editSub, setEditSub] = useState<StoreSubscription | null>(null);
  // Confirmation de suppression (modale propre, à la place du confirm() natif)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message?: string; confirmLabel?: string; onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [subForm, setSubForm] = useState({
    appId: "", clientId: "", clientNom: "", clientEmail: "", userUid: "",
    statut: "active" as StoreSubStatut, dateDebut: new Date().toISOString().split("T")[0],
    dateFin: "", notes: "",
  });
  const [subLimites, setSubLimites] = useState<Record<string, string>>({});
  const [savingSub, setSavingSub] = useState(false);
  const [historySubId, setHistorySubId] = useState<string | null>(null);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [filterApp, setFilterApp] = useState("");
  const [filterStatut, setFilterStatut] = useState<StoreSubStatut | "all">("all");
  const [searchSub, setSearchSub] = useState("");
  const [clientSubSearch, setClientSubSearch] = useState("");

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-sm">Accès réservé aux administrateurs.</p>
      </div>
    );
  }

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── App CRUD ──────────────────────────────────────────────────────────────
  const openNewApp = () => {
    setEditApp(null);
    setAppForm({ nom: "", shortDesc: "", description: "", icon: "🎯", iconUrl: "", couleur: "#6366f1", prix: "", periodicite: "mensuel", actif: true, ordre: String(apps.length), route: "", tags: "", visibleUserIds: [], hiddenUserIds: [] });
    setAppChangelogs([]);
    setAppLimites([]);
    setShowChangelogForm(false);
    setShowAppModal(true);
  };

  const openEditApp = (app: StoreApp) => {
    setEditApp(app);
    setAppForm({
      nom: app.nom, shortDesc: app.shortDesc, description: app.description,
      icon: app.icon, iconUrl: app.iconUrl ?? "", couleur: app.couleur, prix: String(app.prix),
      periodicite: app.periodicite, actif: app.actif, ordre: String(app.ordre),
      route: app.route ?? "", tags: (app.tags ?? []).join(", "),
      visibleUserIds: app.visibleUserIds ?? [],
      hiddenUserIds: app.hiddenUserIds ?? [],
    });
    setAppChangelogs((app.changelogs ?? []).map(c => ({
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      type: c.type,
      date: c.date ? new Date(c.date.seconds * 1000).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
    })));
    setAppLimites((app.limitesConfig ?? []).map(l => ({
      key: l.key,
      label: l.label,
      defaultValue: String(l.defaultValue),
    })));
    setShowChangelogForm(false);
    setShowAppModal(true);
  };

  const addChangelog = () => {
    if (!newChangelog.title.trim()) return;
    setAppChangelogs(prev => [...prev, {
      id: Math.random().toString(36).slice(2),
      title: newChangelog.title.trim(),
      description: newChangelog.description.trim(),
      type: newChangelog.type,
      date: newChangelog.date || new Date().toISOString().split("T")[0],
    }]);
    setNewChangelog({ title: "", description: "", type: "update", date: new Date().toISOString().split("T")[0] });
    setShowChangelogForm(false);
  };

  const saveApp = async () => {
    if (!appForm.nom.trim()) return;
    setSavingApp(true);
    try {
      const rawData = {
        nom: appForm.nom.trim(),
        shortDesc: appForm.shortDesc.trim(),
        description: appForm.description.trim(),
        icon: appForm.icon,
        iconUrl: appForm.iconUrl.trim() || undefined,
        couleur: appForm.couleur,
        prix: Number(appForm.prix) || 0,
        periodicite: appForm.periodicite,
        actif: appForm.actif,
        ordre: Number(appForm.ordre) || 0,
        route: appForm.route.trim() || undefined,
        tags: appForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        visibleUserIds: appForm.visibleUserIds,
        hiddenUserIds: appForm.hiddenUserIds,
        changelogs: appChangelogs.map(c => ({
          id: c.id,
          title: c.title,
          description: c.description || undefined,
          type: c.type,
          date: Timestamp.fromDate(new Date(c.date)),
        })),
        limitesConfig: appLimites
          .filter(l => l.key.trim() && l.label.trim())
          .map(l => ({
            key: l.key.trim(),
            label: l.label.trim(),
            defaultValue: Number(l.defaultValue) || 0,
          })),
        createdBy: currentUser!.uid,
      };
      const data = Object.fromEntries(Object.entries(rawData).filter(([, v]) => v !== undefined)) as typeof rawData;
      if (editApp) {
        await updateStoreApp(editApp.id, data);
        showToast("Application modifiée.");
      } else {
        await createStoreApp(data as Omit<StoreApp, "id" | "createdAt">);
        showToast("Application créée.");
      }
      setShowAppModal(false);
    } catch (e) {
      console.error("[saveApp]", e);
      showToast("Erreur lors de l'enregistrement.", false);
    } finally {
      setSavingApp(false);
    }
  };

  const handleDeleteApp = (app: StoreApp) => {
    setConfirmDialog({
      title: `Supprimer « ${app.nom} » ?`,
      message: "Les abonnements associés resteront en base. Cette action est définitive.",
      confirmLabel: "Supprimer",
      onConfirm: async () => { await deleteStoreApp(app.id); showToast("Application supprimée."); },
    });
  };

  // ── Sub CRUD ──────────────────────────────────────────────────────────────
  const openNewSub = () => {
    setEditSub(null);
    setSubForm({ appId: apps[0]?.id ?? "", clientId: "", clientNom: "", clientEmail: "", userUid: "", statut: "active", dateDebut: new Date().toISOString().split("T")[0], dateFin: "", notes: "" });
    setSubLimites({});
    setShowSubModal(true);
  };

  const openEditSub = (sub: StoreSubscription) => {
    setEditSub(sub);
    setSubForm({
      appId: sub.appId, clientId: sub.clientId ?? "", clientNom: sub.clientNom,
      clientEmail: sub.clientEmail ?? "", userUid: sub.userUid ?? "",
      statut: sub.statut, dateDebut: toInput(sub.dateDebut),
      dateFin: toInput(sub.dateFin), notes: sub.notes ?? "",
    });
    const lim: Record<string, string> = {};
    Object.entries(sub.limites ?? {}).forEach(([k, v]) => { lim[k] = String(v); });
    setSubLimites(lim);
    setShowSubModal(true);
  };

  const handleSelectClient = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId);
    const linkedUser = client?.linkedUserId ? users.find((u) => u.uid === client.linkedUserId) : null;
    setSubForm((f) => ({
      ...f,
      clientId,
      clientNom: client ? [client.nom, client.prenom].filter(Boolean).join(" ") : "",
      clientEmail: client?.email ?? "",
      userUid: linkedUser?.uid ?? "",
    }));
  };

  const saveSub = async () => {
    if (!subForm.appId || !subForm.clientNom.trim()) return;
    setSavingSub(true);
    try {
      const app = apps.find((a) => a.id === subForm.appId);
      const limites = Object.entries(subLimites)
        .filter(([, v]) => v !== "" && !isNaN(Number(v)))
        .reduce((acc, [k, v]) => ({ ...acc, [k]: Number(v) }), {} as Record<string, number>);
      const rawSub = {
        appId: subForm.appId,
        appNom: app?.nom ?? "",
        clientId: subForm.clientId || null,
        clientNom: subForm.clientNom.trim(),
        clientEmail: subForm.clientEmail.trim() || null,
        userUid: subForm.userUid.trim() || null,
        prix: app?.prix ?? 0,
        statut: subForm.statut,
        dateDebut: subForm.dateDebut ? Timestamp.fromDate(new Date(subForm.dateDebut)) : Timestamp.now(),
        dateFin: subForm.dateFin ? Timestamp.fromDate(new Date(subForm.dateFin)) : null,
        notes: subForm.notes.trim() || null,
        limites: Object.keys(limites).length > 0 ? limites : undefined,
        createdBy: currentUser!.uid,
      };
      const data = Object.fromEntries(
        Object.entries(rawSub).filter(([, v]) => v !== undefined)
      ) as unknown as Omit<StoreSubscription, "id" | "createdAt">;
      if (editSub) {
        await updateStoreSubscription(editSub.id, data);
        showToast("Abonnement modifié.");
      } else {
        await createStoreSubscription(data);
        showToast("Abonnement créé.");
      }
      setShowSubModal(false);
    } catch (e) {
      console.error("[saveSub]", e);
      showToast("Erreur lors de l'enregistrement.", false);
    } finally {
      setSavingSub(false);
    }
  };

  const quickSetStatut = async (sub: StoreSubscription, statut: StoreSubStatut) => {
    if (statut === "active") {
      const app = apps.find((a) => a.id === sub.appId);
      const isPaid = (app?.prix ?? 0) > 0;
      const wasPending = sub.statut === "pending";
      const updates: Partial<StoreSubscription> = { statut: "active" };
      if (isPaid) {
        const now = Date.now();
        updates.dateDebut = Timestamp.fromDate(new Date(now));
        const finMs = computeDateFin(now, app?.periodicite ?? "mensuel");
        updates.dateFin = finMs ? Timestamp.fromDate(new Date(finMs)) : null;
        updates.lastPaymentAt = Timestamp.fromDate(new Date(now));
      } else {
        updates.dateFin = null; // gratuit : aucun blocage
      }
      await updateSubWithEvent(sub.id, updates, isPaid && !wasPending ? "renewed" : "activated");
      // Notifier l'utilisateur que son accès est validé (push + section Notifications)
      if (sub.userUid) {
        fetch("/api/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: sub.userUid,
            persist: true,
            type: "BOUTIQUE_VALIDATION",
            title: "Accès activé",
            body: `Votre accès à "${sub.appNom}" a été activé. Bonne utilisation !`,
            url: app?.route ?? "/boutique",
          }),
        }).catch(() => {});
      }
      showToast(wasPending ? "Demande validée — accès activé" : "Accès activé");
    } else {
      const extra = statut === "cancelled" ? { archivedAt: Timestamp.now() } : {};
      await updateSubWithEvent(sub.id, { statut, ...extra }, statut === "cancelled" ? "cancelled" : "suspended");
      // Prévenir le client que son accès a été suspendu / arrêté (push + section Notifications)
      if (sub.userUid) {
        const arret = statut === "cancelled";
        fetch("/api/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: sub.userUid,
            persist: true,
            type: "BOUTIQUE_STATUT",
            title: arret ? "Abonnement arrêté" : "Accès suspendu",
            body: arret
              ? `Votre accès à "${sub.appNom}" a été arrêté.`
              : `Votre accès à "${sub.appNom}" a été suspendu. Contactez-nous pour le réactiver.`,
            url: "/boutique",
          }),
        }).catch(() => {});
      }
      showToast(`Statut → ${STATUT_LABEL[statut]}`);
    }
  };

  const handleDeleteSub = (sub: StoreSubscription) => {
    setConfirmDialog({
      title: `Supprimer l'abonnement de ${sub.clientNom} ?`,
      message: "Cette action est définitive.",
      confirmLabel: "Supprimer",
      onConfirm: async () => { await deleteStoreSubscription(sub.id); showToast("Abonnement supprimé."); },
    });
  };

  const handleFacturer = (sub: StoreSubscription) => {
    const app = apps.find((a) => a.id === sub.appId);
    const params = new URLSearchParams();
    if (sub.clientId) params.set("clientId", sub.clientId);
    if (app) params.set("label", app.nom);
    if (app) params.set("prix", String(app.prix));
    router.push(`/facturation/create?${params.toString()}`);
  };

  const filteredSubs = subscriptions
    .filter((s) => !filterApp || s.appId === filterApp)
    .filter((s) => filterStatut === "all" || s.statut === filterStatut)
    .filter((s) => !searchSub || s.clientNom.toLowerCase().includes(searchSub.toLowerCase()) || s.clientEmail?.toLowerCase().includes(searchSub.toLowerCase()))
    .sort((a, b) => (a.statut === "pending" ? -1 : 1) - (b.statut === "pending" ? -1 : 1));

  // Derived for sub modal
  const selectedApp = apps.find(a => a.id === subForm.appId);
  const selectedAppLimites = selectedApp?.limitesConfig ?? [];

  return (
    <div className="min-h-screen">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[200] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition ${toast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/boutique")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500 transition">←</button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Gestion du Store</h1>
          <p className="text-sm text-gray-500">Applications et abonnements</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {(["apps", "subs", "rib"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t === "apps" ? `Applications (${apps.length})` : t === "rib" ? "RIB / Paiement" : (
              <span className="flex items-center gap-1.5">
                Abonnements ({subscriptions.length})
                {pendingCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">{pendingCount}</span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── RIB TAB ──────────────────────────────────────────────────────────── */}
      {tab === "rib" && (
        <div className="max-w-lg bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Coordonnées bancaires (RIB)</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Affichées aux clients ayant une souscription payante en attente, avec bouton de copie pour faciliter le virement.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">IBAN</label>
            <input type="text" value={ribIban} onChange={(e) => setRibIban(e.target.value)}
              placeholder="FR76 1600 6200 1100 8401 5620 604"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">BIC</label>
            <input type="text" value={ribBic} onChange={(e) => setRibBic(e.target.value)}
              placeholder="AGRIFRPP860"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleSaveRib} disabled={ribSaving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            {ribSaving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      )}

      {/* ── APPS TAB ─────────────────────────────────────────────────────────── */}
      {tab === "apps" && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={openNewApp} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">
              + Nouvelle application
            </button>
          </div>
          {loadingApps ? (
            <div className="text-center py-10 text-gray-400 text-sm">Chargement…</div>
          ) : apps.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-3xl mb-2">🏪</p>
              <p className="text-sm">Aucune application. Créez la première !</p>
            </div>
          ) : (
            <div className="space-y-3">
              {apps.map((app) => {
                const subCount = subscriptions.filter((s) => s.appId === app.id && s.statut === "active").length;
                return (
                  <div key={app.id} className="bg-white border rounded-xl p-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: app.couleur + "20" }}>
                      {app.iconUrl ? <img src={app.iconUrl} alt="" className="w-full h-full object-cover" /> : app.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{app.nom}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${app.actif ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {app.actif ? "Actif" : "Inactif"}
                        </span>
                        <span className="text-xs text-gray-400">{subCount} abonné{subCount > 1 ? "s" : ""}</span>
                        {(app.visibleUserIds?.length ?? 0) > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            {app.visibleUserIds!.length} visible{app.visibleUserIds!.length > 1 ? "s" : ""}
                          </span>
                        )}
                        {(app.hiddenUserIds?.length ?? 0) > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                            {app.hiddenUserIds!.length} masqué{app.hiddenUserIds!.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{app.shortDesc}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold text-gray-900">{app.prix === 0 ? "Gratuit" : `${app.prix} €${PERIOD_LABEL[app.periodicite]}`}</div>
                      {app.route && <div className="text-xs text-blue-500 truncate max-w-[120px]">{app.route}</div>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => openEditApp(app)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition" title="Modifier">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={() => handleDeleteApp(app)} className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition" title="Supprimer">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SUBS TAB ─────────────────────────────────────────────────────────── */}
      {tab === "subs" && (
        <div>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              type="text" placeholder="Rechercher un client…"
              value={searchSub} onChange={(e) => setSearchSub(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
            />
            <select value={filterApp} onChange={(e) => setFilterApp(e.target.value)} className="border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white text-gray-600">
              <option value="">Toutes les apps</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.nom}</option>)}
            </select>
            <select value={filterStatut} onChange={(e) => setFilterStatut(e.target.value as StoreSubStatut | "all")} className="border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white text-gray-600">
              <option value="all">Tous statuts</option>
              {(Object.keys(STATUT_LABEL) as StoreSubStatut[]).map((s) => (
                <option key={s} value={s}>{STATUT_LABEL[s]}</option>
              ))}
            </select>
            <button onClick={openNewSub} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition whitespace-nowrap shrink-0">
              + Nouvel abonnement
            </button>
          </div>

          {loadingSubs ? (
            <div className="text-center py-10 text-gray-400 text-sm">Chargement…</div>
          ) : filteredSubs.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm">{subscriptions.length === 0 ? "Aucun abonnement pour l'instant." : "Aucun résultat."}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSubs.map((sub) => {
                const app = apps.find((a) => a.id === sub.appId);
                return (
                  <div key={sub.id} className={`bg-white border rounded-xl p-4 ${sub.statut === "pending" ? "border-orange-300 bg-orange-50 ring-1 ring-orange-200" : ""}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: (app?.couleur ?? "#6366f1") + "20" }}>
                        {app?.icon ?? "📦"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-gray-900">{sub.clientNom}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500">{sub.appNom}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUT_COLOR[sub.statut]}`}>{STATUT_LABEL[sub.statut]}</span>
                          {sub.limites && Object.keys(sub.limites).length > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                              {Object.entries(sub.limites).map(([k, v]) => {
                                const cfg = app?.limitesConfig?.find(l => l.key === k);
                                return `${cfg?.label ?? k}: ${v}`;
                              }).join(" · ")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          Depuis {toDateStr(sub.dateDebut)}
                          {sub.dateFin ? ` → ${toDateStr(sub.dateFin)}` : ""}
                          {sub.clientEmail ? ` · ${sub.clientEmail}` : ""}
                        </div>
                        {sub.factureNumber && (
                          <div className="text-xs text-blue-500 mt-0.5">Facture : {sub.factureNumber}</div>
                        )}
                        {(app?.prix ?? 0) > 0 && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[11px] text-gray-500">Réf. virement :</span>
                            <span className="text-[11px] font-mono font-semibold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{orderRef(sub.id)}</span>
                            <button onClick={() => copyText(orderRef(sub.id)).then(() => showToast("Référence copiée"))}
                              className="text-[11px] text-blue-600 hover:underline">Copier</button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                        {sub.statut !== "active" && (
                          <button onClick={() => quickSetStatut(sub, "active")} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition">Activer</button>
                        )}
                        {sub.statut === "active" && (
                          <button onClick={() => quickSetStatut(sub, "suspended")} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition">Suspendre</button>
                        )}
                        {sub.statut !== "cancelled" && (
                          <button onClick={() => quickSetStatut(sub, "cancelled")} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition">Annuler</button>
                        )}
                        <button onClick={() => setHistorySubId(historySubId === sub.id ? null : sub.id)} title="Historique"
                          className={`p-1.5 rounded-lg transition ${historySubId === sub.id ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </button>
                        <button onClick={() => handleFacturer(sub)} title="Créer une facture" className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        </button>
                        <button onClick={() => openEditSub(sub)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button onClick={() => handleDeleteSub(sub)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                    {sub.notes && <p className="text-xs text-gray-400 mt-2 italic">{sub.notes}</p>}
                    {historySubId === sub.id && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Historique</p>
                        {(sub.events && sub.events.length > 0) ? (
                          <ol className="space-y-1.5">
                            {[...sub.events]
                              .sort((a, b) => ((a.date as any)?.toMillis?.() ?? 0) - ((b.date as any)?.toMillis?.() ?? 0))
                              .map((ev, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                                  <span className="text-gray-700 font-medium">{SUB_EVENT_LABELS[ev.type] ?? ev.type}</span>
                                  {ev.note && <span className="text-gray-400">— {ev.note}</span>}
                                  <span className="text-gray-400 ml-auto whitespace-nowrap">
                                    {(ev.date as any)?.toDate?.().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                </li>
                              ))}
                          </ol>
                        ) : (
                          <p className="text-xs text-gray-400 italic">Aucun événement enregistré (abonnement antérieur au suivi d'historique).</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── APP MODAL ─────────────────────────────────────────────────────────── */}
      {showAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowAppModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{editApp ? "Modifier l'application" : "Nouvelle application"}</h2>
              <button onClick={() => setShowAppModal(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>
            <div className="p-6 space-y-5">
              {/* Icône + couleur */}
              <div className="flex gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Icône</label>
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJIS.map((e) => (
                      <button key={e} type="button" onClick={() => setAppForm((f) => ({ ...f, icon: e }))}
                        className={`w-8 h-8 rounded-lg text-lg flex items-center justify-center transition ${appForm.icon === e ? "bg-blue-100 ring-2 ring-blue-400" : "hover:bg-gray-100"}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Couleur</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setAppForm((f) => ({ ...f, couleur: c }))}
                        className={`w-7 h-7 rounded-full transition ${appForm.couleur === c ? "ring-2 ring-offset-1 ring-gray-700" : ""}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Logo image personnalisé (prioritaire sur l'emoji) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">{"Logo image (optionnel — remplace l'emoji)"}</label>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: appForm.couleur + "30" }}>
                    {appForm.iconUrl ? <img src={appForm.iconUrl} alt="" className="w-full h-full object-cover" /> : appForm.icon}
                  </div>
                  <label className="cursor-pointer text-xs font-medium text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                    {uploadingIcon ? "Envoi…" : appForm.iconUrl ? "Changer le logo" : "Importer un logo"}
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingIcon}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !currentUser) return;
                        setUploadingIcon(true);
                        try {
                          const url = await uploadImage(file, `users/${currentUser.uid}/store_icons/${Date.now()}_${file.name}`);
                          setAppForm((f) => ({ ...f, iconUrl: url }));
                        } catch { showToast("Erreur lors de l'envoi du logo.", false); }
                        finally { setUploadingIcon(false); }
                      }} />
                  </label>
                  {appForm.iconUrl && (
                    <button type="button" onClick={() => setAppForm((f) => ({ ...f, iconUrl: "" }))}
                      className="text-xs text-gray-400 hover:text-red-500 transition">Retirer</button>
                  )}
                </div>
              </div>

              {/* Aperçu */}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: appForm.couleur + "15" }}>
                <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center text-xl" style={{ backgroundColor: appForm.couleur + "30" }}>
                  {appForm.iconUrl ? <img src={appForm.iconUrl} alt="" className="w-full h-full object-cover" /> : appForm.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{appForm.nom || "Nom de l'application"}</div>
                  <div className="text-xs text-gray-500">{appForm.shortDesc || "Description courte"}</div>
                </div>
              </div>
              {/* Champs principaux */}
              {[
                { label: "Nom *", key: "nom", placeholder: "Ex : Compteur de belote" },
                { label: "Accroche courte *", key: "shortDesc", placeholder: "Ex : Calculez les points de vos parties" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input type="text" placeholder={placeholder} value={(appForm as any)[key]}
                    onChange={(e) => setAppForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description complète</label>
                <RichTextEditor
                  value={appForm.description}
                  onChange={(html) => setAppForm((f) => ({ ...f, description: html }))}
                  placeholder="Description détaillée de l'application… (gras, italique, listes, couleurs disponibles)"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Prix (€)</label>
                  <input type="number" min="0" step="0.01" placeholder="0" value={appForm.prix}
                    onChange={(e) => setAppForm((f) => ({ ...f, prix: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Périodicité</label>
                  <select value={appForm.periodicite} onChange={(e) => setAppForm((f) => ({ ...f, periodicite: e.target.value as StoreApp["periodicite"] }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition bg-white">
                    <option value="mensuel">Mensuel</option>
                    <option value="annuel">Annuel</option>
                    <option value="unique">Paiement unique</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Route interne</label>
                  <input type="text" placeholder="/belote" value={appForm.route}
                    onChange={(e) => setAppForm((f) => ({ ...f, route: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ordre d'affichage</label>
                  <input type="number" min="0" value={appForm.ordre}
                    onChange={(e) => setAppForm((f) => ({ ...f, ordre: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tags (séparés par virgule)</label>
                <input type="text" placeholder="Jeux, Calcul, Sport…" value={appForm.tags}
                  onChange={(e) => setAppForm((f) => ({ ...f, tags: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setAppForm((f) => ({ ...f, actif: !f.actif }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${appForm.actif ? "bg-green-500" : "bg-gray-200"}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${appForm.actif ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
                <span className="text-sm text-gray-700">Application active (visible dans la boutique)</span>
              </div>

              {/* ── VISIBILITÉ ── */}
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Visibilité</p>
                <div className="space-y-4">
                  {/* Whitelist */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-gray-700">Afficher uniquement à :</label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">
                          {appForm.visibleUserIds.length === 0 ? "tous" : `${appForm.visibleUserIds.length} sélectionné(s)`}
                        </span>
                        {nonAdminUsers.length > 0 && (
                          <button type="button" onClick={() => setAppForm(f => ({
                            ...f,
                            visibleUserIds: f.visibleUserIds.length === nonAdminUsers.length ? [] : nonAdminUsers.map(u => u.uid),
                          }))} className="text-xs text-blue-600 hover:underline">
                            {appForm.visibleUserIds.length === nonAdminUsers.length ? "Aucun" : "Tous"}
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="text" placeholder="Rechercher un utilisateur…"
                      value={visibleSearch} onChange={e => setVisibleSearch(e.target.value)}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 mb-1.5 transition"
                    />
                    <div className="border rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                      {nonAdminUsers.length === 0 ? (
                        <p className="text-xs text-gray-400 p-3">Aucun utilisateur non-admin.</p>
                      ) : nonAdminUsers
                          .filter(u => !visibleSearch || `${u.nom ?? ""} ${u.prenom ?? ""} ${u.email ?? ""}`.toLowerCase().includes(visibleSearch.toLowerCase()))
                          .map(u => (
                        <label key={u.uid} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-0 transition">
                          <input
                            type="checkbox"
                            checked={appForm.visibleUserIds.includes(u.uid)}
                            onChange={e => setAppForm(f => ({
                              ...f,
                              visibleUserIds: e.target.checked
                                ? [...f.visibleUserIds, u.uid]
                                : f.visibleUserIds.filter(id => id !== u.uid),
                            }))}
                            className="rounded"
                          />
                          <span className="text-xs text-gray-700">{(u.nom ?? "").toUpperCase()} {u.prenom}</span>
                          {u.email && <span className="text-xs text-gray-400 ml-auto truncate">{u.email}</span>}
                        </label>
                      ))}
                    </div>
                    {appForm.visibleUserIds.length > 0 && (
                      <p className="text-xs text-orange-600 mt-1">⚠ Seuls ces utilisateurs verront l'app (+ les admins)</p>
                    )}
                  </div>
                  {/* Blacklist */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-gray-700">Masquer pour :</label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">
                          {appForm.hiddenUserIds.length === 0 ? "personne" : `${appForm.hiddenUserIds.length} sélectionné(s)`}
                        </span>
                        {nonAdminUsers.length > 0 && (
                          <button type="button" onClick={() => setAppForm(f => ({
                            ...f,
                            hiddenUserIds: f.hiddenUserIds.length === nonAdminUsers.length ? [] : nonAdminUsers.map(u => u.uid),
                          }))} className="text-xs text-blue-600 hover:underline">
                            {appForm.hiddenUserIds.length === nonAdminUsers.length ? "Aucun" : "Tous"}
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="text" placeholder="Rechercher un utilisateur…"
                      value={hiddenSearch} onChange={e => setHiddenSearch(e.target.value)}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 mb-1.5 transition"
                    />
                    <div className="border rounded-lg overflow-hidden max-h-36 overflow-y-auto">
                      {nonAdminUsers.length === 0 ? (
                        <p className="text-xs text-gray-400 p-3">Aucun utilisateur non-admin.</p>
                      ) : nonAdminUsers
                          .filter(u => !hiddenSearch || `${u.nom ?? ""} ${u.prenom ?? ""} ${u.email ?? ""}`.toLowerCase().includes(hiddenSearch.toLowerCase()))
                          .map(u => (
                        <label key={u.uid} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-0 transition">
                          <input
                            type="checkbox"
                            checked={appForm.hiddenUserIds.includes(u.uid)}
                            onChange={e => setAppForm(f => ({
                              ...f,
                              hiddenUserIds: e.target.checked
                                ? [...f.hiddenUserIds, u.uid]
                                : f.hiddenUserIds.filter(id => id !== u.uid),
                            }))}
                            className="rounded"
                          />
                          <span className="text-xs text-gray-700">{(u.nom ?? "").toUpperCase()} {u.prenom}</span>
                          {u.email && <span className="text-xs text-gray-400 ml-auto truncate">{u.email}</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── LIMITES D'UTILISATION ── */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Limites d'utilisation</p>
                  <button type="button" onClick={() => setAppLimites(prev => [...prev, { key: "", label: "", defaultValue: "0" }])}
                    className="text-xs text-blue-600 hover:underline">+ Ajouter</button>
                </div>
                {appLimites.length === 0 ? (
                  <p className="text-xs text-gray-400">Aucune limite. Utilisez "Ajouter" pour créer des limites par abonnement (ex : nombre d'équipes max).</p>
                ) : (
                  <div className="space-y-2">
                    {appLimites.map((l, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input placeholder="Clé (ex: maxEquipes)" value={l.key}
                          onChange={e => setAppLimites(prev => prev.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                          className="flex-1 border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 transition" />
                        <input placeholder="Label (ex: Équipes max)" value={l.label}
                          onChange={e => setAppLimites(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                          className="flex-1 border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 transition" />
                        <input type="number" placeholder="Défaut" value={l.defaultValue}
                          onChange={e => setAppLimites(prev => prev.map((x, j) => j === i ? { ...x, defaultValue: e.target.value } : x))}
                          className="w-20 border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 transition" />
                        <button type="button" onClick={() => setAppLimites(prev => prev.filter((_, j) => j !== i))}
                          className="text-gray-300 hover:text-red-500 p-1 transition">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── CHANGELOGS ── */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Mises à jour et annonces</p>
                  <button type="button" onClick={() => setShowChangelogForm(v => !v)}
                    className="text-xs text-blue-600 hover:underline">
                    {showChangelogForm ? "Annuler" : "+ Ajouter"}
                  </button>
                </div>
                {showChangelogForm && (
                  <div className="border rounded-lg p-3 mb-3 bg-blue-50 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select value={newChangelog.type} onChange={e => setNewChangelog(f => ({ ...f, type: e.target.value as "update" | "upcoming" }))}
                        className="border rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
                        <option value="update">Mise à jour</option>
                        <option value="upcoming">À venir</option>
                      </select>
                      <input type="date" value={newChangelog.date}
                        onChange={e => setNewChangelog(f => ({ ...f, date: e.target.value }))}
                        className="border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white" />
                    </div>
                    <input placeholder="Titre *" value={newChangelog.title}
                      onChange={e => setNewChangelog(f => ({ ...f, title: e.target.value }))}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
                    <textarea rows={2} placeholder="Description (optionnel)" value={newChangelog.description}
                      onChange={e => setNewChangelog(f => ({ ...f, description: e.target.value }))}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 resize-none" />
                    <button type="button" onClick={addChangelog} disabled={!newChangelog.title.trim()}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition">
                      Ajouter l'entrée
                    </button>
                  </div>
                )}
                {appChangelogs.length === 0 ? (
                  <p className="text-xs text-gray-400">Aucune entrée pour l'instant.</p>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {appChangelogs.map(c => (
                      <div key={c.id} className="flex items-start justify-between gap-2 border rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${c.type === "update" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                              {c.type === "update" ? "Mise à jour" : "À venir"}
                            </span>
                            <span className="text-xs text-gray-400">{c.date}</span>
                          </div>
                          <p className="text-xs font-medium text-gray-800 mt-0.5">{c.title}</p>
                          {c.description && <p className="text-xs text-gray-500">{c.description}</p>}
                        </div>
                        <button type="button" onClick={() => setAppChangelogs(prev => prev.filter(x => x.id !== c.id))}
                          className="text-gray-300 hover:text-red-500 transition shrink-0 mt-0.5 p-0.5">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <button onClick={() => setShowAppModal(false)} className="flex-1 border rounded-lg py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Annuler</button>
              <button onClick={saveApp} disabled={savingApp || !appForm.nom.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-semibold transition">
                {savingApp ? "Enregistrement…" : editApp ? "Enregistrer" : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SUB MODAL ─────────────────────────────────────────────────────────── */}
      {showSubModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowSubModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{editSub ? "Modifier l'abonnement" : "Nouvel abonnement"}</h2>
              <button onClick={() => setShowSubModal(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Application *</label>
                <select value={subForm.appId} onChange={(e) => setSubForm((f) => ({ ...f, appId: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                  {apps.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client (depuis la liste)</label>
                {subForm.clientId ? (
                  <div className="flex items-center justify-between border border-blue-300 bg-blue-50 rounded-lg px-3 py-2.5">
                    <span className="text-sm font-medium text-blue-800">{subForm.clientNom}</span>
                    <button type="button" onClick={() => { handleSelectClient(""); setClientSubSearch(""); }}
                      className="text-blue-400 hover:text-red-500 text-xs ml-2 transition">Changer</button>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <input
                      type="text"
                      placeholder="Rechercher par nom, prénom ou email…"
                      value={clientSubSearch}
                      onChange={(e) => setClientSubSearch(e.target.value)}
                      className="w-full px-3 py-2 text-sm outline-none border-b focus:border-blue-400"
                    />
                    <div className="max-h-44 overflow-y-auto">
                      <button type="button" onClick={() => handleSelectClient("")}
                        className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 border-b transition italic">
                        — Saisie manuelle —
                      </button>
                      {[...clients]
                        .sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr"))
                        .filter((c) => {
                          const q = clientSubSearch.toLowerCase();
                          return !q || c.nom.toLowerCase().includes(q) || (c.prenom ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
                        })
                        .map((c) => (
                          <button type="button" key={c.id}
                            onClick={() => { handleSelectClient(c.id); setClientSubSearch(""); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-0 transition">
                            <span className="font-medium text-gray-800">{[c.nom, c.prenom].filter(Boolean).join(" ")}</span>
                            {c.email && <span className="text-xs text-gray-400 ml-2">{c.email}</span>}
                          </button>
                        ))
                      }
                    </div>
                  </div>
                )}
              </div>
              {!subForm.clientId && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nom *</label>
                    <input type="text" placeholder="Prénom Nom" value={subForm.clientNom}
                      onChange={(e) => setSubForm((f) => ({ ...f, clientNom: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <input type="email" placeholder="email@…" value={subForm.clientEmail}
                      onChange={(e) => setSubForm((f) => ({ ...f, clientEmail: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select value={subForm.statut} onChange={(e) => setSubForm((f) => ({ ...f, statut: e.target.value as StoreSubStatut }))}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                  {(Object.keys(STATUT_LABEL) as StoreSubStatut[]).map((s) => (
                    <option key={s} value={s}>{STATUT_LABEL[s]}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
                  <input type="date" value={subForm.dateDebut}
                    onChange={(e) => setSubForm((f) => ({ ...f, dateDebut: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin</label>
                  <input type="date" value={subForm.dateFin}
                    onChange={(e) => setSubForm((f) => ({ ...f, dateFin: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition" />
                </div>
              </div>
              {/* Limites personnalisées */}
              {selectedAppLimites.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Limites personnalisées</label>
                  <div className="space-y-2">
                    {selectedAppLimites.map(l => (
                      <div key={l.key} className="flex items-center gap-3">
                        <label className="text-sm text-gray-700 flex-1">{l.label}</label>
                        <input
                          type="number"
                          placeholder={String(l.defaultValue)}
                          value={subLimites[l.key] ?? ""}
                          onChange={e => setSubLimites(f => ({ ...f, [l.key]: e.target.value }))}
                          className="w-24 border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400 transition"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Laisser vide = valeur par défaut</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes internes</label>
                <textarea rows={2} placeholder="Remarques, conditions particulières…" value={subForm.notes}
                  onChange={(e) => setSubForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-400 transition resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <button onClick={() => setShowSubModal(false)} className="flex-1 border rounded-lg py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Annuler</button>
              <button onClick={saveSub} disabled={savingSub || !subForm.appId || !subForm.clientNom.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-semibold transition">
                {savingSub ? "Enregistrement…" : editSub ? "Enregistrer" : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFIRMATION DE SUPPRESSION ───────────────────────────────────────── */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => { if (!confirming) setConfirmDialog(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="font-semibold text-gray-900 text-base">{confirmDialog.title}</h2>
              {confirmDialog.message && <p className="text-sm text-gray-500 mt-1.5">{confirmDialog.message}</p>}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setConfirmDialog(null)} disabled={confirming}
                  className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
                  Annuler
                </button>
                <button
                  onClick={async () => {
                    setConfirming(true);
                    try { await confirmDialog.onConfirm(); setConfirmDialog(null); }
                    finally { setConfirming(false); }
                  }}
                  disabled={confirming}
                  className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-medium transition">
                  {confirming ? "Suppression…" : (confirmDialog.confirmLabel ?? "Supprimer")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
