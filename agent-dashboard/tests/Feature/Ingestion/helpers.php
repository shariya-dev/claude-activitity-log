<?php

/*
|--------------------------------------------------------------------------
| Ingestion test helpers
|--------------------------------------------------------------------------
|
| Shared by the tests in this directory (require_once from each file).
| Builds contract-shaped POST /api/agent/v1/sync bodies (docs/contracts/sync-api-v1.md §3.4, §4)
| with every field present and explicit nulls.
|
*/

use App\Models\Device;
use App\Models\TrackingSetting;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

if (! function_exists('ingestionDeviceUid')) {
    /**
     * The device_uid used by every contract example payload.
     */
    function ingestionDeviceUid(): string
    {
        return 'dev_01K5Y8Q2ZC3M4N5P6R7S8T9V0W';
    }
}

if (! function_exists('ingestionExample')) {
    /**
     * Load a contract example (relative to docs/contracts/examples). Files under invalid/ are unwrapped to their payload.
     *
     * @return array<string, mixed>
     */
    function ingestionExample(string $file): array
    {
        $path = base_path('../docs/contracts/examples/'.$file);
        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        if (str_starts_with($file, 'invalid/')) {
            return $decoded['payload'];
        }

        return $decoded;
    }
}

if (! function_exists('ingestionDevice')) {
    /**
     * Create the device the contract examples belong to and authenticate as it.
     *
     * @param  array<string, mixed>  $attributes
     */
    function ingestionDevice(array $attributes = [], bool $actingAs = true): Device
    {
        $device = Device::factory()->create(array_merge([
            'device_uid' => ingestionDeviceUid(),
            'platform' => 'linux',
            'claude_code_version' => '2.1.260',
            'last_sync_at' => null,
        ], $attributes));

        if ($actingAs) {
            Sanctum::actingAs($device, ['agent']);
        }

        return $device;
    }
}

if (! function_exists('setTrackingCategories')) {
    /**
     * @param  array<string, mixed>  $values  e.g. ['prompt' => true, 'git' => true]
     */
    function setTrackingCategories(array $values): TrackingSetting
    {
        $setting = TrackingSetting::current();
        $setting->fill($values)->save();

        return $setting->refresh();
    }
}

if (! function_exists('syncIso')) {
    /**
     * Contract datetime: ISO-8601 UTC with milliseconds and Z.
     */
    function syncIso(CarbonInterface|string $time): string
    {
        return Carbon::parse($time)->utc()->format('Y-m-d\TH:i:s.v\Z');
    }
}

if (! function_exists('projectKey')) {
    function projectKey(string $name): string
    {
        return hash('sha256', 'project:'.$name);
    }
}

if (! function_exists('accountKey')) {
    function accountKey(string $name): string
    {
        return hash('sha256', 'account:'.$name);
    }
}

if (! function_exists('syncAccount')) {
    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    function syncAccount(string $name, array $overrides = []): array
    {
        return array_merge([
            'account_key' => accountKey($name),
            'account_uuid' => (string) Str::uuid(),
            'email' => $name.'@example.com',
            'display_name' => Str::headline($name),
            'organization_uuid' => null,
            'organization_name' => null,
            'observed_at' => syncIso('2026-09-23T08:00:00Z'),
        ], $overrides);
    }
}

if (! function_exists('syncProject')) {
    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    function syncProject(string $name, array $overrides = []): array
    {
        return array_merge([
            'project_key' => projectKey($name),
            'name' => $name,
            'path' => '/home/dev/work/'.$name,
            'git_remote' => null,
            'first_seen_at' => syncIso('2026-09-23T08:00:00Z'),
            'last_seen_at' => syncIso('2026-09-23T09:00:00Z'),
        ], $overrides);
    }
}

if (! function_exists('syncSession')) {
    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    function syncSession(string $sessionId, array $overrides = []): array
    {
        return array_merge([
            'source_session_id' => $sessionId,
            'project_key' => null,
            'account_key' => null,
            'first_seen_at' => syncIso('2026-09-23T08:00:00Z'),
            'last_seen_at' => syncIso('2026-09-23T09:00:00Z'),
            'ended_at' => null,
            'claude_code_version' => '2.1.274',
            'entrypoint' => 'cli',
            'git_branch' => null,
            'model' => null,
        ], $overrides);
    }
}

if (! function_exists('syncUsage')) {
    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    function syncUsage(string $messageId, string $sessionId, array $overrides = []): array
    {
        return array_merge([
            'source_message_id' => $messageId,
            'source_session_id' => $sessionId,
            'request_id' => null,
            'model' => null,
            'is_sidechain' => false,
            'recorded_at' => syncIso('2026-09-23T08:30:00Z'),
            'input_tokens' => 10,
            'output_tokens' => 20,
            'cache_creation_tokens' => 30,
            'cache_read_tokens' => 40,
        ], $overrides);
    }
}

if (! function_exists('syncMessage')) {
    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    function syncMessage(string $messageId, string $sessionId, array $overrides = []): array
    {
        return array_merge([
            'source_message_id' => $messageId,
            'source_session_id' => $sessionId,
            'role' => 'user',
            'content' => 'Please refactor the login controller.',
            'recorded_at' => syncIso('2026-09-23T08:00:00Z'),
        ], $overrides);
    }
}

if (! function_exists('syncBody')) {
    /**
     * A full, valid sync.request envelope. $records may hold accounts/projects/sessions/usage/messages.
     *
     * @param  array<string, array<int, array<string, mixed>>>  $records
     * @param  array<string, mixed>  $sync
     * @param  array<string, mixed>  $agent
     * @return array<string, mixed>
     */
    function syncBody(array $records = [], array $sync = [], array $agent = []): array
    {
        return [
            'agent' => array_merge([
                'device_id' => ingestionDeviceUid(),
                'platform' => 'linux',
                'platform_version' => '6.8.0-45-generic',
                'architecture' => 'x64',
                'agent_version' => '1.0.0',
                'claude_code_version' => '2.1.274',
            ], $agent),
            'sync' => array_merge([
                'batch_id' => (string) Str::uuid(),
                'cursor' => null,
                'is_initial' => false,
                'settings_version' => 1,
                'sequence' => 1,
            ], $sync),
            'accounts' => $records['accounts'] ?? [],
            'projects' => $records['projects'] ?? [],
            'sessions' => $records['sessions'] ?? [],
            'usage' => $records['usage'] ?? [],
            'messages' => $records['messages'] ?? [],
        ];
    }
}

if (! function_exists('withNewBatchId')) {
    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    function withNewBatchId(array $body): array
    {
        $body['sync']['batch_id'] = (string) Str::uuid();

        return $body;
    }
}

if (! function_exists('postSync')) {
    /**
     * @param  array<string, mixed>  $body
     */
    function postSync(array $body): TestResponse
    {
        return test()->postJson('/api/agent/v1/sync', $body);
    }
}

if (! function_exists('syncRecordTotal')) {
    /**
     * Total number of records in a sync body (the contract's accepted + rejected).
     *
     * @param  array<string, mixed>  $body
     */
    function syncRecordTotal(array $body): int
    {
        return count($body['accounts']) + count($body['projects']) + count($body['sessions'])
            + count($body['usage']) + count($body['messages']);
    }
}

if (! function_exists('decodeSyncCursor')) {
    /**
     * @return array<string, mixed>
     */
    function decodeSyncCursor(string $cursor): array
    {
        $b64 = strtr($cursor, '-_', '+/');
        $b64 .= str_repeat('=', (4 - strlen($b64) % 4) % 4);

        return json_decode((string) base64_decode($b64, true), true, 512, JSON_THROW_ON_ERROR);
    }
}

if (! function_exists('ingestionTableCounts')) {
    /**
     * @return array<string, int>
     */
    function ingestionTableCounts(): array
    {
        $counts = [];

        foreach ([
            'claude_accounts', 'claude_account_device', 'projects', 'project_locations', 'claude_models',
            'claude_sessions', 'session_usage', 'session_messages', 'usage_daily_rollups',
        ] as $table) {
            $counts[$table] = DB::table($table)->count();
        }

        return $counts;
    }
}

if (! function_exists('rollupSnapshot')) {
    /**
     * usage_daily_rollups rows without id/updated_at, in a stable order.
     *
     * @return array<int, array<string, mixed>>
     */
    function rollupSnapshot(): array
    {
        return DB::table('usage_daily_rollups')
            ->orderBy('dims_hash')
            ->get()
            ->map(fn (object $row): array => collect((array) $row)->except(['id', 'updated_at'])->all())
            ->all();
    }
}

if (! function_exists('tokenColumns')) {
    /**
     * @return list<string>
     */
    function tokenColumns(): array
    {
        return [
            'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
            'actual_consumed_tokens', 'total_token_activity',
        ];
    }
}

if (! function_exists('postRawSync')) {
    /**
     * POST a raw (possibly gzip-compressed or malformed) body to /sync.
     *
     * @param  array<string, string>  $server
     */
    function postRawSync(string $content, array $server = []): TestResponse
    {
        return test()->call('POST', '/api/agent/v1/sync', [], [], [], array_merge([
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
        ], $server), $content);
    }
}

if (! function_exists('smallSyncBody')) {
    /**
     * One session with one usage record.
     *
     * @return array<string, mixed>
     */
    function smallSyncBody(): array
    {
        return syncBody([
            'sessions' => [syncSession('guard-session')],
            'usage' => [syncUsage('msg_guard', 'guard-session')],
        ]);
    }
}
