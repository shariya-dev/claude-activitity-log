<?php

use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\Project;
use App\Models\SessionUsage;
use App\Models\SyncBatch;
use App\Models\UsageDailyRollup;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

test('every table in the data model exists', function (string $table) {
    expect(Schema::hasTable($table))->toBeTrue();
})->with([
    'users', 'developers', 'pairing_codes', 'devices', 'agent_sync_states', 'sync_batches',
    'claude_accounts', 'claude_account_device', 'projects', 'project_locations', 'claude_models',
    'claude_sessions', 'session_usage', 'usage_daily_rollups', 'session_messages',
    'tracking_settings', 'audit_logs', 'personal_access_tokens',
]);

test('devices has a plain developer_id index', function () {
    $indexes = collect(Schema::getIndexes('devices'))
        ->filter(fn (array $index) => $index['columns'] === ['developer_id'] && ! $index['unique'])
        ->pluck('name')
        ->all();

    expect($indexes)->toContain('devices_developer_id_index');
});

test('device fingerprint is unique per developer', function () {
    $device = Device::factory()->create();

    Device::factory()->create([
        'developer_id' => $device->developer_id,
        'machine_fingerprint' => $device->machine_fingerprint,
    ]);
})->throws(UniqueConstraintViolationException::class);

test('the same fingerprint is allowed for a different developer', function () {
    $device = Device::factory()->create();

    $other = Device::factory()->create(['machine_fingerprint' => $device->machine_fingerprint]);

    expect($other->developer_id)->not->toBe($device->developer_id)
        ->and(Device::where('machine_fingerprint', $device->machine_fingerprint)->count())->toBe(2);
});

test('session source id is unique per device', function () {
    $session = ClaudeSession::factory()->create();

    ClaudeSession::factory()->for($session->device)->create([
        'source_session_id' => $session->source_session_id,
    ]);
})->throws(UniqueConstraintViolationException::class);

test('usage is unique per session and source message', function () {
    $usage = SessionUsage::factory()->create();

    SessionUsage::factory()->for($usage->session, 'session')->create([
        'source_message_id' => $usage->source_message_id,
    ]);
})->throws(UniqueConstraintViolationException::class);

test('rollup dims hash is unique', function () {
    $rollup = UsageDailyRollup::factory()->create();

    UsageDailyRollup::factory()->create(['dims_hash' => $rollup->dims_hash]);
})->throws(UniqueConstraintViolationException::class);

test('sync batch uuid is unique per device', function () {
    $batch = SyncBatch::factory()->create();

    SyncBatch::factory()->for($batch->device)->create(['batch_uuid' => $batch->batch_uuid]);
})->throws(UniqueConstraintViolationException::class);

test('developer email is unique', function () {
    $developer = Developer::factory()->create();

    Developer::factory()->create(['email' => $developer->email]);
})->throws(UniqueConstraintViolationException::class);

test('pairing code hash is unique', function () {
    $code = PairingCode::factory()->create();

    PairingCode::factory()->create(['code_hash' => $code->code_hash]);
})->throws(UniqueConstraintViolationException::class);

test('project key is unique', function () {
    $project = Project::factory()->create();

    Project::factory()->create(['project_key' => $project->project_key]);
})->throws(UniqueConstraintViolationException::class);

test('claude model name is unique', function () {
    $model = ClaudeModel::factory()->create();

    ClaudeModel::factory()->create(['name' => $model->name]);
})->throws(UniqueConstraintViolationException::class);

test('claude account key is unique per developer', function () {
    $account = ClaudeAccount::factory()->create();

    ClaudeAccount::factory()->create([
        'developer_id' => $account->developer_id,
        'account_key' => $account->account_key,
    ]);
})->throws(UniqueConstraintViolationException::class);

test('a device with sessions cannot be deleted', function () {
    $session = ClaudeSession::factory()->create();

    $session->device->delete();
})->throws(QueryException::class);

test('a developer with devices cannot be force deleted', function () {
    $device = Device::factory()->create();

    $device->developer->forceDelete();
})->throws(QueryException::class);

test('tracking settings row 1 is seeded with PRD defaults', function () {
    $row = DB::table('tracking_settings')->where('id', 1)->first();

    expect($row)->not->toBeNull()
        ->and(DB::table('tracking_settings')->count())->toBe(1)
        ->and((bool) $row->session)->toBeTrue()
        ->and((bool) $row->usage)->toBeTrue()
        ->and((bool) $row->project)->toBeTrue()
        ->and((bool) $row->model)->toBeTrue()
        ->and((bool) $row->device)->toBeTrue()
        ->and((bool) $row->account)->toBeTrue()
        ->and((bool) $row->prompt)->toBeFalse()
        ->and((bool) $row->git)->toBeFalse()
        ->and((bool) $row->network)->toBeFalse()
        ->and($row->initial_sync_range)->toBe('7d')
        ->and((int) $row->sync_interval_seconds)->toBe(120)
        ->and((int) $row->heartbeat_interval_seconds)->toBe(300)
        ->and($row->min_agent_version)->toBe('1.0.0')
        ->and($row->retention_days)->toBeNull();
});

test('no foreign key on monitoring data cascades deletes', function () {
    $cascading = DB::table('information_schema.REFERENTIAL_CONSTRAINTS')
        ->where('CONSTRAINT_SCHEMA', DB::connection()->getDatabaseName())
        ->where('TABLE_NAME', '!=', 'passkeys')
        ->where(fn ($query) => $query->where('DELETE_RULE', 'CASCADE')->orWhere('DELETE_RULE', 'SET NULL'))
        ->pluck('CONSTRAINT_NAME')
        ->all();

    expect($cascading)->toBe([]);
});
