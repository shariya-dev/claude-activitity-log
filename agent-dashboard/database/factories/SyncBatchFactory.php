<?php

namespace Database\Factories;

use App\Enums\SyncBatchStatus;
use App\Models\Device;
use App\Models\SyncBatch;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SyncBatch>
 */
class SyncBatchFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $created = fake()->numberBetween(0, 200);
        $updated = fake()->numberBetween(0, 50);
        $receivedAt = now()->subMinutes(fake()->numberBetween(1, 600));
        $durationMs = fake()->numberBetween(20, 900);

        return [
            'device_id' => Device::factory(),
            'batch_uuid' => fake()->uuid(),
            'status' => SyncBatchStatus::Succeeded,
            'is_initial' => false,
            'accepted' => $created + $updated,
            'created' => $created,
            'updated' => $updated,
            'rejected' => 0,
            'rejections' => null,
            'error_code' => null,
            'payload_bytes' => fake()->numberBetween(1_000, 500_000),
            'duration_ms' => $durationMs,
            'response' => null,
            'received_at' => $receivedAt,
            'completed_at' => $receivedAt->copy()->addMilliseconds($durationMs),
        ];
    }

    public function processing(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => SyncBatchStatus::Processing,
            'completed_at' => null,
        ]);
    }

    public function failed(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => SyncBatchStatus::Failed,
            'accepted' => 0,
            'created' => 0,
            'updated' => 0,
            'error_code' => 'persistence_failed',
        ]);
    }
}
