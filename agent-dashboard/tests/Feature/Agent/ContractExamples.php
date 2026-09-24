<?php

namespace Tests\Feature\Agent;

use App\Models\Device;
use JsonException;

/**
 * Loads the canonical sync-api-v1 payloads from docs/contracts/examples so agent tests use the contract, not ad-hoc JSON.
 */
final class ContractExamples
{
    /**
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    public static function load(string $name): array
    {
        $path = base_path('../docs/contracts/examples/'.$name.'.json');

        /** @var array<string, mixed> $decoded */
        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        return $decoded;
    }

    /**
     * The register request example, with optional overrides for the pairing code and device fields.
     *
     * @param  array<string, mixed>  $device
     * @return array<string, mixed>
     */
    public static function registerRequest(?string $code = null, array $device = []): array
    {
        $payload = self::load('register.request');

        if ($code !== null) {
            $payload['pairing_code'] = $code;
        }

        /** @var array<string, mixed> $exampleDevice */
        $exampleDevice = $payload['device'];
        $payload['device'] = array_merge($exampleDevice, $device);

        return $payload;
    }

    /**
     * Recursive key structure of a payload, used to compare a response's shape with a contract example.
     *
     * @param  array<array-key, mixed>  $payload
     * @return array<array-key, mixed>
     */
    public static function shape(array $payload): array
    {
        $shape = [];

        foreach ($payload as $key => $value) {
            $shape[$key] = is_array($value) && ! array_is_list($value) ? self::shape($value) : true;
        }

        ksort($shape);

        return $shape;
    }

    /**
     * Authorization headers for a freshly issued device token.
     *
     * @return array<string, string>
     */
    public static function agentHeaders(Device $device, string $agentVersion = '1.0.0'): array
    {
        return [
            'Authorization' => 'Bearer '.$device->createToken('agent', ['agent'])->plainTextToken,
            'X-Agent-Version' => $agentVersion,
        ];
    }
}
