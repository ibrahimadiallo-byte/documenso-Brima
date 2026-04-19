import { Trans } from '@lingui/react/macro';
import { DocumentStatus, SigningStatus } from '@prisma/client';
import { Bell, ClipboardList, History } from 'lucide-react';
import { Link } from 'react-router';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import type { TDocumentMany } from '@documenso/lib/types/document';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { Button } from '@documenso/ui/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@documenso/ui/primitives/tooltip';

import { DocumentResendDialog } from '~/components/dialogs/document-resend-dialog';
import { useCurrentTeam } from '~/providers/team';

const HOURS_48_MS = 48 * 60 * 60 * 1000;

export type DocumentsTableActionPromptsProps = {
  row: TDocumentMany;
};

export const DocumentsTableActionPrompts = ({ row }: DocumentsTableActionPromptsProps) => {
  const team = useCurrentTeam();
  const { quota } = useLimits();
  const isFreeTier = isFinite(quota.documents) && quota.documents > 0;

  const isPending = row.status === DocumentStatus.PENDING;
  const isComplete = isDocumentCompleted(row.status);

  const unsignedRecipients = row.recipients.filter((r) => r.signingStatus !== SigningStatus.SIGNED);
  const hasPartialSigned =
    row.recipients.some((r) => r.signingStatus === SigningStatus.SIGNED) &&
    unsignedRecipients.length > 0;
  const isStale = Date.now() - new Date(row.updatedAt).getTime() > HOURS_48_MS;

  const showSendReminder =
    isPending && !hasPartialSigned && isStale && unsignedRecipients.length > 0;
  const showResend = isPending && hasPartialSigned;

  const documentsPath = formatDocumentsPath(team.url);
  const auditLogPath = `${documentsPath}/${row.envelopeId}/logs`;

  if (!showSendReminder && !showResend && !isComplete) {
    return null;
  }

  return (
    <div className="flex items-center gap-x-2">
      {showSendReminder &&
        (isFreeTier ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" variant="outline" disabled>
                    <Bell className="mr-1 h-3 w-3" />
                    <Trans>Send Reminder</Trans>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Reminders are available on the Individual plan</Trans>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <DocumentResendDialog
            document={row}
            recipients={unsignedRecipients}
            trigger={
              <Button size="sm" variant="outline">
                <Bell className="mr-1 h-3 w-3" />
                <Trans>Send Reminder</Trans>
              </Button>
            }
          />
        ))}

      {showResend && (
        <DocumentResendDialog
          document={row}
          recipients={unsignedRecipients}
          trigger={
            <Button size="sm" variant="outline">
              <History className="mr-1 h-3 w-3" />
              <Trans>Resend Document</Trans>
            </Button>
          }
        />
      )}

      {isComplete && (
        <Button size="sm" variant="outline" asChild>
          <Link to={auditLogPath}>
            <ClipboardList className="mr-1 h-3 w-3" />
            <Trans>Audit Log</Trans>
          </Link>
        </Button>
      )}
    </div>
  );
};
