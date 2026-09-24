<?php

namespace App\Http\Controllers\Dashboard;

use App\Enums\ConnectionState;
use App\Enums\DeviceStatus;
use App\Enums\SyncHealth;
use App\Http\Controllers\Controller;
use App\Models\ClaudeAccount;
use App\Models\Device;
use App\Models\SyncBatch;
use App\Models\TrackingSetting;
use App\Queries\Analytics\ActivityStats;
use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\FilterOptions;
use App\Queries\Analytics\TokenAnalytics;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Device list and detail (PRD §11, §49). Connection state is derived from last_seen_at and
 * sync health follows AgentHealth: a recorded sync failure wins, then a derived offline
 * connection, else healthy; disabled and uninstalled devices report "disabled".
 * Never exposes tokens, the machine fingerprint or the public IP.
 */
class DeviceController extends Controller
{
    public function index(Request $request, FilterOptions $filterOptions): Response
    {
        Gate::authorize('viewMonitoring');

        $platforms = self::platforms();
        $filters = [
            'platform' => self::enumQuery($request, 'platform', $platforms),
            'status' => DeviceStatus::tryFrom((string) $request->query('status')),
            'connection' => ConnectionState::tryFrom((string) $request->query('connection')),
            'outdated' => match ($request->query('outdated')) {
                '1' => true,
                '0' => false,
                default => null,
            },
            'developer' => self::positiveId($request->query('developer')),
        ];

        $minVersion = TrackingSetting::current()->min_agent_version;
        $now = CarbonImmutable::now();

        $devices = Device::query()
            ->with(['developer:id,name', 'syncState:id,device_id,health'])
            ->when($filters['platform'], fn ($query, string $platform) => $query->where('platform', $platform))
            ->when($filters['status'], fn ($query, DeviceStatus $status) => $query->where('status', $status))
            ->when($filters['developer'], fn ($query, int $developer) => $query->where('developer_id', $developer))
            ->get()
            ->map(fn (Device $device): array => [
                ...self::identity($device, $minVersion, $now),
                'developer' => ['id' => $device->developer_id, 'name' => (string) $device->developer?->name],
            ])
            ->filter(fn (array $row): bool => ($filters['connection'] === null || $row['connection'] === $filters['connection']->value)
                && ($filters['outdated'] === null || $row['outdated'] === $filters['outdated']));

        return Inertia::render('Devices/Index', [
            'devices' => self::problemsFirst($devices),
            'filters' => [
                'platform' => $filters['platform'],
                'status' => $filters['status']?->value,
                'connection' => $filters['connection']?->value,
                'outdated' => $filters['outdated'],
                'developer' => $filters['developer'],
            ],
            'options' => [
                'platforms' => $platforms,
                'developers' => $filterOptions->for([Dimension::Developer])[Dimension::Developer->value],
            ],
            'min_agent_version' => $minVersion,
        ]);
    }

    public function show(Request $request, Device $device, TokenAnalytics $tokens, ActivityStats $activity): Response
    {
        Gate::authorize('viewMonitoring');

        if ($request->session()->has('pairing_code')) {
            // The one-time re-pair code travels in props; keep it out of plaintext browser history.
            Inertia::encryptHistory();
        }

        $device->load(['developer', 'syncState']);
        $minVersion = TrackingSetting::current()->min_agent_version;
        $usage = new UsageFilters(DateRange::fromRequest($request, 'month'), deviceId: $device->id);
        $state = $device->syncState;

        return Inertia::render('Devices/Show', [
            'device' => [
                ...self::identity($device, $minVersion, CarbonImmutable::now()),
                'developer' => [
                    'id' => $device->developer_id,
                    'name' => (string) $device->developer?->name,
                    'email' => (string) $device->developer?->email,
                    'deleted' => $device->developer?->trashed() ?? false,
                ],
                'agent_state' => $device->agent_state,
                'first_seen_at' => self::iso($device->first_seen_at),
                'last_local_activity_at' => self::iso($device->last_local_activity_at),
                'sync_requested_at' => self::iso($device->sync_requested_at),
                'disabled_at' => self::iso($device->disabled_at),
                'uninstalled_at' => self::iso($device->uninstalled_at),
            ],
            'sync_state' => $state === null ? null : [
                'last_success_at' => self::iso($state->last_success_at),
                'last_failure_at' => self::iso($state->last_failure_at),
                'last_error_code' => $state->last_error_code,
                'last_error_message' => $state->last_error_message,
                'consecutive_failures' => $state->consecutive_failures,
                'records_created_total' => $state->records_created_total,
                'records_updated_total' => $state->records_updated_total,
                'records_rejected_total' => $state->records_rejected_total,
            ],
            'accounts' => $device->claudeAccounts()
                ->orderByDesc('claude_account_device.last_seen_at')
                ->get()
                ->map(fn (ClaudeAccount $account): array => [
                    'id' => $account->id,
                    'email' => $account->email,
                    'display_name' => $account->display_name,
                    'organization_name' => $account->organization_name,
                    'first_seen_at' => self::pivotIso($account, 'first_seen_at'),
                    'last_seen_at' => self::pivotIso($account, 'last_seen_at'),
                ])
                ->values()
                ->all(),
            'range' => $usage->range->toArray(),
            'totals' => $tokens->totals($usage),
            'trend' => $tokens->trend($usage),
            'recent_sessions' => $activity->recentSessions($usage),
            'batches' => $device->syncBatches()
                ->latest('received_at')
                ->orderByDesc('id')
                ->limit(20)
                ->get()
                ->map(fn (SyncBatch $batch): array => self::batch($batch))
                ->values()
                ->all(),
            'min_agent_version' => $minVersion,
        ]);
    }

    /**
     * The identity, version and health fields shared by the device list, detail and sync monitor rows.
     *
     * @return array{device_uid: string, hostname: string|null, platform: string, platform_version: string|null, architecture: string|null, agent_version: string|null, outdated: bool, claude_code_version: string|null, status: string, connection: string, health: string, last_seen_at: string|null, last_sync_at: string|null}
     */
    public static function identity(Device $device, string $minAgentVersion, CarbonInterface $now): array
    {
        $connection = ConnectionState::fromLastSeen($device->last_seen_at, $now);

        return [
            'device_uid' => $device->device_uid,
            'hostname' => $device->hostname,
            'platform' => $device->platform,
            'platform_version' => $device->platform_version,
            'architecture' => $device->architecture,
            'agent_version' => $device->agent_version,
            'outdated' => $device->agent_version !== null
                && version_compare(ltrim($device->agent_version, 'vV'), ltrim($minAgentVersion, 'vV'), '<'),
            'claude_code_version' => $device->claude_code_version,
            'status' => $device->status->value,
            'connection' => $connection->value,
            'health' => self::health($device, $connection)->value,
            'last_seen_at' => self::iso($device->last_seen_at),
            'last_sync_at' => self::iso($device->last_sync_at),
        ];
    }

    /**
     * Problems first: sync failed, offline, stale, outdated, healthy, then disabled and uninstalled;
     * ties broken by the oldest last_seen_at (never seen first).
     *
     * @template TRow of array{status: string, connection: string, health: string, outdated: bool, last_seen_at: string|null}
     *
     * @param  Collection<int, TRow>  $rows
     * @return list<TRow>
     */
    public static function problemsFirst(Collection $rows): array
    {
        $rank = fn (array $row): int => match (true) {
            $row['status'] === DeviceStatus::Uninstalled->value => 6,
            $row['status'] === DeviceStatus::Disabled->value => 5,
            $row['health'] === SyncHealth::SyncFailed->value => 0,
            $row['connection'] === ConnectionState::Offline->value => 1,
            $row['connection'] === ConnectionState::Stale->value => 2,
            $row['outdated'] => 3,
            default => 4,
        };

        return $rows->sort(fn (array $a, array $b): int => [$rank($a), $a['last_seen_at'] !== null, $a['last_seen_at']]
            <=> [$rank($b), $b['last_seen_at'] !== null, $b['last_seen_at']])
            ->values()
            ->all();
    }

    /**
     * @return array{id: int, batch_uuid: string, status: string, is_initial: bool, accepted: int, created: int, updated: int, rejected: int, rejections: list<array{type: string, source_id: string|null, reason: string}>, error_code: string|null, payload_bytes: int, duration_ms: int, received_at: string|null, completed_at: string|null}
     */
    public static function batch(SyncBatch $batch): array
    {
        return [
            'id' => $batch->id,
            'batch_uuid' => $batch->batch_uuid,
            'status' => $batch->status->value,
            'is_initial' => $batch->is_initial,
            'accepted' => $batch->accepted,
            'created' => $batch->created,
            'updated' => $batch->updated,
            'rejected' => $batch->rejected,
            'rejections' => array_values(array_map(fn (array $rejection): array => [
                'type' => (string) ($rejection['type'] ?? ''),
                'source_id' => isset($rejection['source_id']) ? (string) $rejection['source_id'] : null,
                'reason' => (string) ($rejection['reason'] ?? ''),
            ], $batch->rejections ?? [])),
            'error_code' => $batch->error_code,
            'payload_bytes' => $batch->payload_bytes,
            'duration_ms' => $batch->duration_ms,
            'received_at' => self::iso($batch->received_at),
            'completed_at' => self::iso($batch->completed_at),
        ];
    }

    public static function iso(?CarbonInterface $timestamp): ?string
    {
        return $timestamp?->copy()->utc()->format('Y-m-d\TH:i:s\Z');
    }

    /**
     * Pivot timestamps are not cast, so they arrive as UTC strings.
     */
    private static function pivotIso(ClaudeAccount $account, string $column): ?string
    {
        $value = $account->getAttribute('pivot')?->getAttribute($column);

        return $value === null ? null : self::iso(CarbonImmutable::parse((string) $value, 'UTC'));
    }

    private static function health(Device $device, ConnectionState $connection): SyncHealth
    {
        if ($device->status !== DeviceStatus::Active) {
            return SyncHealth::Disabled;
        }

        if ($device->syncState?->health === SyncHealth::SyncFailed) {
            return SyncHealth::SyncFailed;
        }

        return $connection === ConnectionState::Offline ? SyncHealth::Offline : SyncHealth::Healthy;
    }

    /**
     * Configured platforms plus any other platform a device has reported.
     *
     * @return list<string>
     */
    private static function platforms(): array
    {
        /** @var list<string> $configured */
        $configured = config('monitor.platforms');

        return collect($configured)
            ->merge(Device::query()->distinct()->pluck('platform'))
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $allowed
     */
    private static function enumQuery(Request $request, string $key, array $allowed): ?string
    {
        $value = $request->query($key);

        return is_string($value) && in_array($value, $allowed, true) ? $value : null;
    }

    private static function positiveId(mixed $value): ?int
    {
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $id === false ? null : $id;
    }
}
