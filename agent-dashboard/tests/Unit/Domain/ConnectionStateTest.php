<?php

use App\Enums\ConnectionState;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterval;
use Tests\TestCase;

uses(TestCase::class);

beforeEach(function () {
    config(['monitor.online_minutes' => 10, 'monitor.stale_hours' => 24]);
    $this->now = CarbonImmutable::parse('2026-09-22T12:00:00Z');
});

test('null last seen is offline', function () {
    expect(ConnectionState::fromLastSeen(null, $this->now))->toBe(ConnectionState::Offline);
});

test('boundaries follow config', function (string $offset, ConnectionState $expected) {
    $lastSeen = $this->now->sub(CarbonInterval::fromString($offset));

    expect(ConnectionState::fromLastSeen($lastSeen, $this->now))->toBe($expected);
})->with([
    'just now' => ['0s', ConnectionState::Online],
    'exactly 10 minutes' => ['10m', ConnectionState::Online],
    '10 minutes + 1 second' => ['10m 1s', ConnectionState::Stale],
    'exactly 24 hours' => ['24h', ConnectionState::Stale],
    '24 hours + 1 second' => ['24h 1s', ConnectionState::Offline],
]);

test('now defaults to the current time', function () {
    CarbonImmutable::setTestNow($this->now);

    expect(ConnectionState::fromLastSeen($this->now->subMinutes(5)))->toBe(ConnectionState::Online)
        ->and(ConnectionState::fromLastSeen($this->now->subHours(2)))->toBe(ConnectionState::Stale);

    CarbonImmutable::setTestNow();
});

test('changing config moves the boundaries', function () {
    config(['monitor.online_minutes' => 5, 'monitor.stale_hours' => 1]);

    expect(ConnectionState::fromLastSeen($this->now->subMinutes(5), $this->now))->toBe(ConnectionState::Online)
        ->and(ConnectionState::fromLastSeen($this->now->subMinutes(6), $this->now))->toBe(ConnectionState::Stale)
        ->and(ConnectionState::fromLastSeen($this->now->subHour(), $this->now))->toBe(ConnectionState::Stale)
        ->and(ConnectionState::fromLastSeen($this->now->subMinutes(61), $this->now))->toBe(ConnectionState::Offline);
});
