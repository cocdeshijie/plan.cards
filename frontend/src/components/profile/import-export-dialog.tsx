"use client";

import { useEffect, useId, useState, useRef } from "react";
import type { Profile, ExportData } from "@/types";
import { exportProfiles, importProfiles } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";

/** "1 card" / "2 cards" — every other count in the app pluralizes conditionally. */
function plural(count: number, noun: string, pluralNoun = `${noun}s`) {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

interface ImportExportDialogProps {
  profiles: Profile[];
  selectedProfileId: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportExportDialog({
  profiles,
  selectedProfileId,
  open,
  onClose,
  onImported,
}: ImportExportDialogProps) {
  const [exportProfileId, setExportProfileId] = useState<string>(selectedProfileId);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<ExportData | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importMode, setImportMode] = useState<string>("new");
  const [targetProfileId, setTargetProfileId] = useState<string>(
    selectedProfileId !== "all" ? selectedProfileId : (profiles[0]?.id.toString() ?? "")
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmOverride, setConfirmOverride] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  // Re-seed both profile pickers from the current scope every time the dialog
  // opens. They used to be seeded once, in the useState initialiser — and both
  // nav bars mount this dialog on their very first render, when
  // selectedProfileId is still "all" and profiles is still []. So the export
  // picker was frozen on "All Profiles" for the whole session, and the import
  // target silently fell back to profiles[0]. For "Override Existing" that
  // meant the default target was whichever profile sorted first, not the one
  // the user was looking at.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setExportProfileId(selectedProfileId);
      setTargetProfileId(
        selectedProfileId !== "all" ? selectedProfileId : (profiles[0]?.id.toString() ?? "")
      );
    }
    wasOpenRef.current = open;
  }, [open, selectedProfileId, profiles]);

  // Opened before the profile list landed: back-fill once it does, otherwise
  // "Merge into existing" posts target_profile_id=NaN.
  useEffect(() => {
    if (open && !targetProfileId && profiles.length > 0) {
      setTargetProfileId(profiles[0].id.toString());
    }
  }, [open, profiles, targetProfileId]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const profileId = exportProfileId !== "all" ? parseInt(exportProfileId) : undefined;
      const data = await exportProfiles(profileId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const profileName = profileId
        ? profiles.find((p) => p.id === profileId)?.name ?? "profile"
        : "all_profiles";
      a.href = url;
      a.download = `cct_export_${profileName}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ExportData;
        if (!data.version || !data.profiles) {
          setImportError("Invalid export file format");
          setImportFile(null);
          return;
        }
        setImportFile(data);
      } catch {
        setImportError("Failed to parse JSON file");
        setImportFile(null);
      }
    };
    // Without onerror an unreadable file (permissions, a disconnected network
    // volume, a directory) was completely silent: the filename was already on
    // screen and the Import button stayed gated on importFile, so the dialog
    // simply looked like it had ignored the file.
    reader.onerror = () => {
      setImportError(`Couldn't read ${file.name}. Check the file and try again.`);
      setImportFile(null);
    };
    reader.readAsText(file);
  };

  const importedCardCount = importFile
    ? importFile.profiles.reduce((sum, p) => sum + p.cards.length, 0)
    : 0;
  // Both pickers clamp their value to one line (SelectTrigger's own
  // [&>span]:line-clamp-1), and a profile name is user-supplied — so the full
  // string has to stay recoverable from a title, same as the two nav bars do.
  const exportProfileName =
    exportProfileId === "all"
      ? "All Profiles"
      : profiles.find((p) => p.id.toString() === exportProfileId)?.name;
  const targetProfile = profiles.find((p) => p.id.toString() === targetProfileId);
  const targetProfileName = targetProfile?.name ?? "the selected profile";

  const handleImport = async () => {
    if (!importFile || importing) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const target = importMode !== "new" ? parseInt(targetProfileId) : undefined;
      const result = await importProfiles(importFile, importMode, target);
      const skippedMsg =
        result.cards_skipped > 0
          ? `, ${plural(result.cards_skipped, "duplicate")} skipped`
          : "";
      setImportResult(
        `Imported ${plural(result.profiles_imported, "profile")}, ${plural(result.cards_imported, "card")}, ${plural(result.events_imported, "event")}${skippedMsg}`
      );
      setImportFile(null);
      setImportFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onImported();
      toast.success(`Imported ${plural(result.cards_imported, "card")}${skippedMsg}`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // "Override Existing" is the most destructive action in the app and it used
  // to be one unguarded click on a button labelled only "Import", against a
  // target the user may never have chosen. Everything else routes through
  // ConfirmDialog; so does this now.
  const handleImportClick = () => {
    if (!importFile || importing) return;
    if (importMode === "override") {
      setConfirmOverride(true);
      return;
    }
    handleImport();
  };

  const handleClose = () => {
    setImportFile(null);
    setImportFileName("");
    setImportResult(null);
    setImportError(null);
    setExportError(null);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        {/* Tallest dialog in the app, so it uses the past-fees-dialog pattern:
            a pinned header with the close X, and a single scrollable body.
            Letting DialogContent's own overflow do the scrolling would carry
            the absolutely-positioned X away with the content. */}
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-6 pb-4 border-b space-y-1.5">
            <DialogTitle>Import / Export</DialogTitle>
            <DialogDescription>Export profiles as JSON or import from a file.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Export Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Export</h3>
              <div className="flex gap-2">
                <Select value={exportProfileId} onValueChange={setExportProfileId}>
                  <SelectTrigger className="flex-1 min-w-0" aria-label="Profile to export" title={exportProfileName}>
                    <SelectValue placeholder="Select profile" />
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
                <Button onClick={handleExport} disabled={exporting} className="shrink-0">
                  <Download className="h-4 w-4 mr-1" aria-hidden="true" />
                  {exporting ? "Exporting..." : "Download"}
                </Button>
              </div>
              {/* Next to the control that failed. This used to share one `error`
                  state with the import flow and rendered below the whole import
                  section — off screen on a phone. */}
              {exportError && (
                <p role="alert" className="text-sm text-danger">
                  {exportError}
                </p>
              )}
            </div>

            <hr />

            {/* Import Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Import</h3>
              <Label htmlFor={fileInputId} className="sr-only">
                Export file to import
              </Label>
              <input
                id={fileInputId}
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
              />

              {importFile && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground break-words" title={importFileName}>
                    File: {importFileName} &mdash;{" "}
                    {plural(importFile.profiles.length, "profile")},{" "}
                    {plural(importedCardCount, "card")}
                  </p>

                  <Select value={importMode} onValueChange={setImportMode}>
                    <SelectTrigger aria-label="Import mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New Profiles</SelectItem>
                      <SelectItem value="override">Override Existing</SelectItem>
                      <SelectItem value="merge">Merge Into Existing</SelectItem>
                    </SelectContent>
                  </Select>

                  {importMode !== "new" && (
                    <Select value={targetProfileId} onValueChange={setTargetProfileId}>
                      <SelectTrigger aria-label="Target profile" title={targetProfile?.name}>
                        <SelectValue placeholder="Select target profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id.toString()}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {importMode === "override" && (
                    <p className="text-sm text-danger">
                      Warning: this will delete every card and event in{" "}
                      <span className="font-medium">{targetProfileName}</span> before importing.
                    </p>
                  )}

                  <Button
                    onClick={handleImportClick}
                    disabled={importing || (importMode !== "new" && !targetProfileId)}
                    className="w-full"
                  >
                    <Upload className="h-4 w-4 mr-1" aria-hidden="true" />
                    {importing ? "Importing..." : "Import"}
                  </Button>
                </div>
              )}

              {importResult && (
                <p aria-live="polite" className="text-sm text-green-600 dark:text-green-400">
                  {importResult}
                </p>
              )}

              {importError && (
                <p role="alert" className="text-sm text-danger">
                  {importError}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sibling of the Dialog, not a child of DialogContent: a successful
          import clears importFile, which unmounts the section the Import button
          lives in — a confirm nested in there would vanish mid-flight. */}
      <ConfirmDialog
        open={confirmOverride}
        onOpenChange={setConfirmOverride}
        title="Replace this profile's data?"
        description={`Every card and event in "${targetProfileName}" will be permanently deleted and replaced with the ${plural(importedCardCount, "card")} in ${importFileName || "this file"}. This cannot be undone.`}
        confirmLabel="Replace"
        pendingLabel="Replacing…"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={async () => {
          await handleImport();
          setConfirmOverride(false);
        }}
      />
    </>
  );
}
