<?php

use App\Support\OrgClock;
use Carbon\CarbonImmutable;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
});

test('timezone comes from config', function () {
    expect(OrgClock::timezone())->toBe('Asia/Dhaka');

    config(['monitor.timezone' => 'UTC']);

    expect(OrgClock::timezone())->toBe('UTC');
});

test('dateFor returns the org-timezone calendar date', function () {
    expect(OrgClock::dateFor(CarbonImmutable::parse('2026-09-21T20:30:00Z')))->toBe('2026-09-22')
        ->and(OrgClock::dateFor(CarbonImmutable::parse('2026-09-21T17:59:59Z')))->toBe('2026-09-21');
});

test('startOfDayUtc returns org midnight expressed in UTC', function () {
    $start = OrgClock::startOfDayUtc('2026-09-22');

    expect($start)->toBeInstanceOf(CarbonImmutable::class)
        ->and($start->toIso8601ZuluString())->toBe('2026-09-21T18:00:00Z')
        ->and($start->timezoneName)->toBe('UTC');
});

test('now is in UTC', function () {
    CarbonImmutable::setTestNow('2026-09-22T10:00:00Z');

    $now = OrgClock::now();

    expect($now)->toBeInstanceOf(CarbonImmutable::class)
        ->and($now->timezoneName)->toBe('UTC')
        ->and($now->toIso8601ZuluString())->toBe('2026-09-22T10:00:00Z');

    CarbonImmutable::setTestNow();
});
