<?php

namespace Database\Factories;

use App\Enums\PairingPurpose;
use App\Models\Developer;
use App\Models\Device;
use App\Models\PairingCode;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PairingCode>
 */
class PairingCodeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $code = fake()->unique()->regexify('[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}');

        return [
            'developer_id' => Developer::factory(),
            'code_hash' => PairingCode::hashCode($code),
            'expires_at' => now()->addMinutes((int) config('monitor.pairing_code_ttl_minutes')),
            'used_at' => null,
            'used_by_device_id' => null,
            'created_by_user_id' => User::factory()->admin(),
            'purpose' => PairingPurpose::Pair,
        ];
    }

    /**
     * Use a known plaintext code (e.g. 'K7Q2-M9XD') so tests can submit it.
     */
    public function withCode(string $code): static
    {
        return $this->state(fn (array $attributes) => [
            'code_hash' => PairingCode::hashCode($code),
        ]);
    }

    public function used(): static
    {
        return $this->state(fn (array $attributes) => [
            'used_at' => now()->subMinute(),
            'used_by_device_id' => fn (array $attributes) => Device::factory()->create(['developer_id' => $attributes['developer_id']])->id,
        ]);
    }

    public function expired(): static
    {
        return $this->state(fn (array $attributes) => [
            'expires_at' => now()->subMinute(),
        ]);
    }

    public function repair(): static
    {
        return $this->state(fn (array $attributes) => [
            'purpose' => PairingPurpose::Repair,
        ]);
    }
}
