<?php

namespace App\Http\Controllers\Api\Agent\V1;

use App\Actions\Agent\RegisterDevice;
use App\Actions\Agent\Support\AgentError;
use App\Actions\Agent\Support\InvalidPairingCode;
use App\Http\Controllers\Controller;
use App\Http\Requests\Agent\RegisterRequest;
use App\Http\Resources\Agent\SettingsResource;
use App\Models\TrackingSetting;
use Illuminate\Http\JsonResponse;

class RegisterController extends Controller
{
    public function __invoke(RegisterRequest $request, RegisterDevice $registerDevice): JsonResponse
    {
        /** @var array{pairing_code: string, device: array{hostname: ?string, platform: string, platform_version: ?string, architecture: string, machine_fingerprint: string, agent_version: string, claude_code_version: ?string}} $data */
        $data = $request->validated();

        try {
            ['device' => $device, 'token' => $token] = $registerDevice->handle($data['pairing_code'], $data['device']);
        } catch (InvalidPairingCode) {
            return AgentError::invalidPairingCode();
        }

        return response()->json([
            'device_id' => $device->device_uid,
            'token' => $token,
            'developer' => [
                'name' => $device->developer->name,
                'email' => $device->developer->email,
            ],
            'settings' => (new SettingsResource(TrackingSetting::current(), $device))->resolve($request),
        ], 201);
    }
}
