import React, { Fragment, useMemo } from 'react';

import { Trans } from '@lingui/react/macro';
import type {
  ColumnDef,
  PaginationState,
  RowSelectionState,
  Table as TTable,
  Updater,
  VisibilityState,
} from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';

import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export type DataTableChildren<TData> = (_table: TTable<TData>) => React.ReactNode;

export type { ColumnDef as DataTableColumnDef, RowSelectionState } from '@tanstack/react-table';

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  columnVisibility?: VisibilityState;
  data: TData[];
  onRowClick?: (row: TData) => void;
  rowClassName?: string;
  perPage?: number;
  currentPage?: number;
  totalPages?: number;
  onPaginationChange?: (_page: number, _perPage: number) => void;
  onClearFilters?: () => void;
  emptyState?: React.ReactNode;
  hasFilters?: boolean;
  children?: DataTableChildren<TData>;
  skeleton?: {
    enable: boolean;
    rows: number;
    component?: React.ReactNode;
  };
  error?: {
    enable: boolean;
    component?: React.ReactNode;
  };
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  getRowId?: (row: TData) => string;
  /** When set, the matching row id (from `getRowId` or row id) shows `renderExpandedRow` below the main row. */
  expandedRowId?: string | null;
  renderExpandedRow?: (row: TData) => React.ReactNode;
}

export function DataTable<TData, TValue>({
  columns,
  columnVisibility,
  data,
  error,
  perPage,
  currentPage,
  totalPages,
  skeleton,
  hasFilters,
  onClearFilters,
  onPaginationChange,
  onRowClick,
  rowClassName,
  children,
  emptyState,
  enableRowSelection,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  expandedRowId,
  renderExpandedRow,
}: DataTableProps<TData, TValue>) {
  const pagination = useMemo<PaginationState>(() => {
    if (currentPage !== undefined && perPage !== undefined) {
      return {
        pageIndex: currentPage - 1,
        pageSize: perPage,
      };
    }

    return {
      pageIndex: 0,
      pageSize: 0,
    };
  }, [currentPage, perPage]);

  const manualPagination = Boolean(currentPage !== undefined && totalPages !== undefined);

  const onTablePaginationChange = (updater: Updater<PaginationState>) => {
    if (typeof updater === 'function') {
      const newState = updater(pagination);

      onPaginationChange?.(newState.pageIndex + 1, newState.pageSize);
    } else {
      onPaginationChange?.(updater.pageIndex + 1, updater.pageSize);
    }
  };

  const onTableRowSelectionChange = (updater: Updater<RowSelectionState>) => {
    if (onRowSelectionChange) {
      const newSelection = typeof updater === 'function' ? updater(rowSelection ?? {}) : updater;
      onRowSelectionChange(newSelection);
    }
  };

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      pagination: manualPagination ? pagination : undefined,
      columnVisibility,
      rowSelection: rowSelection ?? {},
    },
    manualPagination,
    pageCount: totalPages,
    onPaginationChange: onTablePaginationChange,
    enableRowSelection,
    onRowSelectionChange: onTableRowSelectionChange,
    getRowId,
  });

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const rowExpandId = getRowId?.(row.original) ?? row.id;
                const isExpanded = Boolean(
                  renderExpandedRow && expandedRowId !== undefined && expandedRowId === rowExpandId,
                );

                return (
                  <Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsSelected() && 'selected'}
                      className={rowClassName}
                      onClick={() => onRowClick?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          style={{
                            width: `${cell.column.getSize()}px`,
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>

                    {isExpanded && renderExpandedRow && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={row.getVisibleCells().length}
                          className="border-t bg-muted/30 p-0"
                        >
                          {renderExpandedRow(row.original)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            ) : error?.enable ? (
              <TableRow>
                {error.component ?? (
                  <TableCell colSpan={columns.length} className="h-32 text-center">
                    <Trans>Something went wrong.</Trans>
                  </TableCell>
                )}
              </TableRow>
            ) : skeleton?.enable ? (
              Array.from({ length: skeleton.rows }).map((_, i) => (
                <TableRow key={`skeleton-row-${i}`}>{skeleton.component ?? <Skeleton />}</TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  {emptyState ?? (
                    <>
                      <p>
                        <Trans>No results found</Trans>
                      </p>

                      {hasFilters && onClearFilters !== undefined && (
                        <button
                          onClick={() => onClearFilters()}
                          className="mt-1 text-sm text-foreground"
                        >
                          <Trans>Clear filters</Trans>
                        </button>
                      )}
                    </>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {children && <div className="mt-8 w-full">{children(table)}</div>}
    </>
  );
}
