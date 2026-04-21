# Action Prompts — Code Comparison
## PR #1 vs Correct Implementation

> **What this doc is:**
> This document compares the submitted Action Prompts component (Component 3 — Marketing KPI)
> against the correct implementation.
> Each gap has a plain-English explanation, the broken code, and the fixed code side by side.

---

## What is the Action Prompts component?

When you look at the documents table, the Actions column shows buttons that help the document owner manage signing progress. The Action Prompts component decides **which buttons to show and when**, based on the document's current state.

```
Documents Table — one row looks like this:
┌────────────┬─────────────┬──────────┬──────────┬───────────────────────────────────────────┐
│ Created    │ Title       │ Sender   │ Recipients│ Actions                                  │
├────────────┼─────────────┼──────────┼──────────┼───────────────────────────────────────────┤
│ Apr 19     │ Contract.pdf│ Ismael   │  👤 👤   │ [Sign] [🔔 Remind] [🔄 Resend] [⋮ More]  │
└────────────┴─────────────┴──────────┴──────────┴───────────────────────────────────────────┘
                                                           ↑
                                          THIS is what Action Prompts renders
                                          (the contextual buttons in the middle)
```

**Three buttons, each with specific rules:**

```
┌─────────────────┬──────────────────────────────────────────────────────────────────┐
│ Button          │ When it should appear                                            │
├─────────────────┼──────────────────────────────────────────────────────────────────┤
│ 🔔 Remind       │ You own the doc + it's pending + at least one signer             │
│                 │ hasn't signed AND it's been 48+ hours since their last reminder  │
├─────────────────┼──────────────────────────────────────────────────────────────────┤
│ 🔄 Resend       │ You own the doc + it's pending + SOME people signed but          │
│                 │ others haven't yet (partial progress)                            │
├─────────────────┼──────────────────────────────────────────────────────────────────┤
│ 📄 Audit Log    │ You own the doc + it's fully completed                           │
└─────────────────┴──────────────────────────────────────────────────────────────────┘
```

---

## Where does it live in the codebase?

```
apps/remix/app/components/
│
├── tables/
│   ├── documents-table.tsx              ← main table, renders every row
│   ├── documents-table-action-prompts.tsx  ← Component 3 (PR #1)
│   ├── documents-table-action-button.tsx   (existing — the Sign/View button)
│   └── documents-table-action-dropdown.tsx (existing — the ⋮ menu)
│
└── dialogs/
    └── document-resend-dialog.tsx       ← the dialog that opens when you click
                                            Remind or Resend (both share this)
```

The component is imported and rendered inside the Actions cell in `documents-table.tsx`:

```tsx
// Inside documents-table.tsx — Actions column cell
<div className="flex items-center gap-x-4">
  <DocumentsTableActionButton row={row.original} />   {/* existing */}
  <DocumentsTableActionPrompts row={row.original} />  {/* ← Action Prompts component */}
  <DocumentsTableActionDropdown row={row.original} /> {/* existing */}
</div>
```

---

## Gap 1 — No Owner Check (anyone can see the buttons)

**What the bug means in plain English:**
Imagine you receive a contract to sign. You open the documents page and you can see
a "Remind" button next to someone else's document. You are a signer, not the owner.
You should not be able to send reminders on documents you didn't create.
The submitted version shows these buttons to everyone.

**PR #1 version — broken:**
```tsx
export const DocumentsTableActionPrompts = ({ row }) => {
  const team = useCurrentTeam();
  const isPending = row.status === DocumentStatus.PENDING;

  // ❌ PROBLEM: there is no check for who the current user is.
  // The component never asks "is this MY document?"
  // So signers, CC recipients, and random team members all see Remind/Resend buttons
  // on documents they did not create.

  const showSendReminder = isPending && !hasPartialSigned && isStale && ...;
  //                        ↑ only checks document status, never checks ownership
```

**Our version — fixed:**
```tsx
export const DocumentActionPrompts = ({ row }) => {
  const { user } = useSession();             // ← step 1: get the logged-in user
  const team = useCurrentTeam();
  const isOwner = row.user.id === user?.id;  // ← step 2: is this their document?
  const isPending = row.status === DocumentStatus.PENDING;

  // All three buttons now require isOwner to be true first.
  // If you didn't send this document, you see nothing.
  const showSendReminder   = isOwner && isPending && stalledRecipients.length > 0;
  const showResendDocument = isOwner && isPartiallySigned;
  const showViewAuditLog   = isOwner && isComplete;
```

---

## Gap 2 — CC Recipients Counted as Unsigned Signers

**What the bug means in plain English:**
A CC recipient is someone who gets a copy of the document by email but does NOT sign it.
Their `signingStatus` is permanently `NOT_SIGNED` — that is by design, they are observers.
The submitted filter grabs everyone who hasn't signed, including CC people.
This means a document with a CC recipient will always show a "Remind" button,
even if every actual signer has already signed. The Remind button never goes away.

**PR #1 version — broken:**
```tsx
const unsignedRecipients = row.recipients.filter(
  (r) => r.signingStatus !== SigningStatus.SIGNED,
  // ❌ PROBLEM: this grabs every recipient who hasn't signed.
  //
  // CC recipients are NEVER supposed to sign — their status is stuck at NOT_SIGNED.
  // So a doc with one CC person will always have "unsigned recipients"
  // and the Remind button will show forever, even on a completed document.
  //
  // Also missing: no check that the signing email was actually sent yet.
  // A draft recipient with sendStatus=NOT_SENT could trigger a false reminder.
);
```

**Our version — fixed:**
```tsx
const unsignedRecipients = row.recipients.filter(
  (r) =>
    r.signingStatus === SigningStatus.NOT_SIGNED &&
    r.role !== RecipientRole.CC &&       // ← ignore CC recipients entirely
    r.sendStatus === SendStatus.SENT,    // ← only count people who were actually emailed
  //
  // Now "unsigned" means: a real signer, who got the email, and hasn't signed yet.
  // CC people are gone. Draft recipients are gone.
);
```

---

## Gap 3 — Staleness Measured on the Whole Document, Not Per Signer

**What the bug means in plain English:**
The 48-hour timer is supposed to track whether a specific signer has been waiting long enough
to deserve a reminder. PR #1 measures this on the whole document using `row.updatedAt`.
That timestamp updates any time anything happens to the document — including when another
signer signs it. So if Alice signs today, the document's `updatedAt` resets to now,
and Bob (who has been ignoring the doc for 2 weeks) no longer triggers the 48h threshold.
Result: no Remind button for Bob, even though he's been stalling for weeks.

**PR #1 version — broken:**
```tsx
const HOURS_48_MS = 48 * 60 * 60 * 1000;

const isStale = Date.now() - new Date(row.updatedAt).getTime() > HOURS_48_MS;
// ❌ PROBLEM: row.updatedAt is the document's last-modified timestamp.
//
// Scenario: 3-signer contract.
//   - Day 1:  All 3 signers get the email. updatedAt = Day 1.
//   - Day 10: Alice signs. updatedAt resets to Day 10.
//   - Day 11: You check. Bob and Carol have been waiting since Day 1 (10 days!).
//             But isStale = (Day 11 - Day 10) = 1 day → false.
//             No Remind button. Bob and Carol keep waiting.
```

**Our version — fixed:**
```tsx
const REMINDER_THRESHOLD_HOURS = 48;

// Check staleness per individual signer, not for the whole document.
// lastReminderSentAt = when we last reminded them (if we have)
// sentAt             = when they first received the signing email
// We use whichever is more recent as the reference point.
function isPendingOverThreshold(recipient): boolean {
  const referenceTime = recipient.lastReminderSentAt ?? recipient.sentAt;
  if (!referenceTime) return false;
  const hoursSince = (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60);
  return hoursSince >= REMINDER_THRESHOLD_HOURS;
}

// stalledRecipients = only the people who have been waiting 48h+ individually
const stalledRecipients = unsignedRecipients.filter(isPendingOverThreshold);
// → Alice signing on Day 10 does not reset Bob's clock. Bob is still stale.
```

---

## Gap 4 — Remind Disappears When Anyone Has Signed

**What the bug means in plain English:**
The submitted logic says: if the document is partially signed (some signed, some haven't),
show Resend — but do NOT show Remind. These two buttons are treated as mutually exclusive.
That means once one person signs, the Remind button for the remaining signers vanishes entirely.
If you have 5 signers and 1 signs on day 1, you can never remind the other 4 no matter how
long they wait.

**PR #1 version — broken:**
```tsx
const hasPartialSigned =
  row.recipients.some((r) => r.signingStatus === SigningStatus.SIGNED) &&
  unsignedRecipients.length > 0;

// ❌ PROBLEM: !hasPartialSigned kills Remind as soon as anyone signs.
//
// Scenario: 5 signers. Alice signs on Day 1. Now hasPartialSigned = true.
// showSendReminder = isPending && !hasPartialSigned && ...
//                              ↑ this is now false, forever.
// Bob, Carol, Dave, Eve can wait 30 days — no Remind button will ever appear.
const showSendReminder = isPending && !hasPartialSigned && isStale && unsignedRecipients.length > 0;
const showResend       = isPending && hasPartialSigned;
// → once partial, you only get Resend. Remind is gone.
```

**Our version — fixed:**
```tsx
// isPartiallySigned = used ONLY for the Resend button
const isPartiallySigned =
  isPending &&
  row.recipients.some(
    (r) => r.signingStatus === SigningStatus.SIGNED && r.role !== RecipientRole.CC,
  ) &&
  unsignedRecipients.length > 0;

// Remind looks at stalledRecipients only — does not care about partial signing at all.
// If Bob has been waiting 48h+, Remind shows. Full stop.
const showSendReminder   = isOwner && isPending && stalledRecipients.length > 0;
const showResendDocument = isOwner && isPartiallySigned;
// → Both can appear at the same time when appropriate.
// → Alice signing does not affect Bob's Remind button.
```

---

## Gap 5 — Crash When User Is Not on a Team

**What the bug means in plain English:**
`useCurrentTeam()` returns `undefined` when the user is on their personal documents page
(not inside a team workspace). PR #1 accesses `team.url` directly without checking if `team`
exists. The moment a personal user loads the documents page, this throws a TypeError and
the whole table crashes.

**PR #1 version — broken:**
```tsx
const documentsPath = formatDocumentsPath(team.url);
// ❌ PROBLEM: team is undefined for personal accounts.
//
// JavaScript error:
//   TypeError: Cannot read properties of undefined (reading 'url')
//
// This crashes the entire documents table for any user
// who is not inside a team workspace.
```

**Our version — fixed:**
```tsx
const documentsPath = formatDocumentsPath(team?.url ?? '');
//                                              ↑
//   team?.url  → safely returns undefined instead of crashing if team is undefined
//   ?? ''      → if undefined, use empty string, which formatDocumentsPath
//                handles correctly and returns the personal documents path
```

---

## Signer Breakdown — What Michael Built vs What We Added

> **Context:** Michael built the Signer Breakdown component (Component 2 — Legal KPI).
> His implementation is solid — expandable row design, correct use of `sortDashboardRecipients`,
> proper i18n date formatting, `getRecipientDashboardStatusLabel` for status labels,
> and clean responsive table markup with horizontal scroll on small screens.
> He missed the audit log fetch — Device and IP were left as hardcoded dashes.
> The Legal KPI specifically requires real IP address and device type per signer.
> We added the audit log fetch on top of his component to close that gap.

```
WHAT MICHAEL'S TABLE SHOWED (before patch) — Device and IP are fake placeholders:

┌──────────┬──────────────┬────────┬─────────────┬────────┬────────────┐
│ Name     │ Email        │ Status │ Last action │ Device │ IP address │
├──────────┼──────────────┼────────┼─────────────┼────────┼────────────┤
│ Alice    │ alice@co.com │ Signed │ Apr 19      │  —     │     —      │  ← hardcoded dash
│ Bob      │ bob@co.com   │ Pending│     —       │  —     │     —      │  ← hardcoded dash
└──────────┴──────────────┴────────┴─────────────┴────────┴────────────┘


WHAT IT SHOWS AFTER OUR PATCH — real data from the audit log:

┌──────────┬──────────────┬────────┬─────────────┬─────────┬──────────────┐
│ Name     │ Email        │ Status │ Last action │ Device  │ IP address   │
├──────────┼──────────────┼────────┼─────────────┼─────────┼──────────────┤
│ Alice    │ alice@co.com │ Signed │ Apr 19      │ Desktop │ 192.168.1.4  │  ← real data
│ Bob      │ bob@co.com   │ Pending│     —       │  —      │      —       │  ← blank = not signed yet, that's correct
└──────────┴──────────────┴────────┴─────────────┴─────────┴──────────────┘
```

**Exactly what we added to Michael's `DocumentsTableSignerBreakdown` component:**

```tsx
// STEP 1 — Add the trpc client import at the top of documents-table.tsx
// (the audit log query requires this — it wasn't needed before our addition)
import { trpc } from '@documenso/trpc/react';


// STEP 2 — Add a helper function that reads the browser's User-Agent string
// and returns a human-readable device type. No external library needed.
function getDeviceType(userAgent?: string | null): string {
  if (!userAgent) return '—';                               // no data → dash
  if (/Mobi|Android|iP(hone|od)/i.test(userAgent)) return 'Mobile';  // phone check
  if (/Tablet|iPad/i.test(userAgent)) return 'Tablet';     // tablet check
  return 'Desktop';                                         // everything else = desktop
}


// STEP 3 — Inside DocumentsTableSignerBreakdown, fetch the audit log for this document.
// { enabled: recipients.length > 0 } means: only fire the API call if there are signers.
// The component only renders when a row is expanded, so this fires lazily.
const { data: auditData } = trpc.document.auditLog.find.useQuery(
  { documentId: row.id, perPage: 100 },
  { enabled: recipients.length > 0 },
);


// STEP 4 — Build a lookup map: email address → audit log entry.
// The audit log has one entry per event (viewed, signed, etc.).
// We take the first entry per email (most recent signing event comes first).
// This gives us ipAddress and userAgent for each signer.
const signingEvents = useMemo(() => {
  const map = new Map<string, { ipAddress?: string | null; userAgent?: string | null }>();
  for (const log of auditData?.data ?? []) {
    if (!log.email || map.has(log.email)) continue; // skip if no email or already have entry
    map.set(log.email, { ipAddress: log.ipAddress, userAgent: log.userAgent });
  }
  return map;
}, [auditData]);


// STEP 5 — Inside the table row, look up each signer's audit entry and
// replace the two hardcoded dashes with real values.

// Before (Michael's):
<td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">—</td>
<td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">—</td>

// After (our patch):
const audit = signingEvents.get(recipient.email); // look up by email

<td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
  {getDeviceType(audit?.userAgent)}  {/* Desktop / Mobile / Tablet / — */}
</td>
<td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
  {audit?.ipAddress ?? '—'}          {/* real IP, or dash if signer hasn't acted yet */}
</td>
```

---

## Summary of All Changes

| # | Gap | Impact | Fixed? |
|---|-----|--------|--------|
| 1 | No owner check — buttons show to everyone | Security / UX | ✅ `isOwner` guard added |
| 2 | CC recipients counted as unsigned signers | Phantom Remind button that never disappears | ✅ `r.role !== RecipientRole.CC` added |
| 3 | Staleness measured on whole doc, not per signer | Other signers' activity hides Remind for stalled signers | ✅ per-recipient `lastReminderSentAt ?? sentAt` |
| 4 | Remind blocked once anyone has signed | Can't remind remaining signers after partial progress | ✅ Remind and Resend made independent |
| 5 | `team.url` crashes for personal accounts | TypeError crashes the entire table | ✅ `team?.url ?? ''` |
| 6 | Signer breakdown Device/IP hardcoded `—` | Legal KPI not satisfied | ✅ audit log fetch patched into Michael's component |

---

## Branch Status

| Branch | Based on | What's in it | Pushed? |
|--------|----------|--------------|---------|
| `feat/doc-2215-signer-breakdown-ip-device` | Ibrahima's signer breakdown branch | Michael's full component + our audit log patch (IP/device) | ❌ local only |
| `main` stash | our fork | our standalone action prompts + resend dialog patch | ❌ stashed, not committed |

**Nothing has been pushed. Waiting for team sync before any commits.**
