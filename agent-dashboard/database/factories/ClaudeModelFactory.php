<?php

namespace Database\Factories;

use App\Models\ClaudeModel;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ClaudeModel>
 */
class ClaudeModelFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'claude-'.fake()->randomElement(['opus', 'sonnet', 'haiku']).'-'.fake()->unique()->numerify('#-#-########'),
            'first_seen_at' => fake()->dateTimeBetween('-60 days', '-7 days'),
            'last_seen_at' => fake()->dateTimeBetween('-6 days', 'now'),
        ];
    }
}
