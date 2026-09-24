<?php

namespace App\Http\Middleware;

use App\Models\TrackingSetting;
use App\Support\OrgClock;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Adds X-Settings-Version and X-Server-Time to agent API responses.
 */
class AttachSettingsVersion
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Settings-Version', (string) TrackingSetting::current()->version);
        $response->headers->set('X-Server-Time', OrgClock::now()->format('Y-m-d\TH:i:s\Z'));

        return $response;
    }
}
