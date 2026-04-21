# Action Prompts — Side-by-Side Diff
## PR #1 (feat/doc-2215-action-prompts) vs Our Implementation (feat/doc-2215-action-prompts)

---

## File: `documents-table-action-prompts.tsx`

### IMPORTS

**PR #1:**
```tsx
import { Trans } from '@lingui/react/macro';
import { DocumentStatus, SigningStatus } from '@prisma/client';
import { Bell, ClipboardList, History } from 'lucide-react';
import { Link } from 'react-router';

import type { TDocumentMany } from '@documenso/lib/types/document';
import { isDocumentCompleted } from '@documenso/lib/utils/document';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { Button } from '@documenso/ui/primitives/button';

import { DocumentResendDialog } from '~/components/dialogs/document-resend-dialog';
import { useCurrentTeam } from '~/providers/team';
```

**Ours:**
```tsx
import { Trans } from '@lingui/react/macro';
import { DocumentStatus, RecipientRole, SendStatus, SigningStatus } from '@prisma/client'; // ← +RecipientRole, +SendStatus
import { Bell, FileText, RefreshCw } from 'lucide-react';                                 // ← different icons
import { Link } from 'react-router';

import { useSession } from '@documenso/lib/client-only/providers/session';                // ← NEW: need user session
import type { TDocumentMany as TDocumentRow } from '@documenso/lib/types/document';
import { formatDocumentsPath } from '@documenso/lib/utils/teams';
import { Button } from '@documenso/ui/primitives/button';

import { DocumentResendDialog } from '~/components/dialogs/document-resend-dialog';
import { useCurrentTeam } from '~/providers/team';
```

---

### GAP 1 — OWNER GUARD

**PR #1:** ❌ missing — no session, no ownership check
```tsx
export const DocumentsTableActionPrompts = ({ row }) => {
  const team = useCurrentTeam();
  // ❌ useSession() is never called
  // ❌ there is no isOwner variable anywhere in this file
  // Result: Remind/Resend/Audit Log buttons appear for signers, CC recipients,
  //         and anyone on the team who can see the documents list
```

**Ours:** ✅ fixed
```tsx
export const DocumentActionPrompts = ({ row }) => {
  const { user } = useSession();             // step 1: who is viewing this row?
  const team = useCurrentTeam();
  const isOwner = row.user.id === user?.id;  // step 2: did THEY send this document?
  // Every button below requires isOwner — if false, component returns null
```

---

### GAP 2 — CC RECIPIENTS NOT EXCLUDED

**PR #1:** ❌ CC recipients counted as unsigned — Remind button never disappears
```tsx
const unsignedRecipients = row.recipients.filter(
  (r) => r.signingStatus !== SigningStatus.SIGNED,
  // ❌ CC recipients observe the document — they are NEVER supposed to sign
  // Their signingStatus stays NOT_SIGNED forever by design
  // This filter includes them, so unsignedRecipients.length is always > 0
  // on any doc with a CC recipient → Remind shows forever, even on completed docs
  //
  // ❌ Also missing: no check that the signing email was actually sent (sendStatus)
  // A draft recipient who was added but never emailed would also trigger Remind
);
```

**Ours:** ✅ fixed
```tsx
const unsignedRecipients = row.recipients.filter(
  (r) =>
    r.signingStatus === SigningStatus.NOT_SIGNED &&
    r.role !== RecipientRole.CC &&      // ← CC recipients are observers, not signers
    r.sendStatus === SendStatus.SENT,   // ← only people who actually received the email
  // Now "unsigned" means: a real signer + email was sent + they haven't signed yet
);
```

---

### GAP 3 — DOCUMENT-LEVEL STALENESS

**PR #1:** ❌ uses `row.updatedAt` — any signing resets the clock for all remaining signers
```tsx
const isStale = Date.now() - new Date(row.updatedAt).getTime() > HOURS_48_MS;
// ❌ row.updatedAt is the document's last-modified timestamp
// It resets every time ANYTHING happens to the document
//
// Real scenario with 3 signers:
//   Day 1:  All 3 get the email. updatedAt = Day 1.
//   Day 10: Alice signs. updatedAt resets to Day 10.
//   Day 11: Bob and Carol have been waiting since Day 1 (10 days).
//           isStale = Day 11 - Day 10 = 1 day → false → no Remind button.
//           Bob and Carol keep waiting with no way to remind them.
```

**Ours:** ✅ per-recipient clock — each signer tracked independently
```tsx
const REMINDER_THRESHOLD_HOURS = 48;

// lastReminderSentAt = timestamp of the last reminder we sent them (if any)
// sentAt             = timestamp when they first received the signing email
// We use whichever is more recent so the clock resets after each reminder
function isPendingOverThreshold(recipient): boolean {
  const referenceTime = recipient.lastReminderSentAt ?? recipient.sentAt;
  if (!referenceTime) return false;
  const hoursSince = (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60);
  return hoursSince >= REMINDER_THRESHOLD_HOURS;
}

// stalledRecipients = only the individuals who have personally been waiting 48h+
const stalledRecipients = unsignedRecipients.filter(isPendingOverThreshold);
// Alice signing on Day 10 has zero effect on Bob's individual 48h clock
```

---

### GAP 4 — REMIND BLOCKED WHEN PARTIALLY SIGNED

**PR #1:** ❌ Remind disappears the moment anyone signs
```tsx
const hasPartialSigned =
  row.recipients.some((r) => r.signingStatus === SigningStatus.SIGNED) &&
  unsignedRecipients.length > 0;

// ❌ !hasPartialSigned means: once even ONE person signs, Remind is gone forever
// Scenario: 5 signers. Alice signs Day 1. hasPartialSigned = true.
// Bob, Carol, Dave, Eve can wait 30 days — the Remind button will never appear again.
// The owner's only option becomes Resend, which sends the whole document again
// instead of a targeted reminder to the specific stalled signers.
const showSendReminder = isPending && !hasPartialSigned && isStale && unsignedRecipients.length > 0;
const showResend = isPending && hasPartialSigned;
// → once partial, Remind is dead. Only Resend available.
```

**Ours:** ✅ Remind and Resend are fully independent of each other
```tsx
// isPartiallySigned is ONLY used to decide whether to show Resend
// It has no effect on whether Remind shows
const isPartiallySigned =
  isPending &&
  row.recipients.some(
    (r) => r.signingStatus === SigningStatus.SIGNED && r.role !== RecipientRole.CC,
  ) &&
  unsignedRecipients.length > 0;

// Remind: show if any individual has been stalled 48h+ — doesn't care about partial progress
const showSendReminder   = isOwner && isPending && stalledRecipients.length > 0;
// Resend: show if there's partial progress — separate concern entirely
const showResendDocument = isOwner && isPartiallySigned;
// → Both buttons can appear at the same time when the situation calls for it
```

---

### GAP 5 — TEAM NULL CRASH

**PR #1:** ❌ crashes on personal documents page
```tsx
const documentsPath = formatDocumentsPath(team.url);
// ❌ useCurrentTeam() returns undefined when the user is NOT in a team workspace
// Accessing .url on undefined throws immediately:
//   TypeError: Cannot read properties of undefined (reading 'url')
// This crashes the entire documents table for every personal account user
// The error happens before the null check — the component never even renders
```

**Ours:** ✅ null-safe optional chaining
```tsx
const documentsPath = formatDocumentsPath(team?.url ?? '');
// team?.url → returns undefined safely if team is undefined (no crash)
// ?? ''     → falls back to empty string, which formatDocumentsPath handles
//             correctly by returning the personal /documents path
```

---

### GAP 6 — AUDIT LOG VISIBLE TO NON-OWNERS

**PR #1:** ❌ Audit Log button shows to anyone viewing a completed doc
```tsx
const isComplete = isDocumentCompleted(row.status);
// ...
{isComplete && (
  // ❌ no isOwner check here
  // A signer who just signed a contract can now click "Audit Log"
  // and see everyone else's IP addresses, devices, and signing timestamps
  // Audit logs are sensitive — they should only be visible to the document owner
  <Button size="sm" variant="outline" asChild>
    <Link to={auditLogPath}>
      <ClipboardList className="mr-1 h-3 w-3" />
      <Trans>Audit Log</Trans>
    </Link>
  </Button>
)}
```

**Ours:** ✅ owner-only
```tsx
// Audit Log requires isOwner — signers never see this button
const showViewAuditLog = isOwner && isComplete;

{showViewAuditLog && (
  <Button variant="outline" size="sm" asChild>
    <Link to={auditLogPath}>
      <FileText className="mr-1 h-3 w-3" />
      <Trans>Audit Log</Trans>
    </Link>
  </Button>
)}
```

---

## Full Score

| Gap | PR #1 | Ours |
|-----|-------|------|
| Owner guard | ❌ | ✅ |
| CC exclusion | ❌ | ✅ |
| SendStatus filter | ❌ | ✅ |
| Per-recipient staleness | ❌ | ✅ |
| Team null safety | ❌ | ✅ |
| Audit Log owner-only | ❌ | ✅ |

**PR #1: 0/6 — Ours: 6/6**

---

## Line Count Comparison

| | PR #1 | Ours |
|--|-------|------|
| Lines | 75 | 105 |
| Extra lines account for | — | owner guard, per-recipient staleness fn, CC + SendStatus filters |

---

## Branch Status

| Branch | File | Pushed? |
|--------|------|---------|
| `ibrahima/feat/doc-2215-action-prompts` | `documents-table-action-prompts.tsx` (PR #1, 6 gaps) | ✅ pushed |
| `feat/doc-2215-action-prompts` (ours) | `document-action-prompts.tsx` (all fixed) | ❌ local only |
