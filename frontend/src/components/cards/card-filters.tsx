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
      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>
      <Select value={typeFilter} onValueChange={onTypeChange}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="personal">Personal</SelectItem>
          <SelectItem value="business">Business</SelectItem>
        </SelectContent>
      </Select>
      <Select value={issuerFilter} onValueChange={onIssuerChange}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Issuer" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Issuers</SelectItem>
          {issuers.map((iss) => (
            <SelectItem key={iss} value={iss}>{iss}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Select value={sortField} onValueChange={(v) => onSortFieldChange(v as SortField)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="open_date">Open Date</SelectItem>
            <SelectItem value="annual_fee">Annual Fee</SelectItem>
            <SelectItem value="issuer">Issuer</SelectItem>
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onSortDirToggle} title={sortDir === "asc" ? "Ascending" : "Descending"}>
          {sortDir === "asc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
        </Button>
      </div>

      <Badge variant="outline" className="self-center">
        {count} card{count !== 1 ? "s" : ""}
      </Badge>
    </div>
  );
}
