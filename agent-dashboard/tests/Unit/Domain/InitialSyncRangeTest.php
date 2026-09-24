<?php

use App\Enums\InitialSyncRange;
use Carbon\CarbonImmutable;

test('each range resolves to a UTC-midnight since value', function (InitialSyncRange $range, ?string $expected) {
    $since = $range->sinceFrom(CarbonImmutable::parse('2026-09-22T15:45:10Z'));

    expect($since?->toIso8601ZuluString())->toBe($expected);
})->with([
    '1d' => [InitialSyncRange::OneDay, '2026-09-21T00:00:00Z'],
    '7d' => [InitialSyncRange::SevenDays, '2026-09-15T00:00:00Z'],
    '30d' => [InitialSyncRange::ThirtyDays, '2026-08-23T00:00:00Z'],
    'all' => [InitialSyncRange::All, null],
]);

test('sinceFrom normalises a non-UTC now to UTC first', function () {
    $now = CarbonImmutable::parse('2026-09-22T03:00:00', 'Asia/Dhaka'); // 2026-09-21T21:00Z

    expect(InitialSyncRange::SevenDays->sinceFrom($now)?->toIso8601ZuluString())->toBe('2026-09-14T00:00:00Z');
});

test('backing values match the contract', function () {
    expect(array_map(fn (InitialSyncRange $r) => $r->value, InitialSyncRange::cases()))
        ->toBe(['1d', '7d', '30d', 'all']);
});
