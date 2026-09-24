<?php

namespace App\Actions\Agent\Support;

use Illuminate\Http\JsonResponse;

/**
 * Builds the sync-api-v1 error envelope (docs/contracts/sync-api-v1.md §9).
 * Messages must never contain tokens, pairing codes, prompt text or emails.
 */
final class AgentError
{
    /**
     * `retryable` per code, mirroring RETRYABLE in 6am-agent/src/core/contract/errors.ts.
     */
    private const RETRYABLE = [
        'unauthenticated' => false,
        'device_disabled' => false,
        'device_uninstalled' => false,
        'batch_in_progress' => true,
        'batch_too_large' => true,
        'invalid_payload' => false,
        'invalid_pairing_code' => false,
        'agent_outdated' => false,
        'rate_limited' => true,
        'persistence_failed' => true,
    ];

    /**
     * @param  array<string, array<int, string>>|null  $errors  Field errors; only sent for invalid_payload.
     */
    public static function make(string $code, string $message, int $status, ?array $errors = null): JsonResponse
    {
        $error = [
            'code' => $code,
            'message' => $message,
            'retryable' => self::RETRYABLE[$code] ?? false,
        ];

        if ($code === 'invalid_payload') {
            $error['errors'] = (object) ($errors ?? []);
        }

        return new JsonResponse(['success' => false, 'error' => $error], $status);
    }

    /**
     * @param  array<string, array<int, string>>  $errors
     */
    public static function invalidPayload(array $errors): JsonResponse
    {
        return self::make('invalid_payload', 'The payload is invalid.', 422, $errors);
    }

    /**
     * One generic message for every pairing-code problem, so the response never reveals which check failed.
     */
    public static function invalidPairingCode(): JsonResponse
    {
        return self::make('invalid_pairing_code', 'The pairing code is invalid or has expired.', 422);
    }

    public static function agentOutdated(string $minAgentVersion): JsonResponse
    {
        return self::make(
            'agent_outdated',
            "This agent version is no longer supported. Update to {$minAgentVersion} or later.",
            426,
        );
    }
}
