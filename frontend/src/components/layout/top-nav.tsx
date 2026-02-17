"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/hooks/use-app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Plus,
  LogOut,
  UserPlus,
  ArrowUpDown,
  Trash2,
  Sun,
  Moon,
  Shield,
  User,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { createProfile } from "@/lib/api";
import { AdminPanel } from "@/components/admin/admin-panel";
import { AccountMenu } from "@/components/settings/account-menu";

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
  const authMode = useAppStore((s) => s.authMode);
  const isAdmin = currentUser?.role === "admin" && authMode !== "open";
  const showUserActions = authMode !== "open";

  const [addingProfile, setAddingProfile] = useState(false);

  const handleAddProfile = async () => {
    if (!newProfileName.trim()) return;
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

  const navLinks = [
    { href: "/summary", label: "Summary" },
    { href: "/cards", label: "Cards" },
  ];

  return (
    <>
      <header className="hidden md:flex border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Logo className="h-7 w-7" />
              <span className="font-semibold text-lg">plan.cards</span>
            </div>
            <nav className="flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pathname === link.href
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
              <SelectTrigger className="w-[150px] h-9">
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

            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setShowAddProfile(true)} title="Add Profile">
              <UserPlus className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setShowImportExport(true)} title="Import / Export">
              <ArrowUpDown className="h-4 w-4" />
            </Button>
            {selectedProfileId !== "all" && (
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setShowDeleteProfile(true)} title="Delete Profile">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <TimezoneSelector />
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={toggleDarkMode} title="Toggle dark mode">
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {isAdmin && (
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setShowAdmin(true)} title="Admin Panel">
                <Shield className="h-4 w-4" />
              </Button>
            )}
            {showUserActions && (
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setShowAccount(true)} title="Account">
                <User className="h-4 w-4" />
              </Button>
            )}
            {showUserActions && (
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={logout} title="Logout">
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Add Profile Dialog */}
      <Dialog open={showAddProfile} onOpenChange={(v) => !v && setShowAddProfile(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Profile</DialogTitle>
            <DialogDescription>Create a new profile to track cards for a household member.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Profile name"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              maxLength={100}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleAddProfile()}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddProfile(false)}>Cancel</Button>
              <Button onClick={handleAddProfile} disabled={addingProfile}>{addingProfile ? "Adding..." : "Add"}</Button>
            </div>
          </div>
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
