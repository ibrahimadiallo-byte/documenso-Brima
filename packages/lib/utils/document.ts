import type {
  DocumentMeta,
  Envelope,
  OrganisationGlobalSettings,
  Recipient,
  Team,
  User,
} from '@prisma/client';
import {
  DocumentDistributionMethod,
  DocumentSigningOrder,
  DocumentStatus,
  RecipientRole,
  SigningStatus,
} from '@prisma/client';

import { DEFAULT_DOCUMENT_TIME_ZONE } from '../constants/time-zones';
import type { TDocumentLite, TDocumentMany } from '../types/document';
import { DEFAULT_DOCUMENT_EMAIL_SETTINGS } from '../types/document-email';
import { mapSecondaryIdToDocumentId } from './envelope';
import { mapRecipientToLegacyRecipient } from './recipients';
import { isRecipientExpired } from './recipients';

export const isDocumentCompleted = (document: Pick<Envelope, 'status'> | DocumentStatus) => {
  const status = typeof document === 'string' ? document : document.status;

  return status === DocumentStatus.COMPLETED || status === DocumentStatus.REJECTED;
};

/**
 * Extracts the derived document meta which should be used when creating a document
 * from scratch, or from a template.
 *
 * Uses the following, the lower number overrides the higher number:
 * 1. Merged organisation/team settings
 * 2. Meta overrides
 *
 * @param settings - The merged organisation/team settings.
 * @param overrideMeta - The meta to override the settings with.
 * @returns The derived document meta.
 */
export const extractDerivedDocumentMeta = (
  settings: Omit<OrganisationGlobalSettings, 'id'>,
  overrideMeta: Partial<DocumentMeta> | undefined | null,
) => {
  const meta = overrideMeta ?? {};

  // Note: If you update this you will also need to update `create-document-from-template.ts`
  // since there is custom work there which allows 3 overrides.
  return {
    language: meta.language || settings.documentLanguage,
    timezone: meta.timezone || settings.documentTimezone || DEFAULT_DOCUMENT_TIME_ZONE,
    dateFormat: meta.dateFormat || settings.documentDateFormat,
    message: meta.message || null,
    subject: meta.subject || null,
    redirectUrl: meta.redirectUrl || null,

    signingOrder: meta.signingOrder || DocumentSigningOrder.PARALLEL,
    allowDictateNextSigner: meta.allowDictateNextSigner ?? false,
    distributionMethod: meta.distributionMethod || DocumentDistributionMethod.EMAIL, // Todo: Make this a setting.

    // Signature settings.
    typedSignatureEnabled: meta.typedSignatureEnabled ?? settings.typedSignatureEnabled,
    uploadSignatureEnabled: meta.uploadSignatureEnabled ?? settings.uploadSignatureEnabled,
    drawSignatureEnabled: meta.drawSignatureEnabled ?? settings.drawSignatureEnabled,

    // Email settings.
    emailId: meta.emailId ?? settings.emailId,
    emailReplyTo: meta.emailReplyTo ?? settings.emailReplyTo,
    emailSettings:
      meta.emailSettings || settings.emailDocumentSettings || DEFAULT_DOCUMENT_EMAIL_SETTINGS,

    // Envelope expiration.
    envelopeExpirationPeriod:
      meta.envelopeExpirationPeriod ?? settings.envelopeExpirationPeriod ?? null,
  } satisfies Omit<DocumentMeta, 'id'>;
};

/**
 * Map an envelope to a legacy document lite response entity.
 *
 * Do not use spread operator here to avoid unexpected behavior.
 */
export const mapEnvelopeToDocumentLite = (envelope: Envelope): TDocumentLite => {
  const documentId = mapSecondaryIdToDocumentId(envelope.secondaryId);

  return {
    id: documentId, // Use legacy ID.
    envelopeId: envelope.id,
    internalVersion: envelope.internalVersion,
    visibility: envelope.visibility,
    status: envelope.status,
    source: envelope.source,
    externalId: envelope.externalId,
    userId: envelope.userId,
    authOptions: envelope.authOptions,
    formValues: envelope.formValues,
    title: envelope.title,
    createdAt: envelope.createdAt,
    documentDataId: '', // Backwards compatibility.
    updatedAt: envelope.updatedAt,
    completedAt: envelope.completedAt,
    deletedAt: envelope.deletedAt,
    teamId: envelope.teamId,
    folderId: envelope.folderId,
    useLegacyFieldInsertion: envelope.useLegacyFieldInsertion,
    templateId: envelope.templateId,
  };
};

type MapEnvelopeToDocumentManyOptions = Envelope & {
  user: Pick<User, 'id' | 'name' | 'email'>;
  team: Pick<Team, 'id' | 'url'>;
  recipients: Recipient[];
};

const getDashboardSignerProgress = (recipients: Recipient[]) => {
  const actionableRecipients = recipients.filter(
    (recipient) =>
      recipient.role === RecipientRole.SIGNER || recipient.role === RecipientRole.APPROVER,
  );

  return {
    signed: actionableRecipients.filter(
      (recipient) => recipient.signingStatus === SigningStatus.SIGNED,
    ).length,
    total: actionableRecipients.length,
  };
};

const getDashboardStatus = (
  envelope: Pick<Envelope, 'status'>,
  recipients: Recipient[],
): TDocumentMany['dashboardStatus'] => {
  if (envelope.status === DocumentStatus.DRAFT) {
    return 'DRAFT';
  }

  if (envelope.status === DocumentStatus.COMPLETED || envelope.status === DocumentStatus.REJECTED) {
    return 'COMPLETED';
  }

  if (recipients.some((recipient) => isRecipientExpired(recipient))) {
    return 'EXPIRED';
  }

  const signerProgress = getDashboardSignerProgress(recipients);

  if (signerProgress.signed > 0 && signerProgress.signed < signerProgress.total) {
    return 'PARTIALLY_SIGNED';
  }

  return 'SENT';
};

const getLastActivityAt = (
  envelope: Pick<Envelope, 'updatedAt' | 'completedAt'>,
  recipients: Recipient[],
) => {
  const recipientActivityDates = recipients.flatMap((recipient) => {
    const activityDates = [recipient.signedAt];

    return activityDates.filter((date): date is Date => Boolean(date));
  });

  const lastActivityAt = [envelope.updatedAt, envelope.completedAt, ...recipientActivityDates]
    .filter((date): date is Date => Boolean(date))
    .reduce((latest, current) => (current > latest ? current : latest), envelope.updatedAt);

  return lastActivityAt;
};

const getDaysSinceLastActivity = (lastActivityAt: Date) => {
  const millisecondsInDay = 1000 * 60 * 60 * 24;

  return Math.max(0, Math.floor((Date.now() - lastActivityAt.getTime()) / millisecondsInDay));
};

/**
 * Map an envelope to a legacy document many response entity.
 *
 * Do not use spread operator here to avoid unexpected behavior.
 */
export const mapEnvelopesToDocumentMany = (
  envelope: MapEnvelopeToDocumentManyOptions,
): TDocumentMany => {
  const legacyDocumentId = mapSecondaryIdToDocumentId(envelope.secondaryId);
  const signerProgress = getDashboardSignerProgress(envelope.recipients);
  const lastActivityAt = getLastActivityAt(envelope, envelope.recipients);

  return {
    id: legacyDocumentId, // Use legacy ID.
    envelopeId: envelope.id,
    internalVersion: envelope.internalVersion,
    visibility: envelope.visibility,
    status: envelope.status,
    source: envelope.source,
    externalId: envelope.externalId,
    userId: envelope.userId,
    authOptions: envelope.authOptions,
    formValues: envelope.formValues,
    title: envelope.title,
    createdAt: envelope.createdAt,
    documentDataId: '', // Backwards compatibility.
    updatedAt: envelope.updatedAt,
    completedAt: envelope.completedAt,
    deletedAt: envelope.deletedAt,
    teamId: envelope.teamId,
    folderId: envelope.folderId,
    useLegacyFieldInsertion: envelope.useLegacyFieldInsertion,
    templateId: envelope.templateId,
    user: {
      id: envelope.userId,
      name: envelope.user.name,
      email: envelope.user.email,
    },
    team: {
      id: envelope.teamId,
      url: envelope.team.url,
    },
    recipients: envelope.recipients.map((recipient) =>
      mapRecipientToLegacyRecipient(recipient, envelope),
    ),
    dashboardStatus: getDashboardStatus(envelope, envelope.recipients),
    signerProgress,
    lastActivityAt,
    daysSinceLastActivity: getDaysSinceLastActivity(lastActivityAt),
  };
};
