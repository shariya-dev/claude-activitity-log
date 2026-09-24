<?php

namespace Database\Factories;

use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Project>
 */
class ProjectFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = Str::studly(fake()->words(2, true)).'-'.fake()->randomElement(['Api', 'CMS', 'App', 'Service']);

        return [
            'project_key' => hash('sha256', fake()->unique()->uuid()),
            'name' => $name,
            'git_remote' => null,
            'first_activity_at' => fake()->dateTimeBetween('-60 days', '-7 days'),
            'last_activity_at' => fake()->dateTimeBetween('-6 days', 'now'),
            'session_count' => 0,
            'input_tokens' => 0,
            'output_tokens' => 0,
            'cache_creation_tokens' => 0,
            'cache_read_tokens' => 0,
            'actual_consumed_tokens' => 0,
            'total_token_activity' => 0,
        ];
    }
}
