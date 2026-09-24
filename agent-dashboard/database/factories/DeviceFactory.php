<?php

namespace Database\Factories;

use App\Enums\DeviceStatus;
use App\Models\Developer;
use App\Models\Device;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Device>
 */
class DeviceFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        /** @var string $platform */
        $platform = fake()->randomElement(config('monitor.platforms'));

        [$platformVersion, $architecture, $suffix] = match ($platform) {
            'macos' => [fake()->randomElement(['15.6.1', '26.0', '26.0.1']), fake()->randomElement(['arm64', 'x64']), fake()->randomElement(['mbp', 'mba', 'imac'])],
            'windows' => [fake()->randomElement(['10.0.22631', '10.0.26100']), 'x64', fake()->randomElement(['pc', 'desktop', 'laptop'])],
            default => [fake()->randomElement(['6.8.0-45-generic', '6.11.0-8-generic']), fake()->randomElement(['x64', 'arm64']), fake()->randomElement(['ubuntu', 'fedora', 'workstation'])],
        };

        $lastSeen = fake()->dateTimeBetween('-5 minutes', 'now');

        return [
            'developer_id' => Developer::factory(),
            'machine_fingerprint' => hash('sha256', fake()->uuid()),
            'hostname' => fake()->userName().'-'.$suffix,
            'platform' => $platform,
            'platform_version' => $platformVersion,
            'architecture' => $architecture,
            'agent_version' => '1.0.0',
            'claude_code_version' => fake()->randomElement(['2.1.260', '2.1.274', '2.2.3']),
            'status' => DeviceStatus::Active,
            'agent_state' => 'ok',
            'first_seen_at' => fake()->dateTimeBetween('-60 days', '-1 day'),
            'last_seen_at' => $lastSeen,
            'last_sync_at' => $lastSeen,
            'last_local_activity_at' => $lastSeen,
        ];
    }

    public function disabled(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => DeviceStatus::Disabled,
            'disabled_at' => now(),
        ]);
    }

    public function uninstalled(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => DeviceStatus::Uninstalled,
            'uninstalled_at' => now(),
        ]);
    }

    public function online(): static
    {
        return $this->state(fn (array $attributes) => [
            'last_seen_at' => now()->subMinutes(2),
        ]);
    }

    public function stale(): static
    {
        return $this->state(fn (array $attributes) => [
            'last_seen_at' => now()->subHours(3),
        ]);
    }

    public function offline(): static
    {
        return $this->state(fn (array $attributes) => [
            'last_seen_at' => now()->subDays(3),
        ]);
    }
}
