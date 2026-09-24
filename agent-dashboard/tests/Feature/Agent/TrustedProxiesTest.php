<?php

use App\Models\Device;
use App\Models\TrackingSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Env;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

/*
| X-Forwarded-For is honoured only from the proxies in MONITOR_TRUSTED_PROXIES (config
| monitor.trusted_proxies); the default trusts none (e2e F4). Observed through the Network
| category, which stores the request IP on each heartbeat.
*/

/**
 * Rebuilds the application with MONITOR_TRUSTED_PROXIES set, as a deployment would boot it.
 * The database is refreshed on the new application so the test stays isolated.
 */
function bootWithTrustedProxies(?string $value): void
{
    setTrustedProxiesEnv($value);

    test()->refreshApplication();
    test()->refreshDatabase();
}

/**
 * Sets (or clears) MONITOR_TRUSTED_PROXIES as a real process variable, so a `.env` value (even the
 * empty `MONITOR_TRUSTED_PROXIES=` line from `.env.example`) cannot shadow it. The key is first
 * cleared from the shared env repository: dotenv overwrites variables it loaded itself on the next
 * boot, but never an externally defined one.
 */
function setTrustedProxiesEnv(?string $value): void
{
    Env::getRepository()->clear('MONITOR_TRUSTED_PROXIES');

    if ($value === null) {
        putenv('MONITOR_TRUSTED_PROXIES');
        unset($_ENV['MONITOR_TRUSTED_PROXIES'], $_SERVER['MONITOR_TRUSTED_PROXIES']);

        return;
    }

    putenv('MONITOR_TRUSTED_PROXIES='.$value);
    $_ENV['MONITOR_TRUSTED_PROXIES'] = $value;
    $_SERVER['MONITOR_TRUSTED_PROXIES'] = $value;
}

/**
 * Sends a heartbeat from `$remoteAddr` claiming `$forwardedFor`, with Network ON, and returns the stored IP.
 */
function heartbeatIpVia(string $remoteAddr, string $forwardedFor): ?string
{
    $setting = TrackingSetting::current();
    $setting->network = true;
    $setting->bumpVersion();
    $setting->save();
    $device = Device::factory()->create();

    test()->withServerVariables(['REMOTE_ADDR' => $remoteAddr])
        ->postJson(
            '/api/agent/v1/heartbeat',
            ContractExamples::load('heartbeat.request'),
            ContractExamples::agentHeaders($device) + ['X-Forwarded-For' => $forwardedFor],
        )
        ->assertOk();

    return $device->fresh()?->last_public_ip;
}

afterEach(function () {
    setTrustedProxiesEnv(null);
});

test('the default trusts no proxy, so X-Forwarded-For is ignored', function () {
    expect(config('monitor.trusted_proxies'))->toBe('')
        ->and(heartbeatIpVia('10.0.0.5', '203.0.113.10'))->toBe('10.0.0.5');
});

test('X-Forwarded-For is honoured from a configured proxy', function () {
    bootWithTrustedProxies('10.0.0.5, 10.0.0.6');

    expect(config('monitor.trusted_proxies'))->toBe('10.0.0.5, 10.0.0.6')
        ->and(heartbeatIpVia('10.0.0.6', '203.0.113.10'))->toBe('203.0.113.10');
});

test('X-Forwarded-For is ignored from a proxy that is not configured', function () {
    bootWithTrustedProxies('10.0.0.5');

    expect(heartbeatIpVia('198.51.100.20', '203.0.113.10'))->toBe('198.51.100.20');
});

test('a wildcard trusts every proxy', function () {
    bootWithTrustedProxies('*');

    expect(heartbeatIpVia('198.51.100.20', '203.0.113.10'))->toBe('203.0.113.10');
});
