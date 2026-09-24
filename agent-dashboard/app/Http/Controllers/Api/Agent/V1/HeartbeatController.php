<?php

namespace App\Http\Controllers\Api\Agent\V1;

use App\Actions\Agent\RecordHeartbeat;
use App\Actions\Agent\Support\AgentError;
use App\Actions\Agent\Support\AgentVersion;
use App\Actions\Agent\Support\CurrentDevice;
use App\Http\Controllers\Controller;
use App\Http\Requests\Agent\HeartbeatRequest;
use App\Models\TrackingSetting;
use Illuminate\Http\JsonResponse;

class HeartbeatController extends Controller
{
    public function __invoke(HeartbeatRequest $request, RecordHeartbeat $recordHeartbeat): JsonResponse
    {
        /** @var array{agent_version: string, claude_code_version: ?string, platform_version: ?string, hostname: ?string, agent_state: string, last_local_activity_at: ?string, last_successful_sync_at: ?string, last_error: ?string} $data */
        $data = $request->validated();

        $result = $recordHeartbeat->handle(CurrentDevice::of($request), $data, $request->ip());

        // Status is persisted first so an outdated device shows as Outdated, not Offline (sync-api-v1 §3.3).
        $minAgentVersion = TrackingSetting::current()->min_agent_version;
        if (AgentVersion::isOutdated($data['agent_version'], $minAgentVersion)) {
            return AgentError::agentOutdated($minAgentVersion);
        }

        return response()->json($result);
    }
}
