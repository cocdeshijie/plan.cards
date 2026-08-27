"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";

export type SortField = "name" | "open_date" | "annual_fee" | "issuer";
export type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortField, string> = {
  name: "Name",
  open_date: "Open Date",
  annual_fee: "Annual Fee",
  issuer: "Issuer",
};

interface CardFiltersProps {
  statusFilter: string;
  onStatusChange: (v: string) => void;
  typeFilter: string;
  onTypeChange: (v: string) => void;
  issuerFilter: string;
  onIssuerChange: (v: string) => void;
  issuers: string[];
  sortField: SortField;
  onSortFieldChange: (v: SortField) => void;
  sortDir: SortDir;
  onSortDirToggle: () => void;
  count: number;
}

export function CardFilters({
  statusFilter,
  onStatusChange,
  typeFilter,
  onTypeChange,
  issuerFilter,
  onIssuerChange,
  issuers,
  sortField,
  onSortFieldChange,
  sortDir,
  onSortDirToggle,
  count,
}: CardFiltersProps) {
  return (
    <div className="flex gap-3 flex-wrap items-center">
      {/* No visible <Label> above any of these, so each trigger carries its own
          accessible name — "Open Date" on its own says nothing about sorting. */}
      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[130px]" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          {/* "Active"/"Closed" mirrors the stored enum and the tile badge. */}
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>
      <Select value={typeFilter} onValueChange={onTypeChange}>
        <SelectTrigger className="w-[130px]" aria-label="Filter by card type">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="personal">Personal</SelectItem>
          <SelectItem value="business">Business</SelectItem>
        </SelectContent>
      </Select>
      {/* Wider than the other two from sm up, and titled: issuer names are the
          only free-text values here, and "American Ex…" was unrecoverable. */}
      <Select value={issuerFilter} onValueChange={onIssuerChange}>
        <SelectTrigger
          className="w-[130px] sm:w-[180px]"
          aria-label="Filter by issuer"
          title={issuerFilter === "all" ? "All Issuers" : issuerFilter}
        >
          <SelectValue placeholder="Issuer" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Issuers</SelectItem>
          {issuers.map((iss) => (
            <SelectItem key={iss} value={iss} title={iss}>{iss}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Select value={sortField} onValueChange={(v) => onSortFieldChange(v as SortField)}>
          <SelectTrigger className="w-[130px]" aria-label={`Sort by ${SORT_LABELS[sortField]}`}>
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{SORT_LABELS.name}</SelectItem>
            <SelectItem value="open_date">{SORT_LABELS.open_date}</SelectItem>
            <SelectItem value="annual_fee">{SORT_LABELS.annual_fee}</SelectItem>
            <SelectItem value="issuer">{SORT_LABELS.issuer}</SelectItem>
          </SelectContent>
        </Select>
        {/* The label names the current state AND what the tap does — it used to
            read "Ascending" on a button that switches to descending. */}
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
          onClick={onSortDirToggle}
          aria-label={
            sortDir === "asc"
              ? "Sorted ascending — switch to descending"
              : "Sorted descending — switch to ascending"
          }
          title={
            sortDir === "asc"
              ? "Sorted ascending — switch to descending"
              : "Sorted descending — switch to ascending"
          }
        >
          {sortDir === "asc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
        </Button>
      </div>

      {/* Live region: changing a filter otherwise moves the count silently. */}
      <Badge variant="outline" className="self-center" role="status" aria-live="polite">
        {count} card{count !== 1 ? "s" : ""}
      </Badge>
    </div>
  );
}
