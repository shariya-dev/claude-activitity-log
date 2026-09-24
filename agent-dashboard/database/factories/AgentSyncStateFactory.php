<?php

namespace Database\Factories;

use App\Enums\SyncHealth;
use App\Models\AgentSyncState;
use App\Models\Device;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AgentSyncState>
 */
class AgentSyncStateFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'device_id' => Device::factory(),
            'cursor' => null,
            'sequence' => 0,
            'last_batch_uuid' => null,
            'last_success_at' => null,
            'last_failure_at' => null,
            'last_error_code' => null,
            'last_error_message' => null,
            'consecutive_failures' => 0,
            'records_created_total' => 0,
            'records_updated_total' => 0,
            'records_rejected_total' => 0,
            'health' => SyncHealth::Healthy,
        ];
    }

    public function synced(): static
    {
        return $this->state(fn (array $attributes) => [
            'sequence' => fake()->numberBetween(1, 500),
            'last_batch_uuid' => fake()->uuid(),
            'last_success_at' => now()->subMinutes(fake()->numberBetween(1, 5)),
            'records_created_total' => fake()->numberBetween(100, 5000),
            'records_updated_total' => fake()->numberBetween(0, 500),
        ]);
    }

    public function failing(): static
    {
        return $this->state(fn (array $attributes) => [
            'last_failure_at' => now(),
            'last_error_code' => 'persistence_failed',
            'last_error_message' => 'Sync failed.',
            'consecutive_failures' => 3,
            'health' => SyncHealth::SyncFailed,
        ]);
    }
}
