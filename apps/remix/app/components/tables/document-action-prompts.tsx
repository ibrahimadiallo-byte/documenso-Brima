import { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { DocumentStatus, RecipientRole, SendStatus, SigningStatus } from '@prisma/client';
import { Bell, FileText, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { useSession } from '@documenso/lib/client-only/providers/session';
import type { TDocumentMany as TDocumentRow } from '@documenso/lib/types/document';
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

const REMINDER_THRESHOLD_HOURS = 48;

// Check staleness per individual signer using their own reminder/sent timestamps.
// This prevents one signer's activity from resetting the clock for everyone else.
function isPendingOverThreshold(recipient: TDocumentRow['recipients'][number]): boolean {
  const referenceTime = recipient.lastReminderSentAt ?? recipient.sentAt;
  if (!referenceTime) return false;
  const ms = new Date(referenceTime).getTime();
  if (isNaN(ms)) return false;
  return (Date.now() - ms) / (1000 * 60 * 60) >= REMINDER_THRESHOLD_HOURS;
}

export type DocumentActionPromptsProps = {
  row: TDocumentRow;
};

export const DocumentActionPrompts = ({ row }: DocumentActionPromptsProps) => {
  const { user } = useSession();
  const team = useCurrentTeam();
  const { quota } = useLimits();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const documentsPath = formatDocumentsPath(team?.url ?? '');
  const auditLogPath = `${documentsPath}/${row.envelopeId}/logs`;

  // Owner guard — none of these buttons should be visible to signers or CC recipients
  const isOwner = row.user?.id === user?.id;
  // Free tier = finite document quota — Remind requires paid plan
  const isFreeTier = isFinite(quota.documents) && quota.documents > 0;
  const isPending = row.status === DocumentStatus.PENDING;
  const isComplete = row.status === DocumentStatus.COMPLETED;

  // Unsigned = real signer (not CC) who was actually sent the email and hasn't signed yet
  const unsignedRecipients = row.recipients.filter(
    (r) =>
      r.signingStatus === SigningStatus.NOT_SIGNED &&
      r.role !== RecipientRole.CC &&
      r.role !== RecipientRole.VIEWER &&
      r.sendStatus === SendStatus.SENT,
  );

  // Stalled = unsigned recipients who have been waiting 48h+ since last reminder (or initial send)
  const stalledRecipients = unsignedRecipients.filter(isPendingOverThreshold);

  // Partially signed = at least one real signer signed, but others haven't
  const isPartiallySigned =
    isPending &&
    row.recipients.some(
      (r) =>
        r.signingStatus === SigningStatus.SIGNED &&
        r.role !== RecipientRole.CC &&
        r.role !== RecipientRole.VIEWER,
    ) &&
    unsignedRecipients.length > 0;

  // Remind and Resend are independent — one signing does not hide the other button
  const showSendReminder = isOwner && isPending && stalledRecipients.length > 0;
  const showResendDocument = isOwner && isPartiallySigned;
  const showViewAuditLog = isOwner && isComplete;

  if (!mounted || (!showSendReminder && !showResendDocument && !showViewAuditLog)) {
    return null;
  }

  return (
    <div className="gap-2 flex items-center">
      {showSendReminder &&
        (isFreeTier ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" variant="outline" disabled>
                    <Bell className="mr-1 h-3 w-3" />
                    <Trans>Remind</Trans>
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
            recipients={stalledRecipients}
            trigger={
              <Button
                variant="outline"
                size="sm"
                title={`Send reminder to ${stalledRecipients.length} stalled signer(s)`}
              >
                <Bell className="mr-1 h-3 w-3" />
                <Trans>Remind</Trans>
              </Button>
            }
          />
        ))}

      {showResendDocument && (
        <DocumentResendDialog
          document={row}
          recipients={unsignedRecipients}
          trigger={
            <Button variant="outline" size="sm" title="Resend to unsigned recipients">
              <RefreshCw className="mr-1 h-3 w-3" />
              <Trans>Resend</Trans>
            </Button>
          }
        />
      )}

      {showViewAuditLog && (
        <Button variant="outline" size="sm" asChild>
          <Link to={auditLogPath}>
            <FileText className="mr-1 h-3 w-3" />
            <Trans>Audit Log</Trans>
          </Link>
        </Button>
      )}
    </div>
  );
};
