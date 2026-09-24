<?php

namespace Database\Factories;

use App\Models\ClaudeSession;
use App\Models\SessionMessage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SessionMessage>
 */
class SessionMessageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'claude_session_id' => ClaudeSession::factory(),
            'source_message_id' => fake()->uuid(),
            'role' => 'user',
            'content' => fake()->sentence(12),
            'recorded_at' => fn (array $attributes) => ClaudeSession::findOrFail($attributes['claude_session_id'])->started_at,
        ];
    }
}
