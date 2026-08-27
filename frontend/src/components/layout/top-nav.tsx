"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/hooks/use-app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ImportExportDialog } from "@/components/profile/import-export-dialog";
import { DeleteProfileDialog } from "@/components/profile/delete-profile-dialog";
import { TimezoneSelector } from "@/components/settings/timezone-selector";
import {
  LogOut,
  UserPlus,
  ArrowUpDown,
  Trash2,
  Sun,
  Moon,
  Shield,
  User,
  Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { createProfile } from "@/lib/api";
import { AdminPanel } from "@/components/admin/admin-panel";
import { AccountMenu } from "@/components/settings/account-menu";

/** One row of the below-xl overflow menu; mirrors the mobile drawer's rows. */
function MenuRow({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors",
        className
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </button>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const {
    profiles,
    cards,
    selectedProfileId,
    setSelectedProfileId,
    darkMode,
    toggleDarkMode,
    logout,
    refresh,
    currentUser,
  } = useAppStore();

  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [showImportExport, setShowImportExport] = useState(false);
  const [showDeleteProfile, setShowDeleteProfile] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const authMode = useAppStore((s) => s.authMode);
  const isAdmin = currentUser?.role === "admin" && authMode !== "open";
  const showUserActions = authMode !== "open";
  const profileNameId = useId();

  const [addingProfile, setAddingProfile] = useState(false);

  const selectedProfileName =
    selectedProfileId === "all"
      ? "All Profiles"
      : profiles.find((p) => p.id.toString() === selectedProfileId)?.name ?? "All Profiles";

  const handleAddProfile = async () => {
    // Guarded here and not only on the button: Enter in the name field submits
    // this directly, so two quick presses used to create two identical
    // profiles before the first response landed.
    if (addingProfile || !newProfileName.trim()) return;
    setAddingProfile(true);
    try {
      await createProfile(newProfileName.trim());
      setNewProfileName("");
      setShowAddProfile(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create profile");
    } finally {
      setAddingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    setShowDeleteProfile(false);
    setSelectedProfileId("all");
    await refresh();
  };

  // Labels must match BottomTabs and each route's own h1 verbatim.
  const navLinks = [
    { href: "/summary", label: "Summary" },
    { href: "/cards", label: "Cards" },
    { href: "/card-details", label: "Card details" },
  ];

  // Opened from the overflow menu below xl, so the menu has to close first —
  // two stacked dialogs would trap focus in the wrong one.
  const fromMenu = (open: () => void) => () => {
    setShowMoreMenu(false);
    open();
  };

  return (
    <>
      <header className="hidden md:flex border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            {/* /summary, not "/": the landing page renders without the nav, the
                tabs or the profile selector, so a signed-in user who clicked
                the logo lost every control on the page. */}
            <Link
              href="/summary"
              className="flex shrink-0 items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Logo className="h-7 w-7" />
              <span className="font-semibold text-lg">plan.cards</span>
            </Link>
            <nav aria-label="Primary" className="flex items-center gap-1 min-w-0">
              {navLinks.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Every control here is shrink-0. Without it the row had no way to
              report that it didn't fit: the icon buttons collapsed toward their
              16px glyphs and both Selects clipped their labels. The full row
              needs ~1064px and only gets 736px at 768px, so below xl the
              low-frequency actions move into the overflow menu instead. */}
          <div className="flex items-center gap-2 shrink-0">
            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
              <SelectTrigger
                className="w-[150px] h-9 shrink-0"
                aria-label="Filter by profile"
                title={selectedProfileName}
              >
                <SelectValue placeholder="All Profiles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Profiles</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="hidden xl:flex items-center gap-2">
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setShowAddProfile(true)} title="Add Profile" aria-label="Add profile">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setShowImportExport(true)} title="Import / Export" aria-label="Import or export data">
                <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
              </Button>
              {selectedProfileId !== "all" && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setShowDeleteProfile(true)} title="Delete Profile" aria-label={`Delete ${selectedProfileName}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              <TimezoneSelector />
            </div>

            {/* Outside the xl-only group: after the profile filter this is the
                most-used control in the bar, and 36px is cheap enough to keep
                at every width. */}
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={toggleDarkMode} title="Toggle dark mode" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
              {darkMode ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            </Button>

            <div className="hidden xl:flex items-center gap-2">
              {isAdmin && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setShowAdmin(true)} title="Admin Panel" aria-label="Admin panel">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              {showUserActions && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setShowAccount(true)} title="Account" aria-label="Account settings">
                  <User className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              {showUserActions && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={logout} title="Logout" aria-label="Log out">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>

            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 xl:hidden"
              onClick={() => setShowMoreMenu(true)}
              title="Settings"
              aria-label="Open settings menu"
              aria-haspopup="dialog"
              aria-expanded={showMoreMenu}
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      {/* Overflow menu (below xl): the low-frequency actions, in the same order
          as the mobile drawer's rows. */}
      <Dialog open={showMoreMenu} onOpenChange={setShowMoreMenu}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>App preferences and actions</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {/* No dark-mode row: that toggle stays in the header at every
                width. No leading Globe: TimezoneSelector draws one inside its own
                trigger, so a row icon here would render it twice. */}
            <div className="flex items-center gap-3 px-3 py-3">
              <span className="text-sm flex-1 min-w-0 pl-7">Timezone</span>
              <TimezoneSelector />
            </div>

            <MenuRow icon={UserPlus} label="Add Profile" onClick={fromMenu(() => setShowAddProfile(true))} />
            <MenuRow icon={ArrowUpDown} label="Import / Export" onClick={fromMenu(() => setShowImportExport(true))} />
            {selectedProfileId !== "all" && (
              <MenuRow
                icon={Trash2}
                label="Delete Profile"
                className="text-danger"
                onClick={fromMenu(() => setShowDeleteProfile(true))}
              />
            )}

            <div className="h-px bg-border my-2" />

            {isAdmin && (
              <MenuRow icon={Shield} label="Admin Panel" onClick={fromMenu(() => setShowAdmin(true))} />
            )}
            {showUserActions && (
              <MenuRow icon={User} label="Account" onClick={fromMenu(() => setShowAccount(true))} />
            )}
            {showUserActions && (
              <MenuRow icon={LogOut} label="Logout" onClick={fromMenu(logout)} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Profile Dialog */}
      <Dialog open={showAddProfile} onOpenChange={(v) => !v && setShowAddProfile(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Profile</DialogTitle>
            <DialogDescription>Create a new profile to track cards for a household member.</DialogDescription>
          </DialogHeader>
          {/* A real form so Enter submits through the same guarded path as the
              button instead of calling the handler behind its disabled state. */}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleAddProfile();
            }}
          >
            <div>
              <Label htmlFor={profileNameId} className="sr-only">Profile name</Label>
              <Input
                id={profileNameId}
                placeholder="Profile name"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                maxLength={100}
                autoFocus
                autoComplete="off"
                enterKeyHint="done"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowAddProfile(false)} disabled={addingProfile}>
                Cancel
              </Button>
              <Button type="submit" disabled={addingProfile || !newProfileName.trim()}>
                {addingProfile ? "Adding..." : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import/Export Dialog */}
      <ImportExportDialog
        profiles={profiles}
        selectedProfileId={selectedProfileId}
        open={showImportExport}
        onClose={() => setShowImportExport(false)}
        onImported={() => refresh()}
      />

      {/* Delete Profile Dialog */}
      {selectedProfileId !== "all" && profiles.find((p) => p.id === parseInt(selectedProfileId)) && (
        <DeleteProfileDialog
          profile={profiles.find((p) => p.id === parseInt(selectedProfileId))!}
          cardCount={cards.filter((c) => c.profile_id === parseInt(selectedProfileId)).length}
          open={showDeleteProfile}
          onClose={() => setShowDeleteProfile(false)}
          onDeleted={handleDeleteProfile}
        />
      )}

      {/* Admin Panel */}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      {/* Account Menu */}
      {showAccount && <AccountMenu onClose={() => setShowAccount(false)} />}
    </>
  );
}
