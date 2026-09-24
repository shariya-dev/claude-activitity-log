<?php

namespace Database\Factories;

use App\Models\ClaudeSession;
use App\Models\SessionUsage;
use App\Support\OrgClock;
use App\Support\TokenMath;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * Dimension columns are copied from the parent session; calc columns always come from TokenMath.
 *
 * @extends Factory<SessionUsage>
 */
class SessionUsageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $session = fn (array $attributes): ClaudeSession => ClaudeSession::findOrFail($attributes['claude_session_id']);

        return [
            'claude_session_id' => ClaudeSession::factory(),
            'source_message_id' => 'msg_'.fake()->unique()->regexify('[A-Za-z0-9]{24}'),
            'request_id' => 'req_'.fake()->regexify('[A-Za-z0-9]{24}'),
            'is_sidechain' => false,
            'claude_model_id' => fn (array $attributes) => $session($attributes)->claude_model_id,
            'device_id' => fn (array $attributes) => $session($attributes)->device_id,
            'developer_id' => fn (array $attributes) => $session($attributes)->developer_id,
            'project_id' => fn (array $attributes) => $session($attributes)->project_id,
            'claude_account_id' => fn (array $attributes) => $session($attributes)->claude_account_id,
            'input_tokens' => fake()->numberBetween(1, 5_000),
            'output_tokens' => fake()->numberBetween(10, 4_000),
            'cache_creation_tokens' => fake()->numberBetween(0, 50_000),
            'cache_read_tokens' => fake()->numberBetween(0, 200_000),
            'actual_consumed_tokens' => fn (array $attributes) => TokenMath::forRow($attributes)['actual_consumed_tokens'],
            'total_token_activity' => fn (array $attributes) => TokenMath::forRow($attributes)['total_token_activity'],
            'recorded_at' => fn (array $attributes) => $session($attributes)->started_at->copy()->addSeconds(fake()->numberBetween(0, 60)),
            'recorded_on' => fn (array $attributes) => OrgClock::dateFor(Carbon::parse($attributes['recorded_at'])),
        ];
    }
}
