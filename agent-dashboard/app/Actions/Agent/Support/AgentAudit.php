<?php

namespace App\Actions\Agent\Support;

use App\Models\AuditLog;
use App\Models\Device;
use App\Models\TrackingSetting;
use Illuminate\Http\Request;

/**
 * Audit entries for actions the agent itself triggers (actor = system). The request IP is the
 * developer's public IP, so it is kept only while the Network category is ON (PRD §26, invariant 5).
 */
final class AgentAudit
{
    /**
     * @param  array<string, mixed>  $metadata
     */
    public static function record(string $action, Device $device, array $metadata = []): AuditLog
    {
        $request = app()->bound('request') ? app('request') : null;
        $request = $request instanceof Request ? $request : null;
        $userAgent = $request?->userAgent();

        $log = new AuditLog;
        $log->user_id = null;
        $log->action = $action;
        $log->metadata = $metadata;
        $log->ip_address = TrackingSetting::current()->network ? $request?->ip() : null;
        $log->user_agent = $userAgent === null ? null : mb_substr($userAgent, 0, 255);
        $log->subject()->associate($device);
        $log->save();

        return $log;
    }
}
