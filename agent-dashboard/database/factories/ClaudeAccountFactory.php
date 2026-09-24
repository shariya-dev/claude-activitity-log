<?php

namespace Database\Factories;

use App\Models\ClaudeAccount;
use App\Models\Developer;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ClaudeAccount>
 */
class ClaudeAccountFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $accountUuid = fake()->uuid();

        return [
            'developer_id' => Developer::factory(),
            'account_key' => hash('sha256', $accountUuid),
            'account_uuid' => $accountUuid,
            'email' => fake()->safeEmail(),
            'display_name' => fake()->name(),
            'organization_uuid' => fake()->uuid(),
            'organization_name' => fake()->company(),
            'status' => 'active',
            'first_seen_at' => fake()->dateTimeBetween('-60 days', '-7 days'),
            'last_seen_at' => fake()->dateTimeBetween('-6 days', 'now'),
        ];
    }
}
