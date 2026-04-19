import { useMemo, useTransition } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Loader } from 'lucide-react';
import { DateTime } from 'luxon';
import { Link } from 'react-router';
import { match } from 'ts-pattern';

import { useUpdateSearchParams } from '@documenso/lib/client-only/hooks/use-update-search-params';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { findRecipientByEmail } from '@documenso/lib/utils/recipients';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import type { TFindDocumentsResponse } from '@documenso/trpc/server/document-router/find-documents.types';
import { cn } from '@documenso/ui/lib/utils';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import type { DataTableColumnDef, RowSelectionState } from '@documenso/ui/primitives/data-table';
import { DataTable } from '@documenso/ui/primitives/data-table';
import { DataTablePagination } from '@documenso/ui/primitives/data-table-pagination';
import { Skeleton } from '@documenso/ui/primitives/skeleton';
import { TableCell } from '@documenso/ui/primitives/table';

import { useCurrentTeam } from '~/providers/team';

import { StackAvatarsWithTooltip } from '../general/stack-avatars-with-tooltip';
import { DocumentsTableActionButton } from './documents-table-action-button';
import { DocumentsTableActionDropdown } from './documents-table-action-dropdown';
import { DocumentsTableActionPrompts } from './documents-table-action-prompts';

export type DocumentsTableProps = {
  data?: TFindDocumentsResponse;
  isLoading?: boolean;
  isLoadingError?: boolean;
  onMoveDocument?: (documentId: number) => void;
  enableSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
};

type DocumentsTableRow = TFindDocumentsResponse['data'][number];

export const DocumentsTable = ({
  data,
  isLoading,
  isLoadingError,
  onMoveDocument,
  enableSelection,
  rowSelection,
  onRowSelectionChange,
}: DocumentsTableProps) => {
  const { _, i18n } = useLingui();

  const team = useCurrentTeam();
  const [isPending, startTransition] = useTransition();

  const updateSearchParams = useUpdateSearchParams();

  const columns = useMemo(() => {
    const cols: DataTableColumnDef<DocumentsTableRow>[] = [];

    if (enableSelection) {
      cols.push({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={_(msg`Select all`)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={_(msg`Select row`)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      });
    }

    cols.push(
      {
        header: _(msg`Document`),
        cell: ({ row }) => (
          <DataTableTitle
            row={row.original}
            teamUrl={team?.url}
            teamEmail={team?.teamEmail?.email}
            createdAtLabel={i18n.date(row.original.createdAt, { ...DateTime.DATE_MED })}
          />
        ),
      },
      {
        id: 'sender',
        header: _(msg`Sender`),
        cell: ({ row }) => row.original.user.name ?? row.original.user.email,
      },
      {
        header: _(msg`Recipient`),
        accessorKey: 'recipient',
        cell: ({ row }) => (
          <StackAvatarsWithTooltip
            recipients={row.original.recipients}
            documentStatus={row.original.status}
          />
        ),
      },
      {
        header: _(msg`Status`),
        accessorKey: 'dashboardStatus',
        cell: ({ row }) => <DashboardDocumentStatus status={row.original.dashboardStatus} />,
        size: 160,
      },
      {
        header: _(msg`Signers`),
        accessorKey: 'signerProgress',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.signerProgress.signed} / {row.original.signerProgress.total}
          </span>
        ),
        size: 100,
      },
      {
        header: _(msg`Last Activity`),
        accessorKey: 'daysSinceLastActivity',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-foreground">
              {formatDaysSinceLastActivity(row.original.daysSinceLastActivity)}
            </span>
            <span className="text-xs text-muted-foreground">
              {i18n.date(row.original.lastActivityAt, { ...DateTime.DATE_MED })}
            </span>
          </div>
        ),
        size: 140,
      },
      {
        header: _(msg`Actions`),
        cell: ({ row }) =>
          (!row.original.deletedAt || isDocumentCompleted(row.original.status)) && (
            <div className="flex items-center gap-x-4">
              <DocumentsTableActionButton row={row.original} />
              <DocumentsTableActionPrompts row={row.original} />
              <DocumentsTableActionDropdown
                row={row.original}
                onMoveDocument={onMoveDocument ? () => onMoveDocument(row.original.id) : undefined}
              />
            </div>
          ),
      },
    );

    return cols;
  }, [team, onMoveDocument, enableSelection]);

  const onPaginationChange = (page: number, perPage: number) => {
    startTransition(() => {
      updateSearchParams({
        page,
        perPage,
      });
    });
  };

  const results = data ?? {
    data: [],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  return (
    <div className="relative">
      <DataTable
        columns={columns}
        data={results.data}
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        onPaginationChange={onPaginationChange}
        columnVisibility={{
          sender: team !== undefined,
        }}
        error={{
          enable: isLoadingError || false,
        }}
        skeleton={{
          enable: isLoading || false,
          rows: 5,
          component: (
            <>
              {enableSelection && (
                <TableCell>
                  <Skeleton className="h-4 w-4 rounded" />
                </TableCell>
              )}
              <TableCell>
                <Skeleton className="h-4 w-40 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20 rounded-full" />
              </TableCell>
              <TableCell className="py-4">
                <div className="flex w-full flex-row items-center">
                  <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-10 w-24 rounded" />
              </TableCell>
            </>
          ),
        }}
        enableRowSelection={enableSelection}
        rowSelection={rowSelection}
        onRowSelectionChange={onRowSelectionChange}
        getRowId={(row) => row.envelopeId}
      >
        {(table) => <DataTablePagination additionalInformation="VisibleCount" table={table} />}
      </DataTable>

      {isPending && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
};

type DataTableTitleProps = {
  row: DocumentsTableRow;
  teamUrl: string;
  teamEmail?: string;
  createdAtLabel: string;
};

const DataTableTitle = ({ row, teamUrl, teamEmail, createdAtLabel }: DataTableTitleProps) => {
  const { user } = useSession();

  const recipient = findRecipientByEmail({
    recipients: row.recipients,
    userEmail: user.email,
    teamEmail,
  });

  const isOwner = row.user.id === user.id;
  const isRecipient = !!recipient;
  const isCurrentTeamDocument = teamUrl && row.team?.url === teamUrl;

  const documentsPath = formatDocumentsPath(teamUrl);
  const formatPath = `${documentsPath}/${row.envelopeId}`;

  return match({
    isOwner,
    isRecipient,
    isCurrentTeamDocument,
  })
    .with({ isOwner: true }, { isCurrentTeamDocument: true }, () => (
      <DocumentTitleLink to={formatPath} title={row.title} createdAtLabel={createdAtLabel} />
    ))
    .with({ isRecipient: true }, () => (
      <DocumentTitleLink
        to={`/sign/${recipient?.token}`}
        title={row.title}
        createdAtLabel={createdAtLabel}
      />
    ))
    .otherwise(() => (
      <div className="flex flex-col">
        <span className="block max-w-[10rem] truncate font-medium md:max-w-[20rem]">
          {row.title}
        </span>
        <span className="text-xs text-muted-foreground">{createdAtLabel}</span>
      </div>
    ));
};

const DocumentTitleLink = ({
  to,
  title,
  createdAtLabel,
}: {
  to: string;
  title: string;
  createdAtLabel: string;
}) => (
  <div className="flex flex-col">
    <Link
      to={to}
      title={title}
      className="block max-w-[10rem] truncate font-medium hover:underline md:max-w-[20rem]"
    >
      {title}
    </Link>
    <span className="text-xs text-muted-foreground">{createdAtLabel}</span>
  </div>
);

const formatDaysSinceLastActivity = (daysSinceLastActivity: number) => {
  if (daysSinceLastActivity === 0) {
    return 'Today';
  }

  if (daysSinceLastActivity === 1) {
    return '1 day ago';
  }

  return `${daysSinceLastActivity} days ago`;
};

const DASHBOARD_STATUS_STYLES: Record<
  DocumentsTableRow['dashboardStatus'],
  { label: string; className: string }
> = {
  DRAFT: {
    label: 'Draft',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200',
  },
  SENT: {
    label: 'Sent',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
  },
  PARTIALLY_SIGNED: {
    label: 'Partially Signed',
    className: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200',
  },
  EXPIRED: {
    label: 'Expired',
    className: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200',
  },
};

const DashboardDocumentStatus = ({ status }: { status: DocumentsTableRow['dashboardStatus'] }) => {
  const statusConfig = DASHBOARD_STATUS_STYLES[status];

  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
        statusConfig.className,
      )}
    >
      {statusConfig.label}
    </span>
  );
};
