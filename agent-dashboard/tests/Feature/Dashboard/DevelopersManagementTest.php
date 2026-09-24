<?php

use App\Enums\DeveloperStatus;
use App\Models\AuditLog;
use App\Models\ClaudeSession;
use App\Models\Developer;
use App\Models\Device;
use App\Models\UsageDailyRollup;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('admins create a developer', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->from(route('developers.index'))
        ->post(route('developers.store'), [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.test',
            'team' => 'Platform',
        ])
        ->assertRedirect()
        ->assertSessionHasNoErrors()
        ->assertSessionHas('success');

    $developer = Developer::query()->sole();

    expect($developer->name)->toBe('Ada Lovelace')
        ->and($developer->email)->toBe('ada@example.test')
        ->and($developer->team)->toBe('Platform')
        ->and($developer->status)->toBe(DeveloperStatus::Active);

    expect(AuditLog::query()->where('action', 'developer.created')->where('subject_id', $developer->id)->exists())->toBeTrue();
});

test('a new developer needs a name and a unique valid email', function () {
    $admin = User::factory()->admin()->create();
    Developer::factory()->create(['email' => 'taken@example.test']);

    $this->actingAs($admin)
        ->post(route('developers.store'), ['name' => '', 'email' => 'not-an-email'])
        ->assertSessionHasErrors(['name', 'email']);

    $this->actingAs($admin)
        ->post(route('developers.store'), ['name' => 'Someone', 'email' => 'taken@example.test'])
        ->assertSessionHasErrors(['email']);

    expect(Developer::query()->count())->toBe(1);
});

test('emails stay unique against soft-deleted developers', function () {
    $admin = User::factory()->admin()->create();
    Developer::factory()->create(['email' => 'gone@example.test'])->delete();

    $this->actingAs($admin)
        ->post(route('developers.store'), ['name' => 'Someone', 'email' => 'gone@example.test'])
        ->assertSessionHasErrors(['email']);
});

test('admins update a developer and may keep the same email', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->create(['email' => 'same@example.test', 'team' => 'Backend']);

    $this->actingAs($admin)
        ->put(route('developers.update', $developer), [
            'name' => 'Renamed',
            'email' => 'same@example.test',
            'team' => 'Mobile',
            'status' => 'active',
        ])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    $developer->refresh();

    expect($developer->name)->toBe('Renamed')->and($developer->team)->toBe('Mobile');

    $audit = AuditLog::query()->where('action', 'developer.updated')->sole();

    expect($audit->metadata)->toHaveKey('before')->toHaveKey('after');
});

test('updating to another developer email is rejected', function () {
    $admin = User::factory()->admin()->create();
    Developer::factory()->create(['email' => 'other@example.test']);
    $developer = Developer::factory()->create();

    $this->actingAs($admin)
        ->put(route('developers.update', $developer), [
            'name' => 'X', 'email' => 'other@example.test', 'team' => null, 'status' => 'active',
        ])
        ->assertSessionHasErrors(['email']);
});

test('status must be a known developer status', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->create();

    $this->actingAs($admin)
        ->put(route('developers.update', $developer), [
            'name' => 'X', 'email' => $developer->email, 'team' => null, 'status' => 'deleted',
        ])
        ->assertSessionHasErrors(['status']);
});

test('deactivating a developer keeps devices, sessions and usage history', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->create();
    $devices = Device::factory()->count(2)->for($developer)->create();
    ClaudeSession::factory()->for($devices[0])->create(['developer_id' => $developer->id]);
    UsageDailyRollup::factory()->create(['device_id' => $devices[1]->id, 'developer_id' => $developer->id]);

    $this->actingAs($admin)
        ->put(route('developers.update', $developer), [
            'name' => $developer->name,
            'email' => $developer->email,
            'team' => $developer->team,
            'status' => 'inactive',
        ])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    $fresh = Developer::withTrashed()->findOrFail($developer->id);

    expect($fresh->status)->toBe(DeveloperStatus::Inactive)
        ->and($fresh->trashed())->toBeFalse()
        ->and($fresh->devices()->count())->toBe(2)
        ->and($fresh->sessions()->count())->toBe(1)
        ->and(UsageDailyRollup::query()->where('developer_id', $developer->id)->count())->toBe(1);

    expect(AuditLog::query()->where('action', 'developer.deactivated')->where('subject_id', $developer->id)->exists())->toBeTrue();
});

test('reactivating a developer is audited with only the changed fields', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->inactive()->create();

    $this->actingAs($admin)
        ->put(route('developers.update', $developer), [
            'name' => $developer->name, 'email' => $developer->email, 'team' => $developer->team, 'status' => 'active',
        ])
        ->assertSessionHasNoErrors();

    $audit = AuditLog::query()->where('action', 'developer.reactivated')->sole();

    expect($audit->metadata)->toEqual(['before' => ['status' => 'inactive'], 'after' => ['status' => 'active']]);
});

test('saving without changes writes no audit row', function () {
    $admin = User::factory()->admin()->create();
    $developer = Developer::factory()->create();

    $this->actingAs($admin)
        ->put(route('developers.update', $developer), [
            'name' => $developer->name, 'email' => $developer->email, 'team' => $developer->team, 'status' => 'active',
        ])
        ->assertSessionHasNoErrors()
        ->assertSessionHas('success');

    expect(AuditLog::query()->where('action', 'like', 'developer.%')->count())->toBe(0);
});
