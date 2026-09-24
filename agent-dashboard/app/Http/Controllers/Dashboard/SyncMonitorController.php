<?php

namespace App\Http\Controllers\Dashboard;

use App\Enums\DeviceStatus;
use App\Enums\SyncBatchStatus;
use App\Enums\SyncHealth;
use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\SyncBatch;
use App\Models\TrackingSetting;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Sync monitoring (PRD §50): health summary, per-device sync totals and errors, and the
 * failed or rejection-bearing batches of the last 7 days.
 */
class SyncMonitorController extends Controller
{
    private const ERROR_MESSAGE_LIMIT = 200;

    private const FAILURE_DAYS = 7;

    private const FAILURE_LIMIT = 50;

    public function __invoke(Request $request): Response
    {
        Gate::authorize('viewMonitoring');

        $health = SyncHealth::tryFrom((string) $request->query('health'));
        $minVersion = TrackingSetting::current()->min_agent_version;
        $now = CarbonImmutable::now();

        $rows = Device::query()
            ->with(['developer:id,name', 'syncState'])
            ->get()
            ->map(function (Device $device) use ($minVersion, $now): array {
                $identity = DeviceController::identity($device, $minVersion, $now);
                $state = $device->syncState;
                $message = $state?->last_error_message;

                return [
                    'device_uid' => $identity['device_uid'],
                    'hostname' => $identity['hostname'],
                    'developer' => (string) $device->developer?->name,
                    'platform' => $identity['platform'],
                    'agent_version' => $identity['agent_version'],
                    'outdated' => $identity['outdated'],
                    'status' => $identity['status'],
                    'connection' => $identity['connection'],
                    'health' => $identity['health'],
                    'last_seen_at' => $identity['last_seen_at'],
                    'last_success_at' => DeviceController::iso($state?->last_success_at),
                    'last_failure_at' => DeviceController::iso($state?->last_failure_at),
                    'records_created_total' => $state->records_created_total ?? 0,
                    'records_updated_total' => $state->records_updated_total ?? 0,
                    'records_rejected_total' => $state->records_rejected_total ?? 0,
                    'last_error_code' => $state?->last_error_code,
                    'last_error_message' => $message === null ? null : Str::limit($message, self::ERROR_MESSAGE_LIMIT - 3),
                ];
            });

        $counts = ['healthy' => 0, 'offline' => 0, 'sync_failed' => 0, 'disabled' => 0, 'uninstalled' => 0, 'outdated' => 0, 'total' => $rows->count()];

        // As in AgentHealth, only active agents count as outdated; uninstalled ones sit inside "disabled".
        foreach ($rows as $row) {
            $counts[$row['health']]++;
            $isActive = $row['status'] === DeviceStatus::Active->value;
            $counts['uninstalled'] += $row['status'] === DeviceStatus::Uninstalled->value ? 1 : 0;
            $counts['outdated'] += $isActive && $row['outdated'] ? 1 : 0;
        }

        return Inertia::render('Sync/Index', [
            'counts' => $counts,
            'devices' => DeviceController::problemsFirst(
                $rows->filter(fn (array $row): bool => $health === null || $row['health'] === $health->value),
            ),
            'filters' => ['health' => $health?->value],
            'recent_failures' => SyncBatch::query()
                ->with(['device:id,device_uid,hostname,developer_id', 'device.developer:id,name'])
                ->where('received_at', '>=', $now->subDays(self::FAILURE_DAYS))
                ->where(fn (Builder $query) => $query
                    ->where('status', SyncBatchStatus::Failed)
                    ->orWhere('rejected', '>', 0))
                ->latest('received_at')
                ->orderByDesc('id')
                ->limit(self::FAILURE_LIMIT)
                ->get()
                ->map(fn (SyncBatch $batch): array => [
                    ...DeviceController::batch($batch),
                    'device_uid' => (string) $batch->device?->device_uid,
                    'hostname' => $batch->device?->hostname,
                    'developer' => (string) $batch->device?->developer?->name,
                ])
                ->values()
                ->all(),
        ]);
    }
}
