<?php

namespace App\Http\Resources\Agent;

use App\Actions\Agent\Support\AgentTimestamp;
use App\Enums\InitialSyncRange;
use App\Models\Device;
use App\Models\TrackingSetting;
use App\Support\OrgClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The TrackingSettings object for one device (GET /settings, register response).
 * `initial_sync.since` is the device's first_seen_at minus the range, exact (sync-api-v1 §3.2),
 * so it stays stable across re-pairs of the same machine.
 *
 * @property TrackingSetting $resource
 */
class SettingsResource extends JsonResource
{
    /**
     * @var string|null
     */
    public static $wrap = null;

    public function __construct(TrackingSetting $setting, private readonly Device $device)
    {
        parent::__construct($setting);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $payload = $this->resource->toAgentPayload();
        $payload['initial_sync']['since'] = $this->since($this->resource->initial_sync_range);

        return $payload;
    }

    private function since(InitialSyncRange $range): ?string
    {
        $days = match ($range) {
            InitialSyncRange::OneDay => 1,
            InitialSyncRange::SevenDays => 7,
            InitialSyncRange::ThirtyDays => 30,
            InitialSyncRange::All => null,
        };

        if ($days === null) {
            return null;
        }

        $firstSeen = $this->device->first_seen_at === null
            ? OrgClock::now()
            : CarbonImmutable::instance($this->device->first_seen_at);

        return AgentTimestamp::format($firstSeen->subDays($days));
    }
}
