<?php

use App\Actions\Agent\IssuePairingCode;
use App\Enums\PairingPurpose;
use App\Models\AuditLog;
use App\Models\Developer;
use App\Models\PairingCode;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);

test('it returns a XXXX-XXXX Crockford code without 0, O, 1 or I', function () {
    $code = app(IssuePairingCode::class)->handle(Developer::factory()->create(), User::factory()->admin()->create());

    expect($code)->toMatch('/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/');
});

test('it stores only the hash, with expiry, purpose and issuer', function () {
    $this->travelTo(now()->parse('2026-09-23T10:00:00Z'));
    $developer = Developer::factory()->create();
    $admin = User::factory()->admin()->create();

    $code = app(IssuePairingCode::class)->handle($developer, $admin, PairingPurpose::Repair);

    $row = PairingCode::sole();
    expect($row->code_hash)->toBe(PairingCode::hashCode($code))
        ->and($row->developer_id)->toBe($developer->id)
        ->and($row->created_by_user_id)->toBe($admin->id)
        ->and($row->purpose)->toBe(PairingPurpose::Repair)
        ->and($row->used_at)->toBeNull()
        ->and($row->expires_at->toIso8601ZuluString())->toBe('2026-09-23T10:15:00Z');
});

test('the plaintext code is absent from the database and the audit log', function () {
    $developer = Developer::factory()->create();
    $admin = User::factory()->admin()->create();

    $code = app(IssuePairingCode::class)->handle($developer, $admin);

    $stored = json_encode([DB::table('pairing_codes')->get(), DB::table('audit_logs')->get()]);
    expect($stored)->not->toContain($code)
        ->and($stored)->not->toContain(str_replace('-', '', $code));

    $audit = AuditLog::where('action', 'pairing_code.issued')->sole();
    expect($audit->user_id)->toBe($admin->id)
        ->and($audit->subject_type)->toBe($developer->getMorphClass())
        ->and($audit->subject_id)->toBe($developer->id)
        ->and($audit->metadata)->toBe(['purpose' => 'pair']);
});

test('each call issues a distinct code', function () {
    $developer = Developer::factory()->create();
    $admin = User::factory()->admin()->create();
    $action = app(IssuePairingCode::class);

    $codes = collect(range(1, 20))->map(fn () => $action->handle($developer, $admin));

    expect($codes->unique())->toHaveCount(20)
        ->and(PairingCode::count())->toBe(20);
});
