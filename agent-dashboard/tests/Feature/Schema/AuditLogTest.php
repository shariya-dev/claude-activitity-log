<?php

use App\Models\AuditLog;
use App\Models\Device;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;

uses(RefreshDatabase::class);

beforeEach(function () {
    Route::middleware('web')->post('/_test/audit/{device}', function (Device $device) {
        $log = AuditLog::record('device.disabled', $device, ['reason' => 'lost laptop']);

        return response()->json(['id' => $log->id]);
    });
});

test('record stores action, subject, metadata, actor, ip and user agent from the request', function () {
    $user = User::factory()->admin()->create();
    $device = Device::factory()->create();

    $response = $this->actingAs($user)
        ->withHeader('User-Agent', 'Mozilla/5.0 AuditTest')
        ->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
        ->postJson("/_test/audit/{$device->device_uid}");

    $response->assertOk();

    $log = AuditLog::findOrFail($response->json('id'));

    expect($log->action)->toBe('device.disabled')
        ->and($log->user_id)->toBe($user->id)
        ->and($log->subject_type)->toBe($device->getMorphClass())
        ->and($log->subject_id)->toBe($device->id)
        ->and($log->subject->is($device))->toBeTrue()
        ->and($log->user->is($user))->toBeTrue()
        ->and($log->metadata)->toBe(['reason' => 'lost laptop'])
        ->and($log->ip_address)->toBe('203.0.113.7')
        ->and($log->user_agent)->toBe('Mozilla/5.0 AuditTest')
        ->and($log->created_at)->not->toBeNull();
});

test('long user agents are truncated to 255 characters', function () {
    $user = User::factory()->create();
    $device = Device::factory()->create();

    $response = $this->actingAs($user)
        ->withHeader('User-Agent', str_repeat('a', 400))
        ->postJson("/_test/audit/{$device->device_uid}");

    expect(AuditLog::findOrFail($response->json('id'))->user_agent)->toHaveLength(255);
});

test('actor defaults to the authenticated user', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $log = AuditLog::record('tracking.updated');

    expect($log->user_id)->toBe($user->id);
});

test('an explicit actor overrides the authenticated user', function () {
    $this->actingAs(User::factory()->create());
    $actor = User::factory()->admin()->create();

    $log = AuditLog::record('user.role_changed', null, [], $actor);

    expect($log->user_id)->toBe($actor->id);
});

test('record works without an actor or subject (system)', function () {
    $log = AuditLog::record('retention.updated', null, ['days' => 90]);

    expect($log->exists)->toBeTrue()
        ->and($log->user_id)->toBeNull()
        ->and($log->subject_type)->toBeNull()
        ->and($log->subject_id)->toBeNull()
        ->and($log->fresh()->metadata)->toBe(['days' => 90]);
});

test('audit logs cannot be updated', function () {
    $log = AuditLog::record('tracking.updated');

    $log->update(['action' => 'tampered']);
})->throws(LogicException::class, 'Audit logs are append-only.');

test('audit logs cannot be deleted', function () {
    $log = AuditLog::record('tracking.updated');

    $log->delete();
})->throws(LogicException::class, 'Audit logs are append-only.');

test('audit logs cannot be mass updated through the query builder', function () {
    AuditLog::record('tracking.updated');

    AuditLog::query()->update(['action' => 'tampered']);
})->throws(LogicException::class, 'Audit logs are append-only.');

test('audit logs cannot be mass deleted through the query builder', function () {
    AuditLog::record('tracking.updated');

    AuditLog::where('action', 'tracking.updated')->delete();
})->throws(LogicException::class, 'Audit logs are append-only.');

test('audit logs cannot be force deleted, upserted or incremented through the query builder', function (string $method, array $arguments) {
    AuditLog::record('tracking.updated');

    expect(fn () => AuditLog::query()->{$method}(...$arguments))->toThrow(LogicException::class, 'Audit logs are append-only.')
        ->and(AuditLog::where('action', 'tracking.updated')->count())->toBe(1);
})->with([
    'forceDelete' => ['forceDelete', []],
    'upsert' => ['upsert', [[['id' => 1, 'action' => 'x']], ['id'], ['action']]],
    'increment' => ['increment', ['id']],
    'touch' => ['touch', []],
]);

test('audit logs can still be inserted and created', function () {
    AuditLog::query()->insert(['action' => 'sync.requested', 'metadata' => '[]']);
    AuditLog::create(['action' => 'device.disabled', 'metadata' => []]);

    expect(AuditLog::count())->toBe(2);
});
