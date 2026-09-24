<?php

namespace App\Actions\Tracking;

use App\Enums\InitialSyncRange;
use App\Enums\TrackingCategory;
use App\Models\AuditLog;
use App\Models\TrackingSetting;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Applies an admin's tracking-settings change: one version bump per effective change, audited with a before/after diff.
 *
 * Agents pick the change up through the bumped version (X-Settings-Version, GET /settings).
 */
class UpdateTrackingSettings
{
    /**
     * @param  array{session: bool, usage: bool, project: bool, model: bool, device: bool, account: bool, prompt: bool, git: bool, network: bool, initial_sync_range: string, sync_interval_seconds: int, heartbeat_interval_seconds: int, min_agent_version: string, retention_days: int|null}  $data
     */
    public function handle(array $data, User $by): TrackingSetting
    {
        return DB::transaction(function () use ($data, $by): TrackingSetting {
            $settings = TrackingSetting::current(lockForUpdate: true);
            $before = $this->snapshot($settings);

            $settings->fill([
                ...array_intersect_key($data, $before),
                'initial_sync_range' => InitialSyncRange::from($data['initial_sync_range']),
            ]);

            $after = $this->snapshot($settings);
            $changed = array_keys(array_diff_assoc(
                array_map(fn (mixed $value): string => var_export($value, true), $after),
                array_map(fn (mixed $value): string => var_export($value, true), $before),
            ));

            if ($changed === []) {
                return $settings;
            }

            $fromVersion = $settings->version;
            $settings->bumpVersion();
            $settings->updated_by_user_id = $by->id;
            $settings->save();

            $changes = array_flip($changed);

            AuditLog::record('tracking.updated', $settings, [
                'version' => ['from' => $fromVersion, 'to' => $settings->version],
                'before' => array_intersect_key($before, $changes),
                'after' => array_intersect_key($after, $changes),
            ], $by);

            if (isset($changes[TrackingCategory::Prompt->value])) {
                AuditLog::record($after['prompt'] ? 'prompt_tracking.enabled' : 'prompt_tracking.disabled', $settings, [
                    'version' => $settings->version,
                ], $by);
            }

            if (isset($changes['retention_days'])) {
                AuditLog::record('retention.updated', $settings, [
                    'from' => $before['retention_days'],
                    'to' => $after['retention_days'],
                ], $by);
            }

            return $settings;
        });
    }

    /**
     * The admin-editable values, in a stable order and plain scalar form (for diffing and audit metadata).
     *
     * @return array<string, bool|int|string|null>
     */
    private function snapshot(TrackingSetting $settings): array
    {
        $snapshot = [];

        foreach (TrackingCategory::cases() as $category) {
            $snapshot[$category->value] = $settings->enabled($category);
        }

        return $snapshot + [
            'initial_sync_range' => $settings->initial_sync_range->value,
            'sync_interval_seconds' => (int) $settings->sync_interval_seconds,
            'heartbeat_interval_seconds' => (int) $settings->heartbeat_interval_seconds,
            'min_agent_version' => $settings->min_agent_version,
            'retention_days' => $settings->retention_days === null ? null : (int) $settings->retention_days,
        ];
    }
}
