<?php

use App\Queries\Analytics\DateRange;
use App\Queries\Analytics\Granularity;
use App\Queries\Analytics\UsageFilters;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

beforeEach(function () {
    config(['monitor.timezone' => 'Asia/Dhaka']);
    Carbon::setTestNow(CarbonImmutable::parse('2026-09-22 10:00:00', 'Asia/Dhaka'));
});

afterEach(function () {
    Carbon::setTestNow();
});

dataset('presets', [
    'today' => ['today', '2026-09-22', '2026-09-22'],
    'yesterday' => ['yesterday', '2026-09-21', '2026-09-21'],
    'week starts Monday' => ['week', '2026-09-21', '2026-09-27'],
    'month' => ['month', '2026-09-01', '2026-09-30'],
    'year' => ['year', '2026-01-01', '2026-12-31'],
]);

test('presets resolve to org-timezone calendar boundaries', function (string $preset, string $from, string $to) {
    $range = DateRange::preset($preset);

    expect($range->preset)->toBe($preset)
        ->and($range->startDate())->toBe($from)
        ->and($range->endDate())->toBe($to)
        ->and($range->start->getTimezone()->getName())->toBe('Asia/Dhaka')
        ->and($range->start->format('H:i:s'))->toBe('00:00:00')
        ->and($range->end->format('H:i:s'))->toBe('23:59:59')
        ->and($range->toArray())->toBe(['preset' => $preset, 'from' => $from, 'to' => $to]);
})->with('presets');

test('today uses the org day even when UTC is still on the previous date', function () {
    // 2026-09-22 02:00 in Dhaka is 2026-09-21 20:00 UTC.
    $range = DateRange::preset('today', CarbonImmutable::parse('2026-09-21 20:00:00', 'UTC'));

    expect($range->startDate())->toBe('2026-09-22')
        ->and($range->start->utc()->format('Y-m-d H:i:s'))->toBe('2026-09-21 18:00:00');
});

test('a Sunday belongs to the week that started the previous Monday', function () {
    $range = DateRange::preset('week', CarbonImmutable::parse('2026-09-27 23:30:00', 'Asia/Dhaka'));

    expect($range->startDate())->toBe('2026-09-21')
        ->and($range->endDate())->toBe('2026-09-27');
});

test('unknown presets are rejected by preset()', function () {
    DateRange::preset('fortnight');
})->throws(InvalidArgumentException::class);

test('fromRequest falls back to the default preset when range is missing or unknown', function () {
    expect(DateRange::fromRequest(Request::create('/'))->toArray())
        ->toBe(['preset' => 'week', 'from' => '2026-09-21', 'to' => '2026-09-27'])
        ->and(DateRange::fromRequest(Request::create('/', 'GET', ['range' => 'bogus']), 'month')->preset)
        ->toBe('month')
        ->and(DateRange::fromRequest(Request::create('/', 'GET', ['range' => 'today']))->startDate())
        ->toBe('2026-09-22');
});

test('fromRequest builds a custom range from from/to', function () {
    $range = DateRange::fromRequest(Request::create('/', 'GET', ['range' => 'custom', 'from' => '2026-08-10', 'to' => '2026-09-02']));

    expect($range->toArray())->toBe(['preset' => 'custom', 'from' => '2026-08-10', 'to' => '2026-09-02'])
        ->and($range->start->toDateTimeString())->toBe('2026-08-10 00:00:00')
        ->and($range->end->toDateTimeString())->toBe('2026-09-02 23:59:59')
        ->and($range->start->getTimezone()->getName())->toBe('Asia/Dhaka');
});

dataset('invalid custom ranges', [
    'missing from' => [['to' => '2026-09-02'], 'from'],
    'missing to' => [['from' => '2026-09-02'], 'to'],
    'bad format' => [['from' => '09/02/2026', 'to' => '2026-09-10'], 'from'],
    'impossible date' => [['from' => '2026-02-30', 'to' => '2026-03-10'], 'from'],
    'to before from' => [['from' => '2026-09-10', 'to' => '2026-09-02'], 'to'],
    'longer than 3 years' => [['from' => '2023-09-01', 'to' => '2026-09-01'], 'to'],
]);

test('custom ranges are validated', function (array $params, string $errorKey) {
    try {
        DateRange::fromRequest(Request::create('/', 'GET', ['range' => 'custom', ...$params]));
        $this->fail('Expected a validation exception.');
    } catch (ValidationException $e) {
        expect($e->errors())->toHaveKey($errorKey);
    }
})->with('invalid custom ranges');

test('a custom range of exactly 3 years is allowed', function () {
    $range = DateRange::fromRequest(Request::create('/', 'GET', ['range' => 'custom', 'from' => '2023-09-01', 'to' => '2026-08-31']));

    expect($range->endDate())->toBe('2026-08-31');
});

dataset('granularity', [
    'single day' => ['2026-09-22', '2026-09-22', Granularity::Day],
    '45 days' => ['2026-08-01', '2026-09-14', Granularity::Day],
    '46 days' => ['2026-08-01', '2026-09-15', Granularity::Week],
    '26 weeks' => ['2026-01-01', '2026-07-01', Granularity::Week],
    '26 weeks and a day' => ['2026-01-01', '2026-07-02', Granularity::Month],
    'full year' => ['2026-01-01', '2026-12-31', Granularity::Month],
    '3 years' => ['2023-09-01', '2026-08-31', Granularity::Month],
    'over 3 years' => ['2023-09-01', '2026-09-01', Granularity::Year],
]);

test('auto granularity follows the span of the range', function (string $from, string $to, Granularity $expected) {
    $range = new DateRange(
        CarbonImmutable::parse($from, 'Asia/Dhaka')->startOfDay(),
        CarbonImmutable::parse($to, 'Asia/Dhaka')->endOfDay(),
        'custom',
    );

    expect(Granularity::auto($range))->toBe($expected);
})->with('granularity');

test('usage filters read integer ids from the request and ignore junk', function () {
    $filters = UsageFilters::fromRequest(Request::create('/', 'GET', [
        'range' => 'today', 'developer' => '7', 'device' => '12', 'account' => 'abc', 'project' => '0', 'model' => '3',
    ]));

    expect($filters->range->preset)->toBe('today')
        ->and($filters->developerId)->toBe(7)
        ->and($filters->deviceId)->toBe(12)
        ->and($filters->accountId)->toBeNull()
        ->and($filters->projectId)->toBeNull()
        ->and($filters->modelId)->toBe(3);
});
