"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { ImportExportDialog } from "@/components/profile/import-export-dialog";
import { DeleteProfileDialog } from "@/components/profile/delete-profile-dialog";
import { TimezoneSelector } from "@/components/settings/timezone-selector";
import {
  CreditCard,
  Menu,
  UserPlus,
  ArrowUpDown,
  Trash2,
  Sun,
  Moon,
  LogOut,
  Globe,
  Shield,
  User,
} from "lucide-react";
import { createProfile } from "@/lib/api";
import { AdminPanel } from "@/components/admin/admin-panel";
import { AccountMenu } from "@/components/settings/account-menu";

export function MobileTopBar() {
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [addingProfile, setAddingProfile] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showDeleteProfile, setShowDeleteProfile] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const authMode = useAppStore((s) => s.authMode);
  const isAdmin = currentUser?.role === "admin" && authMode !== "open";
  const showUserActions = authMode !== "open";

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

  return (
    <>
      <header className="md:hidden flex items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 px-3 h-12">
        {/* Left: Logo */}
        <div className="flex items-center gap-1.5">
          <CreditCard className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">CCT</span>
        </div>

        {/* Center: Profile selector */}
        <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
          <SelectTrigger className="w-[130px] h-8 text-xs">
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

        {/* Right: Hamburger */}
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDrawerOpen(true)}>
          <Menu className="h-4 w-4" />
        </Button>
      </header>

      {/* Drawer menu */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>Settings</DrawerTitle>
            <DrawerDescription>App preferences and actions</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-1 max-h-[70vh] overflow-y-auto">
            {/* Dark mode */}
            <button
              onClick={() => { toggleDarkMode(); }}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="text-sm">{darkMode ? "Light Mode" : "Dark Mode"}</span>
            </button>

            {/* Timezone */}
            <div className="flex items-center gap-3 px-3 py-3">
              <Globe className="h-4 w-4" />
              <span className="text-sm flex-1">Timezone</span>
              <TimezoneSelector />
            </div>

            {/* Add Profile */}
            <button
              onClick={() => { setDrawerOpen(false); setShowAddProfile(true); }}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              <span className="text-sm">Add Profile</span>
            </button>

            {/* Import / Export */}
            <button
              onClick={() => { setDrawerOpen(false); setShowImportExport(true); }}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowUpDown className="h-4 w-4" />
              <span className="text-sm">Import / Export</span>
            </button>

            {/* Delete Profile */}
            {selectedProfileId !== "all" && (
              <button
                onClick={() => { setDrawerOpen(false); setShowDeleteProfile(true); }}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                <span className="text-sm">Delete Profile</span>
              </button>
            )}

            <div className="h-px bg-border my-2" />

            {/* Admin Panel */}
            {isAdmin && (
              <button
                onClick={() => { setDrawerOpen(false); setShowAdmin(true); }}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors"
              >
                <Shield className="h-4 w-4" />
                <span className="text-sm">Admin Panel</span>
              </button>
            )}

            {/* Account */}
            {showUserActions && (
              <button
                onClick={() => { setDrawerOpen(false); setShowAccount(true); }}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors"
              >
                <User className="h-4 w-4" />
                <span className="text-sm">Account</span>
              </button>
            )}

            {/* Logout */}
            {showUserActions && (
              <button
                onClick={() => { setDrawerOpen(false); logout(); }}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg hover:bg-muted transition-colors"
              >
                <LogOut className="h-4 w-4" />
                <span className="text-sm">Logout</span>
              </button>
            )}
          </div>
        </DrawerContent>
      </Drawer>

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
