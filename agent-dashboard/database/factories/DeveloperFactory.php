<?php

namespace Database\Factories;

use App\Enums\DeveloperStatus;
use App\Models\Developer;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Developer>
 */
class DeveloperFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'team' => fake()->optional(0.8)->randomElement(['Backend', 'Frontend', 'Mobile', 'Platform', 'QA']),
            'status' => DeveloperStatus::Active,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => DeveloperStatus::Inactive,
        ]);
    }
}
