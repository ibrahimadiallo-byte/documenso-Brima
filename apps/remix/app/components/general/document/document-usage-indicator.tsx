import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';

export const DocumentUsageIndicator = () => {
  const { quota, remaining } = useLimits();

  if (!isFinite(quota.documents) || quota.documents === 0) {
    return null;
  }

  const used = quota.documents - remaining.documents;
  const percentage = Math.min((used / quota.documents) * 100, 100);
  const isNearLimit = used >= quota.documents - 1;

  return (
    <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${isNearLimit ? 'bg-destructive' : 'bg-primary'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <span>
        <Trans>
          {used} of {quota.documents} documents used this month
        </Trans>
      </span>

      {isNearLimit && (
        <Link
          to="/settings/billing"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          <Trans>Upgrade</Trans>
        </Link>
      )}
    </div>
  );
};
