import { useMemo, useState, useTransition } from 'react';

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ChevronDownIcon, Loader } from 'lucide-react';
import { DateTime } from 'luxon';
import { Link } from 'react-router';
import { match } from 'ts-pattern';
import { UAParser } from 'ua-parser-js';

import { useUpdateSearchParams } from '@documenso/lib/client-only/hooks/use-update-search-params';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import type { TDocumentAuditLog } from '@documenso/lib/types/document-audit-logs';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { findRecipientByEmail, isRecipientExpired } from '@documenso/lib/utils/recipients';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { ReadStatus, RecipientRole, SigningStatus } from '@documenso/prisma/client-browser';
import { trpc } from '@documenso/trpc/react';
import type { TFindDocumentsResponse } from '@documenso/trpc/server/document-router/find-documents.types';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import type { DataTableColumnDef, RowSelectionState } from '@documenso/ui/primitives/data-table';
import { DataTable } from '@documenso/ui/primitives/data-table';
import { DataTablePagination } from '@documenso/ui/primitives/data-table-pagination';
import { Skeleton } from '@documenso/ui/primitives/skeleton';
import { TableCell } from '@documenso/ui/primitives/table';

import { useCurrentTeam } from '~/providers/team';

import { StackAvatarsWithTooltip } from '../general/stack-avatars-with-tooltip';
import { DocumentActionPrompts } from './document-action-prompts';
import { DocumentsTableActionButton } from './documents-table-action-button';
import { DocumentsTableActionDropdown } from './documents-table-action-dropdown';

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
  const [expandedEnvelopeId, setExpandedEnvelopeId] = useState<string | null>(null);

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
        cell: ({ row }) => {
          const isExpanded = expandedEnvelopeId === row.original.envelopeId;

          return (
            <div className="gap-1 flex items-start">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-0.5 h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? _(msg`Hide signer details`) : _(msg`Show signer details`)}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedEnvelopeId((current) =>
                    current === row.original.envelopeId ? null : row.original.envelopeId,
                  );
                }}
              >
                <ChevronDownIcon
                  className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
                />
              </Button>
              <DataTableTitle
                row={row.original}
                teamUrl={team?.url}
                teamEmail={team?.teamEmail?.email}
                createdAtLabel={i18n.date(row.original.createdAt, { ...DateTime.DATE_MED })}
              />
            </div>
          );
        },
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
            <div className="gap-x-4 flex items-center">
              <DocumentsTableActionButton row={row.original} />
              <DocumentActionPrompts row={row.original} />
              <DocumentsTableActionDropdown
                row={row.original}
                onMoveDocument={onMoveDocument ? () => onMoveDocument(row.original.id) : undefined}
              />
            </div>
          ),
      },
    );

    return cols;
  }, [team, onMoveDocument, enableSelection, expandedEnvelopeId, _, i18n]);

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
        expandedRowId={expandedEnvelopeId}
        renderExpandedRow={(row) => <DocumentsTableSignerBreakdown row={row} />}
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
        <div className="inset-0 bg-background/50 absolute flex items-center justify-center">
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
        <span className="font-medium md:max-w-[20rem] block max-w-[10rem] truncate">
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
      className="font-medium md:max-w-[20rem] block max-w-[10rem] truncate hover:underline"
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
        'px-2.5 py-1 text-xs font-medium inline-flex rounded-full whitespace-nowrap',
        statusConfig.className,
      )}
    >
      {statusConfig.label}
    </span>
  );
};

const sortDashboardRecipients = (recipients: DocumentsTableRow['recipients']) =>
  [...recipients].sort((a, b) => {
    const orderA = a.signingOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.signingOrder ?? Number.MAX_SAFE_INTEGER;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return a.id - b.id;
  });

const getRecipientDashboardStatusLabel = (
  recipient: DocumentsTableRow['recipients'][number],
  documentStatus: DocumentsTableRow['status'],
  translateLabel: (descriptor: MessageDescriptor) => string,
) => {
  if (documentStatus === 'DRAFT') {
    return translateLabel(msg`Not sent`);
  }

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    return match(recipient.role)
      .with(RecipientRole.APPROVER, () => translateLabel(msg`Approved`))
      .with(RecipientRole.CC, () =>
        documentStatus === 'COMPLETED' ? translateLabel(msg`Sent`) : translateLabel(msg`Ready`),
      )
      .with(RecipientRole.SIGNER, () => translateLabel(msg`Signed`))
      .with(RecipientRole.VIEWER, () => translateLabel(msg`Viewed`))
      .with(RecipientRole.ASSISTANT, () => translateLabel(msg`Assisted`))
      .otherwise(() => translateLabel(msg`Unknown`));
  }

  if (recipient.signingStatus === SigningStatus.REJECTED) {
    return translateLabel(msg`Rejected`);
  }

  if (isRecipientExpired(recipient)) {
    return translateLabel(msg`Expired`);
  }

  if (recipient.role === RecipientRole.CC) {
    return translateLabel(msg`Pending`);
  }

  if (
    recipient.readStatus === ReadStatus.OPENED &&
    recipient.signingStatus === SigningStatus.NOT_SIGNED
  ) {
    return translateLabel(msg`Opened`);
  }

  return translateLabel(msg`Pending`);
};

type RecipientAuditMetadata = {
  ipAddress: string | null;
  userAgent: string | null;
};

// Prefer logs that represent a real signing action (and therefore carry
// trustworthy IP / user-agent metadata). Fall back to earlier events so we
// still surface some context for partially-signed / opened documents.
const RECIPIENT_AUDIT_LOG_PRIORITY: Partial<Record<TDocumentAuditLog['type'], number>> = {
  [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED]: 100,
  [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_REJECTED]: 90,
  [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_INSERTED]: 80,
  [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_UNINSERTED]: 70,
  [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_OPENED]: 60,
  [DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_VIEWED]: 50,
};

const getRecipientAuditMetadataMap = (
  logs: TDocumentAuditLog[],
  recipients: DocumentsTableRow['recipients'],
) => {
  const metadataByRecipientId = new Map<number, RecipientAuditMetadata>();
  const bestScoreByRecipientId = new Map<number, number>();

  const emailToRecipientId = new Map<string, number>();
  for (const recipient of recipients) {
    emailToRecipientId.set(recipient.email.toLowerCase(), recipient.id);
  }

  for (const log of logs) {
    if (!log.ipAddress && !log.userAgent) {
      continue;
    }

    const priority = RECIPIENT_AUDIT_LOG_PRIORITY[log.type] ?? 0;

    if (priority === 0) {
      continue;
    }

    // Resolve the recipient this log belongs to. Prefer the structured
    // recipientId on the log data, fall back to matching the base email.
    const logData = log.data as { recipientId?: number } | undefined;
    let recipientId = logData?.recipientId ?? null;

    if (recipientId === null && log.email) {
      recipientId = emailToRecipientId.get(log.email.toLowerCase()) ?? null;
    }

    if (recipientId === null) {
      continue;
    }

    const existingScore = bestScoreByRecipientId.get(recipientId) ?? -1;

    if (priority <= existingScore) {
      continue;
    }

    bestScoreByRecipientId.set(recipientId, priority);
    metadataByRecipientId.set(recipientId, {
      ipAddress: log.ipAddress ?? null,
      userAgent: log.userAgent ?? null,
    });
  }

  return metadataByRecipientId;
};

const getDeviceFromUserAgent = (userAgent: string | null | undefined) => {
  if (!userAgent) {
    return null;
  }

  const parser = new UAParser(userAgent);
  const { os, browser } = parser.getResult();

  const osLabel = os.name ?? null;
  const browserLabel = browser.name
    ? [browser.name, browser.version].filter(Boolean).join(' ')
    : null;

  const parts = [osLabel, browserLabel].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : null;
};

const DocumentsTableSignerBreakdown = ({ row }: { row: DocumentsTableRow }) => {
  const { _, i18n } = useLingui();
  const recipients = useMemo(() => sortDashboardRecipients(row.recipients), [row.recipients]);

  // Drafts have never been sent, so there is no audit log metadata to fetch.
  const shouldFetchAuditLogs = recipients.length > 0 && row.status !== 'DRAFT';

  const { data: auditLogData, isLoading: isLoadingAuditLogs } =
    trpc.document.auditLog.find.useQuery(
      {
        documentId: row.id,
        perPage: 100,
        orderByColumn: 'createdAt',
        orderByDirection: 'desc',
      },
      {
        enabled: shouldFetchAuditLogs,
        staleTime: 60 * 1000,
      },
    );

  const recipientMetadata = useMemo(() => {
    if (!auditLogData?.data) {
      return new Map<number, RecipientAuditMetadata>();
    }

    return getRecipientAuditMetadataMap(auditLogData.data, recipients);
  }, [auditLogData, recipients]);

  if (recipients.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
        <Trans>No recipients</Trans>
      </div>
    );
  }

  const isMetadataPending = shouldFetchAuditLogs && isLoadingAuditLogs;

  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Trans>Signer breakdown</Trans>
      </p>
      <div className="rounded-md border-border bg-background overflow-x-auto border">
        <table className="text-sm w-full min-w-[640px] text-left">
          <thead className="bg-muted/40 text-xs text-muted-foreground border-b">
            <tr>
              <th className="px-3 py-2 font-medium">
                <Trans>Name</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Email</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Status</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Last action</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>Device</Trans>
              </th>
              <th className="px-3 py-2 font-medium">
                <Trans>IP address</Trans>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {recipients.map((recipient) => {
              const metadata = recipientMetadata.get(recipient.id);
              const device = getDeviceFromUserAgent(metadata?.userAgent);

              return (
                <tr key={recipient.id} className="text-foreground">
                  <td className="px-3 py-2.5 font-medium max-w-[10rem] truncate">
                    {recipient.name?.trim() ? recipient.name : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[14rem] truncate">
                    {recipient.email}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {getRecipientDashboardStatusLabel(recipient, row.status, (descriptor) =>
                      _(descriptor),
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {recipient.signedAt
                      ? i18n.date(recipient.signedAt, { ...DateTime.DATETIME_MED })
                      : '—'}
                  </td>
                  <td
                    className="px-3 py-2.5 text-muted-foreground max-w-[14rem] truncate"
                    title={device ?? undefined}
                  >
                    {isMetadataPending ? (
                      <span className="gap-1 text-xs inline-flex items-center">
                        <Loader className="h-3 w-3 animate-spin" aria-hidden="true" />
                        <Trans>Loading</Trans>
                      </span>
                    ) : (
                      (device ?? '—')
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {isMetadataPending ? (
                      <span className="gap-1 inline-flex items-center">
                        <Loader className="h-3 w-3 animate-spin" aria-hidden="true" />
                      </span>
                    ) : (
                      (metadata?.ipAddress ?? '—')
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
