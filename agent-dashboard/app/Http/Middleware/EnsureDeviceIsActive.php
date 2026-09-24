<?php

namespace App\Http\Middleware;

use App\Enums\DeviceStatus;
use App\Models\Device;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Agent API guard: the authenticated tokenable must be an active Device.
 */
class EnsureDeviceIsActive
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $device = $request->user('sanctum');

        if (! $device instanceof Device) {
            return $this->error(401, 'unauthenticated', 'A valid device token is required.');
        }

        return match ($device->status) {
            DeviceStatus::Disabled => $this->error(403, 'device_disabled', 'This device has been disabled by an administrator.'),
            DeviceStatus::Uninstalled => $this->error(403, 'device_uninstalled', 'This device has been uninstalled. Pair it again to resume syncing.'),
            DeviceStatus::Active => $next($request),
        };
    }

    private function error(int $status, string $code, string $message): JsonResponse
    {
        return response()->json([
            'success' => false,
            'error' => [
                'code' => $code,
                'message' => $message,
                'retryable' => false,
            ],
        ], $status);
    }
}
