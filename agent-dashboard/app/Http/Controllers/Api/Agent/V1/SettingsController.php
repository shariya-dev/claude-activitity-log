<?php

namespace App\Http\Controllers\Api\Agent\V1;

use App\Actions\Agent\Support\AgentError;
use App\Actions\Agent\Support\AgentVersion;
use App\Actions\Agent\Support\CurrentDevice;
use App\Http\Controllers\Controller;
use App\Http\Resources\Agent\SettingsResource;
use App\Models\TrackingSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingsController extends Controller
{
    public function __invoke(Request $request): JsonResponse|SettingsResource
    {
        $device = CurrentDevice::of($request);
        $settings = TrackingSetting::current();

        $agentVersion = $request->header('X-Agent-Version') ?: $device->agent_version;
        if (AgentVersion::isOutdated($agentVersion, $settings->min_agent_version)) {
            return AgentError::agentOutdated($settings->min_agent_version);
        }

        return new SettingsResource($settings, $device);
    }
}
