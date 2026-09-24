<?php

namespace Tests\Feature\Agent;

use App\Models\Device;
use Illuminate\Testing\TestResponse;
use JsonException;
use PHPUnit\Framework\Assert;
use Symfony\Component\HttpFoundation\Response;

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
     * Asserts a response is the contract §9.1 error envelope for `$code`: it validates against
     * docs/contracts/schemas/error.json and has the same `retryable` as the code's canonical example.
     *
     * @param  TestResponse<Response>  $response
     *
     * @throws JsonException
     */
    public static function assertErrorEnvelope(TestResponse $response, int $status, string $code): void
    {
        $response->assertStatus($status);

        $path = base_path('../docs/contracts/schemas/error.json');
        /** @var array{properties: array{error: array{properties: array{code: array{enum: list<string>}}}}} $schema */
        $schema = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        $body = $response->json();
        $example = self::load('error.'.$code);

        Assert::assertIsArray($body);
        Assert::assertSame(['error', 'success'], self::sortedKeys($body));
        Assert::assertFalse($body['success']);
        Assert::assertIsArray($body['error']);
        $expectedKeys = $code === 'invalid_payload' ? ['code', 'errors', 'message', 'retryable'] : ['code', 'message', 'retryable'];
        Assert::assertSame($expectedKeys, self::sortedKeys($body['error']));
        Assert::assertContains($body['error']['code'], $schema['properties']['error']['properties']['code']['enum']);
        Assert::assertSame($code, $body['error']['code']);
        Assert::assertIsString($body['error']['message']);
        Assert::assertIsBool($body['error']['retryable']);
        Assert::assertIsArray($example['error']);
        Assert::assertSame($example['error']['retryable'], $body['error']['retryable']);
    }

    /**
     * @param  array<array-key, mixed>  $value
     * @return list<array-key>
     */
    private static function sortedKeys(array $value): array
    {
        $keys = array_keys($value);
        sort($keys);

        return $keys;
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
