<?php

use App\Actions\Agent\IssuePairingCode;
use App\Enums\DeviceStatus;
use App\Enums\InitialSyncRange;
use App\Models\AgentSyncState;
use App\Models\AuditLog;
use App\Models\Developer;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\TrackingSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Agent\ContractExamples;

uses(RefreshDatabase::class);

const REGISTER_URL = '/api/agent/v1/register';

beforeEach(function () {
    $this->travelTo(now()->parse('2026-09-22T12:00:00Z'));
});

function pairingCodeFor(Developer $developer, string $code = 'K7Q2-M9XD'): PairingCode
{
    return PairingCode::factory()->withCode($code)->for($developer)->create();
}

test('a valid code registers the device and returns the contract response', function () {
    $developer = Developer::factory()->create(['name' => 'Dana Developer', 'email' => 'dana.developer@example.com']);
    $code = pairingCodeFor($developer);

    $response = $this->postJson(REGISTER_URL, ContractExamples::registerRequest())->assertCreated();

    expect(ContractExamples::shape($response->json()))->toBe(ContractExamples::shape(ContractExamples::load('register.response')));

    $device = Device::sole();
    $request = ContractExamples::load('register.request')['device'];

    expect($response->json('device_id'))->toBe($device->device_uid)->toMatch('/^dev_[0-9A-HJKMNP-TV-Z]{26}$/')
        ->and($response->json('developer'))->toBe(['name' => 'Dana Developer', 'email' => 'dana.developer@example.com'])
        ->and($response->json('settings.initial_sync'))->toBe(['range' => '7d', 'since' => '2026-09-15T12:00:00Z'])
        ->and($device->developer_id)->toBe($developer->id)
        ->and($device->status)->toBe(DeviceStatus::Active)
        ->and($device->machine_fingerprint)->toBe($request['machine_fingerprint'])
        ->and($device->hostname)->toBe($request['hostname'])
        ->and($device->platform)->toBe('linux')
        ->and($device->platform_version)->toBe($request['platform_version'])
        ->and($device->architecture)->toBe('x64')
        ->and($device->agent_version)->toBe('1.0.0')
        ->and($device->claude_code_version)->toBe('2.1.274')
        ->and($device->first_seen_at?->toIso8601ZuluString())->toBe('2026-09-22T12:00:00Z')
        ->and(AgentSyncState::where('device_id', $device->id)->count())->toBe(1);

    $code->refresh();
    expect($code->used_at)->not->toBeNull()
        ->and($code->used_by_device_id)->toBe($device->id);
});

test('the returned token authenticates the device on /settings', function () {
    pairingCodeFor(Developer::factory()->create());

    $token = $this->postJson(REGISTER_URL, ContractExamples::registerRequest())->json('token');

    $this->withToken($token)
        ->getJson('/api/agent/v1/settings', ['X-Agent-Version' => '1.0.0'])
        ->assertOk()
        ->assertJsonPath('version', 1);
});

test('the settings in the register response follow the configured initial sync range', function () {
    $setting = TrackingSetting::current();
    $setting->initial_sync_range = InitialSyncRange::All;
    $setting->save();
    pairingCodeFor(Developer::factory()->create());

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest())
        ->assertCreated()
        ->assertJsonPath('settings.initial_sync', ['range' => 'all', 'since' => null]);
});

test('every bad pairing code gets the same generic 422', function (string $code) {
    $this->postJson(REGISTER_URL, ContractExamples::registerRequest($code))
        ->assertStatus(422)
        ->assertExactJson(ContractExamples::load('error.invalid_pairing_code'));

    expect(Device::where('machine_fingerprint', ContractExamples::load('register.request')['device']['machine_fingerprint'])->exists())->toBeFalse();
})->with([
    'unknown' => fn () => 'ZZZZ-ZZZZ',
    'expired' => fn () => tap('K7Q2-M9XD', fn ($c) => PairingCode::factory()->withCode($c)->expired()->create()),
    'used' => fn () => tap('K7Q2-M9XD', fn ($c) => PairingCode::factory()->withCode($c)->used()->create()),
    'inactive developer' => fn () => tap('K7Q2-M9XD', fn ($c) => pairingCodeFor(Developer::factory()->inactive()->create(), $c)),
    'deleted developer' => fn () => tap('K7Q2-M9XD', function ($c) {
        $developer = Developer::factory()->create();
        pairingCodeFor($developer, $c);
        $developer->delete();
    }),
    'malformed' => fn () => str_repeat('K', 33),
    'empty' => fn () => '',
]);

test('the code is matched case- and separator-insensitively', function () {
    pairingCodeFor(Developer::factory()->create());

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest(' k7q2 m9xd '))->assertCreated();
});

test('a bad non-code field is invalid_payload even when the code is also bad', function () {
    $invalid = ContractExamples::load('invalid/register-unknown-platform');

    $this->postJson(REGISTER_URL, $invalid['payload'])
        ->assertStatus($invalid['expect']['backend']['status'])
        ->assertJsonPath('success', false)
        ->assertJsonPath('error.code', $invalid['expect']['backend']['code'])
        ->assertJsonPath('error.retryable', false)
        ->assertJsonStructure(['error' => ['errors' => ['device.platform']]]);
});

test('missing nullable fields are a contract violation', function () {
    pairingCodeFor(Developer::factory()->create());
    $payload = ContractExamples::registerRequest();
    unset($payload['device']['claude_code_version']);

    $this->postJson(REGISTER_URL, $payload)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'invalid_payload')
        ->assertJsonStructure(['error' => ['errors' => ['device.claude_code_version']]]);
});

test('re-pairing the same machine reuses the device row and revokes the old token', function () {
    $developer = Developer::factory()->create();
    pairingCodeFor($developer, 'AAAA-BBBB');

    $first = $this->postJson(REGISTER_URL, ContractExamples::registerRequest('AAAA-BBBB'))->assertCreated();
    $device = Device::sole();
    $device->update(['status' => DeviceStatus::Disabled, 'disabled_at' => now()]);

    $this->travel(2)->days();
    pairingCodeFor($developer, 'CCCC-DDDD');
    $second = $this->postJson(REGISTER_URL, ContractExamples::registerRequest('CCCC-DDDD'))->assertCreated();

    expect($second->json('device_id'))->toBe($first->json('device_id'))
        ->and($second->json('token'))->not->toBe($first->json('token'))
        ->and($second->json('settings.initial_sync.since'))->toBe($first->json('settings.initial_sync.since'))
        ->and(Device::count())->toBe(1)
        ->and(AgentSyncState::count())->toBe(1);

    $device->refresh();
    expect($device->status)->toBe(DeviceStatus::Active)
        ->and($device->disabled_at)->toBeNull()
        ->and($device->first_seen_at?->toIso8601ZuluString())->toBe('2026-09-22T12:00:00Z')
        ->and($device->tokens()->count())->toBe(1);

    $audit = AuditLog::where('action', 'device.repaired')->sole();
    expect($audit->subject_id)->toBe($device->id)
        ->and($audit->user_id)->toBeNull();

    $this->app['auth']->forgetGuards();
    $this->withToken($first->json('token'))
        ->getJson('/api/agent/v1/settings', ['X-Agent-Version' => '1.0.0'])
        ->assertUnauthorized();
});

test('a different fingerprint registers a second device for the same developer', function () {
    $developer = Developer::factory()->create();
    pairingCodeFor($developer, 'AAAA-BBBB');
    pairingCodeFor($developer, 'CCCC-DDDD');

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest('AAAA-BBBB'))->assertCreated();
    $this->postJson(REGISTER_URL, ContractExamples::registerRequest('CCCC-DDDD', ['machine_fingerprint' => hash('sha256', 'other-machine')]))
        ->assertCreated();

    expect(Device::where('developer_id', $developer->id)->count())->toBe(2)
        ->and(Device::distinct()->count('device_uid'))->toBe(2);
});

test('a changed IP and hostname on the same machine is still one device', function () {
    $developer = Developer::factory()->create();
    pairingCodeFor($developer, 'AAAA-BBBB');
    pairingCodeFor($developer, 'CCCC-DDDD');

    $first = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.10'])
        ->postJson(REGISTER_URL, ContractExamples::registerRequest('AAAA-BBBB'));
    $second = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.77'])
        ->postJson(REGISTER_URL, ContractExamples::registerRequest('CCCC-DDDD', ['hostname' => 'renamed-laptop']));

    expect($second->json('device_id'))->toBe($first->json('device_id'))
        ->and(Device::count())->toBe(1)
        ->and(Device::sole()->hostname)->toBe('renamed-laptop');
});

test('the hostname is not stored when the Device category is off', function () {
    $setting = TrackingSetting::current();
    $setting->device = false;
    $setting->save();
    pairingCodeFor(Developer::factory()->create());

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest())->assertCreated();

    expect(Device::sole()->hostname)->toBeNull();
});

test('register is throttled to 10 requests per minute per IP', function () {
    foreach (range(1, 10) as $attempt) {
        $this->postJson(REGISTER_URL, ContractExamples::registerRequest('ZZZZ-ZZZZ'))->assertStatus(422);
    }

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest('ZZZZ-ZZZZ'))
        ->assertStatus(429)
        ->assertHeader('Retry-After');
});

test('an outdated agent can still pair', function () {
    $setting = TrackingSetting::current();
    $setting->min_agent_version = '2.0.0';
    $setting->save();
    pairingCodeFor(Developer::factory()->create());

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest(), ['X-Agent-Version' => '1.0.0'])
        ->assertCreated();
});

test('neither the pairing code nor the token is written to the audit log', function () {
    $developer = Developer::factory()->create();
    pairingCodeFor($developer, 'AAAA-BBBB');
    pairingCodeFor($developer, 'CCCC-DDDD');

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest('AAAA-BBBB'));
    $token = $this->postJson(REGISTER_URL, ContractExamples::registerRequest('CCCC-DDDD'))->json('token');

    $audit = json_encode(AuditLog::all()->toArray());
    expect($audit)->not->toContain('CCCC-DDDD')->not->toContain('CCCCDDDD')
        ->and($audit)->not->toContain(explode('|', $token)[1]);
});

test('a code issued by IssuePairingCode redeems through /register', function () {
    $developer = Developer::factory()->create();
    $code = app(IssuePairingCode::class)->handle($developer, User::factory()->admin()->create());

    $this->postJson(REGISTER_URL, ContractExamples::registerRequest($code))->assertCreated();

    expect(Device::sole()->developer_id)->toBe($developer->id);
});

test('re-pairing keeps the stored hostname when none is sent or Device is off', function (bool $deviceCategory, ?string $sent) {
    $developer = Developer::factory()->create();
    pairingCodeFor($developer, 'AAAA-BBBB');
    $this->postJson(REGISTER_URL, ContractExamples::registerRequest('AAAA-BBBB'))->assertCreated();

    $setting = TrackingSetting::current();
    $setting->device = $deviceCategory;
    $setting->save();
    pairingCodeFor($developer, 'CCCC-DDDD');
    $this->postJson(REGISTER_URL, ContractExamples::registerRequest('CCCC-DDDD', ['hostname' => $sent]))->assertCreated();

    expect(Device::sole()->hostname)->toBe('dev-laptop-01');
})->with([
    'device on, null hostname' => [true, null],
    'device off, new hostname' => [false, 'renamed-laptop'],
]);

test('the re-pair audit entry stores the agent IP only when Network is on', function (bool $network, ?string $expected) {
    $developer = Developer::factory()->create();
    pairingCodeFor($developer, 'AAAA-BBBB');
    pairingCodeFor($developer, 'CCCC-DDDD');
    $setting = TrackingSetting::current();
    $setting->network = $network;
    $setting->save();

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.10'])
        ->postJson(REGISTER_URL, ContractExamples::registerRequest('AAAA-BBBB'));
    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.10'])
        ->postJson(REGISTER_URL, ContractExamples::registerRequest('CCCC-DDDD'));

    expect(AuditLog::where('action', 'device.repaired')->sole()->ip_address)->toBe($expected);
})->with([
    'network off' => [false, null],
    'network on' => [true, '203.0.113.10'],
]);
