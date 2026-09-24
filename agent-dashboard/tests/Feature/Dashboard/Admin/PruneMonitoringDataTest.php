<?php

use App\Models\AuditLog;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\SessionMessage;
use App\Models\SessionUsage;
use App\Models\SyncBatch;
use App\Models\TrackingSetting;
use App\Models\UsageDailyRollup;
use App\Support\OrgClock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schedule;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->travelTo(now()->parse('2026-09-24 12:00:00'));

    $this->session = ClaudeSession::factory()->create(['started_at' => now()->subDays(60)]);
    $device = Device::query()->findOrFail($this->session->device_id);

    $usageAt = function (int $daysAgo, bool $rolledUp): SessionUsage {
        $at = now()->subDays($daysAgo);
        $usage = SessionUsage::factory()->create([
            'claude_session_id' => $this->session->id,
            'recorded_at' => $at,
            'recorded_on' => OrgClock::dateFor($at),
        ]);

        if ($rolledUp) {
            UsageDailyRollup::factory()->create([
                'date' => OrgClock::dateFor($at),
                'device_id' => $usage->device_id,
                'developer_id' => $usage->developer_id,
            ]);
        }

        return $usage;
    };

    // Old (beyond 30 days): two rolled-up usage rows on distinct days, one not rolled up.
    $this->oldRolledUp = [$usageAt(45, true), $usageAt(40, true)];
    $this->oldNotRolledUp = $usageAt(50, false);
    // Recent (inside 30 days).
    $this->recent = $usageAt(5, true);

    SessionMessage::factory()->count(3)->create(['claude_session_id' => $this->session->id, 'recorded_at' => now()->subDays(40)]);
    SessionMessage::factory()->count(2)->create(['claude_session_id' => $this->session->id, 'recorded_at' => now()->subDays(10)]);

    SyncBatch::factory()->count(4)->create(['device_id' => $device->id, 'received_at' => now()->subDays(100)]);
    SyncBatch::factory()->count(1)->create(['device_id' => $device->id, 'received_at' => now()->subDays(10)]);
});

function rollupTotals(): array
{
    return [
        'rows' => UsageDailyRollup::query()->count(),
        'actual' => (int) UsageDailyRollup::query()->sum('actual_consumed_tokens'),
        'total' => (int) UsageDailyRollup::query()->sum('total_token_activity'),
    ];
}

function keptEntityCounts(): array
{
    return [
        'sessions' => ClaudeSession::query()->count(),
        'devices' => Device::query()->count(),
        'developers' => Developer::withTrashed()->count(),
    ];
}

test('dry-run reports the counts and deletes nothing', function () {
    TrackingSetting::current()->forceFill(['retention_days' => 30])->save();
    $usage = SessionUsage::query()->count();

    $this->artisan('monitor:prune', ['--dry-run' => true])
        ->expectsOutputToContain('Dry run')
        ->expectsOutputToContain('session_messages 3')
        ->expectsOutputToContain('session_usage 2')
        ->expectsOutputToContain('sync_batches 4')
        ->assertSuccessful();

    expect(SessionMessage::query()->count())->toBe(5)
        ->and(SessionUsage::query()->count())->toBe($usage)
        ->and(SyncBatch::query()->count())->toBe(5)
        ->and(AuditLog::query()->count())->toBe(0);
});

test('a real prune deletes the same rows the dry-run counted and keeps history (PRD §56)', function () {
    TrackingSetting::current()->forceFill(['retention_days' => 30])->save();
    $rollupsBefore = rollupTotals();
    $entitiesBefore = keptEntityCounts();
    $sessionTotals = $this->session->fresh()->only(['actual_consumed_tokens', 'total_token_activity']);

    $this->artisan('monitor:prune')->assertSuccessful();

    expect(SessionMessage::query()->count())->toBe(2)
        ->and(SessionUsage::query()->pluck('id')->sort()->values()->all())
        ->toBe(collect([$this->oldNotRolledUp->id, $this->recent->id])->sort()->values()->all())
        ->and(SyncBatch::query()->count())->toBe(1)
        ->and(rollupTotals())->toBe($rollupsBefore)
        ->and(keptEntityCounts())->toBe($entitiesBefore)
        ->and($this->session->fresh()->only(['actual_consumed_tokens', 'total_token_activity']))->toBe($sessionTotals);

    $audit = AuditLog::query()->where('action', 'retention.pruned')->sole();
    expect($audit->user_id)->toBeNull()
        ->and($audit->metadata)->toEqual([
            'retention_days' => 30,
            'session_messages' => 3,
            'session_usage' => 2,
            'sync_batches' => 4,
        ]);
});

test('usage is kept when the rollup belongs to another device on the same day', function () {
    TrackingSetting::current()->forceFill(['retention_days' => 30])->save();
    $at = now()->subDays(50);
    UsageDailyRollup::factory()->create(['date' => OrgClock::dateFor($at)]);

    $this->artisan('monitor:prune')->assertSuccessful();

    expect(SessionUsage::query()->whereKey($this->oldNotRolledUp->id)->exists())->toBeTrue();
});

test('without a retention policy only old sync batches are pruned', function () {
    $this->artisan('monitor:prune')->assertSuccessful();

    expect(SessionMessage::query()->count())->toBe(5)
        ->and(SessionUsage::query()->count())->toBe(4)
        ->and(SyncBatch::query()->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'retention.pruned')->sole()->metadata)->toEqual([
            'retention_days' => null,
            'session_messages' => 0,
            'session_usage' => 0,
            'sync_batches' => 4,
        ]);
});

test('deletes work across multiple chunks', function () {
    TrackingSetting::current()->forceFill(['retention_days' => 30])->save();
    $device = Device::query()->findOrFail($this->session->device_id);
    SyncBatch::factory()->count(1_200)->create(['device_id' => $device->id, 'received_at' => now()->subDays(200)]);

    $this->artisan('monitor:prune')->assertSuccessful();

    expect(SyncBatch::query()->count())->toBe(1);
});

test('the prune runs daily on the schedule', function () {
    $event = collect(Schedule::events())->first(fn ($event) => str_contains((string) $event->command, 'monitor:prune'));

    expect($event)->not->toBeNull()
        ->and($event->expression)->toBe('0 0 * * *');
});
