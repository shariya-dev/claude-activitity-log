<?php

namespace App\Http\Controllers\Dashboard;

use App\Actions\Agent\DisableDevice;
use App\Actions\Agent\EnableDevice;
use App\Actions\Agent\IssuePairingCode;
use App\Actions\Agent\RequestManualSync;
use App\Enums\DeveloperStatus;
use App\Enums\DeviceStatus;
use App\Enums\PairingPurpose;
use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;

/**
 * Admin device actions (PRD §11, §51). Each delegates to its H05 action, which records the audit entry.
 */
class DeviceActionController extends Controller
{
    public function disable(Request $request, Device $device, DisableDevice $action): RedirectResponse
    {
        Gate::authorize('manageAgents');

        if ($device->status !== DeviceStatus::Active) {
            return $this->back($device, 'error', 'Only an active device can be disabled.');
        }

        $action->handle($device, $this->user($request));

        return $this->back($device, 'success', 'Device disabled. Its history is kept.');
    }

    public function enable(Request $request, Device $device, EnableDevice $action): RedirectResponse
    {
        Gate::authorize('manageAgents');

        if ($device->status !== DeviceStatus::Disabled) {
            return $this->back($device, 'error', 'Only a disabled device can be enabled.');
        }

        $action->handle($device, $this->user($request));

        return $this->back($device, 'success', 'Device enabled. The agent must be re-paired before it can sync.');
    }

    public function requestSync(Request $request, Device $device, RequestManualSync $action): RedirectResponse
    {
        Gate::authorize('manageAgents');

        if ($device->status !== DeviceStatus::Active) {
            return $this->back($device, 'error', 'Only an active device can be asked to sync.');
        }

        $action->handle($device, $this->user($request));

        return $this->back($device, 'success', 'Sync requested. The agent picks it up at its next heartbeat.');
    }

    public function repairCode(Request $request, Device $device, IssuePairingCode $action): RedirectResponse
    {
        Gate::authorize('manageAgents');

        $developer = $device->developer;

        if ($developer === null || $developer->trashed() || $developer->status !== DeveloperStatus::Active) {
            return $this->back($device, 'error', 'The developer of this device is inactive, so a re-pair code cannot be used.');
        }

        $code = $action->handle($developer, $this->user($request), PairingPurpose::Repair);

        return $this->back($device, 'success', 'Re-pair code generated.')->with('pairing_code', $code);
    }

    private function user(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return $user;
    }

    private function back(Device $device, string $type, string $message): RedirectResponse
    {
        Inertia::flash('toast', ['type' => $type, 'message' => $message]);

        return to_route('devices.show', $device);
    }
}
