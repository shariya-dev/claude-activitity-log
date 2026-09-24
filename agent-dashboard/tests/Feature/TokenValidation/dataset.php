<?php

/*
|--------------------------------------------------------------------------
| Generated token-validation dataset (H23)
|--------------------------------------------------------------------------
|
| 3 developers (one device each) x 2 projects (+ one session without project/account) x 2 models.
| Token values come from a seeded Mersenne Twister, so the dataset is identical on every run.
| Org timezone Asia/Dhaka (UTC+6): org midnight is 18:00:00.000Z.
|
| Calendar notes (2026): Sun Aug 30 -> Mon Aug 31 is a week boundary; Mon Aug 31 -> Tue Sep 1 a month
| boundary; 2025-12-31 -> 2026-01-01 a year boundary.
|
*/

use App\Models\Device;
use Illuminate\Support\Str;

require_once __DIR__.'/helpers.php';

if (! function_exists('tvDatasetNow')) {
    function tvDatasetNow(): string
    {
        return '2026-09-05T06:00:00Z';
    }
}

if (! function_exists('tvDataset')) {
    /**
     * @return array{devices: array<string, array{platform: string, account: string}>, sessions: list<array<string, mixed>>}
     */
    function tvDataset(): array
    {
        $sonnet = 'claude-sonnet-5';
        $opus = 'claude-opus-5';

        $sessions = [
            // Straddles org midnight (and the Sun->Mon week boundary): 17:59:59.999Z is Aug 30, 18:00:00.000Z is Aug 31.
            ['id' => 'tv-alice-atlas-midnight', 'device' => 'alice', 'project' => 'atlas', 'account' => true, 'messages' => [
                ['id' => 'msg_s1_1', 'at' => '2026-08-30T17:40:00.000Z', 'model' => $sonnet],
                ['id' => 'msg_s1_2', 'at' => '2026-08-30T17:59:59.999Z', 'model' => $opus],
                ['id' => 'msg_s1_3', 'at' => '2026-08-30T18:00:00.000Z', 'model' => $sonnet],
                ['id' => 'msg_s1_4', 'at' => '2026-08-30T18:20:00.000Z', 'model' => $opus],
            ]],
            // Straddles the Aug 31 -> Sep 1 org midnight (month boundary).
            ['id' => 'tv-alice-borealis-month', 'device' => 'alice', 'project' => 'borealis', 'account' => true, 'messages' => [
                ['id' => 'msg_s2_1', 'at' => '2026-08-31T17:30:00.000Z', 'model' => $sonnet],
                ['id' => 'msg_s2_2', 'at' => '2026-08-31T18:00:00.000Z', 'model' => $sonnet],
                ['id' => 'msg_s2_3', 'at' => '2026-08-31T18:10:00.000Z', 'model' => $opus],
            ]],
            // Crosses UTC midnight, which is NOT an org-day boundary: all three are Sep 2 in Dhaka.
            ['id' => 'tv-bob-atlas-utc-midnight', 'device' => 'bob', 'project' => 'atlas', 'account' => true, 'messages' => [
                ['id' => 'msg_s3_1', 'at' => '2026-09-01T23:30:00.000Z', 'model' => $opus],
                ['id' => 'msg_s3_2', 'at' => '2026-09-01T23:59:59.999Z', 'model' => $sonnet],
                ['id' => 'msg_s3_3', 'at' => '2026-09-02T00:00:00.000Z', 'model' => $opus],
            ]],
            // The previous week (Thu Aug 27).
            ['id' => 'tv-bob-borealis-prev-week', 'device' => 'bob', 'project' => 'borealis', 'account' => true, 'messages' => [
                ['id' => 'msg_s4_1', 'at' => '2026-08-27T04:00:00.000Z', 'model' => $sonnet],
                ['id' => 'msg_s4_2', 'at' => '2026-08-27T05:15:00.000Z', 'model' => $sonnet],
            ]],
            // Straddles the org new-year midnight: 2025-12-31 and 2026-01-01.
            ['id' => 'tv-carol-atlas-new-year', 'device' => 'carol', 'project' => 'atlas', 'account' => true, 'messages' => [
                ['id' => 'msg_s5_1', 'at' => '2025-12-31T17:30:00.000Z', 'model' => $sonnet],
                ['id' => 'msg_s5_2', 'at' => '2025-12-31T18:30:00.000Z', 'model' => $opus],
            ]],
            // No project and no account: lands in the "Unknown" breakdown bucket.
            ['id' => 'tv-carol-unassigned', 'device' => 'carol', 'project' => null, 'account' => false, 'messages' => [
                ['id' => 'msg_s6_1', 'at' => '2026-08-29T10:00:00.000Z', 'model' => $opus],
                ['id' => 'msg_s6_2', 'at' => '2026-08-29T11:00:00.000Z', 'model' => $opus],
            ]],
            // Split-line / duplicate delivery: msg_split arrives in three separate batches with growing output
            // and a trailing all-zero line; it must count once with the per-field max.
            ['id' => 'tv-carol-borealis-split', 'device' => 'carol', 'project' => 'borealis', 'account' => true, 'messages' => [
                ['id' => 'msg_split', 'at' => '2026-09-02T08:00:00.000Z', 'model' => $sonnet, 'deliveries' => [
                    ['input_tokens' => 7, 'output_tokens' => 100, 'cache_creation_tokens' => 1200, 'cache_read_tokens' => 5000],
                    ['input_tokens' => 7, 'output_tokens' => 866, 'cache_creation_tokens' => 1200, 'cache_read_tokens' => 5000],
                    ['input_tokens' => 0, 'output_tokens' => 0, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 0],
                ]],
                ['id' => 'msg_s7_2', 'at' => '2026-09-02T08:05:00.000Z', 'model' => $sonnet],
                // Split line across org midnight, delivered in two batches: the FIRST delivery is stamped
                // 18:00:00.010Z (Sep 2 in Dhaka), the LATER one 17:59:59.990Z (Sep 1) with the full output.
                // Earliest timestamp wins, so the merged message belongs to Sep 1 and must leave Sep 2.
                ['id' => 'msg_midnight_split', 'at' => '2026-09-01T18:00:00.010Z', 'model' => $sonnet, 'deliveries' => [
                    ['at' => '2026-09-01T18:00:00.010Z', 'input_tokens' => 11, 'output_tokens' => 200, 'cache_creation_tokens' => 300, 'cache_read_tokens' => 4000],
                    ['at' => '2026-09-01T17:59:59.990Z', 'input_tokens' => 11, 'output_tokens' => 950, 'cache_creation_tokens' => 300, 'cache_read_tokens' => 4000],
                ]],
            ]],
            ['id' => 'tv-alice-atlas-late', 'device' => 'alice', 'project' => 'atlas', 'account' => true, 'messages' => [
                ['id' => 'msg_s8_1', 'at' => '2026-09-03T09:00:00.000Z', 'model' => $opus],
                ['id' => 'msg_s8_2', 'at' => '2026-09-03T09:30:00.000Z', 'model' => $opus],
            ]],
        ];

        mt_srand(20260923);

        foreach ($sessions as &$session) {
            foreach ($session['messages'] as &$message) {
                $message['deliveries'] ??= [[
                    'input_tokens' => mt_rand(1, 5000),
                    'output_tokens' => mt_rand(1, 4000),
                    'cache_creation_tokens' => mt_rand(0, 30000),
                    'cache_read_tokens' => mt_rand(0, 250000),
                ]];
            }
        }
        unset($session, $message);

        mt_srand();

        return [
            'devices' => [
                'alice' => ['platform' => 'macos', 'account' => 'alice-work'],
                'bob' => ['platform' => 'windows', 'account' => 'bob-work'],
                'carol' => ['platform' => 'linux', 'account' => 'carol-personal'],
            ],
            'sessions' => $sessions,
        ];
    }
}

if (! function_exists('tvDeliveryTimes')) {
    /**
     * Every timestamp a session's messages are delivered with (a delivery may carry its own `at`).
     *
     * @param  array<string, mixed>  $session
     * @return list<string>
     */
    function tvDeliveryTimes(array $session): array
    {
        $times = [];

        foreach ($session['messages'] as $message) {
            foreach ($message['deliveries'] as $delivery) {
                $times[] = $delivery['at'] ?? $message['at'];
            }
        }

        return $times;
    }
}

if (! function_exists('tvExpectedRows')) {
    /**
     * One deduplicated row per message, with every dimension name and its org day — pure PHP, no DB.
     *
     * @param  array{devices: array<string, array{platform: string, account: string}>, sessions: list<array<string, mixed>>}  $dataset
     * @return list<array<string, mixed>>
     */
    function tvExpectedRows(array $dataset): array
    {
        $deliveries = [];

        foreach ($dataset['sessions'] as $session) {
            foreach ($session['messages'] as $message) {
                foreach ($message['deliveries'] as $delivery) {
                    $tokens = array_intersect_key($delivery, array_flip(tvRawColumns()));
                    $deliveries[] = [
                        'session' => $session['id'],
                        'message' => $message['id'],
                        'recorded_at' => $delivery['at'] ?? $message['at'],
                        'model' => $message['model'],
                        'developer' => $session['device'].'@6am.test',
                        'device' => 'dev_tv_'.$session['device'],
                        'project' => $session['project'],
                        'account' => $session['account'] ? $dataset['devices'][$session['device']]['account'].'@example.com' : null,
                        ...$tokens,
                    ];
                }
            }
        }

        return array_map(fn (array $row): array => $row + ['day' => tvOrgDay($row['recorded_at'])], tvDedupe($deliveries));
    }
}

if (! function_exists('tvIngestDataset')) {
    /**
     * Pair the three devices and send the dataset through POST /api/agent/v1/sync: per device one batch
     * with every session and the first delivery of every message, then one batch per further delivery.
     *
     * @param  array{devices: array<string, array{platform: string, account: string}>, sessions: list<array<string, mixed>>}  $dataset
     * @return array{devices: array<string, Device>, bodies: array<string, list<array<string, mixed>>>}
     */
    function tvIngestDataset(array $dataset): array
    {
        $devices = [];
        $bodies = [];

        foreach ($dataset['devices'] as $name => $spec) {
            $device = $devices[$name] = tvPairedDevice($name, $spec['platform']);
            $agent = ['device_id' => $device->device_uid, 'platform' => $spec['platform']];
            $mine = array_values(array_filter($dataset['sessions'], fn (array $s): bool => $s['device'] === $name));

            $sessionRecord = function (array $s) use ($spec): array {
                $times = tvDeliveryTimes($s);

                return syncSession($s['id'], [
                    'project_key' => $s['project'] === null ? null : projectKey($s['project']),
                    'account_key' => $s['account'] ? accountKey($spec['account']) : null,
                    'first_seen_at' => min($times),
                    'last_seen_at' => max($times),
                    'model' => end($s['messages'])['model'],
                ]);
            };
            $usageRecord = fn (array $s, array $m, array $delivery): array => syncUsage($m['id'], $s['id'], [
                'request_id' => 'req_'.Str::after($m['id'], 'msg_'),
                'model' => $m['model'],
                'recorded_at' => $delivery['at'] ?? $m['at'],
                ...array_intersect_key($delivery, array_flip(tvRawColumns())),
            ]);

            $projects = array_values(array_unique(array_filter(array_column($mine, 'project'))));
            $batches = [[
                'accounts' => [syncAccount($spec['account'], ['observed_at' => syncIso('2026-08-01T00:00:00Z')])],
                'projects' => array_map(fn (string $p): array => syncProject($p, [
                    'first_seen_at' => syncIso('2025-12-01T00:00:00Z'),
                    'last_seen_at' => syncIso('2026-09-03T09:30:00Z'),
                ]), $projects),
                'sessions' => array_map($sessionRecord, $mine),
                'usage' => [],
            ]];

            foreach ($mine as $s) {
                foreach ($s['messages'] as $m) {
                    foreach ($m['deliveries'] as $i => $delivery) {
                        $batches[$i] ??= ['sessions' => [$sessionRecord($s)], 'usage' => []];
                        $batches[$i]['usage'][] = $usageRecord($s, $m, $delivery);
                    }
                }
            }

            foreach (array_values($batches) as $sequence => $records) {
                $body = syncBody($records, ['sequence' => $sequence + 1], $agent);
                tvPostAs($device, $body);
                $bodies[$name][] = $body;
            }
        }

        return ['devices' => $devices, 'bodies' => $bodies];
    }
}
