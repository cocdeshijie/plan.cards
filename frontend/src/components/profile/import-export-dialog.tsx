"use client";

import { useState, useRef } from "react";
import type { Profile, ExportData } from "@/types";
import { exportProfiles, importProfiles } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";

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

  const [importFile, setImportFile] = useState<ExportData | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importMode, setImportMode] = useState<string>("new");
  const [targetProfileId, setTargetProfileId] = useState<string>(
    selectedProfileId !== "all" ? selectedProfileId : (profiles[0]?.id.toString() ?? "")
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setImportResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ExportData;
        if (!data.version || !data.profiles) {
          setError("Invalid export file format");
          setImportFile(null);
          return;
        }
        setImportFile(data);
      } catch {
        setError("Failed to parse JSON file");
        setImportFile(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const target = importMode !== "new" ? parseInt(targetProfileId) : undefined;
      const result = await importProfiles(importFile, importMode, target);
      const skippedMsg = result.cards_skipped > 0 ? `, ${result.cards_skipped} skipped as duplicate(s)` : "";
      setImportResult(
        `Imported ${result.profiles_imported} profile(s), ${result.cards_imported} card(s), ${result.events_imported} event(s)${skippedMsg}`
      );
      setImportFile(null);
      setImportFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onImported();
      toast.success(`Imported ${result.cards_imported} card(s)${skippedMsg}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setImportFile(null);
    setImportFileName("");
    setImportResult(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import / Export</DialogTitle>
          <DialogDescription>Export profiles as JSON or import from a file.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Export Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Export</h3>
            <div className="flex gap-2">
              <Select value={exportProfileId} onValueChange={setExportProfileId}>
                <SelectTrigger className="flex-1">
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
              <Button onClick={handleExport} disabled={exporting}>
                <Download className="h-4 w-4 mr-1" />
                {exporting ? "Exporting..." : "Download"}
              </Button>
            </div>
          </div>

          <hr />

          {/* Import Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Import</h3>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
            />

            {importFile && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  File: {importFileName} &mdash;{" "}
                  {importFile.profiles.length} profile(s),{" "}
                  {importFile.profiles.reduce((sum, p) => sum + p.cards.length, 0)} card(s)
                </p>

                <Select value={importMode} onValueChange={setImportMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New Profile(s)</SelectItem>
                    <SelectItem value="override">Override Existing</SelectItem>
                    <SelectItem value="merge">Merge Into Existing</SelectItem>
                  </SelectContent>
                </Select>

                {importMode !== "new" && (
                  <Select value={targetProfileId} onValueChange={setTargetProfileId}>
                    <SelectTrigger>
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
                  <p className="text-sm text-destructive">
                    Warning: This will delete all existing cards and events in the target profile.
                  </p>
                )}

                <Button onClick={handleImport} disabled={importing} className="w-full">
                  <Upload className="h-4 w-4 mr-1" />
                  {importing ? "Importing..." : "Import"}
                </Button>
              </div>
            )}

            {importResult && (
              <p className="text-sm text-green-600 dark:text-green-400">{importResult}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
