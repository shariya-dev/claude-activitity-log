<?php

namespace App\Enums;

use Carbon\CarbonInterface;

enum ConnectionState: string
{
    case Online = 'online';
    case Stale = 'stale';
    case Offline = 'offline';

    /**
     * Derive the agent connection state from its last heartbeat/sync time.
     * Thresholds (inclusive) come from config/monitor.php.
     */
    public static function fromLastSeen(?CarbonInterface $lastSeenAt, ?CarbonInterface $now = null): self
    {
        if ($lastSeenAt === null) {
            return self::Offline;
        }

        $now ??= now();
        $ageSeconds = $lastSeenAt->diffInSeconds($now, false);

        if ($ageSeconds <= (int) config('monitor.online_minutes') * 60) {
            return self::Online;
        }

        if ($ageSeconds <= (int) config('monitor.stale_hours') * 3600) {
            return self::Stale;
        }

        return self::Offline;
    }
}
