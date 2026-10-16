// Ported from fluid-functionalism (registry/default/table.tsx), restyled onto
// the mne design system's `.mne-table` (src/styles/mne.css). The public API is
// unchanged; the proximity-hover layer was dropped in favour of the design's
// plain 180ms row hover, so `index` is accepted but unused.
"use client";

import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import type { SizeVariant } from "@/lib/fluid/size-context";

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** "compact" selects the design's `.is-compact` density. */
  size?: SizeVariant;
}

const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ size, className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn("mne-table", size === "compact" && "is-compact", className)}
      {...props}
    />
  )
);
Table.displayName = "Table";

const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <thead ref={ref} {...props} />);
TableHeader.displayName = "TableHeader";

const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <tbody ref={ref} {...props} />);
TableBody.displayName = "TableBody";

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Retained for API compatibility; the design's row hover is pure CSS. */
  index?: number;
}

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ index: _index, ...props }, ref) => <tr ref={ref} {...props} />
);
TableRow.displayName = "TableRow";

const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>((props, ref) => <th ref={ref} {...props} />);
TableHead.displayName = "TableHead";

const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>((props, ref) => <td ref={ref} {...props} />);
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
