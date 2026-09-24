<?php

namespace Database\Factories;

use App\Enums\SessionStatus;
use App\Models\ClaudeSession;
use App\Models\Device;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<ClaudeSession>
 */
class ClaudeSessionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $startedAt = Carbon::instance(fake()->dateTimeBetween('-6 days', '-2 hours'));
        $durationSeconds = fake()->numberBetween(60, 90 * 60);

        return [
            'device_id' => Device::factory(),
            'developer_id' => fn (array $attributes) => Device::findOrFail($attributes['device_id'])->developer_id,
            'claude_account_id' => null,
            'project_id' => null,
            'claude_model_id' => null,
            'source_session_id' => fake()->uuid(),
            'started_at' => $startedAt,
            'last_activity_at' => $startedAt->copy()->addSeconds($durationSeconds),
            'ended_at' => null,
            'duration_seconds' => $durationSeconds,
            'activity_count' => 0,
            'input_tokens' => 0,
            'output_tokens' => 0,
            'cache_creation_tokens' => 0,
            'cache_read_tokens' => 0,
            'actual_consumed_tokens' => 0,
            'total_token_activity' => 0,
            'status' => SessionStatus::Idle,
            'claude_code_version' => fake()->randomElement(['2.1.260', '2.1.274', '2.2.3']),
            'entrypoint' => fake()->randomElement(['cli', 'sdk-cli', 'claude-vscode']),
            'git_branch' => null,
        ];
    }

    public function active(): static
    {
        return $this->state(function (array $attributes) {
            $startedAt = now()->subMinutes(20);

            return [
                'started_at' => $startedAt,
                'last_activity_at' => now()->subMinutes(2),
                'duration_seconds' => 18 * 60,
                'status' => SessionStatus::Active,
            ];
        });
    }

    public function ended(): static
    {
        return $this->state(fn (array $attributes) => [
            'ended_at' => $attributes['last_activity_at'],
            'status' => SessionStatus::Ended,
        ]);
    }
}
