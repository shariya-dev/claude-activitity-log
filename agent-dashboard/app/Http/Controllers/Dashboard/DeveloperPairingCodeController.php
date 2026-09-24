<?php

namespace App\Http\Controllers\Dashboard;

use App\Actions\Agent\IssuePairingCode;
use App\Enums\DeveloperStatus;
use App\Http\Controllers\Controller;
use App\Models\Developer;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * Issues a one-time pairing code and always returns to the developer page, the only page that displays it. The plaintext only travels through the session flash to the
 * next page load; it is never persisted, logged or put in the audit trail.
 */
class DeveloperPairingCodeController extends Controller
{
    public function store(Request $request, Developer $developer, IssuePairingCode $issuePairingCode): RedirectResponse
    {
        if ($developer->status !== DeveloperStatus::Active) {
            return to_route('developers.show', $developer)->with('error', 'Reactivate this developer before generating a pairing code.');
        }

        /** @var User $user */
        $user = $request->user();

        return to_route('developers.show', $developer)->with('pairing_code', $issuePairingCode->handle($developer, $user));
    }
}
