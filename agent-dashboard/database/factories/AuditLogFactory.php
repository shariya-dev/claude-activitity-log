<?php

namespace Database\Factories;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AuditLog>
 */
class AuditLogFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory()->admin(),
            'action' => fake()->randomElement(['tracking.updated', 'device.disabled', 'pairing_code.issued', 'sync.requested']),
            'subject_type' => null,
            'subject_id' => null,
            'metadata' => [],
            'ip_address' => fake()->ipv4(),
            'user_agent' => fake()->userAgent(),
        ];
    }

    public function system(): static
    {
        return $this->state(fn (array $attributes) => [
            'user_id' => null,
            'ip_address' => null,
            'user_agent' => null,
        ]);
    }
}
