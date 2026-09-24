<?php

use App\Enums\ConnectionState;
use App\Enums\DeviceStatus;
use App\Enums\InitialSyncRange;
use App\Enums\TrackingCategory;
use App\Enums\UserRole;
use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\SessionMessage;
use App\Models\SessionUsage;
use App\Models\TrackingSetting;
use App\Models\UsageDailyRollup;
use App\Models\User;
use App\Support\OrgClock;
use App\Support\TokenMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

test('devices get a dev_ ULID public id used as route key', function () {
    $device = Device::factory()->create();

    expect($device->device_uid)->toMatch('/^dev_[0-9A-Z]{26}$/')
        ->and($device->getRouteKeyName())->toBe('device_uid')
        ->and($device->getRouteKey())->toBe($device->device_uid)
        ->and($device->status)->toBe(DeviceStatus::Active);
});

test('an explicit device uid is kept', function () {
    $device = Device::factory()->create(['device_uid' => 'dev_01J9Z0000000000000000000AB']);

    expect($device->device_uid)->toBe('dev_01J9Z0000000000000000000AB');
});

test('connection state is derived from last_seen_at', function () {
    expect(Device::factory()->online()->create()->connectionState())->toBe(ConnectionState::Online)
        ->and(Device::factory()->stale()->create()->connectionState())->toBe(ConnectionState::Stale)
        ->and(Device::factory()->offline()->create()->connectionState())->toBe(ConnectionState::Offline)
        ->and(Device::factory()->create(['last_seen_at' => null])->connectionState())->toBe(ConnectionState::Offline);
});

test('developer has many devices and sessions', function () {
    $developer = Developer::factory()->create();
    $device = Device::factory()->for($developer)->create();
    ClaudeSession::factory()->for($device)->count(2)->create();

    expect($developer->devices->pluck('id')->all())->toBe([$device->id])
        ->and($developer->sessions)->toHaveCount(2)
        ->and($device->sessions)->toHaveCount(2)
        ->and($device->developer->is($developer))->toBeTrue();
});

test('session factory follows the device developer', function () {
    $device = Device::factory()->create();

    $session = ClaudeSession::factory()->for($device)->create();

    expect($session->developer_id)->toBe($device->developer_id);
});

test('device claude accounts pivot carries seen and timestamp columns', function () {
    $device = Device::factory()->create();
    $account = ClaudeAccount::factory()->for($device->developer)->create();

    $device->claudeAccounts()->attach($account->id, [
        'first_seen_at' => now()->subDay(),
        'last_seen_at' => now(),
    ]);

    $pivot = $device->claudeAccounts()->first()->pivot;

    expect($pivot->first_seen_at)->not->toBeNull()
        ->and($pivot->last_seen_at)->not->toBeNull()
        ->and($pivot->created_at)->not->toBeNull()
        ->and($pivot->updated_at)->not->toBeNull()
        ->and($account->devices->pluck('id')->all())->toBe([$device->id]);
});

test('session has usage rows', function () {
    $session = ClaudeSession::factory()->create();
    SessionUsage::factory()->for($session, 'session')->count(3)->create();

    expect($session->usage)->toHaveCount(3)
        ->and($session->usage->first()->session->is($session))->toBeTrue();
});

test('session usage factory denormalizes dims and computes calc columns through TokenMath', function () {
    $usage = SessionUsage::factory()->create([
        'input_tokens' => 100000,
        'output_tokens' => 20000,
        'cache_creation_tokens' => 30000,
        'cache_read_tokens' => 500000,
    ])->fresh();

    $expected = TokenMath::forRow($usage->only(['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens']));

    expect($usage->actual_consumed_tokens)->toBe($expected['actual_consumed_tokens'])
        ->and($usage->total_token_activity)->toBe($expected['total_token_activity'])
        ->and($usage->actual_consumed_tokens)->toBe(150000)
        ->and($usage->device_id)->toBe($usage->session->device_id)
        ->and($usage->developer_id)->toBe($usage->session->developer_id)
        ->and($usage->recorded_on->format('Y-m-d'))->toBe(OrgClock::dateFor($usage->recorded_at));
});

test('ClaudeModel::idFor is idempotent and creates new names', function () {
    $first = ClaudeModel::idFor('claude-sonnet-5');
    $again = ClaudeModel::idFor('claude-sonnet-5');
    $other = ClaudeModel::idFor('claude-opus-5');

    expect($again)->toBe($first)
        ->and($other)->not->toBe($first)
        ->and(ClaudeModel::where('name', 'claude-sonnet-5')->count())->toBe(1)
        ->and(ClaudeModel::count())->toBe(2)
        ->and(ClaudeModel::find($first)->first_seen_at)->not->toBeNull()
        ->and(ClaudeModel::find($first)->last_seen_at)->not->toBeNull();
});

test('ClaudeModel::idFor does not cache ids from a rolled back transaction', function () {
    $baseLevel = DB::transactionLevel();

    DB::beginTransaction();
    expect(DB::transactionLevel())->toBe($baseLevel + 1);
    $rolledBackId = ClaudeModel::idFor('claude-rollback-5');
    expect(ClaudeModel::whereKey($rolledBackId)->exists())->toBeTrue();
    DB::rollBack();

    expect(DB::transactionLevel())->toBe($baseLevel)
        ->and(ClaudeModel::whereKey($rolledBackId)->exists())->toBeFalse();

    $id = ClaudeModel::idFor('claude-rollback-5');

    expect(ClaudeModel::whereKey($id)->where('name', 'claude-rollback-5')->exists())->toBeTrue();
});

test('ClaudeModel::idFor caches ids once the transaction commits', function () {
    DB::transaction(fn () => ClaudeModel::idFor('claude-commit-5'));
    $id = ClaudeModel::where('name', 'claude-commit-5')->value('id');

    DB::table('claude_models')->where('id', $id)->update(['last_seen_at' => null]);

    expect(ClaudeModel::idFor('claude-commit-5'))->toBe($id)
        ->and(ClaudeModel::find($id)->last_seen_at)->toBeNull();
});

test('ClaudeModel::idFor finds rows created outside the memo', function () {
    $model = ClaudeModel::factory()->create(['name' => 'claude-haiku-5']);

    expect(ClaudeModel::idFor('claude-haiku-5'))->toBe($model->id)
        ->and(ClaudeModel::count())->toBe(1);
});

test('pairing code hashes are normalized', function () {
    $hash = PairingCode::hashCode('k7q2-m9xd');

    expect($hash)->toMatch('/^[0-9a-f]{64}$/')
        ->and(PairingCode::hashCode('K7Q2M9XD'))->toBe($hash)
        ->and(PairingCode::hashCode(' K7Q2 - M9XD '))->toBe($hash)
        ->and(PairingCode::hashCode('K7Q2-M9XE'))->not->toBe($hash);
});

test('pairing code factory states', function () {
    $code = PairingCode::factory()->withCode('ab12-cd34')->create();
    $used = PairingCode::factory()->used()->create();
    $expired = PairingCode::factory()->expired()->create();
    $repair = PairingCode::factory()->repair()->create();

    expect($code->code_hash)->toBe(PairingCode::hashCode('AB12CD34'))
        ->and($code->used_at)->toBeNull()
        ->and($code->expires_at->isFuture())->toBeTrue()
        ->and($used->used_at)->not->toBeNull()
        ->and($used->usedByDevice->developer_id)->toBe($used->developer_id)
        ->and($expired->expires_at->isPast())->toBeTrue()
        ->and($repair->purpose->value)->toBe('repair')
        ->and($code->createdBy)->toBeInstanceOf(User::class);
});

test('session message content is encrypted at rest and hidden from arrays', function () {
    $message = SessionMessage::factory()->create(['content' => 'Refactor the invoice service']);

    $raw = DB::table('session_messages')->where('id', $message->id)->value('content');

    expect($raw)->not->toBe('Refactor the invoice service')
        ->and($raw)->not->toContain('invoice')
        ->and($message->fresh()->content)->toBe('Refactor the invoice service')
        ->and($message->fresh()->toArray())->not->toHaveKey('content');
});

test('tracking settings singleton and category checks', function () {
    $settings = TrackingSetting::current();

    expect($settings->id)->toBe(1)
        ->and($settings->enabled(TrackingCategory::Session))->toBeTrue()
        ->and($settings->enabled(TrackingCategory::Prompt))->toBeFalse()
        ->and($settings->initial_sync_range)->toBe(InitialSyncRange::SevenDays);
});

test('tracking settings agent payload has the exact contract shape', function () {
    $this->travelTo(now()->parse('2026-09-22T12:00:00Z'));

    expect(TrackingSetting::current()->toAgentPayload())->toBe([
        'version' => 1,
        'categories' => [
            'session' => true,
            'usage' => true,
            'project' => true,
            'model' => true,
            'device' => true,
            'account' => true,
            'prompt' => false,
            'git' => false,
            'network' => false,
        ],
        'initial_sync' => ['range' => '7d', 'since' => '2026-09-15T00:00:00Z'],
        'sync_interval_seconds' => 120,
        'heartbeat_interval_seconds' => 300,
        'min_agent_version' => '1.0.0',
    ]);
});

test('tracking settings payload since is null for all history', function () {
    $settings = TrackingSetting::current();
    $settings->initial_sync_range = InitialSyncRange::All;
    $settings->prompt = true;
    $settings->save();

    $payload = TrackingSetting::current()->toAgentPayload();

    expect($payload['initial_sync'])->toBe(['range' => 'all', 'since' => null])
        ->and($payload['categories']['prompt'])->toBeTrue();
});

test('current can lock the settings row inside a transaction', function () {
    $version = DB::transaction(function () {
        $settings = TrackingSetting::current(lockForUpdate: true);
        $settings->bumpVersion();
        $settings->save();

        return $settings->version;
    });

    expect($version)->toBe(2)
        ->and(TrackingSetting::current()->version)->toBe(2);
});

test('bumpVersion increments the version', function () {
    $settings = TrackingSetting::current();

    $settings->bumpVersion();
    $settings->save();

    expect(TrackingSetting::current()->version)->toBe(2);
});

test('user role cast and isAdmin', function () {
    $admin = User::factory()->admin()->create();
    $viewer = User::factory()->create();

    expect($admin->fresh()->role)->toBe(UserRole::Admin)
        ->and($admin->isAdmin())->toBeTrue()
        ->and($viewer->fresh()->role)->toBe(UserRole::Viewer)
        ->and($viewer->isAdmin())->toBeFalse()
        ->and(User::factory()->viewer()->create()->isAdmin())->toBeFalse()
        ->and($viewer->fresh()->can_view_prompts)->toBeFalse()
        ->and($viewer->fresh()->is_active)->toBeTrue();
});

test('soft deleting a developer keeps devices', function () {
    $device = Device::factory()->create();
    $developer = $device->developer;

    $developer->delete();

    expect(Developer::find($developer->id))->toBeNull()
        ->and(Developer::withTrashed()->find($developer->id))->not->toBeNull()
        ->and(Device::find($device->id))->not->toBeNull()
        ->and(Device::find($device->id)->developer->is($developer))->toBeTrue();
});

test('history models resolve their soft-deleted developer', function () {
    $usage = SessionUsage::factory()->create();
    $rollup = UsageDailyRollup::factory()->for($usage->device)->create();
    $session = $usage->session;
    $session->developer->delete();

    expect($session->fresh()->developer)->not->toBeNull()
        ->and($usage->fresh()->developer)->not->toBeNull()
        ->and($rollup->fresh()->developer)->not->toBeNull()
        ->and($usage->fresh()->device->developer)->not->toBeNull();
});
