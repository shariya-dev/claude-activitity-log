<?php

use App\Enums\InitialSyncRange;
use App\Models\AuditLog;
use App\Models\Device;
use App\Models\TrackingSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    $this->admin = User::factory()->admin()->create();
});

function trackingPayload(array $overrides = []): array
{
    return array_merge([
        'session' => true,
        'usage' => true,
        'project' => true,
        'model' => true,
        'device' => true,
        'account' => true,
        'prompt' => false,
        'git' => false,
        'network' => false,
        'initial_sync_range' => '7d',
        'sync_interval_seconds' => 120,
        'heartbeat_interval_seconds' => 300,
        'min_agent_version' => '1.0.0',
        'retention_days' => null,
        'prompt_confirmed' => false,
    ], $overrides);
}

test('the edit page renders the defaults with prompt, git and network off (AC28)', function () {
    $this->actingAs($this->admin)
        ->get(route('tracking-settings.edit'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Admin/TrackingSettings')
            ->where('settings.categories', [
                'session' => true, 'usage' => true, 'project' => true, 'model' => true, 'device' => true,
                'account' => true, 'prompt' => false, 'git' => false, 'network' => false,
            ])
            ->where('settings.initial_sync_range', '7d')
            ->where('settings.sync_interval_seconds', 120)
            ->where('settings.heartbeat_interval_seconds', 300)
            ->where('settings.min_agent_version', '1.0.0')
            ->where('settings.retention_days', null)
            ->where('settings.version', 1)
            ->has('categories', 9)
            ->where('categories.6.key', 'prompt')
            ->where('categories.6.default', false)
            ->has('initialSyncRanges', 4)
            ->where('limits', ['interval_min' => 60, 'interval_max' => 3600, 'retention_min' => 30]));
});

test('an update bumps the version, audits the diff and reaches agents (AC27)', function () {
    $device = Device::factory()->create();

    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload([
            'git' => true,
            'initial_sync_range' => '30d',
            'sync_interval_seconds' => 600,
        ]))
        ->assertRedirect(route('tracking-settings.edit'))
        ->assertSessionHasNoErrors();

    $settings = TrackingSetting::current();
    expect($settings->version)->toBe(2)
        ->and($settings->git)->toBeTrue()
        ->and($settings->initial_sync_range)->toBe(InitialSyncRange::ThirtyDays)
        ->and($settings->updated_by_user_id)->toBe($this->admin->id);

    $audit = AuditLog::query()->where('action', 'tracking.updated')->sole();
    expect($audit->user_id)->toBe($this->admin->id)
        ->and($audit->subject_type)->toBe(TrackingSetting::class)
        ->and($audit->metadata)->toEqual([
            'version' => ['from' => 1, 'to' => 2],
            'before' => ['git' => false, 'initial_sync_range' => '7d', 'sync_interval_seconds' => 120],
            'after' => ['git' => true, 'initial_sync_range' => '30d', 'sync_interval_seconds' => 600],
        ]);

    Sanctum::actingAs($device, ['agent']);
    $this->getJson('/api/agent/v1/settings', ['X-Agent-Version' => '1.0.0'])
        ->assertOk()
        ->assertHeader('X-Settings-Version', '2')
        ->assertJsonPath('version', 2)
        ->assertJsonPath('categories.git', true)
        ->assertJsonPath('initial_sync.range', '30d')
        ->assertJsonPath('sync_interval_seconds', 600);
});

test('every change bumps the version again', function () {
    $this->actingAs($this->admin)->put(route('tracking-settings.update'), trackingPayload(['usage' => false]));
    $this->actingAs($this->admin)->put(route('tracking-settings.update'), trackingPayload(['usage' => true]));

    expect(TrackingSetting::current()->version)->toBe(3)
        ->and(AuditLog::query()->where('action', 'tracking.updated')->count())->toBe(2);
});

test('saving without changes neither bumps the version nor audits', function () {
    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload())
        ->assertRedirect(route('tracking-settings.edit'));

    expect(TrackingSetting::current()->version)->toBe(1)
        ->and(AuditLog::query()->count())->toBe(0);
});

test('enabling prompt tracking requires the explicit confirmation', function () {
    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload(['prompt' => true]))
        ->assertSessionHasErrors('prompt_confirmed');

    expect(TrackingSetting::current()->prompt)->toBeFalse()
        ->and(TrackingSetting::current()->version)->toBe(1);
});

test('confirmed prompt enable is audited separately, and so is disabling it', function () {
    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload(['prompt' => true, 'prompt_confirmed' => true]))
        ->assertSessionHasNoErrors();

    expect(TrackingSetting::current()->prompt)->toBeTrue()
        ->and(AuditLog::query()->where('action', 'prompt_tracking.enabled')->sole()->user_id)->toBe($this->admin->id);

    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload(['prompt' => false]))
        ->assertSessionHasNoErrors();

    expect(TrackingSetting::current()->prompt)->toBeFalse()
        ->and(AuditLog::query()->where('action', 'prompt_tracking.disabled')->count())->toBe(1)
        ->and(TrackingSetting::current()->version)->toBe(3);
});

test('keeping prompt on does not require re-confirmation', function () {
    TrackingSetting::current()->forceFill(['prompt' => true])->save();

    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload(['prompt' => true, 'git' => true]))
        ->assertSessionHasNoErrors();

    expect(AuditLog::query()->whereLike('action', 'prompt_tracking.%')->count())->toBe(0);
});

test('a retention change writes a retention.updated audit', function () {
    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload(['retention_days' => 90]))
        ->assertSessionHasNoErrors();

    expect(TrackingSetting::current()->retention_days)->toBe(90);

    $audit = AuditLog::query()->where('action', 'retention.updated')->sole();
    expect($audit->metadata)->toEqual(['from' => null, 'to' => 90]);
});

test('invalid values are rejected', function (array $overrides, string $field) {
    $this->actingAs($this->admin)
        ->put(route('tracking-settings.update'), trackingPayload($overrides))
        ->assertSessionHasErrors($field);

    expect(TrackingSetting::current()->version)->toBe(1);
})->with([
    'interval too low' => [['sync_interval_seconds' => 59], 'sync_interval_seconds'],
    'interval too high' => [['sync_interval_seconds' => 3601], 'sync_interval_seconds'],
    'heartbeat too low' => [['heartbeat_interval_seconds' => 30], 'heartbeat_interval_seconds'],
    'bad range' => [['initial_sync_range' => '90d'], 'initial_sync_range'],
    'bad version' => [['min_agent_version' => 'v1'], 'min_agent_version'],
    'retention below minimum' => [['retention_days' => 29], 'retention_days'],
    'missing category' => [['network' => null], 'network'],
]);
