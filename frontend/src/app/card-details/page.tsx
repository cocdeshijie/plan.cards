"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Card, CardSecretMasked, CardSecretRevealed } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import {
  AUTO_HIDE_OPTIONS,
  hydrateAutoHidePreference,
  useCardVault,
} from "@/hooks/use-card-vault";
import { getCardSecrets } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardSecretDialog } from "@/components/card-details/card-secret-dialog";
import { CardDetailResponsive } from "@/components/card-detail/card-detail-responsive";
import { CardThumbnail } from "@/components/shared/card-thumbnail";
import {
  Search,
  Eye,
  EyeOff,
  Copy,
  Check,
  Lock,
  Pencil,
  ClipboardList,
  ArrowDownAZ,
  ArrowUpAZ,
  FilterX,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

type GroupBy = "none" | "product" | "issuer" | "network" | "type" | "profile";
type SortField = "name" | "issuer" | "profile" | "network" | "exp";

interface Row {
  card: Card;
  secret: CardSecretMasked;
  profileName: string;
}

export default function CardDetailsPage() {
  const { cards, profiles, dataLoading, selectedProfileId, authMode } = useAppStore();
  const {
    revealed,
    loadingIds,
    autoHideSeconds,
    expiresAt,
    reveal,
    revealMany,
    hide,
    hideAll,
    setAutoHideSeconds,
    checkExpiry,
  } = useCardVault();

  const [secrets, setSecrets] = useState<CardSecretMasked[] | null>(null);
  const [query, setQuery] = useState("");
  const [persons, setPersons] = useState<number[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  // Defaults to active. A closed card's number is dead, and pasting one into a
  // checkout is the obvious failure this page could cause. Shown as a pressed
  // chip rather than hidden default state, so it's visible and removable.
  const [statuses, setStatuses] = useState<string[]>(["active"]);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [copied, setCopied] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ cardId: number | null; existing: CardSecretMasked | null }>({
    cardId: null,
    existing: null,
  });
  const [now, setNow] = useState(() => Date.now());
  // Derived from the id, not stored as an object, so it stays current when the
  // store refreshes — the same pattern the cards page uses.
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const openCard = openCardId !== null ? (cards.find((c) => c.id === openCardId) ?? null) : null;

  const load = useCallback(async () => {
    try {
      setSecrets(await getCardSecrets());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load card details");
      setSecrets([]);
    }
  }, []);

  useEffect(() => {
    hydrateAutoHidePreference();
    load();
  }, [load]);

  // Drive the countdown label. The store owns expiry; this only re-renders.
  useEffect(() => {
    if (expiresAt === null) return;
    // `now` is only advanced by this interval, which doesn't exist until
    // something is revealed — so without this first call the label showed a
    // value computed at mount until the first tick corrected it.
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      checkExpiry();
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, checkExpiry]);

  const profileName = useCallback(
    (id: number) => profiles.find((p) => p.id === id)?.name ?? "—",
    [profiles],
  );

  const rows: Row[] = useMemo(() => {
    if (!secrets) return [];
    // The global profile selector sits in the nav above this page and every
    // other page obeys it. Ignoring it here meant the header could read "Alice"
    // while the table listed Bob's cards.
    const scoped =
      selectedProfileId === "all"
        ? cards
        : cards.filter((c) => c.profile_id === parseInt(selectedProfileId, 10));
    const byId = new Map(scoped.map((c) => [c.id, c]));
    return secrets
      .map((s) => {
        const card = byId.get(s.card_id);
        return card ? { card, secret: s, profileName: profileName(card.profile_id) } : null;
      })
      .filter((r): r is Row => r !== null);
  }, [secrets, cards, profileName, selectedProfileId]);

  // OR within a facet, AND across facets. An empty facet stops constraining,
  // which is why there is no "All" chip — it would be a second way to say the
  // same thing.
  const passSearch = useCallback(
    (r: Row) => {
      if (!query.trim()) return true;
      const hay = [r.card.card_name, r.card.issuer, r.profileName, r.card.network, r.secret.last_digits]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(query.trim().toLowerCase());
    },
    [query],
  );
  const passPersons = useCallback(
    (r: Row) => persons.length === 0 || persons.includes(r.card.profile_id),
    [persons],
  );
  const passTypes = useCallback(
    (r: Row) => types.length === 0 || types.includes(r.card.card_type),
    [types],
  );
  const passStatuses = useCallback(
    (r: Row) => statuses.length === 0 || statuses.includes(r.secret.card_status),
    [statuses],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) => passSearch(r) && passPersons(r) && passTypes(r) && passStatuses(r),
    );
    const sorted = [...filtered].sort((a, b) => {
      let r = 0;
      if (sortField === "exp") {
        r =
          a.secret.exp_year * 100 + a.secret.exp_month - (b.secret.exp_year * 100 + b.secret.exp_month);
      } else if (sortField === "profile") {
        r = a.profileName.localeCompare(b.profileName);
      } else if (sortField === "name") {
        r = a.card.card_name.localeCompare(b.card.card_name);
      } else if (sortField === "issuer") {
        r = a.card.issuer.localeCompare(b.card.issuer);
      } else {
        r = (a.card.network ?? "").localeCompare(b.card.network ?? "");
      }
      if (r === 0) r = a.card.card_name.localeCompare(b.card.card_name);
      return r * sortDir;
    });
    return sorted;
  }, [rows, passSearch, passPersons, passTypes, passStatuses, sortField, sortDir]);

  // Counts are computed against the OTHER active facets, so a chip reading 0
  // warns you it would empty the table before you click it.
  const personChips = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.card.profile_id))];
    return ids
      .map((id) => ({
        id,
        name: profileName(id),
        count: rows.filter(
          (r) => passSearch(r) && passTypes(r) && passStatuses(r) && r.card.profile_id === id,
        ).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, profileName, passSearch, passTypes, passStatuses]);

  const typeChips = useMemo(
    () =>
      (["personal", "business"] as const).map((t) => ({
        value: t,
        label: t === "business" ? "Business" : "Personal",
        count: rows.filter(
          (r) => passSearch(r) && passPersons(r) && passStatuses(r) && r.card.card_type === t,
        ).length,
      })),
    [rows, passSearch, passPersons, passStatuses],
  );

  const statusChips = useMemo(
    () =>
      ([
        { value: "active", label: "Open" },
        { value: "closed", label: "Closed" },
      ] as const).map((st) => ({
        value: st.value,
        label: st.label,
        count: rows.filter(
          (r) => passSearch(r) && passPersons(r) && passTypes(r) && r.secret.card_status === st.value,
        ).length,
      })),
    [rows, passSearch, passPersons, passTypes],
  );

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "", rows: visible }];
    const keyOf = (r: Row) => {
      switch (groupBy) {
        case "product":
          return r.card.card_name;
        case "issuer":
          return r.card.issuer;
        case "network":
          return r.card.network ?? "Unknown";
        case "type":
          return r.card.card_type === "business" ? "Business" : "Personal";
        default:
          return r.profileName;
      }
    };
    const buckets = new Map<string, Row[]>();
    for (const r of visible) {
      const k = keyOf(r);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(r);
    }
    // Multi-card groups first — whatever you grouped for is what you want to see.
    return [...buckets.entries()]
      .map(([key, rs]) => ({ key, rows: rs }))
      .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
  }, [visible, groupBy]);

  const revealedCount = Object.keys(revealed).length;
  const allRevealed = visible.length > 0 && visible.every((r) => revealed[r.card.id]);
  const statusIsDefault = statuses.length === 1 && statuses[0] === "active";
  const activeFilters =
    persons.length + types.length + (query.trim() ? 1 : 0) + (statusIsDefault ? 0 : 1);

  const secondsLeft = expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const timerLabel =
    autoHideSeconds === 0
      ? "no auto-hide"
      : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const doCopy = async (key: string, value: string, label: string) => {
    const result = await copyToClipboard(value);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    if (result === "async") toast.success(`${label} copied`);
    else if (result === "fallback")
      toast.success(`${label} copied — via the legacy path; the Clipboard API is blocked here`);
    else toast.error(`Couldn't copy ${label}. Select the value and copy it manually.`);
  };

  const openAdd = () => {
    setEditing({ cardId: null, existing: null });
    setDialogOpen(true);
  };
  const openEdit = (row: Row) => {
    setEditing({ cardId: row.card.id, existing: row.secret });
    setDialogOpen(true);
  };

  const cardsWithoutSecrets = useMemo(() => {
    const stored = new Set((secrets ?? []).map((s) => s.card_id));
    return cards.filter((c) => !stored.has(c.id));
  }, [cards, secrets]);

  if (dataLoading || secrets === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Card details</h1>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            Card details
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-prose">
            Optional. Stored on your server, encrypted at rest. Reveal a row to copy its fields — the
            number copies without spaces.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {revealedCount > 0 && (
            <span className="text-xs text-primary font-medium tabular-nums whitespace-nowrap">
              {timerLabel}
            </span>
          )}
          <Select
            value={String(autoHideSeconds)}
            onValueChange={(v) => setAutoHideSeconds(parseInt(v, 10))}
          >
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO_HIDE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  Auto-hide: {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {revealedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={hideAll}>
              Hide all
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={allRevealed || visible.length === 0}
            onClick={async () => {
              const { revealed: ok, failed } = await revealMany(visible.map((r) => r.card.id));
              if (failed > 0) {
                toast.error(
                  ok > 0
                    ? `Revealed ${ok}, but ${failed} could not be decrypted`
                    : `Couldn't reveal ${failed} card${failed === 1 ? "" : "s"}`,
                );
              }
            }}
          >
            <Eye className="h-4 w-4 mr-1.5" />
            {allRevealed ? "All revealed" : revealedCount > 0 ? "Reveal rest" : "Reveal all"}
          </Button>
          {/* Only cards WITHOUT stored details. Falling back to the full list
              when every card already had details turned "Add" into an
              unconfirmed overwrite: the dialog opened blank, and saving wiped
              the stored code, name and postcode. Editing goes through the row. */}
          <Button size="sm" onClick={openAdd} disabled={cardsWithoutSecrets.length === 0}>
            Add details
          </Button>
        </div>
      </div>

      {/* Open mode has no login at all — require_auth hands back the first admin
          without checking a credential. Everything else in the app is exposed
          the same way, but a card number is a different order of consequence,
          so say it plainly instead of letting the page look like a vault. */}
      {authMode === "open" && (
        <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">This instance has no login.</span> Auth
            mode is <code className="text-[11px]">open</code>, so anyone who can open this page —
            anyone on the same network, or the internet if you&apos;ve exposed it — can reveal these
            card numbers without a password. Set one in the admin settings to change that.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">No card details stored yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Add a number, expiry and security code to any card to use this page. The rest of the app
              works fine without it.
            </p>
          </div>
          <Button onClick={openAdd} disabled={cards.length === 0}>
            Add card details
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-[280px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search or type last 4…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 h-9"
                autoComplete="off"
              />
            </div>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="product">Same card product</SelectItem>
                <SelectItem value="issuer">Issuer</SelectItem>
                <SelectItem value="network">Network</SelectItem>
                <SelectItem value="type">Personal / business</SelectItem>
                <SelectItem value="profile">Person</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Card name</SelectItem>
                  <SelectItem value="issuer">Issuer</SelectItem>
                  <SelectItem value="profile">Person</SelectItem>
                  <SelectItem value="network">Network</SelectItem>
                  <SelectItem value="exp">Expiry</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
                title={sortDir === 1 ? "Ascending" : "Descending"}
              >
                {sortDir === 1 ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
              </Button>
            </div>
            <Badge variant="outline" className="ml-auto">
              {visible.length === rows.length
                ? `${rows.length} stored`
                : `${visible.length} of ${rows.length}`}
            </Badge>
          </div>

          <div className="rounded-xl border bg-card p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground w-14 shrink-0">
                Person
              </span>
              {personChips.map((p) => {
                const on = persons.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setPersons((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))
                    }
                    className={`h-7 px-3 rounded-full border text-xs font-medium transition-colors ${
                      on
                        ? "bg-primary border-primary text-primary-foreground"
                        : `bg-background text-muted-foreground hover:text-foreground ${p.count === 0 ? "opacity-40" : ""}`
                    }`}
                  >
                    {p.name} <span className="opacity-60 tabular-nums">{p.count}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground w-14 shrink-0">
                Type
              </span>
              {typeChips.map((t) => {
                const on = types.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setTypes((s) =>
                        s.includes(t.value) ? s.filter((x) => x !== t.value) : [...s, t.value],
                      )
                    }
                    className={`h-7 px-3 rounded-full border text-xs font-medium transition-colors ${
                      on
                        ? "bg-primary border-primary text-primary-foreground"
                        : `bg-background text-muted-foreground hover:text-foreground ${t.count === 0 ? "opacity-40" : ""}`
                    }`}
                  >
                    {t.label} <span className="opacity-60 tabular-nums">{t.count}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground w-14 shrink-0">
                Status
              </span>
              {statusChips.map((st) => {
                const on = statuses.includes(st.value);
                return (
                  <button
                    key={st.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setStatuses((s2) =>
                        s2.includes(st.value) ? s2.filter((x) => x !== st.value) : [...s2, st.value],
                      )
                    }
                    className={`h-7 px-3 rounded-full border text-xs font-medium transition-colors ${
                      on
                        ? "bg-primary border-primary text-primary-foreground"
                        : `bg-background text-muted-foreground hover:text-foreground ${st.count === 0 ? "opacity-40" : ""}`
                    }`}
                  >
                    {st.label} <span className="opacity-60 tabular-nums">{st.count}</span>
                  </button>
                );
              })}
              {activeFilters > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 text-xs"
                  onClick={() => {
                    setPersons([]);
                    setTypes([]);
                    setQuery("");
                    // Back to the default view, not to "no filters at all" —
                    // showing closed cards is a deliberate choice, not a baseline.
                    setStatuses(["active"]);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 space-y-3">
              <FilterX className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No stored cards match those filters.</p>
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                {/* Wider than the 980px this used to need: the card art adds
                    ~48px to the Card column before anything else can shrink. */}
                <table className="w-full min-w-[1030px] border-collapse">
                  <thead>
                    <tr className="bg-muted/60 border-b">
                      {["Card", "Person", "Number", "Expires", "Code", "ZIP", "Cardholder"].map((h) => (
                        <th
                          key={h}
                          className="text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-3 h-10 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                      <th className="text-right text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-3 h-10">
                        Reveal
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((group) => (
                      // Fragment needs an explicit key — a bare <> cannot take
                      // one, and React warns for every group without it.
                      <Fragment key={group.key || "all"}>
                        {group.key && (
                          <tr className="bg-muted/40 border-y">
                            <th
                              colSpan={8}
                              scope="colgroup"
                              className="text-left px-3 h-8 text-xs font-semibold"
                            >
                              {group.key}
                              <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                                {group.rows.length} {group.rows.length === 1 ? "card" : "cards"}
                              </span>
                            </th>
                          </tr>
                        )}
                        {group.rows.map((row) => (
                          <SecretRow
                            key={row.card.id}
                            row={row}
                            revealedData={revealed[row.card.id]}
                            loading={loadingIds.includes(row.card.id)}
                            copiedKey={copied}
                            onReveal={() =>
                              revealed[row.card.id]
                                ? hide(row.card.id)
                                : reveal(row.card.id).catch((e) =>
                                    toast.error(
                                      e instanceof Error ? e.message : "Could not reveal details",
                                    ),
                                  )
                            }
                            onCopy={doCopy}
                            onEdit={() => openEdit(row)}
                            onOpenCard={() => setOpenCardId(row.card.id)}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground max-w-prose">
            Revealed rows stay revealed while you move around the app or switch to another browser tab
            — pasting into a checkout elsewhere is the point. They hide when the auto-hide timer runs
            out, when you hide them, or on reload. Copying does not clear your clipboard afterwards;
            browsers can&apos;t do that reliably, so this page doesn&apos;t claim it.
          </p>
        </>
      )}

      {openCard && (
        <CardDetailResponsive
          card={openCard}
          open={!!openCard}
          onClose={() => setOpenCardId(null)}
          onUpdated={() => {
            useAppStore.getState().refresh();
            // The card editor can change stored details too, so re-read them.
            load();
          }}
          onDeleted={() => {
            setOpenCardId(null);
            useAppStore.getState().refresh();
            load();
          }}
          profileName={profiles.find((p) => p.id === openCard.profile_id)?.name}
        />
      )}

      <CardSecretDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          // The dialog drops the stale revealed copy itself, for every caller.
          load();
          useAppStore.getState().refresh();
        }}
        cards={editing.existing ? cards : cardsWithoutSecrets}
        cardId={editing.cardId}
        existing={editing.existing}
      />
    </div>
  );
}

function SecretRow({
  row,
  revealedData,
  loading,
  copiedKey,
  onReveal,
  onCopy,
  onEdit,
  onOpenCard,
}: {
  row: Row;
  revealedData: CardSecretRevealed | undefined;
  loading: boolean;
  copiedKey: string | null;
  onReveal: () => void;
  onCopy: (key: string, value: string, label: string) => void;
  onEdit: () => void;
  onOpenCard: () => void;
}) {
  const { card, secret, profileName } = row;
  const on = !!revealedData;

  const cells: { key: string; label: string; shown: string; copy: string | null; mono: boolean }[] = [
    {
      key: "pan",
      label: "Number",
      shown: on ? revealedData!.pan : secret.masked_pan,
      // Bare digits: checkout fields commonly mask input or cap at maxlength=16,
      // where pasted spaces get truncated or rejected outright.
      copy: on ? revealedData!.pan_digits : null,
      mono: true,
    },
    {
      key: "exp",
      label: "Expiry",
      shown: on ? revealedData!.exp_display : "••/••",
      copy: on ? revealedData!.exp_display : null,
      mono: true,
    },
    {
      key: "cvv",
      label: secret.code_label,
      shown: on ? (revealedData!.cvv ?? "—") : secret.has_cvv ? "•••" : "—",
      copy: on ? revealedData!.cvv : null,
      mono: true,
    },
    {
      key: "zip",
      label: "ZIP",
      shown: on ? (revealedData!.billing_zip ?? "—") : secret.has_billing_zip ? "•••••" : "—",
      copy: on ? revealedData!.billing_zip : null,
      mono: true,
    },
    {
      key: "holder",
      label: "Cardholder",
      shown: on ? (revealedData!.holder ?? "—") : secret.has_holder ? "••••••••" : "—",
      copy: on ? revealedData!.holder : null,
      mono: false,
    },
  ];

  const copyAll = () => {
    if (!revealedData) return;
    const block = [
      revealedData.pan_digits,
      revealedData.exp_display,
      revealedData.cvv ?? "",
      revealedData.billing_zip ?? "",
      revealedData.holder ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    onCopy(`all-${card.id}`, block, "All fields");
  };

  return (
    <tr className={`border-b last:border-b-0 ${on ? "bg-primary/5" : "hover:bg-muted/40"}`}>
      <td className="px-3 h-12">
        {/* Card art sits inside the click target, as it does on the summary
            page — spans rather than divs, because a button may only contain
            phrasing content. */}
        <button
          type="button"
          onClick={onOpenCard}
          className="group flex items-center gap-2 min-w-0 max-w-full text-left rounded-sm focus-visible:ring-2 focus-visible:ring-ring outline-none"
        >
          <CardThumbnail
            templateId={card.template_id}
            cardName={card.card_name}
            cardImage={card.card_image}
            className="w-10 h-[25px] shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium truncate group-hover:underline">
              {card.card_name}
            </span>
            <span className="block text-xs text-muted-foreground truncate">
              {card.issuer}
              {card.network ? ` · ${card.network}` : ""}
            </span>
          </span>
        </button>
      </td>
      <td className="px-3 h-12">
        <div className="flex items-center gap-1.5">
          <Badge variant={card.card_type === "business" ? "warning" : "outline"}>
            {profileName}
            {card.card_type === "business" ? " · biz" : ""}
          </Badge>
          {/* A cancelled card is otherwise indistinguishable from a live one,
              and the obvious failure is pasting a dead number into a checkout. */}
          {secret.card_status === "closed" && <Badge variant="destructive">closed</Badge>}
        </div>
      </td>
      {cells.map((c) => (
        <td key={c.key} className="px-3 h-12">
          <div className="flex items-center gap-1">
            <span
              className={`text-sm whitespace-nowrap ${c.mono ? "font-mono tabular-nums" : ""}`}
              aria-hidden={!on || undefined}
            >
              {c.shown}
            </span>
            {!on && <span className="sr-only">{c.label} hidden</span>}
            {c.copy && (
              <button
                type="button"
                onClick={() => onCopy(`${c.key}-${card.id}`, c.copy!, c.label)}
                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none"
              >
                {copiedKey === `${c.key}-${card.id}` ? (
                  <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className="sr-only">
                  Copy {c.label} for {card.card_name}
                </span>
              </button>
            )}
          </div>
        </td>
      ))}
      <td className="px-3 h-12">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onReveal}
            aria-pressed={on}
            disabled={loading}
            className={`h-8 w-8 grid place-items-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none ${
              on ? "text-primary border-primary/40" : "text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {on ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            <span className="sr-only">
              {on ? "Hide" : "Show"} details for {card.card_name} ending {secret.last_digits}
            </span>
          </button>
          <button
            type="button"
            onClick={copyAll}
            disabled={!on}
            className="h-8 w-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring outline-none"
          >
            {copiedKey === `all-${card.id}` ? (
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
            ) : (
              <ClipboardList className="h-3.5 w-3.5" />
            )}
            <span className="sr-only">Copy all fields for {card.card_name}</span>
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="h-8 w-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="sr-only">Edit details for {card.card_name}</span>
          </button>
        </div>
      </td>
    </tr>
  );
}
