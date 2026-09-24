<?php

use App\Support\TokenMath;

test('actual and total match the PRD example', function () {
    expect(TokenMath::actual(100000, 20000, 30000))->toBe(150000)
        ->and(TokenMath::total(100000, 20000, 30000, 500000))->toBe(650000);
});

test('forRow computes both values', function () {
    expect(TokenMath::forRow([
        'input_tokens' => 100000,
        'output_tokens' => 20000,
        'cache_creation_tokens' => 30000,
        'cache_read_tokens' => 500000,
    ]))->toBe([
        'actual_consumed_tokens' => 150000,
        'total_token_activity' => 650000,
    ]);
});

test('forRow treats missing keys as zero', function () {
    expect(TokenMath::forRow(['input_tokens' => 5, 'cache_read_tokens' => 7]))->toBe([
        'actual_consumed_tokens' => 5,
        'total_token_activity' => 12,
    ])->and(TokenMath::forRow([]))->toBe([
        'actual_consumed_tokens' => 0,
        'total_token_activity' => 0,
    ]);
});

test('zeros yield zero', function () {
    expect(TokenMath::actual(0, 0, 0))->toBe(0)
        ->and(TokenMath::total(0, 0, 0, 0))->toBe(0);
});

test('negative arguments throw', function (callable $call) {
    expect($call)->toThrow(InvalidArgumentException::class);
})->with([
    'actual input' => [fn () => TokenMath::actual(-1, 0, 0)],
    'actual output' => [fn () => TokenMath::actual(0, -1, 0)],
    'actual cache creation' => [fn () => TokenMath::actual(0, 0, -1)],
    'total input' => [fn () => TokenMath::total(-1, 0, 0, 0)],
    'total output' => [fn () => TokenMath::total(0, -1, 0, 0)],
    'total cache creation' => [fn () => TokenMath::total(0, 0, -1, 0)],
    'total cache read' => [fn () => TokenMath::total(0, 0, 0, -1)],
    'forRow input' => [fn () => TokenMath::forRow(['input_tokens' => -1])],
    'forRow output' => [fn () => TokenMath::forRow(['output_tokens' => -1])],
    'forRow cache creation' => [fn () => TokenMath::forRow(['cache_creation_tokens' => -1])],
    'forRow cache read' => [fn () => TokenMath::forRow(['cache_read_tokens' => -1])],
]);
