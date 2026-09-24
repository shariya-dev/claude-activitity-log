<?php

namespace Database\Factories;

use App\Models\Device;
use App\Models\Project;
use App\Models\ProjectLocation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ProjectLocation>
 */
class ProjectLocationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $path = '/Users/'.fake()->userName().'/code/'.fake()->slug(2);

        return [
            'project_id' => Project::factory(),
            'device_id' => Device::factory(),
            'path' => $path,
            'path_hash' => hash('sha256', $path),
            'first_seen_at' => fake()->dateTimeBetween('-60 days', '-7 days'),
            'last_seen_at' => fake()->dateTimeBetween('-6 days', 'now'),
        ];
    }
}
