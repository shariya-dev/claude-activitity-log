<?php

use App\Models\AuditLog;
use App\Models\Developer;
use App\Models\PairingCode;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

test('admins issue a pairing code that is flashed once and stored only as a hash', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->create();

    $this->actingAs($admin)
        ->from(route('developers.show', $developer))
        ->post(route('developers.pairing-codes.store', $developer))
        ->assertRedirect(route('developers.show', $developer));

    $code = session('pairing_code');

    expect($code)->toBeString()->toMatch('/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/');

    $stored = PairingCode::query()->sole();

    expect($stored->developer_id)->toBe($developer->id)
        ->and($stored->code_hash)->toBe(PairingCode::hashCode($code))
        ->and(json_encode($stored->getAttributes()))->not->toContain($code)
        ->and(json_encode($stored->getAttributes()))->not->toContain(str_replace('-', '', $code));

    $this->get(route('developers.show', $developer))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Developers/Show')
            ->where('flash.pairing_code', $code));

    $this->get(route('developers.show', $developer))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('flash.pairing_code', null));
});

test('issuing a pairing code writes an audit row without the code', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->create();

    $this->actingAs($admin)->post(route('developers.pairing-codes.store', $developer));

    $code = (string) session('pairing_code');
    $audit = AuditLog::query()->where('action', 'pairing_code.issued')->sole();

    expect($audit->subject_id)->toBe($developer->id)
        ->and($audit->user_id)->toBe($admin->id)
        ->and(json_encode($audit->getAttributes()))->not->toContain($code)
        ->and(json_encode($audit->getAttributes()))->not->toContain(str_replace('-', '', $code));
});

test('inactive developers cannot receive pairing codes', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->inactive()->create();

    $this->actingAs($admin)
        ->from(route('developers.show', $developer))
        ->post(route('developers.pairing-codes.store', $developer))
        ->assertRedirect(route('developers.show', $developer))
        ->assertSessionHas('error')
        ->assertSessionMissing('pairing_code');

    expect(PairingCode::query()->count())->toBe(0);
});

test('the code is flashed to the developer page even without a referer', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->create();

    $this->actingAs($admin)
        ->post(route('developers.pairing-codes.store', $developer))
        ->assertRedirect(route('developers.show', $developer))
        ->assertSessionHas('pairing_code');
});
