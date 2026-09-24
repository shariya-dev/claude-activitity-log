<?php

use App\Models\AuditLog;
use App\Models\Device;
use App\Models\TrackingSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    $this->admin = User::factory()->admin()->create(['name' => 'Ada Admin']);
});

function auditAt(string $action, string $at, ?User $actor = null, $subject = null, array $metadata = []): AuditLog
{
    test()->travelTo(now()->parse($at));
    $log = AuditLog::record($action, $subject, $metadata, $actor);
    test()->travelBack();

    return $log;
}

test('the audit log lists entries newest first with actor, subject and metadata', function () {
    $device = Device::factory()->create();
    auditAt('device.disabled', '2026-09-01 10:00:00', $this->admin, $device, ['reason' => 'lost']);
    auditAt('retention.pruned', '2026-09-02 10:00:00', null, null, ['session_messages' => 3]);

    $this->actingAs($this->admin)
        ->get(route('audit-logs.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Admin/AuditLogs')
            ->where('logs.per_page', 50)
            ->has('logs.data', 2)
            ->where('logs.data.0.action', 'retention.pruned')
            ->where('logs.data.0.actor', null)
            ->where('logs.data.0.subject', null)
            ->where('logs.data.0.metadata', ['session_messages' => 3])
            ->where('logs.data.1.action', 'device.disabled')
            ->where('logs.data.1.actor', ['id' => $this->admin->id, 'name' => 'Ada Admin'])
            ->where('logs.data.1.subject.type', 'Device')
            ->where('logs.data.1.subject.id', $device->id)
            ->where('logs.data.1.subject.url', route('devices.show', $device))
            ->where('logs.data.1.metadata', ['reason' => 'lost'])
            ->where('options.actions', ['device.disabled', 'retention.pruned'])
            ->where('options.actors', [['id' => $this->admin->id, 'name' => 'Ada Admin']])
            ->where('options.subjectTypes', [['value' => 'Device', 'label' => 'Device']]));
});

test('filters narrow by action, actor, subject type and date range', function (array $query, array $expected) {
    $other = User::factory()->admin()->create(['name' => 'Bo Admin']);
    $device = Device::factory()->create();

    auditAt('device.disabled', '2026-09-01 10:00:00', $this->admin, $device);
    auditAt('tracking.updated', '2026-09-05 10:00:00', $other, TrackingSetting::current());
    auditAt('user.created', '2026-09-10 10:00:00', $this->admin, $other);

    if (($query['actor'] ?? null) === 'self') {
        $query['actor'] = $this->admin->id;
    }

    $this->actingAs($this->admin)
        ->get(route('audit-logs.index', $query))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('logs.data', fn ($rows) => collect($rows)->pluck('action')->all() === $expected));
})->with([
    'action' => [['action' => 'tracking.updated'], ['tracking.updated']],
    'actor' => [['actor' => 'self'], ['user.created', 'device.disabled']],
    'subject type' => [['subject_type' => 'Device'], ['device.disabled']],
    'from' => [['from' => '2026-09-05'], ['user.created', 'tracking.updated']],
    'to' => [['to' => '2026-09-05'], ['tracking.updated', 'device.disabled']],
    'range' => [['from' => '2026-09-02', 'to' => '2026-09-09'], ['tracking.updated']],
]);

test('filters are echoed back', function () {
    $this->actingAs($this->admin)
        ->get(route('audit-logs.index', ['action' => 'x.y', 'actor' => $this->admin->id, 'subject_type' => 'User', 'from' => '2026-09-01', 'to' => '2026-09-02']))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('filters', [
            'action' => 'x.y',
            'actor' => $this->admin->id,
            'subject_type' => 'User',
            'from' => '2026-09-01',
            'to' => '2026-09-02',
        ]));
});

test('invalid filters are rejected', function (array $query) {
    $this->actingAs($this->admin)
        ->get(route('audit-logs.index', $query))
        ->assertSessionHasErrors();
})->with([
    'bad date' => [['from' => 'yesterday']],
    'unknown subject type' => [['subject_type' => 'App\\Models\\User']],
]);

test('the log paginates at 50', function () {
    foreach (range(1, 51) as $i) {
        AuditLog::record('sync.requested', null, [], $this->admin);
    }

    $this->actingAs($this->admin)
        ->get(route('audit-logs.index', ['page' => 2]))
        ->assertInertia(fn (Assert $page) => $page->has('logs.data', 1)->where('logs.total', 51));
});

test('the audit log exposes no update or delete route', function () {
    $methods = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => str_starts_with($route->uri(), 'admin/audit-logs'))
        ->flatMap(fn ($route) => $route->methods())
        ->unique()
        ->sort()
        ->values()
        ->all();

    expect($methods)->toBe(['GET', 'HEAD']);

    $log = AuditLog::record('sync.requested', null, [], $this->admin);
    $this->actingAs($this->admin)->delete('/admin/audit-logs/'.$log->id)->assertNotFound();
    $this->actingAs($this->admin)->delete('/admin/audit-logs')->assertStatus(405);
});
