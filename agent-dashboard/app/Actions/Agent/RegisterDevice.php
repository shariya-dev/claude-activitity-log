<?php

namespace App\Actions\Agent;

use App\Actions\Agent\Support\AgentAudit;
use App\Actions\Agent\Support\InvalidPairingCode;
use App\Enums\DeveloperStatus;
use App\Enums\DeviceStatus;
use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\TrackingSetting;
use App\Support\OrgClock;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Redeems a pairing code and issues a device token (PRD §9, sync-api-v1 §3.1).
 * A machine is identified by (developer_id, machine_fingerprint) only; IP and hostname never affect identity.
 */
class RegisterDevice
{
    /**
     * @param  array{hostname: ?string, platform: string, platform_version: ?string, architecture: string, machine_fingerprint: string, agent_version: string, claude_code_version: ?string}  $deviceInfo
     * @return array{device: Device, token: string}
     *
     * @throws InvalidPairingCode
     */
    public function handle(string $code, array $deviceInfo): array
    {
        try {
            return $this->redeem($code, $deviceInfo);
        } catch (UniqueConstraintViolationException) {
            // Two first-time pairings of the same machine raced past the (gap-)locked lookup; the
            // loser's transaction was rolled back, so redeeming again finds the row and re-pairs.
            return $this->redeem($code, $deviceInfo);
        }
    }

    /**
     * @param  array{hostname: ?string, platform: string, platform_version: ?string, architecture: string, machine_fingerprint: string, agent_version: string, claude_code_version: ?string}  $deviceInfo
     * @return array{device: Device, token: string}
     */
    private function redeem(string $code, array $deviceInfo): array
    {
        return DB::transaction(function () use ($code, $deviceInfo): array {
            $pairingCode = PairingCode::query()
                ->where('code_hash', PairingCode::hashCode($code))
                ->lockForUpdate()
                ->first();

            $now = OrgClock::now();
            $developer = $pairingCode?->developer;

            if ($pairingCode === null
                || $pairingCode->used_at !== null
                || $pairingCode->expires_at->lessThanOrEqualTo($now)
                || $developer === null
                || $developer->status !== DeveloperStatus::Active) {
                throw new InvalidPairingCode;
            }

            $attributes = [
                'platform' => $deviceInfo['platform'],
                'platform_version' => $deviceInfo['platform_version'],
                'architecture' => $deviceInfo['architecture'],
                'agent_version' => $deviceInfo['agent_version'],
                'claude_code_version' => $deviceInfo['claude_code_version'],
                'status' => DeviceStatus::Active,
            ];

            // A hostname is only recorded while Device is ON; one already stored is kept as history.
            if (TrackingSetting::current()->device && $deviceInfo['hostname'] !== null) {
                $attributes['hostname'] = $deviceInfo['hostname'];
            }

            $device = Device::query()
                ->where('developer_id', $developer->id)
                ->where('machine_fingerprint', $deviceInfo['machine_fingerprint'])
                ->lockForUpdate()
                ->first();

            if ($device === null) {
                $device = Device::create([
                    ...$attributes,
                    'developer_id' => $developer->id,
                    'machine_fingerprint' => $deviceInfo['machine_fingerprint'],
                    'first_seen_at' => $now,
                ]);

                AgentSyncState::create(['device_id' => $device->id]);
            } else {
                $device->tokens()->delete();
                $device->fill([...$attributes, 'disabled_at' => null, 'uninstalled_at' => null])->save();

                $syncState = AgentSyncState::firstOrCreate(['device_id' => $device->id]);
                if ($syncState->health === SyncHealth::Disabled) {
                    $syncState->update(['health' => SyncHealth::Offline]);
                }

                AgentAudit::record('device.repaired', $device, ['pairing_code_id' => $pairingCode->id]);
            }

            $pairingCode->forceFill(['used_at' => $now, 'used_by_device_id' => $device->id])->save();

            $device->setRelation('developer', $developer);

            return [
                'device' => $device,
                'token' => $device->createToken('agent', ['agent'])->plainTextToken,
            ];
        });
    }
}
