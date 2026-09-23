<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Organization Timezone
    |--------------------------------------------------------------------------
    |
    | Timestamps are stored in UTC. Day buckets ("Today", daily rollups) are
    | computed in this timezone.
    |
    */

    'timezone' => env('MONITOR_TIMEZONE', 'Asia/Dhaka'),

    'platforms' => ['macos', 'windows', 'linux'],

    /*
    |--------------------------------------------------------------------------
    | Agent Health Thresholds
    |--------------------------------------------------------------------------
    */

    'online_minutes' => 10,

    'stale_hours' => 24,

    'session_active_minutes' => 30,

    'pairing_code_ttl_minutes' => 15,

    /*
    |--------------------------------------------------------------------------
    | Sync Batch Limits
    |--------------------------------------------------------------------------
    |
    | Maximum records per type and maximum request body size (bytes) accepted
    | in a single POST /api/agent/v1/sync batch.
    |
    */

    'sync_limits' => [
        'usage' => 500,
        'sessions' => 200,
        'messages' => 200,
        'bytes' => 2097152,
    ],

];
