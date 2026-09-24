<?php

use App\Enums\DeviceStatus;
use App\Models\AuditLog;
use App\Models\ClaudeSession;
use App\Models\Device;
use App\Models\TrackingSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

const DEREGISTER_URL = '/api/agent/v1/deregister';

test('deregister uninstalls the device, revokes its tokens and keeps its history', function () {
    $this->travelTo(now()->parse('2026-09-23T10:00:00Z'));
    $device = Device::factory()->create();
    $sessions = ClaudeSession::factory()->count(2)->for($device)->create();
    $headers = ContractExamples::agentHeaders($device);
    $device->createToken('agent', ['agent']);

    $this->postJson(DEREGISTER_URL, [], $headers)
        ->assertNoContent()
        ->assertHeader('X-Settings-Version', '1');

    $device->refresh();
    expect($device->status)->toBe(DeviceStatus::Uninstalled)
        ->and($device->uninstalled_at?->toIso8601ZuluString())->toBe('2026-09-23T10:00:00Z')
        ->and($device->tokens()->count())->toBe(0)
        ->and(ClaudeSession::where('device_id', $device->id)->pluck('id')->all())->toEqualCanonicalizing($sessions->pluck('id')->all());

    $audit = AuditLog::where('action', 'device.uninstalled')->sole();
    expect($audit->subject_id)->toBe($device->id)
        ->and($audit->user_id)->toBeNull();

    $this->app['auth']->forgetGuards();
    $this->postJson(DEREGISTER_URL, [], $headers)->assertUnauthorized();
});

test('a disabled device can still deregister', function () {
    $device = Device::factory()->disabled()->create();

    $this->postJson(DEREGISTER_URL, [], ContractExamples::agentHeaders($device))->assertNoContent();

    expect($device->fresh()->status)->toBe(DeviceStatus::Uninstalled);
});

test('deregister never returns 426', function () {
    $setting = TrackingSetting::current();
    $setting->min_agent_version = '9.0.0';
    $setting->save();

    $this->postJson(DEREGISTER_URL, [], ContractExamples::agentHeaders(Device::factory()->create(), '1.0.0'))
        ->assertNoContent();
});
