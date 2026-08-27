"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Card, CardSecretMasked, CardSecretRevealed } from "@/types";
import { useAppStore } from "@/hooks/use-app-store";
import {
  AUTO_HIDE_OPTIONS,
  hydrateAutoHidePreference,
  useCardVault,
} from "@/hooks/use-card-vault";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getCardSecrets } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
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
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";

type GroupBy = "none" | "product" | "issuer" | "network" | "type" | "profile";
type SortField = "name" | "issuer" | "profile" | "network" | "exp";

interface Row {
  card: Card;
  secret: CardSecretMasked;
  profileName: string;
}

/**
 * The legacy `execCommand` copy path is the NORMAL path on a self-hosted LAN
 * address — http://192.168.1.50:3000 is not a secure context, so
 * `navigator.clipboard` doesn't exist there. Explaining that on every copy turns
 * a feature that works into a permanent apology, so say it once per session and
 * then just confirm the copy like anywhere else.
 */
let legacyCopyNoticeShown = false;

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
  const [revealingAll, setRevealingAll] = useState(false);
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
  const searchRef = useRef<HTMLInputElement>(null);
  // The table needs 1030px before the actions column is reachable, which no
  // breakpoint below `lg` gives us once the container's padding is taken off.
  // Below that we render the same rows as a stacked list instead.
  const isWide = useMediaQuery("(min-width: 1024px)");

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

  // The global profile selector sits in the nav above this page and every other
  // page obeys it. Ignoring it here meant the header could read "Alice" while
  // the table listed Bob's cards. Shared with the "Add details" picker below, so
  // the button can't offer a card the page itself is hiding.
  const scopedCards = useMemo(
    () =>
      selectedProfileId === "all"
        ? cards
        : cards.filter((c) => c.profile_id === parseInt(selectedProfileId, 10)),
    [cards, selectedProfileId],
  );

  const rows: Row[] = useMemo(() => {
    if (!secrets) return [];
    const byId = new Map(scopedCards.map((c) => [c.id, c]));
    return secrets
      .map((s) => {
        const card = byId.get(s.card_id);
        return card ? { card, secret: s, profileName: profileName(card.profile_id) } : null;
      })
      .filter((r): r is Row => r !== null);
  }, [secrets, scopedCards, profileName]);

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
      // "Active"/"Closed" to match the status filter on /cards. This page used
      // to say "Open", which read as a third state next to the other page's
      // Active for the very same `card_status`.
      ([
        { value: "active", label: "Active" },
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
    if (result === "failed") {
      // No green tick on a failure — a red toast next to a check mark told two
      // different stories about the same click.
      toast.error(`Couldn't copy ${label}. Select the value and copy it manually.`);
      return;
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    if (result === "fallback" && !legacyCopyNoticeShown) {
      legacyCopyNoticeShown = true;
      toast.success(`${label} copied — via the legacy path; the Clipboard API is blocked here`);
    } else {
      toast.success(`${label} copied`);
    }
  };

  const openAdd = () => {
    setEditing({ cardId: null, existing: null });
    setDialogOpen(true);
  };
  const openEdit = (row: Row) => {
    setEditing({ cardId: row.card.id, existing: row.secret });
    setDialogOpen(true);
  };

  // One set of handlers for both layouts, so the table row and the stacked card
  // can never drift apart on what a reveal or a copy actually does.
  const rowProps = (row: Row) => ({
    row,
    revealedData: revealed[row.card.id],
    loading: loadingIds.includes(row.card.id),
    copiedKey: copied,
    onReveal: () =>
      revealed[row.card.id]
        ? hide(row.card.id)
        : reveal(row.card.id).catch((e) =>
            toast.error(e instanceof Error ? e.message : "Could not reveal details"),
          ),
    onCopy: doCopy,
    onEdit: () => openEdit(row),
    onOpenCard: () => setOpenCardId(row.card.id),
  });

  const cardsWithoutSecrets = useMemo(() => {
    const stored = new Set((secrets ?? []).map((s) => s.card_id));
    return scopedCards.filter((c) => !stored.has(c.id));
  }, [scopedCards, secrets]);

  // Stored, but belonging to a card the nav's profile selector is filtering out.
  // Counted against the full card list rather than `secrets.length` so a secret
  // whose card has since been deleted isn't reported as "hidden".
  const hiddenByProfile = useMemo(() => {
    if (!secrets || selectedProfileId === "all") return 0;
    const inScope = new Set(scopedCards.map((c) => c.id));
    const allIds = new Set(cards.map((c) => c.id));
    return secrets.filter((s) => allIds.has(s.card_id) && !inScope.has(s.card_id)).length;
  }, [secrets, cards, scopedCards, selectedProfileId]);

  if (dataLoading || secrets === null) {
    // Shaped like the real page — same `space-y-5`, same heading with its icon,
    // the same description line, the four-control cluster, the toolbar and the
    // three-row filter panel. The old two-bar skeleton was several hundred
    // pixels shorter than what replaced it, so everything jumped on load.
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              Card details
            </h1>
            <Skeleton className="h-4 w-[min(28rem,80vw)]" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-[130px]" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-[220px]" />
          <Skeleton className="h-9 w-[170px]" />
          <Skeleton className="h-9 w-[150px]" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-6 w-20 ml-auto" />
        </div>
        <div className="rounded-xl border bg-card p-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Skeleton className="h-3 w-14 shrink-0" />
              <Skeleton className="h-11 w-24 rounded-full sm:h-7" />
              <Skeleton className="h-11 w-20 rounded-full sm:h-7" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[336px] w-full rounded-xl" />
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
            disabled={allRevealed || visible.length === 0 || revealingAll}
            onClick={async () => {
              setRevealingAll(true);
              try {
                const { revealed: ok, failed } = await revealMany(visible.map((r) => r.card.id));
                if (failed > 0) {
                  toast.error(
                    ok > 0
                      ? `Revealed ${ok}, but ${failed} could not be decrypted`
                      : `Couldn't reveal ${failed} card${failed === 1 ? "" : "s"}`,
                  );
                } else if (ok === 0) {
                  // revealMany returns {0,0} when every id is already revealed
                  // or still in flight from a row click. Left unhandled, the
                  // second press of this button did nothing and said nothing.
                  toast.info("Nothing left to reveal — those rows are already open or decrypting.");
                }
              } finally {
                setRevealingAll(false);
              }
            }}
          >
            {revealingAll ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-1.5" />
            )}
            {revealingAll
              ? "Revealing…"
              : allRevealed
                ? "All revealed"
                : revealedCount > 0
                  ? "Reveal rest"
                  : "Reveal all"}
          </Button>
          {/* Only cards WITHOUT stored details. Falling back to the full list
              when every card already had details turned "Add" into an
              unconfirmed overwrite: the dialog opened blank, and saving wiped
              the stored code, name and postcode. Editing goes through the row.
              The wrapping span carries the title because a disabled button is
              not a reliable tooltip host, and "why is this dead?" is the whole
              question once every card has details. */}
          <span
            title={
              cardsWithoutSecrets.length === 0
                ? "Every card in view already has details stored. Use the pencil on a card to edit its details."
                : undefined
            }
          >
            <Button size="sm" onClick={openAdd} disabled={cardsWithoutSecrets.length === 0}>
              Add details
            </Button>
          </span>
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
            <p className="font-medium">
              {hiddenByProfile > 0 ? "No card details for this person" : "No card details stored yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {hiddenByProfile > 0 ? (
                <>
                  {hiddenByProfile} stored {hiddenByProfile === 1 ? "entry belongs" : "entries belong"}{" "}
                  to another person. Switch the profile selector above to{" "}
                  <span className="font-medium text-foreground">All profiles</span> to see{" "}
                  {hiddenByProfile === 1 ? "it" : "them"}.
                </>
              ) : (
                <>
                  Add a number, expiry and security code to any card to use this page. The rest of the
                  app works fine without it.
                </>
              )}
            </p>
          </div>
          {/* With no cards in scope there is nothing to attach details to, and a
              dead button is a dead end — send them where cards are created. */}
          {scopedCards.length === 0 ? (
            <Button asChild>
              <Link href="/cards">Add a card first</Link>
            </Button>
          ) : (
            <Button onClick={openAdd} disabled={cardsWithoutSecrets.length === 0}>
              Add card details
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-[280px]">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              />
              <Input
                ref={searchRef}
                type="search"
                placeholder="Search or type last 4…"
                aria-label="Search stored card details"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 pr-9 h-9 [&::-webkit-search-cancel-button]:hidden"
                autoComplete="off"
                enterKeyHint="search"
              />
              {/* The only reset used to be the empty-state button, which needs
                  zero results before it appears — no way back from a typo. */}
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-0 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
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
              {/* `title` names the CURRENT state; the accessible name has to
                  name the ACTION, or the control announces as its own opposite. */}
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
                title={sortDir === 1 ? "Ascending" : "Descending"}
              >
                {sortDir === 1 ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
                <span className="sr-only">
                  {sortDir === 1 ? "Sorted ascending. Sort descending" : "Sorted descending. Sort ascending"}
                </span>
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
                    className={`h-7 min-h-[44px] sm:min-h-0 px-3 rounded-full border text-xs font-medium transition-colors ${
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
                    className={`h-7 min-h-[44px] sm:min-h-0 px-3 rounded-full border text-xs font-medium transition-colors ${
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
                    className={`h-7 min-h-[44px] sm:min-h-0 px-3 rounded-full border text-xs font-medium transition-colors ${
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
                  className="ml-auto h-7 min-h-[44px] sm:min-h-0 text-xs"
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
          ) : isWide ? (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                {/* Wider than the 980px this used to need: the card art adds
                    ~48px to the Card column before anything else can shrink.
                    Below `lg` this table isn't rendered at all — see the stacked
                    list below, which is what a phone and a tablet get. */}
                <table className="w-full min-w-[1030px] border-collapse">
                  <thead>
                    <tr className="bg-muted/60 border-b">
                      {["Card", "Person", "Number", "Expires", "Code", "Postcode", "Cardholder"].map((h) => (
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
                          <SecretRow key={row.card.id} {...rowProps(row)} />
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Stacked list for anything narrower than the table's 1030px. Same
               data, same handlers — the fields become labelled rows instead of
               columns, and every control is on screen without a sideways
               scroll nobody could see the thumb for. */
            <div className="space-y-4">
              {grouped.map((group) => (
                <div key={group.key || "all"} className="space-y-2">
                  {group.key && (
                    <h2 className="flex items-baseline gap-2 px-0.5 pt-1 text-xs font-semibold">
                      <span className="min-w-0 truncate" title={group.key}>
                        {group.key}
                      </span>
                      <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
                        {group.rows.length} {group.rows.length === 1 ? "card" : "cards"}
                      </span>
                    </h2>
                  )}
                  {group.rows.map((row) => (
                    <SecretCard key={row.card.id} {...rowProps(row)} />
                  ))}
                </div>
              ))}
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

/** What each layout renders per field, so the table and the stacked list can
 *  never disagree about what "hidden" looks like or what a copy actually puts
 *  on the clipboard. */
interface SecretField {
  key: string;
  label: string;
  /** Column headings have room the stacked list's label gutter does not, and
   *  "Cardholder" is 30% wider than the widest of the others. */
  shortLabel: string;
  shown: string;
  copy: string | null;
  mono: boolean;
  /** False when this card never had a value here. The table still shows the
   *  column — a table needs one shape — but the stacked list drops the row
   *  rather than stacking three em dashes under the number. */
  stored: boolean;
}

function fieldsFor(secret: CardSecretMasked, revealedData: CardSecretRevealed | undefined): SecretField[] {
  const on = !!revealedData;
  return [
    {
      key: "pan",
      label: "Number",
      shortLabel: "Number",
      shown: on ? revealedData!.pan : secret.masked_pan,
      // Bare digits: checkout fields commonly mask input or cap at maxlength=16,
      // where pasted spaces get truncated or rejected outright.
      copy: on ? revealedData!.pan_digits : null,
      mono: true,
      stored: true,
    },
    {
      key: "exp",
      label: "Expiry",
      shortLabel: "Expiry",
      shown: on ? revealedData!.exp_display : "••/••",
      copy: on ? revealedData!.exp_display : null,
      mono: true,
      stored: true,
    },
    {
      key: "cvv",
      label: secret.code_label,
      shortLabel: secret.code_label,
      shown: on ? (revealedData!.cvv ?? "—") : secret.has_cvv ? "•••" : "—",
      copy: on ? revealedData!.cvv : null,
      mono: true,
      stored: secret.has_cvv,
    },
    {
      key: "zip",
      label: "Postcode",
      shortLabel: "Postcode",
      shown: on ? (revealedData!.billing_zip ?? "—") : secret.has_billing_zip ? "•••••" : "—",
      copy: on ? revealedData!.billing_zip : null,
      mono: true,
      stored: secret.has_billing_zip,
    },
    {
      key: "holder",
      label: "Cardholder",
      shortLabel: "Name",
      shown: on ? (revealedData!.holder ?? "—") : secret.has_holder ? "••••••••" : "—",
      copy: on ? revealedData!.holder : null,
      mono: false,
      stored: secret.has_holder,
    },
  ];
}

function copyAllBlock(revealedData: CardSecretRevealed): string {
  return [
    revealedData.pan_digits,
    revealedData.exp_display,
    revealedData.cvv ?? "",
    revealedData.billing_zip ?? "",
    revealedData.holder ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

interface SecretViewProps {
  row: Row;
  revealedData: CardSecretRevealed | undefined;
  loading: boolean;
  copiedKey: string | null;
  onReveal: () => void;
  onCopy: (key: string, value: string, label: string) => void;
  onEdit: () => void;
  onOpenCard: () => void;
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
}: SecretViewProps) {
  const { card, secret, profileName } = row;
  const on = !!revealedData;
  const cells = fieldsFor(secret, revealedData);

  const copyAll = () => {
    if (!revealedData) return;
    onCopy(`all-${card.id}`, copyAllBlock(revealedData), "All fields");
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
            <span
              className="block text-sm font-medium truncate group-hover:underline"
              title={card.card_name}
            >
              {card.card_name}
            </span>
            <span
              className="block text-xs text-muted-foreground truncate"
              title={`${card.issuer}${card.network ? ` · ${card.network}` : ""}`}
            >
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
          {secret.card_status === "closed" && <Badge variant="destructive">Closed</Badge>}
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
            {c.copy ? (
              <button
                type="button"
                onClick={() => onCopy(`${c.key}-${card.id}`, c.copy!, c.label)}
                className="h-7 w-7 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none"
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
            ) : (
              // Holds the copy button's slot open while the row is hidden.
              // The masked and revealed values are the same width — the API
              // masks to the real grouping — so the button appearing was the
              // whole of the jitter when a row was revealed.
              <span className="h-7 w-7 shrink-0" aria-hidden="true" />
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
            className={`h-8 w-8 grid place-items-center rounded-md border transition-colors disabled:opacity-60 disabled:cursor-progress focus-visible:ring-2 focus-visible:ring-ring outline-none ${
              on ? "text-primary border-primary/40" : "text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : on ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            <span className="sr-only">
              {loading
                ? `Decrypting ${card.card_name} ending ${secret.last_digits}`
                : `${on ? "Hide" : "Show"} details for ${card.card_name} ending ${secret.last_digits}`}
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

/**
 * The same row, stacked, for anything narrower than the table.
 *
 * Field shapes are lifted from `benefit-card-vault`'s Shell/Field so the two
 * places in the app that show a stored card number look like the same feature:
 * a small uppercase label, the value, and the copy control pinned to the right.
 * Everything a finger has to hit is at least 44px.
 */
function SecretCard({
  row,
  revealedData,
  loading,
  copiedKey,
  onReveal,
  onCopy,
  onEdit,
  onOpenCard,
}: SecretViewProps) {
  const { card, secret, profileName } = row;
  const on = !!revealedData;
  const fields = fieldsFor(secret, revealedData);

  const copyAll = () => {
    if (!revealedData) return;
    onCopy(`all-${card.id}`, copyAllBlock(revealedData), "All fields");
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 space-y-3 transition-colors",
        on && "border-primary/40 bg-primary/[0.04]",
      )}
    >
      {/* Name on its own row: at 375px a badge sharing the line left the card
          name about eight characters of room. */}
      <button
        type="button"
        onClick={onOpenCard}
        className="group flex w-full min-w-0 items-center gap-2.5 text-left rounded-sm focus-visible:ring-2 focus-visible:ring-ring outline-none"
      >
        <CardThumbnail
          templateId={card.template_id}
          cardName={card.card_name}
          cardImage={card.card_image}
          className="w-12 h-[30px] shrink-0"
        />
        <span className="min-w-0">
          <span
            className="block text-sm font-medium truncate group-hover:underline"
            title={card.card_name}
          >
            {card.card_name}
          </span>
          <span
            className="block text-xs text-muted-foreground truncate"
            title={`${card.issuer}${card.network ? ` · ${card.network}` : ""}`}
          >
            {card.issuer}
            {card.network ? ` · ${card.network}` : ""}
          </span>
        </span>
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={card.card_type === "business" ? "warning" : "outline"}>
          <span className="max-w-[12rem] truncate" title={profileName}>
            {profileName}
            {card.card_type === "business" ? " · biz" : ""}
          </span>
        </Badge>
        {secret.card_status === "closed" && <Badge variant="destructive">Closed</Badge>}
      </div>

      {secret.card_status === "closed" && (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          This card is closed — the number will decline.
        </p>
      )}

      <div className="space-y-1">
        {/* Rows for values this card never had are dropped rather than stacked
            up as em dashes — the same call `benefit-card-vault` makes for its
            Name field. `has_*` comes from the masked record, so the set of rows
            doesn't change when the card is revealed. */}
        {fields
          .filter((f) => f.stored)
          .map((f) => (
            <StackedField
              key={f.key}
              field={f}
              revealed={on}
              copied={copiedKey === `${f.key}-${card.id}`}
              cardName={card.card_name}
              onCopy={() => f.copy && onCopy(`${f.key}-${card.id}`, f.copy, f.label)}
            />
          ))}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant={on ? "outline" : "default"}
          size="sm"
          onClick={onReveal}
          aria-pressed={on}
          disabled={loading}
          // Starts with the word on the face of the button. The table's
          // icon-only twin says "Show", but overriding a VISIBLE "Reveal" with
          // an accessible name that doesn't contain it breaks voice control:
          // "click Reveal" would match nothing.
          aria-label={
            loading
              ? `Decrypting ${card.card_name} ending ${secret.last_digits}`
              : `${on ? "Hide" : "Reveal"} details for ${card.card_name} ending ${secret.last_digits}`
          }
          className="min-h-[44px] flex-1"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : on ? (
            <EyeOff className="h-4 w-4 mr-1.5" />
          ) : (
            <Eye className="h-4 w-4 mr-1.5" />
          )}
          {loading ? "Decrypting…" : on ? "Hide" : "Reveal"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={copyAll}
          disabled={!on}
          aria-label={`Copy all fields for ${card.card_name}`}
          className="min-h-[44px] min-w-[44px] px-0 w-11"
        >
          {copiedKey === `all-${card.id}` ? (
            <Check className="h-4 w-4 text-green-600 dark:text-green-500" />
          ) : (
            <ClipboardList className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label={`Edit details for ${card.card_name}`}
          className="min-h-[44px] min-w-[44px] px-0 w-11"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StackedField({
  field,
  revealed,
  copied,
  cardName,
  onCopy,
}: {
  field: SecretField;
  revealed: boolean;
  copied: boolean;
  cardName: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 py-1 pl-2.5 pr-1">
      <span className="w-[4.5rem] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {field.shortLabel}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          field.mono && "font-mono tabular-nums",
        )}
        title={revealed ? field.shown : undefined}
        aria-hidden={!revealed || undefined}
      >
        {field.shown}
      </span>
      {!revealed && <span className="sr-only">{field.label} hidden</span>}
      {field.copy ? (
        <button
          type="button"
          onClick={onCopy}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-600 dark:text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          <span className="sr-only">
            Copy {field.label} for {cardName}
          </span>
        </button>
      ) : (
        // Never a copy control on a value that isn't there — and the slot stays
        // reserved so revealing a card doesn't shuffle the rows sideways.
        <span className="h-11 w-11 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}
