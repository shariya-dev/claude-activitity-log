<?php

namespace Database\Factories;

use App\Models\Device;
use App\Models\UsageDailyRollup;
use App\Support\OrgClock;
use App\Support\TokenMath;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<UsageDailyRollup>
 */
class UsageDailyRollupFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'date' => OrgClock::dateFor(now()->subDays(fake()->numberBetween(0, 29))),
            'device_id' => Device::factory(),
            'developer_id' => fn (array $attributes) => Device::findOrFail($attributes['device_id'])->developer_id,
            'project_id' => null,
            'claude_account_id' => null,
            'claude_model_id' => null,
            'dims_hash' => fn (array $attributes) => hash('sha256', implode('|', [
                $attributes['date'],
                $attributes['developer_id'],
                $attributes['device_id'],
                $attributes['project_id'] ?? '',
                $attributes['claude_account_id'] ?? '',
                $attributes['claude_model_id'] ?? '',
            ])),
            'input_tokens' => fake()->numberBetween(100, 50_000),
            'output_tokens' => fake()->numberBetween(1_000, 100_000),
            'cache_creation_tokens' => fake()->numberBetween(0, 500_000),
            'cache_read_tokens' => fake()->numberBetween(0, 5_000_000),
            'actual_consumed_tokens' => fn (array $attributes) => TokenMath::forRow($attributes)['actual_consumed_tokens'],
            'total_token_activity' => fn (array $attributes) => TokenMath::forRow($attributes)['total_token_activity'],
            'message_count' => fake()->numberBetween(1, 400),
        ];
    }
}
